/**
 * Error Handling Utilities
 * 
 * Standardized error response helpers for consistent API error formatting.
 * All errors follow the format: { error: "Error type", message: "Human-readable message" }
 */

/**
 * Send generic error response
 * 
 * @param {Object} res - Express response object
 * @param {Number} statusCode - HTTP status code (400, 401, 403, 404, 500)
 * @param {String} error - Error type string (e.g., "Validation Error")
 * @param {String} message - Human-readable error message
 */
function sendError(res, statusCode, error, message) {
  return res.status(statusCode).json({
    error: error,
    message: message
  });
}

/**
 * Send validation error response (400 Bad Request)
 * 
 * @param {Object} res - Express response object
 * @param {String} field - Field name (e.g., "bbox")
 * @param {String} message - Error message
 */
function sendValidationError(res, field, message) {
  return res.status(400).json({
    error: 'Validation Error',
    message: `${field}: ${message}`
  });
}

/**
 * Send not found error response (404 Not Found)
 * 
 * @param {Object} res - Express response object
 * @param {String} resource - Resource type (e.g., "Dataset", "Image")
 * @param {String} id - Resource ID
 */
function sendNotFoundError(res, resource, id) {
  return res.status(404).json({
    error: 'Not Found',
    message: `${resource} not found: ${id}`
  });
}

/**
 * Send unauthorized error response (401 Unauthorized)
 * 
 * @param {Object} res - Express response object
 * @param {String} message - Error message (default: "Unauthorized")
 */
function sendUnauthorizedError(res, message = 'Unauthorized') {
  return res.status(401).json({
    error: 'Unauthorized',
    message: message
  });
}

/**
 * Send forbidden error response (403 Forbidden)
 * 
 * @param {Object} res - Express response object
 * @param {String} message - Error message (default: "Forbidden")
 */
function sendForbiddenError(res, message = 'Forbidden') {
  return res.status(403).json({
    error: 'Forbidden',
    message: message
  });
}

module.exports = {
  sendError,
  sendValidationError,
  sendNotFoundError,
  sendUnauthorizedError,
  sendForbiddenError
};

