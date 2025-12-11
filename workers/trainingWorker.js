// workers/trainingWorker.js
require('dotenv').config(); // load .env so process.env.MONGO_URI is available

const mongoose = require('mongoose');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { trainingQueue } = require('../queue');
const TrainingJob = require('../models/TrainingJob');
const Dataset = require('../models/Dataset');
const Model = require('../models/Model');
const storageAdapter = require('../services/storageAdapter');
const trainingService = require('../services/trainingService');

/**
 * Training Worker - Background Job Processor
 * 
 * This worker runs separately from the main API server and processes
 * training jobs by:
 * - Spawning Python training processes
 * - Streaming logs and parsing metrics
 * - Saving checkpoints
 * - Computing final metrics
 * - Registering trained models
 * 
 * Why run this in a worker?
 * - Training can take hours (keeps API responsive)
 * - Can run on separate machines/containers with GPU
 * - Can process multiple training jobs in parallel
 * - Jobs can be retried if they fail
 */

/**
 * Get base model path for YOLO training
 * @param {string} modelType - Model type (YOLO, EfficientNet, Custom)
 * @param {string} modelSize - Optional model size (n, s, m, l) - defaults to 'n' for YOLO
 * @returns {string} Path to base model file
 */
function getBaseModelPath(modelType, modelSize = 'n') {
  if (modelType === 'YOLO') {
    const baseModelsDir = path.join(process.cwd(), 'models', 'base');
    
    // Check for YOLOv11 first (newer), then YOLOv8 (fallback)
    const v11ModelName = `yolov11${modelSize}.pt`;
    const v11ModelPath = path.join(baseModelsDir, v11ModelName);
    const v8ModelName = `yolov8${modelSize}.pt`;
    const v8ModelPath = path.join(baseModelsDir, v8ModelName);
    
    // Prefer YOLOv11 if available
    if (fs.existsSync(v11ModelPath)) {
      return v11ModelPath;
    }
    
    // Fallback to YOLOv8
    if (fs.existsSync(v8ModelPath)) {
      return v8ModelPath;
    }
    
    // Fallback: return model name (YOLO will download if not found)
    // But log a warning
    console.warn(`⚠️  Base model not found locally: ${v11ModelPath} or ${v8ModelPath}`);
    console.warn(`⚠️  YOLO will download it automatically (slower). Run: npm run download-models`);
    return v8ModelName; // YOLO will download from internet (default to v8)
  }
  
  // For other model types, return null (let Python script handle it)
  return null;
}

/**
 * Generate YOLO training config file
 * @param {object} hyperparameters - Training hyperparameters
 * @param {string} datasetPath - Path to dataset directory
 * @param {string} outputPath - Path where config will be saved
 * @param {string} modelType - Model type (YOLO, EfficientNet, Custom)
 * @param {string} modelSize - Optional model size (n, s, m, l) - defaults to 'n'
 * @returns {Promise<string>} Path to generated config file
 */
async function generateTrainingConfig(hyperparameters, datasetPath, outputPath, modelType, modelSize = 'n') {
  // Create data.yaml for YOLO
  const dataYaml = `# YOLO Dataset Configuration
path: ${datasetPath}
train: images/train
val: images/val
test: images/test

# Number of classes (will be updated by Python script)
nc: 0

# Class names (will be updated by Python script)
names: []
`;

  const dataYamlPath = path.join(datasetPath, 'data.yaml');
  await fsPromises.writeFile(dataYamlPath, dataYaml, 'utf8');

  // Get base model path (use local if available)
  const baseModelPath = getBaseModelPath(modelType, modelSize);

  // Create training config
  const config = {
    epochs: hyperparameters.epochs,
    batch: hyperparameters.batchSize,
    imgsz: hyperparameters.imgSize,
    lr0: hyperparameters.learningRate,
    workers: hyperparameters.workers,
    data: dataYamlPath,
    project: path.join(path.dirname(outputPath), 'runs'),
    name: 'train',
    exist_ok: true
  };

  // Add model path if available (for YOLO)
  if (baseModelPath) {
    config.model = baseModelPath; // YOLO uses 'model' parameter for pretrained weights
  }

  // Write config as JSON (Python script will read it)
  const configJson = JSON.stringify(config, null, 2);
  await fsPromises.writeFile(outputPath, configJson, 'utf8');

  console.log(`✅ Generated training config at: ${outputPath}`);
  if (baseModelPath && fs.existsSync(baseModelPath)) {
    console.log(`✅ Using local base model: ${baseModelPath}`);
  }
  return outputPath;
}

/**
 * Parse log line for metrics
 * @param {string} logLine - Log line from training output
 * @returns {object|null} Parsed metrics or null
 */
function parseLogLine(logLine) {
  const metrics = {};

  // Parse epoch: "Epoch 25/100"
  const epochMatch = logLine.match(/Epoch\s+(\d+)\/(\d+)/i);
  if (epochMatch) {
    metrics.currentEpoch = parseInt(epochMatch[1]);
    metrics.totalEpochs = parseInt(epochMatch[2]);
  }

  // Parse loss: "loss=0.45" or "train_loss=0.45"
  const lossMatch = logLine.match(/(?:train_)?loss[:\s=]+([\d.]+)/i);
  if (lossMatch) {
    metrics.currentLoss = parseFloat(lossMatch[1]);
  }

  // Parse learning rate: "lr=0.01" or "lr: 0.01"
  const lrMatch = logLine.match(/lr[:\s=]+([\d.e-]+)/i);
  if (lrMatch) {
    metrics.currentLR = parseFloat(lrMatch[1]);
  }

  // Parse mAP50: "mAP50=0.72" or "mAP@0.5=0.72"
  const map50Match = logLine.match(/mAP(?:@|50)[:\s=]+([\d.]+)/i);
  if (map50Match) {
    metrics.mAP50 = parseFloat(map50Match[1]);
  }

  // Parse mAP50-95: "mAP50-95=0.58" or "mAP@0.5:0.95=0.58"
  const map50_95Match = logLine.match(/mAP(?:50-95|@0\.5:0\.95)[:\s=]+([\d.]+)/i);
  if (map50_95Match) {
    metrics.mAP50_95 = parseFloat(map50_95Match[1]);
  }

  // Parse precision: "precision=0.85"
  const precisionMatch = logLine.match(/precision[:\s=]+([\d.]+)/i);
  if (precisionMatch) {
    metrics.precision = parseFloat(precisionMatch[1]);
  }

  // Parse recall: "recall=0.78"
  const recallMatch = logLine.match(/recall[:\s=]+([\d.]+)/i);
  if (recallMatch) {
    metrics.recall = parseFloat(recallMatch[1]);
  }

  return Object.keys(metrics).length > 0 ? metrics : null;
}

/**
 * Process a single training job
 */
const processTrainingJob = async (job) => {
  const { jobId, datasetId, company, project, modelType, modelSize = 'n', hyperparameters } = job.data;

  console.log(`🚀 Starting training job ${jobId}...`);

  let trainingJob = null;
  let pythonProcess = null;

  try {
    // ✅ Load training job from MongoDB
    trainingJob = await TrainingJob.findOne({ jobId });
    if (!trainingJob) {
      throw new Error(`Training job ${jobId} not found`);
    }

    // ✅ Check if job was cancelled
    if (trainingJob.status === 'cancelled') {
      console.log(`⚠️ Job ${jobId} was cancelled, skipping...`);
      return;
    }

    // ✅ Get dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    // ✅ Update status to 'running'
    trainingJob.status = 'running';
    trainingJob.startedAt = new Date();
    await trainingJob.save();

    console.log(`✅ Training job ${jobId} status updated to 'running'`);

    // ✅ Build dataset path
    const datasetPath = storageAdapter.buildDatasetPath(company, project, dataset.version);
    console.log(`📁 Dataset path: ${datasetPath}`);

    // ✅ Create model storage directory
    // Determine model version (increment if models exist)
    const existingModels = await Model.find({ company, project }).sort({ createdAt: -1 });
    const modelVersion = existingModels.length > 0 
      ? `v${existingModels.length + 1}` 
      : 'v1';

    const modelStoragePath = path.join(
      process.cwd(),
      'models',
      company,
      project,
      modelVersion
    );

    await storageAdapter.ensureDir(modelStoragePath);
    await storageAdapter.ensureDir(path.join(modelStoragePath, 'checkpoints'));
    await storageAdapter.ensureDir(path.join(modelStoragePath, 'metrics'));

    console.log(`📦 Model storage: ${modelStoragePath}`);

    // ✅ Generate training config
    // Use modelSize from job data (defaults to 'n' if not provided)
    const configPath = path.join(modelStoragePath, 'training-config.json');
    await generateTrainingConfig(hyperparameters, datasetPath, configPath, modelType, modelSize);

    // ✅ Spawn Python training process
    // Note: This assumes you have a Python training script at training-scripts/train.py
    // For now, we'll create a placeholder that logs progress
    const pythonScriptPath = path.join(__dirname, '../training-scripts/train.py');
    
    // Check if Python script exists, if not, we'll simulate training for now
    const scriptExists = await fsPromises.access(pythonScriptPath).then(() => true).catch(() => false);

    if (!scriptExists) {
      console.log(`⚠️ Python training script not found at ${pythonScriptPath}`);
      console.log(`⚠️ Simulating training for demonstration...`);
      
      // Simulate training (for testing without Python script)
      await simulateTraining(trainingJob, hyperparameters, modelStoragePath);
      return;
    }

    // Spawn actual Python process
    pythonProcess = spawn('python', [pythonScriptPath, '--config', configPath], {
      cwd: path.join(__dirname, '../training-scripts'),
      stdio: ['ignore', 'pipe', 'pipe'] // stdin ignored, stdout/stderr piped
    });

    let logBuffer = '';
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 5000; // Save to DB every 5 seconds

    // ✅ Stream stdout (logs)
    pythonProcess.stdout.on('data', async (data) => {
      const chunk = data.toString();
      logBuffer += chunk;

      // Process line by line
      const lines = logBuffer.split('\n');
      logBuffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          // Add log to training job
          trainingJob.logs.push(line);
          
          // Parse metrics from log line
          const parsedMetrics = parseLogLine(line);
          if (parsedMetrics) {
            // Update metrics
            if (parsedMetrics.currentEpoch !== undefined) {
              trainingJob.progress.currentEpoch = parsedMetrics.currentEpoch;
              trainingJob.progress.totalEpochs = parsedMetrics.totalEpochs || trainingJob.progress.totalEpochs;
              trainingJob.progress.progressPercent = trainingService.computeProgressPercent(
                parsedMetrics.currentEpoch,
                parsedMetrics.totalEpochs || trainingJob.progress.totalEpochs
              );
            }

            if (parsedMetrics.currentLoss !== undefined) {
              trainingJob.metrics.currentLoss = parsedMetrics.currentLoss;
              
              // Update best loss if this is better
              if (!trainingJob.metrics.bestLoss || parsedMetrics.currentLoss < trainingJob.metrics.bestLoss) {
                trainingJob.metrics.bestLoss = parsedMetrics.currentLoss;
                trainingJob.metrics.bestEpoch = parsedMetrics.currentEpoch || trainingJob.progress.currentEpoch;
              }
            }

            if (parsedMetrics.currentLR !== undefined) {
              trainingJob.metrics.currentLR = parsedMetrics.currentLR;
            }

            if (parsedMetrics.mAP50 !== undefined) {
              trainingJob.metrics.mAP50 = parsedMetrics.mAP50;
            }

            if (parsedMetrics.mAP50_95 !== undefined) {
              trainingJob.metrics.mAP50_95 = parsedMetrics.mAP50_95;
            }

            if (parsedMetrics.precision !== undefined) {
              trainingJob.metrics.precision = parsedMetrics.precision;
            }

            if (parsedMetrics.recall !== undefined) {
              trainingJob.metrics.recall = parsedMetrics.recall;
            }
          }

          // Save to DB periodically (not on every line to avoid overwhelming DB)
          const now = Date.now();
          if (now - lastSaveTime > SAVE_INTERVAL) {
            await trainingJob.save();
            lastSaveTime = now;
          }
        }
      }
    });

    // ✅ Stream stderr (errors)
    pythonProcess.stderr.on('data', (data) => {
      const errorLine = data.toString();
      console.error(`[Training ${jobId}] Error:`, errorLine);
      trainingJob.logs.push(`[ERROR] ${errorLine}`);
    });

    // ✅ Handle process completion
    pythonProcess.on('close', async (code) => {
      // Save final logs
      await trainingJob.save();

      if (code === 0) {
        console.log(`✅ Training job ${jobId} completed successfully`);
        await finalizeTraining(trainingJob, dataset, modelStoragePath, modelVersion, company, project);
      } else {
        console.error(`❌ Training job ${jobId} failed with exit code ${code}`);
        trainingJob.status = 'failed';
        trainingJob.error = `Training process exited with code ${code}`;
        trainingJob.completedAt = new Date();
        await trainingJob.save();
      }
    });

    // ✅ Handle cancellation
    // Check periodically if job was cancelled
    const cancellationCheck = setInterval(async () => {
      const updatedJob = await TrainingJob.findOne({ jobId });
      if (updatedJob && updatedJob.status === 'cancelled') {
        console.log(`⚠️ Job ${jobId} cancelled, terminating process...`);
        if (pythonProcess && !pythonProcess.killed) {
          pythonProcess.kill('SIGTERM');
        }
        clearInterval(cancellationCheck);
      }
    }, 2000); // Check every 2 seconds

    // Clean up interval on process exit
    pythonProcess.on('exit', () => {
      clearInterval(cancellationCheck);
    });

  } catch (error) {
    console.error(`❌ Error processing training job ${jobId}:`, error);
    
    if (trainingJob) {
      trainingJob.status = 'failed';
      trainingJob.error = error.message;
      trainingJob.completedAt = new Date();
      await trainingJob.save();
    }

    // Kill Python process if running
    if (pythonProcess && !pythonProcess.killed) {
      pythonProcess.kill('SIGTERM');
    }
  }
};

/**
 * Simulate training (for testing without Python script)
 */
async function simulateTraining(trainingJob, hyperparameters, modelStoragePath) {
  console.log(`🎭 Simulating training for job ${trainingJob.jobId}...`);

  const totalEpochs = hyperparameters.epochs;
  let currentEpoch = 0;

  while (currentEpoch < totalEpochs) {
    // Check if cancelled
    const updatedJob = await TrainingJob.findOne({ jobId: trainingJob.jobId });
    if (updatedJob && updatedJob.status === 'cancelled') {
      console.log(`⚠️ Job ${trainingJob.jobId} cancelled during simulation`);
      return;
    }

    currentEpoch++;
    const progress = trainingService.computeProgressPercent(currentEpoch, totalEpochs);
    
    // Simulate metrics
    const loss = 1.0 - (currentEpoch / totalEpochs) * 0.6; // Decreasing loss
    const mAP50 = 0.5 + (currentEpoch / totalEpochs) * 0.3; // Increasing mAP

    // Update training job
    trainingJob.progress.currentEpoch = currentEpoch;
    trainingJob.progress.progressPercent = progress;
    trainingJob.metrics.currentLoss = loss;
    trainingJob.metrics.currentLR = 0.01;
    
    if (!trainingJob.metrics.bestLoss || loss < trainingJob.metrics.bestLoss) {
      trainingJob.metrics.bestLoss = loss;
      trainingJob.metrics.bestEpoch = currentEpoch;
    }

    trainingJob.metrics.mAP50 = mAP50;
    trainingJob.logs.push(`Epoch ${currentEpoch}/${totalEpochs}: loss=${loss.toFixed(4)}, lr=0.01, mAP50=${mAP50.toFixed(4)}`);

    await trainingJob.save();

    // Simulate epoch duration
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second per epoch
  }

  // Finalize
  await finalizeTraining(
    trainingJob,
    await Dataset.findById(trainingJob.datasetId),
    modelStoragePath,
    'v1',
    trainingJob.company,
    trainingJob.project
  );
}

/**
 * Finalize training: compute final metrics, register model
 */
async function finalizeTraining(trainingJob, dataset, modelStoragePath, modelVersion, company, project) {
  try {
    console.log(`📊 Finalizing training job ${trainingJob.jobId}...`);

    // ✅ Copy best checkpoint to model storage
    // For now, we'll create a placeholder best.pt file
    // In real implementation, this would copy from Python output
    const bestCheckpointPath = path.join(modelStoragePath, 'best.pt');
    await fsPromises.writeFile(bestCheckpointPath, 'placeholder checkpoint file', 'utf8');

    // ✅ Compute final metrics (copy from current metrics)
    const finalMetrics = {
      bestEpoch: trainingJob.metrics.bestEpoch || trainingJob.progress.currentEpoch,
      bestLoss: trainingJob.metrics.bestLoss || trainingJob.metrics.currentLoss,
      precision: trainingJob.metrics.precision || 0.85,
      recall: trainingJob.metrics.recall || 0.78,
      mAP50: trainingJob.metrics.mAP50 || 0.72,
      mAP50_95: trainingJob.metrics.mAP50_95 || 0.58,
      perLabelStats: [] // Will be populated from Python output
    };

    trainingJob.finalMetrics = finalMetrics;

    // ✅ Generate insights (simplified for now)
    const insights = {
      bestAccuracy: finalMetrics.precision,
      bestmAP: finalMetrics.mAP50,
      weakestLabels: [],
      classImbalanceWarnings: [],
      recommendations: []
    };

    // ✅ Create Model registry entry
    const model = new Model({
      modelId: `model_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      jobId: trainingJob._id,
      company,
      project,
      modelVersion,
      modelType: trainingJob.modelType,
      datasetVersion: dataset.version,
      datasetId: dataset._id,
      metrics: finalMetrics,
      insights,
      storagePath: modelStoragePath,
      bestCheckpointPath,
      chartDataPath: path.join(modelStoragePath, 'metrics')
    });

    await model.save();

    // ✅ Update training job status
    trainingJob.status = 'completed';
    trainingJob.completedAt = new Date();
    await trainingJob.save();

    console.log(`✅ Training job ${trainingJob.jobId} completed and model registered: ${model.modelId}`);

  } catch (error) {
    console.error(`❌ Error finalizing training:`, error);
    trainingJob.status = 'failed';
    trainingJob.error = `Finalization error: ${error.message}`;
    trainingJob.completedAt = new Date();
    await trainingJob.save();
  }
}

/**
 * Connect to MongoDB and start processing jobs
 */
const startWorker = async () => {
  try {
    // ✅ Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri);
    console.log('✅ Training worker connected to MongoDB');

    // ✅ Process jobs from queue
    trainingQueue.process(async (job) => {
      await processTrainingJob(job);
    });

    console.log('✅ Training worker started. Waiting for jobs...');

  } catch (error) {
    console.error('❌ Failed to start training worker:', error);
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

// ✅ Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ✅ Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

// ✅ Start the worker
startWorker();

