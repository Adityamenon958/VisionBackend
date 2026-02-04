const express = require('express');
const router = express.Router();
const { updateUserRoleHandler, setMemberActiveHandler, deleteMemberHandler } = require('../controllers/userController');
const { requirePermission, requirePermissionOr } = require('../middleware/authorizationMiddleware');
const { authenticateToken } = require('../middleware/authMiddleware');

/**
 * User Management Routes
 *
 * Role assignment, login access toggle, and member delete.
 * All routes require authentication and appropriate permissions.
 */

// PUT /api/users/:userId/role - Update user role
// Requires: assignRoles (platform_admin or workspace_admin)
router.put(
  '/:userId/role',
  authenticateToken,
  requirePermission('assignRoles'),
  updateUserRoleHandler
);

// PATCH /api/users/:userId/active - Toggle login access (active true/false)
// Requires: removeUsers (platform_admin) or manageWorkspaceUsers (workspace_admin)
// Backend enforces: no self, workspace_admin cannot touch platform_admin, same workspace for workspace_admin
router.patch(
  '/:userId/active',
  authenticateToken,
  requirePermissionOr(['removeUsers', 'manageWorkspaceUsers']),
  setMemberActiveHandler
);

// DELETE /api/users/:userId - Remove member (deactivate + remove from workspace)
// Requires: removeUsers or manageWorkspaceUsers; same enforcement as toggle
router.delete(
  '/:userId',
  authenticateToken,
  requirePermissionOr(['removeUsers', 'manageWorkspaceUsers']),
  deleteMemberHandler
);

module.exports = router;
