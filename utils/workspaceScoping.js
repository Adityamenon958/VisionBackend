/**
 * Workspace Scoping Utilities
 * 
 * Provides helper functions to filter MongoDB queries based on user role
 * and workspace membership. This ensures users can only access data from
 * their own workspace (unless they are platform_admin).
 */

/**
 * Build MongoDB filter object based on user role and workspace
 * 
 * @param {Object} user - User object from req.user (contains id, role, company_id)
 * @param {string} [requestedCompany] - Optional company identifier from query/body params
 * @param {string} [requestedProject] - Optional project identifier from query/body params
 * @returns {Object} MongoDB filter object
 * 
 * @example
 * // Platform admin - no filter (can see all)
 * buildWorkspaceFilter({ role: 'platform_admin' }) 
 * // Returns: {}
 * 
 * // Workspace admin - filter by their workspace
 * buildWorkspaceFilter({ role: 'workspace_admin', company_id: 'workspace-uuid' })
 * // Returns: { company: 'workspace-name' } (after mapping company_id to company string)
 * 
 * // With project filter
 * buildWorkspaceFilter({ role: 'ml_engineer', company_id: 'workspace-uuid' }, null, 'project1')
 * // Returns: { company: 'workspace-name', project: 'project1' }
 */
function buildWorkspaceFilter(user, requestedCompany = null, requestedProject = null) {
  // Platform admin can access all workspaces - no filter
  if (user && user.role === 'platform_admin') {
    const filter = {};
    if (requestedCompany) {
      filter.company = requestedCompany;
    }
    if (requestedProject) {
      filter.project = requestedProject;
    }
    return filter;
  }

  // Other roles can only access their own workspace
  // Use company string identifier directly from user object (sent by frontend)
  if (user && user.company) {
    const filter = {};
    
    // Use user's company string identifier
    // Frontend sends company string (e.g., "gsn") in X-User-Company header
    filter.company = user.company;
    
    if (requestedProject) {
      filter.project = requestedProject;
    }
    
    return filter;
  }

  // If user doesn't have company, return empty filter
  // Controllers should handle this case and deny access
  return {};
}

/**
 * Validate that user can access a specific workspace/company
 * 
 * @param {Object} user - User object from req.user
 * @param {string} company - Company/workspace identifier to check access for
 * @returns {Object} { allowed: boolean, error?: string }
 * 
 * @example
 * validateWorkspaceAccess({ role: 'platform_admin' }, 'any-company')
 * // Returns: { allowed: true }
 * 
 * validateWorkspaceAccess({ role: 'workspace_admin', company_id: 'uuid-1' }, 'company-1')
 * // Returns: { allowed: true } if company-1 matches uuid-1's workspace
 * // Returns: { allowed: false, error: '...' } if not
 */
function validateWorkspaceAccess(user, company) {
  // Platform admin can access all workspaces
  if (user && user.role === 'platform_admin') {
    return { allowed: true };
  }

  // If no user, deny access
  if (!user) {
    return {
      allowed: false,
      error: 'Authentication required'
    };
  }

  // If user doesn't have company string identifier, deny access
  if (!user.company) {
    return {
      allowed: false,
      error: 'User does not belong to a workspace'
    };
  }

  // Validate that requested company matches user's company
  // Frontend sends company string (e.g., "gsn") in X-User-Company header
  if (company && company !== user.company) {
    return {
      allowed: false,
      error: 'Access denied: You do not have access to this workspace'
    };
  }

  return { allowed: true };
}

/**
 * Get user's workspace company identifier
 * Helper function to extract company string from user object
 * 
 * @param {Object} user - User object from req.user
 * @returns {string|null} Company identifier or null if not available
 * 
 * @example
 * getUserWorkspace({ role: 'platform_admin' })
 * // Returns: null (platform admin has no workspace restriction)
 * 
 * getUserWorkspace({ role: 'ml_engineer', company_id: 'uuid-1' })
 * // Returns: company string identifier (after mapping from UUID)
 */
function getUserWorkspace(user) {
  if (!user) {
    return null;
  }

  // Platform admin has no workspace restriction
  if (user.role === 'platform_admin') {
    return null;
  }

  // Return company string identifier directly (sent by frontend in X-User-Company header)
  return user.company || null;
}

/**
 * Check if user can access all workspaces (platform admin)
 * 
 * @param {Object} user - User object from req.user
 * @returns {boolean} True if user is platform admin
 */
function canAccessAllWorkspaces(user) {
  return user && user.role === 'platform_admin';
}

module.exports = {
  buildWorkspaceFilter,
  validateWorkspaceAccess,
  getUserWorkspace,
  canAccessAllWorkspaces
};
