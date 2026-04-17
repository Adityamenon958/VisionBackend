const express = require('express');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizationMiddleware');
const {
  startDemoSession,
  ingestDemoFrame,
  listSessionReads,
  stopDemoSession,
  clearSessionReads,
  getIpCameraSnapshot
} = require('../controllers/demoExtinguisherController');

const router = express.Router();

/**
 * Demo Extinguisher OCR Routes
 *
 * Temporary client-demo-only surface.
 */
router.post('/session/start', authenticateToken, requirePermission('runInference'), startDemoSession);
router.post('/ip-camera/snapshot', authenticateToken, requirePermission('runInference'), getIpCameraSnapshot);
router.post('/session/:sessionId/frame', authenticateToken, requirePermission('runInference'), ingestDemoFrame);
router.get('/session/:sessionId/reads', authenticateToken, requirePermission('viewInferenceResults'), listSessionReads);
router.post('/session/:sessionId/stop', authenticateToken, requirePermission('runInference'), stopDemoSession);
router.delete('/session/:sessionId/reads', authenticateToken, requirePermission('runInference'), clearSessionReads);

module.exports = router;
