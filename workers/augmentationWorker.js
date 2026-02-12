const path = require('path');
require('dotenv').config({
  path: path.resolve(process.cwd(), '.env'),
});

const { spawn } = require('child_process');
const mongoose = require('mongoose');
const fs = require('fs').promises;

const { augmentationQueue } = require('../queue');
const Dataset = require('../models/Dataset');
const storageAdapter = require('../services/storageAdapter');

/**
 * Augmentation Worker - Background Job Processor
 *
 * This worker orchestrates the Python-based image data augmentation using the
 * existing `image_data_augmentation` code. It is designed to be additive and
 * not to interfere with existing preprocessing/training workers.
 */

/**
 * Compute next dataset version string for a given company/project.
 * Existing convention is simple strings like "v1", "v2", ...
 * We keep that convention and increment the numeric suffix.
 */
async function getNextVersion(company, project) {
  const datasets = await Dataset.find({ company, project }).select('version').lean();
  if (!datasets.length) {
    return 'v1';
  }

  let maxNum = 1;
  for (const d of datasets) {
    const match = typeof d.version === 'string' && d.version.match(/^v(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  return `v${maxNum + 1}`;
}

/**
 * Run Python augmentation script as a child process.
 * Returns { exitCode, stdout, stderr }.
 */
function runPythonAugmentation({
  inputRoot,
  outputRoot,
  targetTrainTotal,
  valTestMultiplier,
  targetSize,
}) {
  return new Promise((resolve) => {
    const pythonBin = process.env.AUG_PYTHON_BIN || 'python';
    const scriptPath = path.join(
      process.cwd(),
      'image_data_augmentation',
      'run_augmentation.py',
    );

    const args = [
      scriptPath,
      '--input-root',
      inputRoot,
      '--output-root',
      outputRoot,
      '--target-train-total',
      String(targetTrainTotal),
      '--val-test-multiplier',
      String(valTestMultiplier),
      '--target-size',
      String(targetSize),
    ];

    console.log('[AUGMENT-WORKER] Spawning Python augmentation process', {
      pythonBin,
      scriptPath,
      inputRoot,
      outputRoot,
      targetTrainTotal,
      valTestMultiplier,
      targetSize,
    });

    const child = spawn(pythonBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log('[AUGMENT-PYTHON-STDOUT]', text.trimEnd());
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error('[AUGMENT-PYTHON-STDERR]', text.trimEnd());
    });

    child.on('close', (code) => {
      console.log('[AUGMENT-WORKER] Python process exited with code', code);
      resolve({
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Run Python fix_labels script against the labels root directory.
 * Returns { exitCode, stdout, stderr }.
 */
function runPythonFixLabels({ labelsRoot }) {
  return new Promise((resolve) => {
    const pythonBin = process.env.AUG_PYTHON_BIN || 'python';
    const scriptPath = path.join(
      process.cwd(),
      'image_data_augmentation',
      'fix_labels.py',
    );

    const args = [scriptPath, labelsRoot];

    console.log('[AUGMENT-WORKER] Spawning Python fix_labels process', {
      pythonBin,
      scriptPath,
      labelsRoot,
    });

    const child = spawn(pythonBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log('[FIX-LABELS-PYTHON-STDOUT]', text.trimEnd());
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error('[FIX-LABELS-PYTHON-STDERR]', text.trimEnd());
    });

    child.on('close', (code) => {
      console.log('[AUGMENT-WORKER] fix_labels process exited with code', code);
      resolve({
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Compute recursive folder size in bytes.
 */
async function computeFolderSize(rootPath) {
  let total = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const st = await fs.stat(fullPath);
          total += st.size;
        } catch {
          // ignore
        }
      }
    }
  }
  await walk(rootPath);
  return total;
}

/**
 * Process a single augmentation job.
 *
 * Job data:
 * {
 *   datasetId: string (original dataset),
 *   targetTrainTotal?: number,
 *   valTestMultiplier?: number,
 *   targetSize?: number
 * }
 */
const processAugmentationJob = async (job) => {
  const {
    datasetId,
    targetTrainTotal,
    valTestMultiplier,
    targetSize,
    augmentationMultiplier,
  } = job.data || {};

  console.log('[AUGMENT-WORKER] Processing augmentation job', {
    jobId: job.id,
    datasetId,
  });

  let originalDataset;
  let augmentedDataset;

  try {
    originalDataset = await Dataset.findById(datasetId);
    if (!originalDataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    if (originalDataset.status !== 'ready' && originalDataset.status !== 'ready_to_train') {
      throw new Error(
        `Dataset must be in 'ready' or 'ready_to_train' status for augmentation. Current status: ${originalDataset.status}`,
      );
    }

    if (originalDataset.augmentationStatus === 'running') {
      // Check if there is an in-flight augmented dataset for this original dataset.
      // If yes, this really is a duplicate job and we should no-op.
      // If not, treat the 'running' status as stale and allow augmentation to proceed.
      const existingRunningAugmented = await Dataset.findOne({
        backupDatasetId: originalDataset._id,
        augmentationStatus: 'running',
        deletedAt: null,
      })
        .select('_id version')
        .lean();

      if (existingRunningAugmented) {
        console.log('[AUGMENT-WORKER] Duplicate augmentation job detected; ignoring', {
          jobId: job.id,
          datasetId,
          existingAugmentedDatasetId: existingRunningAugmented._id,
          existingAugmentedVersion: existingRunningAugmented.version,
        });
        // Treat duplicate jobs as a no-op so they don't appear as hard failures
        return {
          skipped: true,
          reason: 'Augmentation already running for this dataset',
        };
      }

      console.warn(
        '[AUGMENT-WORKER] Original dataset marked as augmentationStatus=running but no active augmented dataset found; treating as stale state and continuing',
        {
          jobId: job.id,
          datasetId,
        },
      );
    }

    // Mark original as running (non-destructive to status)
    originalDataset.augmentationStatus = 'running';
    await originalDataset.save();

    const { company, project } = originalDataset;
    const newVersion = await getNextVersion(company, project);

    const outputRoot = storageAdapter.buildDatasetPath(company, project, newVersion);
    const inputRoot = storageAdapter.buildDatasetPath(
      company,
      project,
      originalDataset.version,
    );

    // Create augmented dataset document (minimal fields; will be updated after success)
    // Start as inactive; will be set to active after successful augmentation
    augmentedDataset = new Dataset({
      company,
      project,
      version: newVersion,
      storagePath: outputRoot,
      status: 'processing',
      augmentationStatus: 'running',
      isAugmented: true,
      backupDatasetId: originalDataset._id,
      augmentationMultiplier: augmentationMultiplier || null,
      augmentedFromVersion: originalDataset.version,
      isActive: false, // Will be set to true after successful augmentation
      totalImages: 0,
      sizeBytes: 0,
      uploadErrors: [],
      files: [],
    });

    await augmentedDataset.save();

    console.log('[AUGMENT-WORKER] Created augmented dataset', {
      originalDatasetId: originalDataset._id.toString(),
      augmentedDatasetId: augmentedDataset._id.toString(),
      company,
      project,
      inputRoot,
      outputRoot,
    });

    // Ensure outputRoot exists
    await storageAdapter.ensureDir(outputRoot);

    // Determine effective augmentation parameters
    let effectiveValTestMultiplier =
      typeof valTestMultiplier === 'number' && valTestMultiplier > 0
        ? valTestMultiplier
        : 2;

    let effectiveTargetTrainTotal =
      typeof targetTrainTotal === 'number' && targetTrainTotal > 0
        ? targetTrainTotal
        : 0;

    // If an augmentationMultiplier is provided and no explicit targetTrainTotal,
    // derive targetTrainTotal based on the existing train split size so that
    // the final dataset roughly matches the desired multiplier.
    if (augmentationMultiplier && !effectiveTargetTrainTotal) {
      try {
        const trainDir = path.join(inputRoot, 'images', 'train');
        const entries = await fs.readdir(trainDir, { withFileTypes: true });
        const trainImages = entries.filter((e) => e.isFile()).length;
        if (trainImages > 0) {
          effectiveTargetTrainTotal = Math.max(
            trainImages,
            Math.round(trainImages * augmentationMultiplier),
          );
        }
      } catch {
        // If we cannot derive, leave target total at 0 to fall back to default below.
      }
    }

    if (!effectiveTargetTrainTotal) {
      // Fallback to a sensible default if nothing else was provided/derived.
      effectiveTargetTrainTotal = 1000;
    }

    const result = await runPythonAugmentation({
      inputRoot,
      outputRoot,
      targetTrainTotal: effectiveTargetTrainTotal,
      valTestMultiplier: effectiveValTestMultiplier,
      targetSize: typeof targetSize === 'number' && targetSize > 0 ? targetSize : 640,
    });

    if (result.exitCode !== 0) {
      const message =
        result.stderr ||
        result.stdout ||
        `Python augmentation exited with code ${result.exitCode}`;
      throw new Error(message);
    }

    // After successful augmentation, run fix_labels on the augmented labels directory
    const labelsRootForFix = path.join(outputRoot, 'labels');
    const fixResult = await runPythonFixLabels({ labelsRoot: labelsRootForFix });
    if (fixResult.exitCode !== 0) {
      const message =
        fixResult.stderr ||
        fixResult.stdout ||
        `Python fix_labels exited with code ${fixResult.exitCode}`;
      throw new Error(message);
    }

    // Compute basic stats from outputRoot and build files manifest for augmented dataset
    const imagesRoot = path.join(outputRoot, 'images');
    const labelRoot = path.join(outputRoot, 'labels');

    let totalImages = 0;
    let trainCount = 0;
    let valCount = 0;
    let testCount = 0;
    const filesManifest = [];

    for (const split of ['train', 'val', 'test']) {
      const splitImagesDir = path.join(imagesRoot, split);
      const splitLabelsDir = path.join(labelRoot, split);

      // Images
      try {
        const imageEntries = await fs.readdir(splitImagesDir, { withFileTypes: true });
        for (const entry of imageEntries) {
          if (!entry.isFile()) continue;
          const storedName = entry.name;
          const fullPath = path.join(splitImagesDir, storedName);
          let stat;
          try {
            stat = await fs.stat(fullPath);
          } catch {
            continue;
          }
          const storedPath = path
            .relative(outputRoot, fullPath)
            .replace(/\\/g, '/'); // path relative to dataset root

          const fileEntry = {
            storedName,
            originalName: storedName,
            type: 'image',
            size: stat.size,
            folder: split, // train/val/test for augmented datasets
            storedPath,
          };

          filesManifest.push(fileEntry);

          totalImages += 1;
          if (split === 'train') trainCount += 1;
          else if (split === 'val') valCount += 1;
          else if (split === 'test') testCount += 1;
        }
      } catch {
        // Ignore missing image split dirs
      }

      // Labels
      try {
        const labelEntries = await fs.readdir(splitLabelsDir, { withFileTypes: true });
        for (const entry of labelEntries) {
          if (!entry.isFile()) continue;
          const storedName = entry.name;
          const fullPath = path.join(splitLabelsDir, storedName);
          let stat;
          try {
            stat = await fs.stat(fullPath);
          } catch {
            continue;
          }
          const storedPath = path
            .relative(outputRoot, fullPath)
            .replace(/\\/g, '/'); // path relative to dataset root

          filesManifest.push({
            storedName,
            originalName: storedName,
            type: 'label',
            size: stat.size,
            folder: split,
            storedPath,
          });
        }
      } catch {
        // Ignore missing label split dirs
      }
    }

    const sizeBytes = await computeFolderSize(outputRoot);
    // Attach files manifest and update final metadata
    if (filesManifest.length > 0) {
      augmentedDataset.files = filesManifest;
    }

    augmentedDataset.status = 'ready';
    augmentedDataset.augmentationStatus = 'succeeded';
    augmentedDataset.totalImages = totalImages;
    augmentedDataset.trainCount = trainCount;
    augmentedDataset.valCount = valCount;
    augmentedDataset.testCount = testCount;
    augmentedDataset.sizeBytes = sizeBytes;
    augmentedDataset.augmentationError = undefined;
    augmentedDataset.isActive = true; // Make augmented dataset active
    await augmentedDataset.save();

    // Update original dataset: mark as inactive and update augmentation status
    // Original files are preserved but dataset is no longer the active version
    const previousVersion = originalDataset.version;
    originalDataset.isActive = false;
    originalDataset.augmentationStatus = 'succeeded';
    await originalDataset.save();

    console.log('[AUGMENTATION] augmentation_completed', {
      originalDatasetId: originalDataset._id.toString(),
      originalVersion: previousVersion,
      augmentedDatasetId: augmentedDataset._id.toString(),
      augmentedVersion: augmentedDataset.version,
      totalImages,
      sizeBytes,
      augmentationMultiplier: augmentedDataset.augmentationMultiplier
    });

    console.log('[DATASET] dataset_version_switched', {
      company,
      project,
      fromVersion: previousVersion,
      toVersion: augmentedDataset.version,
      originalDatasetId: originalDataset._id.toString(),
      augmentedDatasetId: augmentedDataset._id.toString()
    });

    return {
      augmentedDatasetId: augmentedDataset._id.toString(),
    };
  } catch (err) {
    console.error('[AUGMENT-WORKER] Error processing augmentation job', {
      jobId: job.id,
      datasetId,
      error: err.message,
    });

    try {
      // Special case: if the error is "Augmentation already running for this dataset",
      // this job is effectively a duplicate/no-op and we should NOT overwrite the
      // original dataset's augmentationStatus/augmentationError, which may reflect
      // a real in-flight augmentation. We still allow Bull to mark the job as failed.
      if (err.message !== 'Augmentation already running for this dataset') {
        if (augmentedDataset && augmentedDataset._id) {
          augmentedDataset.status = 'failed';
          augmentedDataset.augmentationStatus = 'failed';
          augmentedDataset.augmentationError = err.message;
          await augmentedDataset.save();
        }

        if (originalDataset) {
          // Do not touch original status for duplicate jobs; for real failures we
          // mark the augmentation as failed with the error message.
          originalDataset.augmentationStatus = 'failed';
          originalDataset.augmentationError = err.message;
          await originalDataset.save();
        }
      }
    } catch (updateErr) {
      console.error(
        '[AUGMENT-WORKER] Failed to update dataset augmentation state after error',
        updateErr,
      );
    }

    throw err;
  }
};

/**
 * Start the augmentation worker.
 *
 * This is similar to preprocessingWorker.startWorker but only attaches a
 * processor to augmentationQueue and does not affect other queues.
 */
const startWorker = async () => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    family: 4,
  });
  console.log('✅ Augmentation worker connected to MongoDB');

  await augmentationQueue.isReady();
  console.log('[AUGMENT-QUEUE] augmentationQueue is ready and listening');

  augmentationQueue.on('error', (err) => {
    console.error('[AUGMENT-QUEUE] Redis/Queue error', err);
  });

  augmentationQueue.on('waiting', (jobId) => {
    console.log('[AUGMENT-QUEUE] Job waiting', jobId);
  });

  augmentationQueue.on('active', (job) => {
    console.log('[AUGMENT-QUEUE] Job active', {
      jobId: job.id,
      datasetId: job.data?.datasetId,
    });
  });

  augmentationQueue.process(1, async (job) => {
    return processAugmentationJob(job);
  });

  console.log('✅ Augmentation worker started. Waiting for jobs...');
};

// Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down augmentation worker gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

if (require.main === module) {
  startWorker().catch((error) => {
    console.error('❌ Augmentation worker startup error:', error);
    process.exit(1);
  });
}

module.exports = {
  startWorker,
  processAugmentationJob,
};

