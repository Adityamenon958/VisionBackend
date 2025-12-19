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
  const { inferenceId, modelId, company, project, sourceType, datasetId, testFolderPath, customFolderPath } = job.data;

  console.log(`🔮 Starting inference job ${inferenceId}...`);

  let inferenceJob = null;
  let pythonProcess = null;
  let isSaving = false; // Flag to prevent parallel saves
  let sourceFolderPath = null; // Will be set based on sourceType

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

      sourceFolderPath = testFolderPath;
    } else if (sourceType === 'custom_folder') {
      // ✅ Validate custom folder exists
      if (!customFolderPath || !fs.existsSync(customFolderPath)) {
        throw new Error(`Custom folder not found: ${customFolderPath}`);
      }

      sourceFolderPath = customFolderPath;
    } else if (sourceType === 'live_camera') {
      // ✅ Live camera inference (will be implemented in Phase 5)
      console.log(`📹 Live camera inference not yet implemented`);
      inferenceJob.status = 'failed';
      inferenceJob.error = 'Live camera inference not yet implemented';
      inferenceJob.completedAt = new Date();
      await saveInferenceJob();
      return; // Exit early for live_camera
    } else {
      throw new Error(`Unsupported source type: ${sourceType}`);
    }

    // ✅ Count images in source folder (works for both test_folder and custom_folder)
    const imageFiles = fs.readdirSync(sourceFolderPath)
        .filter(file => /\.(jpg|jpeg|png)$/i.test(file));

      if (imageFiles.length === 0) {
      throw new Error(`No images found in folder: ${sourceFolderPath}`);
      }

      // ✅ Update total images count
      inferenceJob.progress.totalImages = imageFiles.length;
      await saveInferenceJob();

    console.log(`📁 Source folder: ${sourceFolderPath}`);
      console.log(`📊 Total images: ${imageFiles.length}`);
    console.log(`🔍 Source type: ${sourceType}`);

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
      source: sourceFolderPath,
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

          // ✅ Organize images into good/defect folders based on detections
          let goodImagesPath = null;
          let defectImagesPath = null;
          let goodCount = 0;
          let defectCount = 0;

          if (metadata && metadata.images && Array.isArray(metadata.images)) {
            // ✅ Create good/ and defect/ folders
            goodImagesPath = path.join(resultsPath, 'good');
            defectImagesPath = path.join(resultsPath, 'defect');
            
            await storageAdapter.ensureDir(goodImagesPath);
            await storageAdapter.ensureDir(defectImagesPath);

            console.log(`📁 Organizing images into good/defect folders...`);

            // ✅ Process each image from metadata
            for (const imageData of metadata.images) {
              const imageFilename = imageData.imagePath || imageData.annotatedPath?.split('/').pop();
              if (!imageFilename) continue;

              // ✅ Source path: annotated image in annotatedImagesPath
              const sourceImagePath = path.join(annotatedImagesPath, imageFilename);
              
              // ✅ Check if image has detections
              const hasDetections = imageData.detections && Array.isArray(imageData.detections) && imageData.detections.length > 0;
              
              // ✅ Determine destination folder
              const destFolder = hasDetections ? defectImagesPath : goodImagesPath;
              const destImagePath = path.join(destFolder, imageFilename);

              try {
                // ✅ Check if source image exists
                if (fs.existsSync(sourceImagePath)) {
                  // ✅ Move image to appropriate folder
                  await fsPromises.rename(sourceImagePath, destImagePath);
                  
                  if (hasDetections) {
                    defectCount++;
                  } else {
                    goodCount++;
                  }
                } else {
                  console.warn(`⚠️ Source image not found: ${sourceImagePath}`);
                }
              } catch (error) {
                console.error(`❌ Failed to move image ${imageFilename}:`, error.message);
                // If rename fails (cross-device), try copy + delete
                try {
                  await fsPromises.copyFile(sourceImagePath, destImagePath);
                  await fsPromises.unlink(sourceImagePath);
                  
                  if (hasDetections) {
                    defectCount++;
                  } else {
                    goodCount++;
                  }
                } catch (copyError) {
                  console.error(`❌ Failed to copy image ${imageFilename}:`, copyError.message);
                }
              }
            }

            console.log(`✅ Images organized: ${goodCount} good, ${defectCount} defect`);
          } else {
            // ✅ If no metadata, count images in annotated folder as fallback
            if (fs.existsSync(annotatedImagesPath)) {
              const allImages = fs.readdirSync(annotatedImagesPath)
                .filter(file => /\.(jpg|jpeg|png)$/i.test(file));
              
              // ✅ Create folders anyway
              goodImagesPath = path.join(resultsPath, 'good');
              defectImagesPath = path.join(resultsPath, 'defect');
              await storageAdapter.ensureDir(goodImagesPath);
              await storageAdapter.ensureDir(defectImagesPath);
              
              // ✅ Without detection data, we can't determine good/defect, so keep in annotated folder
              // But still set paths for API consistency
              console.log(`⚠️ No metadata available, images remain in annotated/ folder`);
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
              goodImagesPath: goodImagesPath,
              defectImagesPath: defectImagesPath,
              metadataPath: metadataPath,
              totalDetections: metadata.totalDetections || 0,
              averageConfidence: metadata.averageConfidence || 0,
              goodCount: goodCount,
              defectCount: defectCount,
              detectionsByClass: metadata.detectionsByClass || []
            };
          } else {
            // Fallback: set basic results structure
            inferenceJob.results = {
              resultsPath: resultsPath,
              annotatedImagesPath: annotatedImagesPath,
              goodImagesPath: goodImagesPath,
              defectImagesPath: defectImagesPath,
              metadataPath: metadataPath,
              totalDetections: 0,
              averageConfidence: 0,
              goodCount: 0,
              defectCount: 0,
              detectionsByClass: []
            };
          }

          await saveInferenceJob();
          console.log(`✅ Inference job ${inferenceId} results saved`);

          // ✅ Clean up custom folder after successful inference
          if (sourceType === 'custom_folder' && customFolderPath && fs.existsSync(customFolderPath)) {
            try {
              fs.rmSync(customFolderPath, { recursive: true, force: true });
              console.log(`🗑️ Cleaned up custom folder: ${customFolderPath}`);
            } catch (cleanupError) {
              console.warn(`⚠️ Failed to cleanup custom folder ${customFolderPath}: ${cleanupError.message}`);
            }
          }

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

          // ✅ Clean up custom folder even on failure
          if (sourceType === 'custom_folder' && customFolderPath && fs.existsSync(customFolderPath)) {
            try {
              fs.rmSync(customFolderPath, { recursive: true, force: true });
              console.log(`🗑️ Cleaned up custom folder after failure: ${customFolderPath}`);
            } catch (cleanupError) {
              console.warn(`⚠️ Failed to cleanup custom folder ${customFolderPath}: ${cleanupError.message}`);
            }
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
          
          // ✅ Clean up custom folder on cancellation
          if (sourceType === 'custom_folder' && customFolderPath && fs.existsSync(customFolderPath)) {
            try {
              fs.rmSync(customFolderPath, { recursive: true, force: true });
              console.log(`🗑️ Cleaned up custom folder after cancellation: ${customFolderPath}`);
            } catch (cleanupError) {
              console.warn(`⚠️ Failed to cleanup custom folder ${customFolderPath}: ${cleanupError.message}`);
            }
          }
          
          clearInterval(cancellationCheck);
        }
      }, 2000); // Check every 2 seconds

      pythonProcess.on('exit', () => {
        clearInterval(cancellationCheck);
      });

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

    // ✅ Clean up custom folder on error
    if (sourceType === 'custom_folder' && customFolderPath && fs.existsSync(customFolderPath)) {
      try {
        fs.rmSync(customFolderPath, { recursive: true, force: true });
        console.log(`🗑️ Cleaned up custom folder after error: ${customFolderPath}`);
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup custom folder ${customFolderPath}: ${cleanupError.message}`);
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

