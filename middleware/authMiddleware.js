const { VALID_ROLES } = require('../utils/permissions');

/**
 * Authentication Middleware
 * 
 * Extracts user information from request headers and attaches it to the request object.
 * Frontend is responsible for sending user info in custom headers after validating
 * the Supabase token on the client side.
 */

/**
 * Authenticate token middleware
 * Extracts user information from custom headers and attaches user to req.user
 * 
 * Required headers:
 * - X-User-Id: User UUID
 * - X-User-Role: User role (platform_admin, workspace_admin, ml_engineer, operator, viewer)
 * - X-User-Company: Company string identifier (e.g., "gsn")
 * 
 * Optional headers:
 * - X-User-Email: User email
 * - X-User-Company-Id: Company UUID
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function authenticateToken(req, res, next) {
  try {
    // Extract user information from custom headers
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const userCompany = req.headers['x-user-company'];
    const userEmail = req.headers['x-user-email'];
    const userCompanyId = req.headers['x-user-company-id'];

    // Validate required headers
    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing required header: X-User-Id'
      });
    }

    if (!userRole) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing required header: X-User-Role'
      });
    }

    // Validate role is one of the valid roles
    if (!VALID_ROLES.includes(userRole)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: `Invalid role: ${userRole}. Valid roles are: ${VALID_ROLES.join(', ')}`
      });
    }

    // Build user object from headers
    const user = {
      id: userId,
      email: userEmail || null,
      role: userRole,
      company_id: userCompanyId || null,
      company: userCompany || null // Company string identifier (e.g., "gsn")
    };

    // Attach user to request object
    req.user = user;

    // Continue to next middleware
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed'
    });
  }
}

/**
 * Optional authentication middleware
 * Similar to authenticateToken but doesn't fail if headers are missing/invalid.
 * Attaches user to req.user if valid headers are present, otherwise continues without user.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function optionalAuthenticateToken(req, res, next) {
  try {
    // Extract user information from custom headers
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const userCompany = req.headers['x-user-company'];
    const userEmail = req.headers['x-user-email'];
    const userCompanyId = req.headers['x-user-company-id'];

    // If required headers are missing, continue without user
    if (!userId || !userRole) {
      return next();
    }

    // Validate role is one of the valid roles
    if (!VALID_ROLES.includes(userRole)) {
      return next(); // Invalid role, continue without user
    }

    // Build user object from headers
    const user = {
      id: userId,
      email: userEmail || null,
      role: userRole,
      company_id: userCompanyId || null,
      company: userCompany || null
    };

    // Attach user to request object
    req.user = user;

    // Continue regardless
    next();
  } catch (error) {
    console.error('Optional authentication error:', error);
    // Continue even on error
    next();
  }
}

module.exports = {
  authenticateToken,
  optionalAuthenticateToken
};
