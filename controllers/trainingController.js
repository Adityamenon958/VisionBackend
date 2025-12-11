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
 *     "epochs": 20,
 *     "batchSize": 8,
 *     "imgSize": 416,
 *     "learningRate": 0.01,
 *     "workers": 2
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
 */
const startTraining = async (req, res) => {
  try {
    const { datasetId, modelType, modelSize, hyperparameters } = req.body;

    // Validate required fields
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

    // Validate modelType
    if (!['YOLO', 'EfficientNet', 'Custom'].includes(modelType)) {
      return res.status(400).json({
        error: 'Invalid modelType. Must be one of: YOLO, EfficientNet, Custom'
      });
    }

    // Validate modelSize for YOLO (optional, defaults to 'n')
    let finalModelSize = modelSize || 'n';
    if (modelType === 'YOLO' && modelSize) {
      if (!['n', 's', 'm', 'l', 'x'].includes(modelSize)) {
        return res.status(400).json({
          error: 'Invalid modelSize. Must be one of: n (nano), s (small), m (medium), l (large), x (extra large)'
        });
      }
    }

    // Validate dataset
    const validation = await trainingService.validateDatasetForTraining(datasetId);
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.error
      });
    }

    const dataset = validation.dataset;

    // Merge hyperparameters with defaults
    const mergedHyperparameters = trainingService.mergeHyperparameters(modelType, hyperparameters);

    // Validate hyperparameters
    const hyperValidation = trainingService.validateHyperparameters(mergedHyperparameters);
    if (!hyperValidation.valid) {
      return res.status(400).json({
        error: hyperValidation.error
      });
    }

    // Generate job ID
    const jobId = trainingService.generateJobId();

    // Create TrainingJob document
    const trainingJob = new TrainingJob({
      jobId,
      datasetId: dataset._id,
      company: dataset.company,
      project: dataset.project,
      modelType,
      modelSize: finalModelSize,
      status: 'queued',
      hyperparameters: mergedHyperparameters
    });

    await trainingJob.save();

    // Enqueue training job
    await trainingQueue.add({
      jobId,
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      modelType,
      modelSize: finalModelSize,
      hyperparameters: mergedHyperparameters
    }, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false
    });

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

    const trainingJob = await TrainingJob.findOne({ jobId });

    if (!trainingJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    return res.status(200).json({
      jobId: trainingJob.jobId,
      status: trainingJob.status,
      progress: trainingJob.progress,
      metrics: trainingJob.metrics,
      startedAt: trainingJob.startedAt,
      completedAt: trainingJob.completedAt,
      error: trainingJob.error
    });

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
 */
const getTrainingLogs = async (req, res) => {
  try {
    const { jobId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const trainingJob = await TrainingJob.findOne({ jobId });

    if (!trainingJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    // Return last N logs
    const logs = trainingJob.logs.slice(-limit);

    return res.status(200).json({
      jobId: trainingJob.jobId,
      logs: logs,
      total: trainingJob.logs.length
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
 * Cancel a training job
 */
const cancelTraining = async (req, res) => {
  try {
    const { jobId } = req.params;

    const trainingJob = await TrainingJob.findOne({ jobId });

    if (!trainingJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    if (!trainingService.canCancelJob(trainingJob.status)) {
      return res.status(400).json({
        error: `Cannot cancel job with status: ${trainingJob.status}`,
        validStatuses: ['queued', 'running']
      });
    }

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
 * Retry a failed/cancelled training job
 */
const retryTraining = async (req, res) => {
  try {
    const { jobId } = req.params;

    const originalJob = await TrainingJob.findOne({ jobId });

    if (!originalJob) {
      return res.status(404).json({
        error: 'Training job not found',
        jobId: jobId
      });
    }

    if (!trainingService.canRetryJob(originalJob.status)) {
      return res.status(400).json({
        error: `Cannot retry job with status: ${originalJob.status}`,
        validStatuses: ['failed', 'cancelled']
      });
    }

    // Create new job with same parameters
    const newJobId = trainingService.generateJobId();
    const newTrainingJob = new TrainingJob({
      jobId: newJobId,
      datasetId: originalJob.datasetId,
      company: originalJob.company,
      project: originalJob.project,
      modelType: originalJob.modelType,
      modelSize: originalJob.modelSize || 'n',
      status: 'queued',
      hyperparameters: originalJob.hyperparameters
    });

    await newTrainingJob.save();

    // Enqueue new training job
    await trainingQueue.add({
      jobId: newJobId,
      datasetId: originalJob.datasetId.toString(),
      company: originalJob.company,
      project: originalJob.project,
      modelType: originalJob.modelType,
      modelSize: originalJob.modelSize || 'n',
      hyperparameters: originalJob.hyperparameters
    }, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false
    });

    return res.status(202).json({
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
