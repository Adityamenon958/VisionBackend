// workers/inferenceWorker.js
require('dotenv').config(); // load .env so process.env.MONGO_URI is available

const mongoose = require('mongoose');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { inferenceQueue } = require('../queue');
const InferenceJob = require('../models/InferenceJob');
const Model = require('../models/Model');
const Dataset = require('../models/Dataset');
const storageAdapter = require('../services/storageAdapter');

/**
 * Inference Worker - Background Job Processor
 * 
 * This worker runs separately from the main API server and processes
 * inference jobs by:
 * - Loading trained models
 * - Running YOLO inference on test images
 * - Generating annotated images with bounding boxes
 * - Saving metadata (detections, confidence scores)
 * - Updating progress in MongoDB
 * 
 * Why run this in a worker?
 * - Inference can take time for large image sets (keeps API responsive)
 * - Can run on separate machines/containers with GPU
 * - Can process multiple inference jobs in parallel
 * - Jobs can be retried if they fail
 */

/**
 * Process a single inference job
 */
const processInferenceJob = async (job) => {
  const { inferenceId, modelId, company, project, sourceType, datasetId, testFolderPath } = job.data;

  console.log(`🔮 Starting inference job ${inferenceId}...`);

  let inferenceJob = null;
  let pythonProcess = null;
  let isSaving = false; // Flag to prevent parallel saves

  try {
    // ✅ Load inference job from MongoDB
    inferenceJob = await InferenceJob.findOne({ inferenceId });
    if (!inferenceJob) {
      throw new Error(`Inference job ${inferenceId} not found`);
    }

    // ✅ Check if job was cancelled
    if (inferenceJob.status === 'cancelled') {
      console.log(`⚠️ Job ${inferenceId} was cancelled, skipping...`);
      return;
    }

    // ✅ Helper function to save inference job (prevents parallel saves)
    const saveInferenceJob = async () => {
      if (isSaving) {
        return; // Already saving, skip
      }
      
      try {
        isSaving = true;
        // Fetch fresh document from DB to avoid stale document issues
        const freshJob = await InferenceJob.findOne({ inferenceId });
        if (!freshJob) {
          console.warn(`⚠️ Inference job ${inferenceId} not found in DB`);
          return;
        }
        
        // Update fresh document with current state
        freshJob.status = inferenceJob.status;
        freshJob.progress = inferenceJob.progress;
        freshJob.results = inferenceJob.results;
        freshJob.startedAt = inferenceJob.startedAt;
        freshJob.completedAt = inferenceJob.completedAt;
        freshJob.cancelledAt = inferenceJob.cancelledAt;
        freshJob.error = inferenceJob.error;
        
        await freshJob.save();
      } catch (error) {
        console.error(`Error saving inference job ${inferenceId}:`, error);
      } finally {
        isSaving = false;
      }
    };

    // ✅ Get model
    const model = await Model.findById(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    // ✅ Validate model checkpoint exists
    if (!model.bestCheckpointPath || !fs.existsSync(model.bestCheckpointPath)) {
      throw new Error(`Model checkpoint not found: ${model.bestCheckpointPath}`);
    }

    // ✅ Update status to 'running'
    inferenceJob.status = 'running';
    inferenceJob.startedAt = new Date();
    await saveInferenceJob();

    console.log(`✅ Inference job ${inferenceId} status updated to 'running'`);

    // ✅ Handle different source types
    if (sourceType === 'test_folder') {
      // ✅ Validate test folder exists
      if (!testFolderPath || !fs.existsSync(testFolderPath)) {
        throw new Error(`Test folder not found: ${testFolderPath}`);
      }

      // ✅ Count images in test folder
      const imageFiles = fs.readdirSync(testFolderPath)
        .filter(file => /\.(jpg|jpeg|png)$/i.test(file));

      if (imageFiles.length === 0) {
        throw new Error(`No images found in test folder: ${testFolderPath}`);
      }

      // ✅ Update total images count
      inferenceJob.progress.totalImages = imageFiles.length;
      await saveInferenceJob();

      console.log(`📁 Test folder: ${testFolderPath}`);
      console.log(`📊 Total images: ${imageFiles.length}`);

      // ✅ Build results paths
      const resultsPath = storageAdapter.buildResultsPath(company, project, model.modelId, inferenceId);
      const annotatedImagesPath = storageAdapter.buildAnnotatedImagesPath(resultsPath);
      const metadataPath = storageAdapter.buildMetadataPath(resultsPath);

      // ✅ Create results directories
      await storageAdapter.ensureDir(resultsPath);
      await storageAdapter.ensureDir(annotatedImagesPath);

      console.log(`📦 Results path: ${resultsPath}`);

      // ✅ Run Python inference script
      const pythonScriptPath = path.join(__dirname, '../inference-scripts/run_inference.py');
      
      // Check if Python script exists
      const scriptExists = await fsPromises.access(pythonScriptPath).then(() => true).catch(() => false);

      if (!scriptExists) {
        throw new Error(`Python inference script not found at ${pythonScriptPath}`);
      }

      // ✅ Prepare Python script arguments
      // Get confidence threshold from job data (default 0.25)
      const confidenceThreshold = job.data.confidenceThreshold !== undefined 
        ? parseFloat(job.data.confidenceThreshold) 
        : 0.25;
      
      const config = {
        model: model.bestCheckpointPath,
        source: testFolderPath,
        output: resultsPath,
        conf: confidenceThreshold
      };

      const configPath = path.join(resultsPath, 'inference-config.json');
      await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

      // ✅ Spawn Python inference process
      // Use -u flag for unbuffered output (real-time logs)
      pythonProcess = spawn('python', ['-u', pythonScriptPath, '--config', configPath], {
        cwd: path.join(__dirname, '../inference-scripts'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });

      let logBuffer = '';
      let processedCount = 0;

      // ✅ Stream stdout (logs)
      pythonProcess.stdout.on('data', async (data) => {
        const chunk = data.toString();
        logBuffer += chunk;

        // Process line by line
        const lines = logBuffer.split('\n');
        logBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            console.log(`[Inference ${inferenceId}] ${line}`);

            // ✅ Parse progress from logs (e.g., "Processing image 5/10")
            const progressMatch = line.match(/Processing\s+image\s+(\d+)\/(\d+)/i);
            if (progressMatch) {
              processedCount = parseInt(progressMatch[1]);
              const total = parseInt(progressMatch[2]);

              // Update progress in MongoDB
              inferenceJob.progress.processedImages = processedCount;
              inferenceJob.progress.progressPercent = Math.round((processedCount / total) * 100);
              await saveInferenceJob();
            }
          }
        }
      });

      // ✅ Stream stderr (errors and warnings)
      pythonProcess.stderr.on('data', (data) => {
        const errorLine = data.toString().trim();
        if (!errorLine) return;

        // Filter out common Python warnings
        const isWarning = /RuntimeWarning|UserWarning|FutureWarning|DeprecationWarning/i.test(errorLine);
        if (isWarning) {
          console.warn(`[Inference ${inferenceId}] Warning: ${errorLine}`);
        } else {
          console.error(`[Inference ${inferenceId}] Error: ${errorLine}`);
        }
      });

      // ✅ Handle process completion
      pythonProcess.on('close', async (code) => {
        // ✅ Wait for any pending saves to complete
        while (isSaving) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (code === 0) {
          console.log(`✅ Inference job ${inferenceId} completed successfully`);

          // ✅ Read metadata JSON file
          let metadata = null;
          if (fs.existsSync(metadataPath)) {
            try {
              const metadataContent = await fsPromises.readFile(metadataPath, 'utf8');
              metadata = JSON.parse(metadataContent);
            } catch (error) {
              console.warn(`Could not read metadata file: ${error.message}`);
            }
          }

          // ✅ Update inference job with results
          inferenceJob.status = 'completed';
          inferenceJob.completedAt = new Date();
          inferenceJob.progress.processedImages = inferenceJob.progress.totalImages;
          inferenceJob.progress.progressPercent = 100;

          if (metadata) {
            inferenceJob.results = {
              resultsPath: resultsPath,
              annotatedImagesPath: annotatedImagesPath,
              metadataPath: metadataPath,
              totalDetections: metadata.totalDetections || 0,
              averageConfidence: metadata.averageConfidence || 0,
              detectionsByClass: metadata.detectionsByClass || []
            };
          } else {
            // Fallback: set basic results structure
            inferenceJob.results = {
              resultsPath: resultsPath,
              annotatedImagesPath: annotatedImagesPath,
              metadataPath: metadataPath,
              totalDetections: 0,
              averageConfidence: 0,
              detectionsByClass: []
            };
          }

          await saveInferenceJob();
          console.log(`✅ Inference job ${inferenceId} results saved`);

        } else {
          console.error(`❌ Inference job ${inferenceId} failed with exit code ${code}`);
          // Fetch fresh job for final update
          const freshJob = await InferenceJob.findOne({ inferenceId });
          if (freshJob) {
            freshJob.status = 'failed';
            freshJob.error = `Python process exited with code ${code}`;
            freshJob.completedAt = new Date();
            await freshJob.save();
          }
        }
      });

      // ✅ Handle cancellation
      const cancellationCheck = setInterval(async () => {
        const updatedJob = await InferenceJob.findOne({ inferenceId });
        if (updatedJob && updatedJob.status === 'cancelled') {
          console.log(`⚠️ Inference job ${inferenceId} cancelled, terminating Python process...`);
          if (pythonProcess && !pythonProcess.killed) {
            pythonProcess.kill('SIGTERM');
          }
          clearInterval(cancellationCheck);
        }
      }, 2000); // Check every 2 seconds

      pythonProcess.on('exit', () => {
        clearInterval(cancellationCheck);
      });

    } else if (sourceType === 'live_camera') {
      // ✅ Live camera inference (will be implemented in Phase 5)
      console.log(`📹 Live camera inference not yet implemented`);
      inferenceJob.status = 'failed';
      inferenceJob.error = 'Live camera inference not yet implemented';
      inferenceJob.completedAt = new Date();
      await saveInferenceJob();
    }

  } catch (error) {
    console.error(`❌ Error processing inference job ${inferenceId}:`, error);

    if (inferenceJob) {
      // ✅ Wait for any pending saves to complete
      while (isSaving) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Update status using fresh document
      const freshJob = await InferenceJob.findOne({ inferenceId });
      if (freshJob) {
        freshJob.status = 'failed';
        freshJob.error = error.message;
        freshJob.completedAt = new Date();
        await freshJob.save();
      }
    }

    // ✅ Kill Python process if it's still running
    if (pythonProcess && !pythonProcess.killed) {
      pythonProcess.kill('SIGTERM');
    }
  }
};

/**
 * Connect to MongoDB and start processing jobs
 */
const startWorker = async () => {
  try {
    // ✅ Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri);
    console.log('✅ Inference worker connected to MongoDB');

    // ✅ Process inference jobs from queue
    inferenceQueue.process(async (job) => {
      await processInferenceJob(job);
    });

    console.log('✅ Inference worker started. Waiting for jobs...');

  } catch (error) {
    console.error('❌ Failed to start inference worker:', error);
    process.exit(1);
  }
};

// ✅ Handle MongoDB connection errors
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected');
});

// ✅ Start the worker
startWorker();

