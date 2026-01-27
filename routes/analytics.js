const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizationMiddleware');
const {
  getTrainingAnalytics,
  getTrainingStatusSummary,
  getInferenceRuns,
  getInferencePassFail,
  getAccuracyTrends
} = require('../controllers/analyticsController');

/**
 * Analytics Routes
 *
 * Read-only analytics endpoints for training and inference.
 */

// Training analytics for a specific model
router.get('/training/:modelId', authenticateToken, requirePermission('viewTrainingMetrics'), getTrainingAnalytics);

// Training status summary
router.get('/training/status', authenticateToken, requirePermission('viewTrainingMetrics'), getTrainingStatusSummary);

// Inference runs summary
router.get('/inference/runs', authenticateToken, requirePermission('viewInferenceResults'), getInferenceRuns);

// Inference pass/fail statistics
router.get('/inference/pass-fail', authenticateToken, requirePermission('viewInferenceResults'), getInferencePassFail);

// Accuracy trends over time
router.get('/accuracy/trends', authenticateToken, requirePermission('viewTrainingMetrics'), getAccuracyTrends);

module.exports = router;

