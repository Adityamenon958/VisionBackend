/**
 * Input Validation Middleware
 * 
 * Provides strict allowlist validation for user inputs before persisting to database.
 * Validates length limits, character sets, and blocks dangerous patterns.
 */

const { containsDangerousPattern } = require('./xssSanitizer');

/**
 * Validation rules for different field types
 */
const VALIDATION_RULES = {
  projectName: {
    minLength: 2,
    maxLength: 30,
    allowedChars: /^[a-zA-Z0-9\s\-_]+$/,
    blockPattern: /<script\b[\s\S]*?>|<\/script>|on\w+\s*=|javascript\s*:/i
  },
  companyName: {
    minLength: 2,
    maxLength: 50,
    allowedChars: /^[a-zA-Z0-9\s\-_&.,()]+$/,
    blockPattern: /<script\b[\s\S]*?>|<\/script>|on\w+\s*=|javascript\s*:/i
  },
  userName: {
    minLength: 3,
    maxLength: 40,
    allowedChars: /^[a-zA-Z\s]+$/,
    blockPattern: /<script\b[\s\S]*?>|<\/script>|on\w+\s*=|javascript\s*:/i
  },
  description: {
    minLength: 0,
    maxLength: 500,
    allowedChars: null, // Allow most characters for descriptions
    blockPattern: /<script\b[\s\S]*?>|<\/script>|on\w+\s*=|javascript\s*:/i
  },
  className: {
    minLength: 1,
    maxLength: 50,
    allowedChars: /^[a-zA-Z0-9\s\-_]+$/,
    blockPattern: /<script\b[\s\S]*?>|<\/script>|on\w+\s*=|javascript\s*:/i
  },
  phoneNumber: {
    minLength: 0,
    maxLength: 20,
    allowedChars: /^[\d+\s\-]+$/,
    blockPattern: /<script\b[\s\S]*?>|<\/script>|on\w+\s*=|javascript\s*:/i
  }
};

/**
 * Validate a string against validation rules
 * 
 * @param {string} str - String to validate
 * @param {Object} rules - Validation rules object
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateString(str, rules) {
  // Must be string
  if (typeof str !== 'string') {
    return {
      valid: false,
      error: 'Must be a string'
    };
  }
  
  const { minLength, maxLength, allowedChars, blockPattern } = rules;
  
  // Check length limits
  if (str.length < minLength) {
    return {
      valid: false,
      error: `Minimum length is ${minLength} characters`
    };
  }
  
  if (str.length > maxLength) {
    return {
      valid: false,
      error: `Maximum length is ${maxLength} characters`
    };
  }
  
  // Check character set (if allowlist specified)
  if (allowedChars && !allowedChars.test(str)) {
    return {
      valid: false,
      error: 'Invalid characters detected'
    };
  }
  
  // Check blocklist pattern (dangerous XSS patterns)
  if (blockPattern && blockPattern.test(str)) {
    return {
      valid: false,
      error: 'Invalid characters: script tags, event handlers, and javascript: URLs are not allowed'
    };
  }
  
  return {
    valid: true,
    error: null
  };
}

/**
 * Validate project name
 * 
 * @param {string} name - Project name
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateProjectName(name) {
  return validateString(name, VALIDATION_RULES.projectName);
}

/**
 * Validate company name
 * 
 * @param {string} name - Company name
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateCompanyName(name) {
  return validateString(name, VALIDATION_RULES.companyName);
}

/**
 * Validate user name
 * 
 * @param {string} name - User name
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateUserName(name) {
  return validateString(name, VALIDATION_RULES.userName);
}

/**
 * Validate description
 * 
 * @param {string} description - Description text
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateDescription(description) {
  return validateString(description, VALIDATION_RULES.description);
}

/**
 * Validate class/category name
 * 
 * @param {string} name - Class/category name
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateClassName(name) {
  return validateString(name, VALIDATION_RULES.className);
}

/**
 * Validate phone number
 * 
 * @param {string} phone - Phone number
 * @returns {{ valid: boolean, error: string | null }}
 */
function validatePhoneNumber(phone) {
  return validateString(phone, VALIDATION_RULES.phoneNumber);
}

module.exports = {
  validateString,
  validateProjectName,
  validateCompanyName,
  validateUserName,
  validateDescription,
  validateClassName,
  validatePhoneNumber,
  VALIDATION_RULES
};
