/**
 * Bounding Box Validator
 * 
 * Validates bounding box coordinates in normalized format (0-1).
 * Used for annotation bounding boxes before saving to database.
 */

/**
 * Validate bounding box coordinates
 * 
 * @param {Array<Number>} bbox - Bounding box [x, y, width, height] (normalized 0-1)
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateBbox(bbox) {
  // Rule 1: bbox must be an array of 4 numbers
  if (!Array.isArray(bbox)) {
    return {
      valid: false,
      error: 'Bbox must be an array of 4 numbers'
    };
  }

  if (bbox.length !== 4) {
    return {
      valid: false,
      error: 'Bbox must be an array of 4 numbers'
    };
  }

  // Check all values are numbers
  const [x, y, width, height] = bbox;
  
  if (typeof x !== 'number' || isNaN(x) ||
      typeof y !== 'number' || isNaN(y) ||
      typeof width !== 'number' || isNaN(width) ||
      typeof height !== 'number' || isNaN(height)) {
    return {
      valid: false,
      error: 'Bbox must be an array of 4 numbers'
    };
  }

  // Rule 2: x must be between 0 and 1
  if (x < 0 || x > 1) {
    return {
      valid: false,
      error: 'Bbox x must be between 0 and 1'
    };
  }

  // Rule 3: y must be between 0 and 1
  if (y < 0 || y > 1) {
    return {
      valid: false,
      error: 'Bbox y must be between 0 and 1'
    };
  }

  // Rule 4: width must be greater than 0 and less than or equal to 1
  if (width <= 0 || width > 1) {
    return {
      valid: false,
      error: 'Bbox width must be greater than 0 and less than or equal to 1'
    };
  }

  // Rule 5: height must be greater than 0 and less than or equal to 1
  if (height <= 0 || height > 1) {
    return {
      valid: false,
      error: 'Bbox height must be greater than 0 and less than or equal to 1'
    };
  }

  // Rule 6: x + width must be ≤ 1 (box doesn't exceed image width)
  if (x + width > 1) {
    return {
      valid: false,
      error: 'Bbox exceeds image bounds: x + width must be ≤ 1'
    };
  }

  // Rule 7: y + height must be ≤ 1 (box doesn't exceed image height)
  if (y + height > 1) {
    return {
      valid: false,
      error: 'Bbox exceeds image bounds: y + height must be ≤ 1'
    };
  }

  // All validations passed
  return {
    valid: true,
    error: null
  };
}

module.exports = {
  validateBbox
};

