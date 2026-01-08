/**
 * Category Validator
 * 
 * Validates category data (name, color) before saving to database.
 */

/**
 * Validate color hex format
 * 
 * @param {string} color - Color hex code (e.g., "#ef4444")
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateColor(color) {
  // Must be string
  if (typeof color !== 'string') {
    return {
      valid: false,
      error: 'Color must be a string'
    };
  }

  // Must match #RRGGBB format (case-insensitive)
  // Regex: starts with #, followed by exactly 6 hex characters (0-9, A-F, a-f)
  const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;

  if (!hexColorRegex.test(color)) {
    return {
      valid: false,
      error: 'Color must be a valid hex color code (#RRGGBB)'
    };
  }

  return {
    valid: true,
    error: null
  };
}

/**
 * Validate category name
 * 
 * @param {string} name - Category name
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateName(name) {
  // Must be string
  if (typeof name !== 'string') {
    return {
      valid: false,
      error: 'Name must be a string'
    };
  }

  // Trim whitespace
  const trimmedName = name.trim();

  // Length must be 1-50 characters
  if (trimmedName.length === 0) {
    return {
      valid: false,
      error: 'Name must not be empty'
    };
  }

  if (trimmedName.length > 50) {
    return {
      valid: false,
      error: 'Name must be 50 characters or less'
    };
  }

  return {
    valid: true,
    error: null
  };
}

module.exports = {
  validateColor,
  validateName
};

