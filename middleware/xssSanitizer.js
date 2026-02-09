/**
 * XSS Sanitization Middleware
 * 
 * Provides global input sanitization to prevent XSS attacks before data reaches
 * the database. Sanitizes all string fields in request body, query params, URL params,
 * and selected headers.
 */

/**
 * XSS Pattern - Detects dangerous patterns that could lead to XSS
 * Matches:
 * - <script> tags (opening and closing)
 * - Event handlers (onclick, onerror, onload, etc.)
 * - javascript: URLs
 */
const XSS_PATTERN = /<script\b[\s\S]*?>|<\/script>|on\w+\s*=|javascript\s*:/gi;

/**
 * Check if a string contains dangerous XSS patterns
 * 
 * @param {string} str - String to check
 * @returns {boolean} True if dangerous pattern detected
 */
function containsDangerousPattern(str) {
  if (typeof str !== 'string') return false;
  return XSS_PATTERN.test(str);
}

/**
 * Sanitize a string by escaping HTML entities
 * Throws error if dangerous patterns are detected
 * 
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string with HTML entities escaped
 * @throws {Error} If dangerous pattern detected
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  
  // Check for dangerous patterns first (fail fast)
  if (containsDangerousPattern(str)) {
    throw new Error('Invalid characters detected: script tags, event handlers, and javascript: URLs are not allowed');
  }
  
  // Escape HTML entities to prevent XSS
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Recursively sanitize all string values in an object or array
 * 
 * @param {any} obj - Object, array, or primitive to sanitize
 * @returns {any} Sanitized object/array/primitive
 */
function sanitizeInput(obj) {
  // Handle strings
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  
  // Handle objects
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  // Return primitives as-is (numbers, booleans, null, undefined)
  return obj;
}

/**
 * Global XSS sanitization middleware
 * Sanitizes req.body, req.query, req.params, and selected headers
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function xssSanitizationMiddleware(req, res, next) {
  try {
    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeInput(req.body);
    }
    
    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeInput(req.query);
    }
    
    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeInput(req.params);
    }
    
    // Sanitize selected headers (user-provided data)
    const headersToSanitize = ['x-user-email', 'x-user-company'];
    for (const headerName of headersToSanitize) {
      if (req.headers[headerName] && typeof req.headers[headerName] === 'string') {
        req.headers[headerName] = sanitizeString(req.headers[headerName]);
      }
    }
    
    // Continue to next middleware
    next();
  } catch (error) {
    // Return 400 Bad Request with clear error message
    return res.status(400).json({
      error: 'Invalid input',
      message: error.message || 'Dangerous pattern detected'
    });
  }
}

module.exports = {
  sanitizeString,
  sanitizeInput,
  containsDangerousPattern,
  xssSanitizationMiddleware
};
