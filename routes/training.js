const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizationMiddleware');
const {
  getAvailableBaseModels,
  getDefaultHyperparameters,
  startTraining,
  getActiveTraining,
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
router.get('/base-models', authenticateToken, requirePermission('viewModels'), getAvailableBaseModels);

// GET /api/train/defaults?modelType=YOLO - Get default hyperparameters for a model type
router.get('/defaults', authenticateToken, requirePermission('viewTrainingMetrics'), getDefaultHyperparameters);

// POST /api/train - Start a new training job
router.post('/', authenticateToken, requirePermission('startTraining'), startTraining);

// GET /api/train/active - Live queued/running job (must be before /:jobId/status)
router.get('/active', authenticateToken, requirePermission('viewTrainingMetrics'), getActiveTraining);

// GET /api/train/:jobId/status - Get training job status and progress
router.get('/:jobId/status', authenticateToken, requirePermission('viewTrainingMetrics'), getTrainingStatus);

// GET /api/train/:jobId/logs - Get training logs
router.get('/:jobId/logs', authenticateToken, requirePermission('viewTrainingMetrics'), getTrainingLogs);

// POST /api/train/:jobId/cancel - Cancel a training job
router.post('/:jobId/cancel', authenticateToken, requirePermission('startTraining'), cancelTraining);

// POST /api/train/:jobId/retry - Retry a failed/cancelled training job
router.post('/:jobId/retry', authenticateToken, requirePermission('startTraining'), retryTraining);

module.exports = router;

