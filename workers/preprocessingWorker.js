// workers/preprocessingWorker.js (top of file)
require('dotenv').config(); // load .env so process.env.MONGO_URI is available

const mongoose = require('mongoose');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { preprocessingQueue } = require('../queue');
const Dataset = require('../models/Dataset');
const storageAdapter = require('../services/storageAdapter');

/**
 * Preprocessing Worker - Background Job Processor
 * 
 * This worker runs separately from the main API server and processes
 * heavy dataset operations like:
 * - Train/validation split
 * - Thumbnail generation
 * - Statistics computation
 * 
 * Why run this in a worker?
 * - Keeps API responsive (no 30+ second timeouts)
 * - Can run on separate machines/containers
 * - Can process multiple datasets in parallel
 * - Jobs can be retried if they fail
 */

/**
 * Compute total size of a folder recursively
 * @param {string} rootPath - Root directory path
 * @returns {Promise<number>} Total size in bytes
 */
async function computeFolderSize(rootPath) {
  let total = 0;
  async function walk(dir) {
    const items = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(p);
      } else if (it.isFile()) {
        const st = await fsPromises.stat(p);
        total += st.size;
      }
    }
  }
  try {
    await walk(rootPath);
  } catch (err) {
    // ignore missing folder
  }
  return total;
}

/**
 * Process a single preprocessing job
 */
const processPreprocessingJob = async (job) => {
  const { datasetId, storagePath, company, project, version } = job.data;

  console.log(`🔄 Processing dataset ${datasetId}...`);

  try {
    // ✅ Update status to 'processing'
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    dataset.status = 'processing';
    await dataset.save();

    // ✅ Build paths
    const imagesPath = storageAdapter.buildImagesPath(company, project, version);
    const labelsPath = storageAdapter.buildLabelsPath(company, project, version);
    const thumbnailsPath = storageAdapter.buildThumbnailsPath(company, project, version);

    // ✅ Create train/val/test directories
    const trainImagesPath = path.join(imagesPath, 'train');
    const valImagesPath = path.join(imagesPath, 'val');
    const testImagesPath = path.join(imagesPath, 'test');
    const trainLabelsPath = path.join(labelsPath, 'train');
    const valLabelsPath = path.join(labelsPath, 'val');

    await storageAdapter.ensureDir(trainImagesPath);
    await storageAdapter.ensureDir(valImagesPath);
    await storageAdapter.ensureDir(testImagesPath);
    await storageAdapter.ensureDir(trainLabelsPath);
    await storageAdapter.ensureDir(valLabelsPath);
    await storageAdapter.ensureDir(thumbnailsPath);

    // ✅ Use manifest-based matching (dataset.files) with storedPath
    // Build maps: originalName (base) → { storedName, storedPath, fileEntry } for images and labels
    const imageManifest = new Map(); // originalName (base) → { storedName, storedPath, fileEntry }
    const labelManifest = new Map(); // originalName (base) → { storedName, storedPath, fileEntry }

    const datasetRoot = storageAdapter.buildDatasetPath(company, project, version);

    for (const fileEntry of dataset.files) {
      const originalBaseName = path.parse(fileEntry.originalName).name; // Remove extension
      
      if (fileEntry.type === 'image') {
        imageManifest.set(originalBaseName, {
          storedName: fileEntry.storedName,
          storedPath: fileEntry.storedPath, // e.g., "images/good/692..._img.jpg"
          fileEntry: fileEntry
        });
      } else if (fileEntry.type === 'label') {
        labelManifest.set(originalBaseName, {
          storedName: fileEntry.storedName,
          storedPath: fileEntry.storedPath, // e.g., "labels/good/692..._img.txt"
          fileEntry: fileEntry
        });
      }
    }

    // ✅ Separate labeled and unlabeled images using manifest
    const labeledImages = [];
    const unlabeledImages = [];

    for (const [originalBaseName, imageInfo] of imageManifest.entries()) {
      if (labelManifest.has(originalBaseName)) {
        labeledImages.push(imageInfo);
      } else {
        unlabeledImages.push(imageInfo);
      }
    }

    // ✅ Perform 80:20 train/val split on labeled images
    // ⚠️ CAUTION: Using deterministic shuffle for reproducibility
    // For true randomness, use: labeledImages.sort(() => Math.random() - 0.5)
    // Or use a seeded random number generator for reproducible splits
    const shuffled = [...labeledImages].sort((a, b) => {
      // Simple deterministic shuffle based on stored filename
      return a.storedName.localeCompare(b.storedName);
    });

    const splitIndex = Math.floor(shuffled.length * 0.8);
    const trainImages = shuffled.slice(0, splitIndex);
    const valImages = shuffled.slice(splitIndex);

    // ✅ Copy images and labels to train/val folders (flattened structure)
    // ⚠️ CAUTION: We COPY (not move) to preserve original folder structure for dashboard
    // Training requires flat structure (no folders), but dashboard needs folder view
    let trainCount = 0;
    let valCount = 0;

    for (const imageInfo of trainImages) {
      // ✅ Use storedPath to find file in its original folder location
      const srcPath = path.join(datasetRoot, imageInfo.storedPath); // e.g., datasetRoot/images/good/storedName
      const destPath = path.join(trainImagesPath, imageInfo.storedName); // Flattened: train/images/storedName
      await storageAdapter.copyFile(srcPath, destPath); // Copy preserves original
      trainCount++;

      // ✅ Copy corresponding label file using manifest
      const originalBaseName = path.parse(imageInfo.fileEntry.originalName).name;
      const labelInfo = labelManifest.get(originalBaseName);
      
      if (labelInfo) {
        const labelSrcPath = path.join(datasetRoot, labelInfo.storedPath); // e.g., datasetRoot/labels/good/storedName
        const labelDestPath = path.join(trainLabelsPath, labelInfo.storedName); // Flattened: train/labels/storedName
        await storageAdapter.copyFile(labelSrcPath, labelDestPath); // Copy preserves original
      }
    }

    for (const imageInfo of valImages) {
      // ✅ Use storedPath to find file in its original folder location
      const srcPath = path.join(datasetRoot, imageInfo.storedPath); // e.g., datasetRoot/images/good/storedName
      const destPath = path.join(valImagesPath, imageInfo.storedName); // Flattened: val/images/storedName
      await storageAdapter.copyFile(srcPath, destPath); // Copy preserves original
      valCount++;

      // ✅ Copy corresponding label file using manifest
      const originalBaseName = path.parse(imageInfo.fileEntry.originalName).name;
      const labelInfo = labelManifest.get(originalBaseName);
      
      if (labelInfo) {
        const labelSrcPath = path.join(datasetRoot, labelInfo.storedPath); // e.g., datasetRoot/labels/good/storedName
        const labelDestPath = path.join(valLabelsPath, labelInfo.storedName); // Flattened: val/labels/storedName
        await storageAdapter.copyFile(labelSrcPath, labelDestPath); // Copy preserves original
      }
    }

    // ✅ Move unlabeled images to test folder (or keep in images root)
    // For now, we'll leave unlabeled images in the root images folder
    // You can move them to test folder if needed

    // ✅ Generate thumbnails (sample subset for performance)
    // ⚠️ CAUTION: Generating thumbnails for all images can be slow
    // We'll generate for first 50 images as a sample
    // ✅ Read from original folder locations (images/{folder}/...) to preserve folder context
    const thumbnailSample = [...trainImages, ...valImages].slice(0, 50);
    let thumbnailsGenerated = 0;

    for (const imageInfo of thumbnailSample) {
      try {
        // ✅ Use storedPath to read from original folder location
        const originalImagePath = path.join(datasetRoot, imageInfo.storedPath);

        if (fs.existsSync(originalImagePath)) {
          const thumbnailPath = path.join(thumbnailsPath, `thumb_${imageInfo.storedName}`);
          await sharp(originalImagePath)
            .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
            .toFile(thumbnailPath);
          thumbnailsGenerated++;
        }
      } catch (error) {
        console.warn(`Failed to generate thumbnail for ${imageInfo.storedName}:`, error.message);
      }
    }

    // ✅ Extract labels from label files (read from both train and val)
    const labelsSet_final = new Set();
    
    // Read from train labels
    try {
      const trainLabelFiles = await fsPromises.readdir(trainLabelsPath);
      for (const labelFile of trainLabelFiles) {
        try {
          const labelPath = path.join(trainLabelsPath, labelFile);
          const content = await fsPromises.readFile(labelPath, 'utf-8');
          const lines = content.trim().split('\n');
          for (const line of lines) {
            const parts = line.trim().split(' ');
            if (parts.length > 0) {
              const classId = parseInt(parts[0]);
              if (!isNaN(classId)) {
                // ✅ In YOLO format, class ID is first number
                // For now, we'll store class IDs. You can map to class names later
                labelsSet_final.add(`class_${classId}`);
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to read label file ${labelFile}:`, error.message);
        }
      }
    } catch (error) {
      // Directory might be empty, that's ok
      console.warn('Train labels directory read error (may be empty):', error.message);
    }

    // Read from val labels
    try {
      const valLabelFiles = await fsPromises.readdir(valLabelsPath);
      for (const labelFile of valLabelFiles) {
        try {
          const labelPath = path.join(valLabelsPath, labelFile);
          const content = await fsPromises.readFile(labelPath, 'utf-8');
          const lines = content.trim().split('\n');
          for (const line of lines) {
            const parts = line.trim().split(' ');
            if (parts.length > 0) {
              const classId = parseInt(parts[0]);
              if (!isNaN(classId)) {
                labelsSet_final.add(`class_${classId}`);
              }
            }
          }
        } catch (error) {
          console.warn(`Failed to read label file ${labelFile}:`, error.message);
        }
      }
    } catch (error) {
      // Directory might be empty, that's ok
      console.warn('Val labels directory read error (may be empty):', error.message);
    }

    // ✅ Update dataset metadata
    dataset.labeledImages = labeledImages.length;
    dataset.unlabeledImages = unlabeledImages.length;
    dataset.trainCount = trainCount;
    dataset.valCount = valCount;
    dataset.labels = Array.from(labelsSet_final);
    
    // ✅ Recompute final dataset sizeBytes after preprocessing
    try {
      const datasetRoot = storageAdapter.buildDatasetPath(company, project, version);
      const computedSize = await computeFolderSize(datasetRoot);
      dataset.sizeBytes = computedSize;
    } catch (err) {
      console.warn('Failed to compute final dataset size:', err.message);
    }
    
    dataset.status = 'ready';
    await dataset.save();

    console.log(`✅ Dataset ${datasetId} processed successfully`);
    console.log(`   - Train: ${trainCount}, Val: ${valCount}`);
    console.log(`   - Labeled: ${labeledImages.length}, Unlabeled: ${unlabeledImages.length}`);
    console.log(`   - Thumbnails: ${thumbnailsGenerated}`);

  } catch (error) {
    console.error(`❌ Error processing dataset ${datasetId}:`, error);

    // ✅ Update dataset status to 'failed'
    try {
      const dataset = await Dataset.findById(datasetId);
      if (dataset) {
        dataset.status = 'failed';
        dataset.errorMessage = error.message;
        await dataset.save();
      }
    } catch (updateError) {
      console.error('Failed to update dataset status:', updateError);
    }

    throw error; // Re-throw to mark job as failed
  }
};

/**
 * Start the worker - process jobs from the queue
 */
const startWorker = async () => {
  // ✅ Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
  await mongoose.connect(mongoUri);
  console.log('✅ Worker connected to MongoDB');

  // ✅ Process jobs from the queue
  preprocessingQueue.process(async (job) => {
    return await processPreprocessingJob(job);
  });

  console.log('✅ Preprocessing worker started. Waiting for jobs...');
};

// ✅ Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ✅ Start worker if this file is run directly
if (require.main === module) {
  startWorker().catch((error) => {
    console.error('❌ Worker startup error:', error);
    process.exit(1);
  });
}

module.exports = { startWorker, processPreprocessingJob };
