const express = require('express');
const router = express.Router();
const {
  listModels,
  getModel,
  getModelMetrics,
  getModelInsights,
  downloadModel,
  listCheckpoints,
  deleteModel
} = require('../controllers/modelController');

/**
 * Model Registry Routes
 * 
 * These routes handle trained model management:
 * - List all models for a company/project
 * - Get model details
 * - Get model metrics and charts
 * - Get model insights and recommendations
 * - Download model files
 * - List checkpoints
 * - Delete models and their files
 */

// GET /api/models - List all models (filtered by company/project)
router.get('/', listModels);

// GET /api/models/:modelId - Get model details
router.get('/:modelId', getModel);

// GET /api/models/:modelId/metrics - Get detailed metrics and chart data
router.get('/:modelId/metrics', getModelMetrics);

// GET /api/models/:modelId/insights - Get insights and recommendations
router.get('/:modelId/insights', getModelInsights);

// GET /api/models/:modelId/download - Download model file
router.get('/:modelId/download', downloadModel);

// GET /api/models/:modelId/checkpoints - List all checkpoints
router.get('/:modelId/checkpoints', listCheckpoints);

// DELETE /api/models/:modelId - Delete model and its files
router.delete('/:modelId', deleteModel);

module.exports = router;





