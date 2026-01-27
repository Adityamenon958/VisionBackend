const TrainingJob = require('../models/TrainingJob');
const Dataset = require('../models/Dataset');
const Model = require('../models/Model');
const { trainingQueue } = require('../queue');
const trainingService = require('../services/trainingService');
const auditService = require('../services/auditService');
const { buildWorkspaceFilter, validateWorkspaceAccess, canAccessAllWorkspaces } = require('../utils/workspaceScoping');
const fs = require('fs');
const path = require('path');
const { BlobServiceClient } = require('@azure/storage-blob');

/**
 * Normalize modelSize input to a consistent format.
 * Supports:
 * - "n" | "s" | "m" | "l" | "x"
 * - "v5n" | "v8n" | "v11s" | "v26n"
 * - "base-v26n"
 * - "yolov26n.pt" | "yolo26n.pt" | "yolov5n.pt"
 */
function normalizeModelSize(input) {
  if (!input) return null;

  let value = String(input).trim();

  if (value.startsWith('base-')) {
    value = value.slice('base-'.length);
  }

  const fileMatch = value.match(/yolov?(\d+)([nsmlx])\.pt/i);
  if (fileMatch) {
    return `v${fileMatch[1]}${fileMatch[2].toLowerCase()}`;
  }

  const versionMatch = value.match(/^v?(5|8|11|26)([nsmlx])$/i);
  if (versionMatch) {
    return `v${versionMatch[1]}${versionMatch[2].toLowerCase()}`;
  }

  const sizeMatch = value.match(/^([nsmlx])$/i);
  if (sizeMatch) {
    return sizeMatch[1].toLowerCase();
  }

  return value;
}

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
 * List available base YOLO models and trained models for a project
 * 
 * Query params:
 * - company (optional) - Filter trained models by company
 * - project (optional) - Filter trained models by project
 * 
 * Returns both base models (from models/base/) and trained models (from MongoDB)
 */
const getAvailableBaseModels = async (req, res) => {
  try {
    const baseModelsDir = path.join(process.cwd(), 'models', 'base');
    
    // ✅ Get trained models from MongoDB (if company and project provided)
    const trainedModels = [];
    if (req.query.company && req.query.project) {
      const models = await Model.find({ company: req.query.company, project: req.query.project })
        .sort({ createdAt: -1 }) // Newest first
        .select('modelId modelVersion modelType metrics createdAt')
        .lean();

      trainedModels.push(...models.map(model => {
        // Format name with metrics: "YOLO - v1 (mAP: 83%)"
        const mAP50 = model.metrics?.mAP50 || 0;
        const mAP50Percent = (mAP50 * 100).toFixed(0);
        const name = `${model.modelType} - ${model.modelVersion} (mAP: ${mAP50Percent}%)`;

        return {
          type: 'trained',
          modelId: model.modelId,
          modelVersion: model.modelVersion,
          modelType: model.modelType,
          name: name,
          metrics: {
            mAP50: model.metrics?.mAP50,
            precision: model.metrics?.precision,
            recall: model.metrics?.recall
          },
          createdAt: model.createdAt
        };
      }));
    }

    // ✅ DUAL MODE: Read base models from Azure Blob Storage OR local filesystem
    const models = [];
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    
    if (connectionString) {
      // ✅ Azure Blob Storage mode
      console.log('[getAvailableBaseModels] Using Azure Blob Storage mode');
      
      try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerName = 'models';
        const prefix = 'base/';
        
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const baseModelsList = [];
        
        // List blobs with prefix "base/"
        for await (const blob of containerClient.listBlobsFlat({ prefix })) {
          // Skip directory placeholders (blobs ending with "/")
          if (blob.name.endsWith('/')) {
            continue;
          }
          
          // Extract filename from blob name (e.g., "base/yolov8n.pt" -> "yolov8n.pt")
          const filename = blob.name.substring(prefix.length);
          
          // Only process .pt files
          if (!filename.endsWith('.pt')) {
            continue;
          }
          
          // Extract model size from filename (yolov8n.pt -> 'n', yolov11s.pt -> 's')
          const v5Match = filename.match(/yolov5([nsmlx])\.pt/);
          const v8Match = filename.match(/yolov8([nsmlx])\.pt/);
          const v11Match = filename.match(/yolov11([nsmlx])\.pt/);
          const v26Match = filename.match(/yolov?26([nsmlx])\.pt/);
          const size = v5Match ? v5Match[1] : (v8Match ? v8Match[1] : (v11Match ? v11Match[1] : (v26Match ? v26Match[1] : null)));
          const version = v5Match ? 'v5' : (v8Match ? 'v8' : (v11Match ? 'v11' : (v26Match ? 'v26' : null)));
          
          // Skip invalid YOLO models
          if (!size || !version) {
            continue;
          }
          
          // Map size codes to readable names
          const sizeNames = {
            'n': 'Nano',
            's': 'Small',
            'm': 'Medium',
            'l': 'Large',
            'x': 'Extra Large'
          };
          
          const sizeMB = blob.properties.contentLength 
            ? (blob.properties.contentLength / (1024 * 1024)).toFixed(2)
            : '0.00';
          
          baseModelsList.push({
            type: 'base',
            filename: filename,
            size: size,
            version: version,
            key: `base-${version}${size}`,
            name: `YOLO${version} ${sizeNames[size]}`,
            sizeMB: parseFloat(sizeMB),
            path: `/models/${blob.name}` // Logical path for Azure mode
          });
        }
        
        // Sort by size (n, s, m, l, x)
        const sizeOrder = { 'n': 1, 's': 2, 'm': 3, 'l': 4, 'x': 5 };
        baseModelsList.sort((a, b) => (sizeOrder[a.size] || 99) - (sizeOrder[b.size] || 99));
        models.push(...baseModelsList);
        
        console.log(`[getAvailableBaseModels] Found ${baseModelsList.length} base models in Azure Blob Storage`);
        
      } catch (error) {
        console.error('[getAvailableBaseModels] Error reading from Azure Blob Storage:', error.message);
        // Fall through to return empty array (don't break the API)
      }
    } else {
      // ✅ Local filesystem mode
      console.log('[getAvailableBaseModels] Using local filesystem mode');
      
      if (fs.existsSync(baseModelsDir)) {
        const files = fs.readdirSync(baseModelsDir);
        const modelFiles = files.filter(file => file.endsWith('.pt'));

        // Map to model info
        const baseModelsList = modelFiles.map(file => {
          const filePath = path.join(baseModelsDir, file);
          const stats = fs.statSync(filePath);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

          // Extract model size from filename (yolov8n.pt -> 'n', yolov11s.pt -> 's')
          const v5Match = file.match(/yolov5([nsmlx])\.pt/);
          const v8Match = file.match(/yolov8([nsmlx])\.pt/);
          const v11Match = file.match(/yolov11([nsmlx])\.pt/);
          const v26Match = file.match(/yolov?26([nsmlx])\.pt/);
          const size = v5Match ? v5Match[1] : (v8Match ? v8Match[1] : (v11Match ? v11Match[1] : (v26Match ? v26Match[1] : null)));
          const version = v5Match ? 'v5' : (v8Match ? 'v8' : (v11Match ? 'v11' : (v26Match ? 'v26' : null)));

          // Map size codes to readable names
          const sizeNames = {
            'n': 'Nano',
            's': 'Small',
            'm': 'Medium',
            'l': 'Large',
            'x': 'Extra Large'
          };

          return {
            type: 'base',
            filename: file,
            size: size,
            version: version,
            key: `base-${version}${size}`,
            name: size && version ? `YOLO${version} ${sizeNames[size]}` : file.replace('.pt', ''),
            sizeMB: parseFloat(sizeMB),
            path: filePath
          };
        }).filter(model => model.size !== null); // Only include valid YOLO models

        // Sort by size (n, s, m, l, x)
        const sizeOrder = { 'n': 1, 's': 2, 'm': 3, 'l': 4, 'x': 5 };
        baseModelsList.sort((a, b) => (sizeOrder[a.size] || 99) - (sizeOrder[b.size] || 99));
        models.push(...baseModelsList);
        
        console.log(`[getAvailableBaseModels] Found ${baseModelsList.length} base models in local filesystem`);
      }
    }

    return res.status(200).json({
      baseModels: models,
      trainedModels: trainedModels,
      total: models.length + trainedModels.length
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
    const { datasetId, modelId, modelType, modelSize, modelKey, hyperparameters } = req.body;
    const normalizedModelSize = normalizeModelSize(modelSize);
    const normalizedModelKey = modelKey ? String(modelKey).trim() : null;

    // Validate required fields
    if (!datasetId) {
      return res.status(400).json({
        error: 'Missing required field: datasetId'
      });
    }

    // ✅ If modelId is provided, validate and use trained model
    let trainedModel = null;
    let finalModelType = modelType;
    let finalModelSize = normalizedModelSize || 'n';
    let finalModelKey = normalizedModelKey;

    if (modelId) {
      // Fetch trained model from database
      trainedModel = await Model.findOne({ modelId });
      
      if (!trainedModel) {
        return res.status(404).json({
          error: 'Trained model not found',
          modelId: modelId
        });
      }

      // ✅ Validate that modelType matches (if provided)
      if (modelType && modelType !== trainedModel.modelType) {
        return res.status(400).json({
          error: `Model type mismatch. Trained model is ${trainedModel.modelType}, but ${modelType} was provided.`
        });
      }

      // Use trained model's type and size
      finalModelType = trainedModel.modelType;
      // Note: trained models don't have modelSize stored, so we'll use the one from request or default
      
      // Validate that model belongs to same company/project as dataset
      const dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        return res.status(404).json({
          error: 'Dataset not found'
        });
      }

      if (trainedModel.company !== dataset.company || trainedModel.project !== dataset.project) {
        return res.status(400).json({
          error: 'Trained model does not belong to the same company/project as the dataset'
        });
      }
    } else {
      // ✅ If no modelId, validate modelType and modelSize (base model)
      if (!modelType) {
        return res.status(400).json({
          error: 'Missing required field: modelType (or provide modelId for trained model)'
        });
      }

      // Validate modelType
      if (!['YOLO', 'EfficientNet', 'Custom'].includes(modelType)) {
        return res.status(400).json({
          error: 'Invalid modelType. Must be one of: YOLO, EfficientNet, Custom'
        });
      }

      // Validate modelSize for YOLO (optional, defaults to 'n')
      if (modelType === 'YOLO' && normalizedModelSize) {
        const validSizePattern = /^(?:[nsmlx]|v(?:5|8|11|26)[nsmlx])$/i;
        if (!validSizePattern.test(normalizedModelSize)) {
          return res.status(400).json({
            error: 'Invalid modelSize. Must be one of: n/s/m/l/x or v5n/v8n/v11n/v26n'
          });
        }
      }

      if (modelType === 'YOLO' && normalizedModelKey) {
        const validKeyPattern = /^base-v(?:5|8|11|26)[nsmlx]$/i;
        if (!validKeyPattern.test(normalizedModelKey)) {
          return res.status(400).json({
            error: 'Invalid modelKey. Must be like base-v5n/base-v8n/base-v11n/base-v26n'
          });
        }
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

    // Merge hyperparameters with defaults (use finalModelType which may come from trained model)
    const mergedHyperparameters = trainingService.mergeHyperparameters(finalModelType, hyperparameters);

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
      modelType: finalModelType,
      modelSize: finalModelSize,
      modelKey: finalModelKey,
      status: 'queued',
      hyperparameters: mergedHyperparameters
    });

    await trainingJob.save();

    // Enqueue training job (include modelId if using trained model)
    await trainingQueue.add({
      jobId,
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      modelType: finalModelType,
      modelSize: finalModelSize,
      modelKey: finalModelKey,
      modelId: modelId || null, // ✅ Pass modelId if provided (for trained model)
      hyperparameters: mergedHyperparameters
    }, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false
    });

    // Log training job execution activity
    await auditService.logAction({
      action: 'execute',
      resourceType: 'training',
      resourceId: jobId,
      details: {
        company: dataset.company,
        project: dataset.project,
        projectName: dataset.project,
        datasetId: dataset._id.toString(),
        modelType: finalModelType,
        modelSize: finalModelSize
      },
      req
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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, trainingJob.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this training job'
        });
      }
    }

    // ✅ Build base response with training job data
    const response = {
      jobId: trainingJob.jobId,
      status: trainingJob.status,
      progress: trainingJob.progress,
      metrics: trainingJob.metrics,
      finalMetrics: trainingJob.finalMetrics || null, // ✅ Include final metrics
      hyperparameters: trainingJob.hyperparameters, // ✅ Include hyperparameters used
      modelType: trainingJob.modelType,
      modelSize: trainingJob.modelSize,
      startedAt: trainingJob.startedAt,
      completedAt: trainingJob.completedAt,
      cancelledAt: trainingJob.cancelledAt,
      error: trainingJob.error,
      model: null // ✅ Will be populated if model is registered
    };

    // ✅ If training is completed, check if model was registered
    if (trainingJob.status === 'completed') {
      const registeredModel = await Model.findOne({ jobId: trainingJob._id })
        .select('modelId modelVersion storagePath bestCheckpointPath downloadUrl metrics insights createdAt')
        .lean();

      if (registeredModel) {
        response.model = {
          modelId: registeredModel.modelId,
          modelVersion: registeredModel.modelVersion,
          storagePath: registeredModel.storagePath,
          bestCheckpointPath: registeredModel.bestCheckpointPath,
          downloadUrl: registeredModel.downloadUrl,
          metrics: registeredModel.metrics,
          insights: registeredModel.insights,
          registeredAt: registeredModel.createdAt
        };
      }
    }

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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, trainingJob.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this training job'
        });
      }
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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, originalJob.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this training job'
        });
      }
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
