/**
 * Permission Utilities
 * 
 * Defines the permission matrix for role-based access control (RBAC).
 * Each role has a set of permissions that determine what actions they can perform.
 */

/**
 * Permission matrix mapping roles to their allowed permissions
 */
const PERMISSIONS = {
  platform_admin: [
    'manageGlobalConfig',
    'removeUsers',
    'manageWorkspace',
    'manageProjects',
    'manageWorkspaceUsers',
    'assignRoles',
    'deleteProjects',
    'manageDatasets',
    'startTraining',
    'tuneHyperparameters',
    'viewTrainingMetrics',
    'runInference',
    'monitorInference',
    'viewInferenceResults',
    'viewProjects',
    'viewDatasets',
    'viewModels',
    'viewInference'
  ],
  workspace_admin: [
    'manageWorkspace',
    'manageProjects',
    'manageWorkspaceUsers',
    'assignRoles',
    'deleteProjects',
    'manageDatasets',
    'startTraining',
    'tuneHyperparameters',
    'viewTrainingMetrics',
    'runInference',
    'monitorInference',
    'viewInferenceResults',
    'viewProjects',
    'viewDatasets',
    'viewModels',
    'viewInference'
  ],
  ml_engineer: [
    'manageDatasets',
    'startTraining',
    'tuneHyperparameters',
    'viewTrainingMetrics',
    'runInference',
    'monitorInference',
    'viewInferenceResults',
    'viewProjects',
    'viewDatasets',
    'viewModels',
    'viewInference'
  ],
  operator: [
    'runInference',
    'monitorInference',
    'viewInferenceResults',
    'viewProjects',
    'viewDatasets',
    'viewModels',
    'viewInference'
  ],
  viewer: [
    'viewProjects',
    'viewDatasets',
    'viewModels',
    'viewInference'
  ]
};

/**
 * Valid role names
 */
const VALID_ROLES = [
  'platform_admin',
  'workspace_admin',
  'ml_engineer',
  'operator',
  'viewer'
];

/**
 * Check if a role has a specific permission
 * 
 * @param {string} role - User role
 * @param {string} permission - Permission to check
 * @returns {boolean} True if role has permission, false otherwise
 */
function checkPermission(role, permission) {
  if (!role || !permission) {
    return false;
  }

  const rolePermissions = PERMISSIONS[role];
  if (!rolePermissions) {
    return false;
  }

  return rolePermissions.includes(permission);
}

/**
 * Get all permissions for a role
 * 
 * @param {string} role - User role
 * @returns {string[]} Array of permissions for the role, empty array if role not found
 */
function getRolePermissions(role) {
  if (!role) {
    return [];
  }

  return PERMISSIONS[role] || [];
}

/**
 * Check if a role is valid
 * 
 * @param {string} role - Role to validate
 * @returns {boolean} True if role is valid, false otherwise
 */
function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

/**
 * Check if a role can assign another role
 * 
 * @param {string} assignerRole - Role of the user trying to assign
 * @param {string} targetRole - Role being assigned
 * @returns {boolean} True if assignment is allowed, false otherwise
 */
function canAssignRole(assignerRole, targetRole) {
  // platform_admin can assign any role
  if (assignerRole === 'platform_admin') {
    return isValidRole(targetRole);
  }

  // workspace_admin can assign workspace roles (not platform_admin)
  if (assignerRole === 'workspace_admin') {
    const allowedRoles = ['workspace_admin', 'ml_engineer', 'operator', 'viewer'];
    return allowedRoles.includes(targetRole);
  }

  // Other roles cannot assign roles
  return false;
}

module.exports = {
  PERMISSIONS,
  VALID_ROLES,
  checkPermission,
  getRolePermissions,
  isValidRole,
  canAssignRole
};
