const TrainingJob = require('../models/TrainingJob');
const Dataset = require('../models/Dataset');
const { trainingQueue } = require('../queue');
const trainingService = require('../services/trainingService');
const fs = require('fs');
const path = require('path');

/**
 * Training Controller - Handles training job management
 * 
 * This controller provides endpoints for:
 * - Listing available base models
 * - Starting new training jobs
 * - Checking training status and progress
 * - Retrieving training logs
 * - Cancelling training jobs
 * - Retrying failed/cancelled jobs
 */

/**
 * GET /api/train/base-models
 * 
 * List available base YOLO models in models/base/ directory
 */
const getAvailableBaseModels = async (req, res) => {
  try {
    const baseModelsDir = path.join(process.cwd(), 'models', 'base');
    
    // Check if directory exists
    if (!fs.existsSync(baseModelsDir)) {
      return res.status(200).json({
        models: [],
        message: 'Base models directory does not exist. Run: npm run download-models'
      });
    }

    // Read directory and filter .pt files
    const files = fs.readdirSync(baseModelsDir);
    const modelFiles = files.filter(file => file.endsWith('.pt'));

    // Map to model info
    const models = modelFiles.map(file => {
      const filePath = path.join(baseModelsDir, file);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      // Extract model size from filename (yolov8n.pt -> 'n', yolov11s.pt -> 's')
      const v8Match = file.match(/yolov8([nsmlx])\.pt/);
      const v11Match = file.match(/yolov11([nsmlx])\.pt/);
      const size = v8Match ? v8Match[1] : (v11Match ? v11Match[1] : null);
      const version = v8Match ? 'v8' : (v11Match ? 'v11' : null);

      // Map size codes to readable names
      const sizeNames = {
        'n': 'Nano',
        's': 'Small',
        'm': 'Medium',
        'l': 'Large',
        'x': 'Extra Large'
      };

      return {
        filename: file,
        size: size,
        version: version,
        name: size && version ? `YOLO${version} ${sizeNames[size]}` : file.replace('.pt', ''),
        sizeMB: parseFloat(sizeMB),
        path: filePath
      };
    }).filter(model => model.size !== null); // Only include valid YOLO models

    // Sort by size (n, s, m, l, x)
    const sizeOrder = { 'n': 1, 's': 2, 'm': 3, 'l': 4, 'x': 5 };
    models.sort((a, b) => (sizeOrder[a.size] || 99) - (sizeOrder[b.size] || 99));

    return res.status(200).json({
      models: models,
      total: models.length
    });

  } catch (error) {
    console.error('Error listing base models:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/train/defaults
 * 
 * Get default hyperparameters for a model type
 * 
 * Query params:
 * - modelType: 'YOLO' | 'EfficientNet' | 'Custom'
 * 
 * Response:
 * {
 *   "modelType": "YOLO",
 *   "defaults": {
 *     "epochs": 100,
 *     "batchSize": 16,
 *     "imgSize": 640,
 *     "learningRate": 0.01,
 *     "workers": 4
 *   }
 * }
 */
const getDefaultHyperparameters = async (req, res) => {
  try {
    const { modelType } = req.query;

    if (!modelType) {
      return res.status(400).json({
        error: 'modelType query parameter is required',
        validTypes: ['YOLO', 'EfficientNet', 'Custom']
      });
    }

    const validTypes = ['YOLO', 'EfficientNet', 'Custom'];
    if (!validTypes.includes(modelType)) {
      return res.status(400).json({
        error: `Invalid modelType: ${modelType}`,
        validTypes: validTypes
      });
    }

    const defaults = trainingService.getDefaultHyperparameters(modelType);

    return res.status(200).json({
      modelType: modelType,
      defaults: defaults
    });

  } catch (error) {
    console.error('Error getting default hyperparameters:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/train
 * 
 * Start a new training job
 * 
 * Request body:
 * {
 *   "datasetId": "507f1f77bcf86cd799439011",
 *   "modelType": "YOLO",
 *   "hyperparameters": {
 *     "epochs": 100,
 *     "batchSize": 16,
 *     "imgSize": 640,
 *     "learningRate": 0.01,
 *     "workers": 4
 *   }
 * }
 */
const startTraining = async (req, res) => {
  try {
    const { datasetId, modelType, modelSize, hyperparameters } = req.body;

    // ✅ Validate required fields
    if (!datasetId) {
      return res.status(400).json({
        error: 'Missing required field: datasetId'
      });
    }

    if (!modelType) {
      return res.status(400).json({
        error: 'Missing required field: modelType'
      });
    }

    // ✅ Validate modelType
    if (!['YOLO', 'EfficientNet', 'Custom'].includes(modelType)) {
      return res.status(400).json({
        error: 'Invalid modelType. Must be one of: YOLO, EfficientNet, Custom'
      });
    }

    // ✅ Validate modelSize for YOLO (optional, defaults to 'n')
    let finalModelSize = modelSize || 'n'; // Default to 'n' (nano)
    if (modelType === 'YOLO' && modelSize) {
      if (!['n', 's', 'm', 'l', 'x'].includes(modelSize)) {
        return res.status(400).json({
          error: 'Invalid modelSize. Must be one of: n (nano), s (small), m (medium), l (large), x (extra large)'
        });
      }
      finalModelSize = modelSize;
    }

    // ✅ Validate dataset exists and is ready for training
    const validation = await trainingService.validateDatasetForTraining(datasetId);
    if (!validation.valid) {
      if (validation.error.includes('not found')) {
        return res.status(404).json({
          error: validation.error,
          datasetId: datasetId
        });
      }
      if (validation.error.includes('not ready')) {
        return res.status(409).json({
          error: validation.error,
          datasetId: datasetId,
          status: validation.dataset?.status
        });
      }
      return res.status(400).json({
        error: validation.error,
        datasetId: datasetId
      });
    }

    const dataset = validation.dataset;

    // ✅ Merge user hyperparameters with defaults
    const mergedHyperparameters = trainingService.mergeHyperparameters(modelType, hyperparameters);

    // ✅ Validate merged hyperparameters
    const hyperparameterValidation = trainingService.validateHyperparameters(mergedHyperparameters);
    if (!hyperparameterValidation.valid) {
      return res.status(400).json({
        error: 'Invalid hyperparameters',
        details: hyperparameterValidation.error
      });
    }

    // ✅ Generate unique job ID
    const jobId = trainingService.generateJobId();

    // ✅ Create TrainingJob document
    const trainingJob = new TrainingJob({
      jobId,
      datasetId: dataset._id,
      company: dataset.company,
      project: dataset.project,
      modelType,
      status: 'queued',
      hyperparameters: mergedHyperparameters,
      progress: {
        currentEpoch: 0,
        totalEpochs: mergedHyperparameters.epochs,
        progressPercent: 0
      }
    });

    // ✅ Save to MongoDB
    await trainingJob.save();

    // ✅ Enqueue job to training queue
    await trainingQueue.add({
      jobId,
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      modelType,
      modelSize: finalModelSize, // Include model size
      hyperparameters: mergedHyperparameters
    }, {
      attempts: 1, // Don't retry automatically (user can retry manually)
      removeOnComplete: false, // Keep completed jobs for history
      removeOnFail: false // Keep failed jobs for debugging
    });

    // ✅ Return success response
    return res.status(202).json({
      jobId,
      status: 'queued',
      message: 'Training job queued successfully',
      datasetId: dataset._id.toString(),
      modelType,
      modelSize: finalModelSize,
      hyperparameters: mergedHyperparameters
    });

  } catch (error) {
    console.error('Error starting training:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/train/:jobId/status
 * 
 * Get training job status and progress
 */
const getTrainingStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: 'Missing required parameter: jobId'
      });
    }

    // ✅ Find training job
    const trainingJob = await TrainingJob.findOne({ jobId });

    if (!trainingJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    // ✅ Calculate estimated completion time (if running)
    let estimatedCompletion = null;
    if (trainingJob.status === 'running' && trainingJob.startedAt && trainingJob.progress.currentEpoch > 0) {
      const elapsed = Date.now() - trainingJob.startedAt.getTime();
      const avgTimePerEpoch = elapsed / trainingJob.progress.currentEpoch;
      const remainingEpochs = trainingJob.progress.totalEpochs - trainingJob.progress.currentEpoch;
      estimatedCompletion = new Date(Date.now() + (avgTimePerEpoch * remainingEpochs));
    }

    // ✅ Build response
    const response = {
      jobId: trainingJob.jobId,
      status: trainingJob.status,
      progress: {
        currentEpoch: trainingJob.progress.currentEpoch,
        totalEpochs: trainingJob.progress.totalEpochs,
        progressPercent: trainingJob.progress.progressPercent
      },
      metrics: trainingJob.metrics.currentLoss ? {
        currentLoss: trainingJob.metrics.currentLoss,
        currentLR: trainingJob.metrics.currentLR,
        bestLoss: trainingJob.metrics.bestLoss,
        bestEpoch: trainingJob.metrics.bestEpoch,
        mAP50: trainingJob.metrics.mAP50,
        mAP50_95: trainingJob.metrics.mAP50_95
      } : null,
      startedAt: trainingJob.startedAt,
      estimatedCompletion: estimatedCompletion
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting training status:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/train/:jobId/logs
 * 
 * Get training logs
 * 
 * Query params:
 * - limit: Maximum number of log lines (default: 100, max: 1000)
 */
const getTrainingLogs = async (req, res) => {
  try {
    const { jobId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000); // Max 1000 lines

    if (!jobId) {
      return res.status(400).json({
        error: 'Missing required parameter: jobId'
      });
    }

    // ✅ Find training job
    const trainingJob = await TrainingJob.findOne({ jobId });

    if (!trainingJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    // ✅ Get logs (most recent first if limit is applied)
    const totalLines = trainingJob.logs.length;
    let logs = trainingJob.logs;

    if (limit < totalLines) {
      // Return last N lines (most recent)
      logs = trainingJob.logs.slice(-limit);
    }

    return res.status(200).json({
      jobId: trainingJob.jobId,
      logs: logs,
      totalLines: totalLines,
      returnedLines: logs.length
    });

  } catch (error) {
    console.error('Error getting training logs:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/train/:jobId/cancel
 * 
 * Cancel a training job (only if queued or running)
 */
const cancelTraining = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: 'Missing required parameter: jobId'
      });
    }

    // ✅ Find training job
    const trainingJob = await TrainingJob.findOne({ jobId });

    if (!trainingJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    // ✅ Check if job can be cancelled
    if (!trainingService.canCancelJob(trainingJob.status)) {
      return res.status(409).json({
        error: 'Training job cannot be cancelled',
        jobId: jobId,
        status: trainingJob.status,
        reason: `Job is already ${trainingJob.status}`
      });
    }

    // ✅ If job is queued, remove it from queue
    if (trainingJob.status === 'queued') {
      // Find and remove the job from queue
      const jobs = await trainingQueue.getJobs(['waiting', 'delayed']);
      for (const job of jobs) {
        if (job.data.jobId === jobId) {
          await job.remove();
          break;
        }
      }
    }

    // ✅ If job is running, we'll signal cancellation (worker will check this)
    // For now, just update status - worker will check status periodically
    trainingJob.status = 'cancelled';
    trainingJob.cancelledAt = new Date();
    await trainingJob.save();

    return res.status(200).json({
      jobId: trainingJob.jobId,
      status: 'cancelled',
      message: 'Training job cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling training:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/train/:jobId/retry
 * 
 * Retry a failed or cancelled training job
 * Creates a new job with the same parameters
 */
const retryTraining = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: 'Missing required parameter: jobId'
      });
    }

    // ✅ Find original training job
    const originalJob = await TrainingJob.findOne({ jobId });

    if (!originalJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    // ✅ Check if job can be retried
    if (!trainingService.canRetryJob(originalJob.status)) {
      return res.status(409).json({
        error: 'Training job cannot be retried',
        jobId: jobId,
        status: originalJob.status,
        reason: `Job is ${originalJob.status}. Only failed or cancelled jobs can be retried.`
      });
    }

    // ✅ Validate dataset is still ready
    const validation = await trainingService.validateDatasetForTraining(originalJob.datasetId);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Cannot retry: ' + validation.error,
        datasetId: originalJob.datasetId.toString()
      });
    }

    // ✅ Generate new job ID
    const newJobId = trainingService.generateJobId();

    // ✅ Create new training job with same parameters
    const newTrainingJob = new TrainingJob({
      jobId: newJobId,
      datasetId: originalJob.datasetId,
      company: originalJob.company,
      project: originalJob.project,
      modelType: originalJob.modelType,
      modelSize: originalJob.modelSize || 'n', // Preserve model size
      status: 'queued',
      hyperparameters: originalJob.hyperparameters,
      progress: {
        currentEpoch: 0,
        totalEpochs: originalJob.hyperparameters.epochs,
        progressPercent: 0
      }
    });

    await newTrainingJob.save();

    // ✅ Enqueue new job
    await trainingQueue.add({
      jobId: newJobId,
      datasetId: originalJob.datasetId.toString(),
      company: originalJob.company,
      project: originalJob.project,
      modelType: originalJob.modelType,
      modelSize: originalJob.modelSize || 'n', // Preserve model size
      hyperparameters: originalJob.hyperparameters
    }, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false
    });

    return res.status(200).json({
      jobId: newJobId,
      status: 'queued',
      message: 'Training job retried successfully',
      originalJobId: jobId
    });

  } catch (error) {
    console.error('Error retrying training:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

module.exports = {
  getAvailableBaseModels,
  getDefaultHyperparameters,
  startTraining,
  getTrainingStatus,
  getTrainingLogs,
  cancelTraining,
  retryTraining
};

