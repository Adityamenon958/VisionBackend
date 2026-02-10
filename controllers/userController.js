const { isValidRole } = require('../utils/permissions');
const { validateRoleAssignment } = require('../middleware/authorizationMiddleware');
const { getUserProfile, updateUserActive, deactivateAndRemoveFromWorkspace } = require('../services/supabaseService');

/**
 * User Controller
 *
 * Handles user management: role assignment, login access toggle, and member delete.
 */

/**
 * Shared validation for "target member" actions (toggle active, delete).
 * Returns { errorResponse } to send and stop, or { targetProfile } to continue.
 * Rules: no self; workspace_admin cannot act on platform_admin; workspace_admin only same company.
 */
async function validateTargetMemberForManage(req, userId) {
  const currentUser = req.user;
  const currentUserId = currentUser.id;
  const currentUserRole = currentUser.role;

  if (!currentUser) {
    return { errorResponse: { status: 401, body: { success: false, error: 'Unauthorized', message: 'Authentication required' } } };
  }

  if (currentUserId === userId) {
    return { errorResponse: { status: 403, body: { success: false, error: 'Forbidden', message: 'You cannot deactivate or delete your own profile' } } };
  }

  const targetProfile = await getUserProfile(userId);
  if (!targetProfile) {
    return { errorResponse: { status: 404, body: { success: false, error: 'Not found', message: 'User not found' } } };
  }

  if (currentUserRole === 'workspace_admin') {
    if (targetProfile.role === 'platform_admin') {
      return { errorResponse: { status: 403, body: { success: false, error: 'Forbidden', message: 'Workspace admin cannot deactivate or delete platform admin users' } } };
    }
    const currentCompanyId = currentUser.company_id || currentUser.company;
    const targetCompanyId = targetProfile.company_id;
    if (currentCompanyId != null && targetCompanyId != null && currentCompanyId !== targetCompanyId) {
      return { errorResponse: { status: 403, body: { success: false, error: 'Forbidden', message: 'You can only manage members in your own workspace' } } };
    }
  }

  return { targetProfile };
}

/**
 * PUT /api/users/:userId/role
 * 
 * Update user role
 * 
 * Authorization:
 * - Only platform_admin or workspace_admin can call this endpoint
 * - platform_admin can assign any role (including platform_admin)
 * - workspace_admin can assign: workspace_admin, ml_engineer, operator, viewer
 * - workspace_admin cannot assign platform_admin
 * - Users cannot change their own role
 * 
 * Request Body:
 * {
 *   "role": "platform_admin" | "workspace_admin" | "ml_engineer" | "operator" | "viewer"
 * }
 */
const updateUserRoleHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role: newRole } = req.body;

    // Validate user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    const currentUser = req.user;
    const currentUserRole = currentUser.role;
    const currentUserId = currentUser.id;

    // Check if current user has permission to assign roles
    // Only platform_admin and workspace_admin can assign roles
    if (currentUserRole !== 'platform_admin' && currentUserRole !== 'workspace_admin') {
      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        message: 'Only platform admins and workspace admins can assign roles'
      });
    }

    // Validate newRole is provided
    if (!newRole) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role',
        message: 'Role is required'
      });
    }

    // Validate role value
    if (!isValidRole(newRole)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role',
        message: `Role must be one of: platform_admin, workspace_admin, ml_engineer, operator, viewer`,
        provided: newRole
      });
    }

    // Validate role assignment permission
    const assignmentValidation = validateRoleAssignment(currentUserRole, newRole);
    if (!assignmentValidation.allowed) {
      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        message: assignmentValidation.error
      });
    }

    // Prevent self-role change
    if (currentUserId === userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change own role',
        message: 'Users cannot change their own role'
      });
    }

    // Additional check: workspace_admin can only assign roles to users in their workspace
    // Note: Frontend should validate that target user belongs to the same workspace
    // Backend validates permissions, but actual role update happens in Supabase by frontend
    if (currentUserRole === 'workspace_admin') {
      const currentUserCompany = currentUser.company;

      // If current user doesn't have a company, deny
      if (!currentUserCompany) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied',
          message: 'Workspace admin must belong to a workspace'
        });
      }

      // Note: Frontend should send target user's company in request body for validation
      // For now, we'll trust frontend to handle workspace validation
      // In a production system, you might want to add targetUserCompany to request body
    }

    // Backend validates permissions and returns success
    // Frontend is responsible for actually updating the role in Supabase
    // This endpoint serves as a permission validation endpoint
    return res.status(200).json({
      success: true,
      message: 'Role assignment authorized. Frontend should update role in Supabase.',
      userId: userId,
      newRole: newRole,
      note: 'Backend has validated permissions. Frontend must update the role in Supabase profiles table.'
    });

  } catch (error) {
    console.error('Error updating user role:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
};

/**
 * PATCH /api/users/:userId/active
 *
 * Toggle login access for a member (active = can log in, inactive = cannot).
 * Only platform_admin and workspace_admin. Cannot toggle self or (for workspace_admin) platform_admins.
 */
const setMemberActiveHandler = async (req, res) => {
  try {
    const { userId } = req.params;
    const { active } = req.body;

    const validation = await validateTargetMemberForManage(req, userId);
    if (validation.errorResponse) {
      return res.status(validation.errorResponse.status).json(validation.errorResponse.body);
    }

    if (typeof active !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Bad request',
        message: 'Request body must include { "active": true | false }'
      });
    }

    const result = await updateUserActive(userId, active);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Update failed',
        message: result.error || 'Failed to update login access'
      });
    }

    return res.status(200).json({
      success: true,
      message: active ? 'Login access enabled' : 'Login access disabled',
      userId,
      active
    });
  } catch (error) {
    console.error('Error setting member active:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
};

/**
 * DELETE /api/users/:userId
 *
 * Remove member: revoke login and remove from workspace (is_active = false, company_id = null).
 * Only platform_admin and workspace_admin. Cannot delete self or (for workspace_admin) platform_admins.
 */
const deleteMemberHandler = async (req, res) => {
  try {
    const { userId } = req.params;

    const validation = await validateTargetMemberForManage(req, userId);
    if (validation.errorResponse) {
      return res.status(validation.errorResponse.status).json(validation.errorResponse.body);
    }

    const result = await deactivateAndRemoveFromWorkspace(userId);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Delete failed',
        message: result.error || 'Failed to remove member'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Member removed from workspace and login disabled',
      userId
    });
  } catch (error) {
    console.error('Error deleting member:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'An unexpected error occurred'
    });
  }
};

module.exports = {
  updateUserRoleHandler,
  setMemberActiveHandler,
  deleteMemberHandler
};
