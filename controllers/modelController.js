const Model = require('../models/Model');
const TrainingJob = require('../models/TrainingJob');
const fs = require('fs');
const path = require('path');
const storageAdapter = require('../services/storageAdapter');

/**
 * Model Controller - Handles model registry operations
 * 
 * This controller provides endpoints for:
 * - Listing trained models
 * - Getting model details
 * - Retrieving metrics and chart data
 * - Getting insights and recommendations
 * - Downloading model files
 * - Listing checkpoints
 */

/**
 * GET /api/models
 * 
 * List all models for a company and project
 * 
 * Query params:
 * - company (required)
 * - project (required)
 */
const listModels = async (req, res) => {
  try {
    const { company, project } = req.query;

    // ✅ Validate required query parameters
    if (!company || !project) {
      return res.status(400).json({
        error: 'Missing required query parameters',
        required: ['company', 'project']
      });
    }

    // ✅ Find all models for company/project
    const models = await Model.find({ company, project })
      .sort({ createdAt: -1 }) // Newest first
      .select('modelId modelVersion modelType status metrics insights createdAt')
      .lean();

    // ✅ Format response with all metrics and insights
    const formattedModels = models.map(model => ({
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      modelType: model.modelType,
      status: model.status || 'completed',
      metrics: model.metrics || {
        bestEpoch: null,
        bestLoss: null,
        precision: null,
        recall: null,
        mAP50: null,
        mAP50_95: null,
        perLabelStats: []
      },
      insights: model.insights || {
        bestAccuracy: null,
        bestmAP: null,
        weakestLabels: [],
        classImbalanceWarnings: [],
        recommendations: []
      },
      createdAt: model.createdAt
    }));

    return res.status(200).json({
      models: formattedModels,
      total: formattedModels.length
    });

  } catch (error) {
    console.error('Error listing models:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/models/:modelId
 * 
 * Get full model details
 */
const getModel = async (req, res) => {
  try {
    const { modelId } = req.params;

    if (!modelId) {
      return res.status(400).json({
        error: 'Missing required parameter: modelId'
      });
    }

    // ✅ Find model
    const model = await Model.findOne({ modelId })
      .populate('jobId', 'jobId status hyperparameters')
      .populate('datasetId', 'company project version status totalImages trainCount valCount')
      .lean();

    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: modelId
      });
    }

    // ✅ Format response
    const response = {
      modelId: model.modelId,
      jobId: model.jobId?._id?.toString(),
      company: model.company,
      project: model.project,
      modelVersion: model.modelVersion,
      modelType: model.modelType,
      datasetVersion: model.datasetVersion,
      datasetId: model.datasetId?._id?.toString(),
      metrics: model.metrics,
      insights: model.insights,
      storagePath: model.storagePath,
      bestCheckpointPath: model.bestCheckpointPath,
      createdAt: model.createdAt
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting model:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/models/:modelId/metrics
 * 
 * Get detailed metrics including per-label stats and chart data
 */
const getModelMetrics = async (req, res) => {
  try {
    const { modelId } = req.params;

    if (!modelId) {
      return res.status(400).json({
        error: 'Missing required parameter: modelId'
      });
    }

    // ✅ Find model
    const model = await Model.findOne({ modelId }).lean();

    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: modelId
      });
    }

    // ✅ Load chart data if available
    let chartData = null;
    if (model.chartDataPath) {
      try {
        const lossCurvePath = path.join(model.chartDataPath, 'loss_curve.json');
        const precisionCurvePath = path.join(model.chartDataPath, 'precision_curve.json');
        const mapCurvePath = path.join(model.chartDataPath, 'map_curve.json');

        const lossCurve = fs.existsSync(lossCurvePath) 
          ? JSON.parse(fs.readFileSync(lossCurvePath, 'utf8'))
          : null;
        const precisionCurve = fs.existsSync(precisionCurvePath)
          ? JSON.parse(fs.readFileSync(precisionCurvePath, 'utf8'))
          : null;
        const mapCurve = fs.existsSync(mapCurvePath)
          ? JSON.parse(fs.readFileSync(mapCurvePath, 'utf8'))
          : null;

        chartData = {
          lossCurve: lossCurve || [],
          precisionCurve: precisionCurve || [],
          mAPCurve: mapCurve || []
        };
      } catch (error) {
        console.warn(`Could not load chart data for model ${modelId}:`, error.message);
        chartData = {
          lossCurve: [],
          precisionCurve: [],
          mAPCurve: []
        };
      }
    }

    // ✅ Format response
    const response = {
      modelId: model.modelId,
      metrics: model.metrics || {},
      chartData: chartData || {
        lossCurve: [],
        precisionCurve: [],
        mAPCurve: []
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting model metrics:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/models/:modelId/insights
 * 
 * Get insights and recommendations
 */
const getModelInsights = async (req, res) => {
  try {
    const { modelId } = req.params;

    if (!modelId) {
      return res.status(400).json({
        error: 'Missing required parameter: modelId'
      });
    }

    // ✅ Find model
    const model = await Model.findOne({ modelId }).lean();

    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: modelId
      });
    }

    // ✅ Format response
    const response = {
      modelId: model.modelId,
      insights: model.insights || {
        bestAccuracy: null,
        bestmAP: null,
        weakestLabels: [],
        classImbalanceWarnings: [],
        recommendations: []
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting model insights:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/models/:modelId/download
 * 
 * Download the best checkpoint file
 */
const downloadModel = async (req, res) => {
  try {
    const { modelId } = req.params;

    if (!modelId) {
      return res.status(400).json({
        error: 'Missing required parameter: modelId'
      });
    }

    // ✅ Find model
    const model = await Model.findOne({ modelId }).lean();

    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: modelId
      });
    }

    // ✅ Check if file exists
    const filePath = model.bestCheckpointPath || path.join(model.storagePath, 'best.pt');
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Model file not found',
        modelId: modelId,
        path: filePath
      });
    }

    // ✅ Set headers for file download
    const filename = `model_${model.modelVersion}.pt`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // ✅ Stream file to response
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('Error streaming model file:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Error reading model file',
          message: error.message
        });
      }
    });

  } catch (error) {
    console.error('Error downloading model:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
};

/**
 * GET /api/models/:modelId/checkpoints
 * 
 * List all checkpoints for a model
 */
const listCheckpoints = async (req, res) => {
  try {
    const { modelId } = req.params;

    if (!modelId) {
      return res.status(400).json({
        error: 'Missing required parameter: modelId'
      });
    }

    // ✅ Find model
    const model = await Model.findOne({ modelId }).lean();

    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: modelId
      });
    }

    // ✅ Get checkpoints from training job
    const trainingJob = await TrainingJob.findById(model.jobId).lean();

    if (!trainingJob) {
      return res.status(404).json({
        error: 'Training job not found',
        modelId: modelId
      });
    }

    // ✅ Format checkpoints
    const checkpoints = (trainingJob.checkpoints || []).map(checkpoint => ({
      epoch: checkpoint.epoch,
      path: checkpoint.path,
      isBest: checkpoint.isBest,
      metrics: checkpoint.metrics,
      savedAt: checkpoint.savedAt
    }));

    return res.status(200).json({
      modelId: model.modelId,
      checkpoints: checkpoints,
      total: checkpoints.length
    });

  } catch (error) {
    console.error('Error listing checkpoints:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

module.exports = {
  listModels,
  getModel,
  getModelMetrics,
  getModelInsights,
  downloadModel,
  listCheckpoints
};

