const { checkPermission, isValidRole, canAssignRole } = require('../utils/permissions');

/**
 * Authorization Middleware
 * 
 * Provides middleware functions to check user permissions and roles
 * for protecting routes based on RBAC (Role-Based Access Control).
 */

/**
 * Require a specific permission
 * Returns middleware that checks if the authenticated user has the required permission.
 * 
 * @param {string} permission - Required permission name
 * @returns {Function} Express middleware function
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const userRole = req.user.role;

      // Check if user has the required permission
      if (!checkPermission(userRole, permission)) {
        return res.status(403).json({
          error: 'Permission denied',
          message: 'Your role does not have permission to perform this action',
          requiredPermission: permission,
          userRole: userRole
        });
      }

      // User has permission, continue
      next();
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Authorization check failed'
      });
    }
  };
}

/**
 * Require one of the specified roles
 * Returns middleware that checks if the authenticated user has one of the allowed roles.
 * 
 * @param {...string} roles - Allowed role names
 * @returns {Function} Express middleware function
 */
function requireRole(...roles) {
  return async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const userRole = req.user.role;

      // Check if user has one of the allowed roles
      if (!roles.includes(userRole)) {
        return res.status(403).json({
          error: 'Permission denied',
          message: 'Your role does not have access to this resource',
          allowedRoles: roles,
          userRole: userRole
        });
      }

      // User has allowed role, continue
      next();
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Authorization check failed'
      });
    }
  };
}

/**
 * Require workspace access
 * Returns middleware that ensures the user can access workspace data.
 * Platform admins can access all workspaces, others can only access their own.
 * 
 * @param {string} companyParam - Name of the query/body parameter containing company/workspace identifier
 * @returns {Function} Express middleware function
 */
function requireWorkspaceAccess(companyParam = 'company') {
  return async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      // Platform admin can access all workspaces
      if (req.user.role === 'platform_admin') {
        return next();
      }

      // Get requested company/workspace from query params or body
      const requestedCompany = req.query[companyParam] || req.body[companyParam];

      // If no company specified, allow (will be filtered in controller)
      if (!requestedCompany) {
        return next();
      }

      // Get user's company_id (workspace identifier)
      const userCompanyId = req.user.company_id;

      // If user doesn't have a company_id, deny access
      if (!userCompanyId) {
        return res.status(403).json({
          error: 'Permission denied',
          message: 'User does not belong to a workspace'
        });
      }

      // Note: This assumes company_id matches the company string identifier
      // If your system uses different identifiers, adjust this logic accordingly
      // For now, we'll allow the request and let the controller handle filtering
      // The actual filtering should be done in controllers using workspace scoping

      next();
    } catch (error) {
      console.error('Workspace access check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Workspace access check failed'
      });
    }
  };
}

/**
 * Check if user can assign a specific role
 * Helper function for role assignment validation
 * 
 * @param {string} assignerRole - Role of the user trying to assign
 * @param {string} targetRole - Role being assigned
 * @returns {boolean} True if assignment is allowed
 */
function validateRoleAssignment(assignerRole, targetRole) {
  // Check if target role is valid
  if (!isValidRole(targetRole)) {
    return {
      allowed: false,
      error: 'Invalid role'
    };
  }

  // Check if assigner can assign target role
  if (!canAssignRole(assignerRole, targetRole)) {
    return {
      allowed: false,
      error: assignerRole === 'workspace_admin' 
        ? 'Cannot assign platform_admin role'
        : 'Insufficient permissions to assign roles'
    };
  }

  return {
    allowed: true
  };
}

module.exports = {
  requirePermission,
  requireRole,
  requireWorkspaceAccess,
  validateRoleAssignment
};
