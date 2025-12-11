const express = require('express');
const router = express.Router();
const {
  getAvailableBaseModels,
  getDefaultHyperparameters,
  startTraining,
  getTrainingStatus,
  getTrainingLogs,
  cancelTraining,
  retryTraining
} = require('../controllers/trainingController');

/**
 * Training Routes
 * 
 * These routes handle training job management:
 * - List available base models
 * - Start a new training job
 * - Check training status and progress
 * - Get training logs
 * - Cancel a running training job
 * - Retry a failed/cancelled training job
 */

// GET /api/train/base-models - List available base YOLO models
router.get('/base-models', getAvailableBaseModels);

// GET /api/train/defaults?modelType=YOLO - Get default hyperparameters for a model type
router.get('/defaults', getDefaultHyperparameters);

// POST /api/train - Start a new training job
router.post('/', startTraining);

// GET /api/train/:jobId/status - Get training job status and progress
router.get('/:jobId/status', getTrainingStatus);

// GET /api/train/:jobId/logs - Get training logs
router.get('/:jobId/logs', getTrainingLogs);

// POST /api/train/:jobId/cancel - Cancel a training job
router.post('/:jobId/cancel', cancelTraining);

// POST /api/train/:jobId/retry - Retry a failed/cancelled training job
router.post('/:jobId/retry', retryTraining);

module.exports = router;

