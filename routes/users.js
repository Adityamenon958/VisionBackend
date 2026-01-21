const express = require('express');
const router = express.Router();
const { updateUserRoleHandler } = require('../controllers/userController');
const { requirePermission } = require('../middleware/authorizationMiddleware');
const { authenticateToken } = require('../middleware/authMiddleware');

/**
 * User Management Routes
 * 
 * These routes handle user management operations, specifically role assignment.
 * All routes require authentication and appropriate permissions.
 */

// PUT /api/users/:userId/role - Update user role
// Requires: assignRoles permission (platform_admin or workspace_admin)
router.put(
  '/:userId/role',
  authenticateToken,
  requirePermission('assignRoles'),
  updateUserRoleHandler
);

module.exports = router;
