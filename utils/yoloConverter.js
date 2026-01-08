const path = require('path');

/**
 * YOLO Format Converter
 * 
 * Converts normalized bounding box annotations to YOLO format label files.
 * YOLO format: class_id center_x center_y width height (all normalized 0-1)
 */

/**
 * Convert normalized bbox to YOLO format
 * 
 * Input: [x, y, width, height] (normalized 0-1)
 * Output: [center_x, center_y, width, height] (normalized 0-1)
 * 
 * @param {Array<Number>} bbox - Normalized bbox [x, y, width, height]
 * @returns {Array<Number>} YOLO format [center_x, center_y, width, height]
 */
function convertBboxToYOLO(bbox) {
  const [x, y, width, height] = bbox;
  
  // Convert top-left corner to center coordinates
  const center_x = x + width / 2;
  const center_y = y + height / 2;
  
  // Width and height remain unchanged
  return [center_x, center_y, width, height];
}

/**
 * Get class_id for a category based on category order
 * 
 * @param {ObjectId|String} categoryId - Category ID
 * @param {Array<ObjectId|String>} categoryOrder - Ordered array of category IDs
 * @returns {Number} class_id (0-based index)
 */
function getClassId(categoryId, categoryOrder) {
  const categoryIdStr = categoryId.toString();
  const index = categoryOrder.findIndex(id => id.toString() === categoryIdStr);
  
  if (index === -1) {
    throw new Error(`Category ${categoryId} not found in category order`);
  }
  
  return index;
}

/**
 * Generate YOLO label file content from annotations
 * 
 * Format: One line per annotation
 * Line format: class_id center_x center_y width height
 * All values space-separated, normalized 0-1
 * 
 * @param {Array} annotations - Array of annotation objects with bbox and categoryId
 * @param {Array<ObjectId|String>} categoryOrder - Ordered array of category IDs
 * @returns {String} Label file content
 */
function generateLabelFileContent(annotations, categoryOrder) {
  if (!annotations || annotations.length === 0) {
    // Return empty string for images with no annotations (negative samples)
    return '';
  }

  const lines = annotations.map(ann => {
    // Convert bbox to YOLO format
    const [center_x, center_y, width, height] = convertBboxToYOLO(ann.bbox);
    
    // Get class_id from category order
    const class_id = getClassId(ann.categoryId, categoryOrder);
    
    // Format: class_id center_x center_y width height
    return `${class_id} ${center_x} ${center_y} ${width} ${height}`;
  });

  return lines.join('\n') + '\n'; // Add newline at end
}

/**
 * Generate data.yaml content for YOLO training
 * 
 * @param {Array} categories - Array of category objects with name
 * @param {String} datasetPath - Full path to dataset directory
 * @returns {String} YAML content
 */
function generateDataYaml(categories, datasetPath) {
  // Extract category names in order
  const names = categories.map(cat => cat.name);
  
  // Build YAML content
  const yamlContent = `# Auto-generated during YOLO conversion
# Dataset configuration for YOLO training

names:
${names.map(name => `  - ${name}`).join('\n')}

nc: ${names.length}

path: ${datasetPath.replace(/\\/g, '/')}
train: images/train
val: images/val
test: images/test
`;

  return yamlContent;
}

/**
 * Get label file path from image stored path
 * 
 * Converts: images/unlabeled/image_001.jpg -> labels/unlabeled/image_001.txt
 *          images\train\image.jpg -> labels\train\image.txt (Windows)
 * Maintains parallel folder structure
 * 
 * @param {String} imageStoredPath - Image stored path (e.g., "images/unlabeled/image_001.jpg" or "images\\train\\image.jpg")
 * @returns {String} Label file path (e.g., "labels/unlabeled/image_001.txt" or "labels\\train\\image.txt")
 */
function getLabelFilePath(imageStoredPath) {
  // Normalize path separators to forward slashes for consistent processing
  // This handles both Windows backslashes (images\train\image.jpg) and Unix forward slashes (images/train/image.jpg)
  const normalized = imageStoredPath.replace(/\\/g, '/');
  
  // Replace "images/" with "labels/" in normalized path
  const labelPath = normalized.replace(/^images\//, 'labels/');
  
  // Replace image extension with .txt
  const ext = path.extname(labelPath);
  return labelPath.replace(ext, '.txt');
}

module.exports = {
  convertBboxToYOLO,
  getClassId,
  generateLabelFileContent,
  generateDataYaml,
  getLabelFilePath
};

