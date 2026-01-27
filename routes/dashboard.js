const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizationMiddleware');
const {
  getDashboardOverview,
  getDashboardActivity,
  getDashboardProjects
} = require('../controllers/dashboardController');

/**
 * Dashboard Routes
 *
 * All routes here are read-only aggregations over existing data.
 */

// GET /api/dashboard/overview
router.get('/overview', authenticateToken, requirePermission('viewProjects'), getDashboardOverview);

// GET /api/dashboard/activity
router.get('/activity', authenticateToken, requirePermission('viewProjects'), getDashboardActivity);

// GET /api/dashboard/projects
router.get('/projects', authenticateToken, requirePermission('viewProjects'), getDashboardProjects);

module.exports = router;

