const mongoose = require('mongoose');

/**
 * Annotation Schema - Stores bounding box annotations for images
 * 
 * This document tracks:
 * - Bounding box coordinates (normalized 0-1)
 * - Category assignment
 * - Review state (draft/reviewed/approved/rejected)
 * - Audit trail (who created/updated/reviewed)
 */
const annotationSchema = new mongoose.Schema({
  // References
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true
  },
  imageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Image',
    required: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },

  // Bounding box coordinates (normalized 0-1)
  // Format: [x, y, width, height]
  // x, y: top-left corner position (0-1)
  // width, height: box dimensions (0-1)
  bbox: {
    type: [Number],
    required: true,
    validate: {
      validator: function(bbox) {
        // Validate array has exactly 4 elements
        if (!Array.isArray(bbox) || bbox.length !== 4) {
          return false;
        }
        // Validate all values are numbers
        return bbox.every(val => typeof val === 'number' && !isNaN(val));
      },
      message: 'Bbox must be an array of 4 numbers [x, y, width, height]'
    }
  },

  // Denormalized category name (for performance)
  // Must be kept in sync with Category.name
  categoryName: {
    type: String,
    required: true
  },

  // Review state
  state: {
    type: String,
    enum: ['draft', 'reviewed', 'approved', 'rejected'],
    default: 'draft'
  },

  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true // User ID from auth token
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  reviewedAt: {
    type: Date
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  approvedAt: {
    type: Date
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  rejectedAt: {
    type: Date
  },

  // Soft delete
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true // Automatically adds createdAt and updatedAt
});

// ✅ Create indexes for faster queries
// Index for filtering by dataset
annotationSchema.index({ datasetId: 1 });

// Index for filtering by image
annotationSchema.index({ imageId: 1 });

// Index for filtering by category
annotationSchema.index({ categoryId: 1 });

// Composite index for common queries (CRITICAL)
annotationSchema.index({ datasetId: 1, imageId: 1 });

// Index for sorting
annotationSchema.index({ createdAt: 1 });

// Index for soft delete filtering
annotationSchema.index({ deletedAt: 1 });

/**
 * Static method: Find annotations by image ID
 * @param {ObjectId} imageId - Image ID
 * @returns {Promise<Array>} Array of annotations
 */
annotationSchema.statics.findByImageId = async function(imageId) {
  return this.find({ imageId, deletedAt: null }).sort({ createdAt: 1 });
};

/**
 * Static method: Find annotations by dataset ID (optionally filtered by image)
 * @param {ObjectId} datasetId - Dataset ID
 * @param {ObjectId} imageId - Optional image ID filter
 * @returns {Promise<Array>} Array of annotations
 */
annotationSchema.statics.findByDatasetId = async function(datasetId, imageId = null) {
  const query = { datasetId, deletedAt: null };
  if (imageId) {
    query.imageId = imageId;
  }
  return this.find(query).sort({ createdAt: 1 });
};

/**
 * Instance method: Convert annotation to YOLO format
 * @param {Array<ObjectId>} categoryOrder - Ordered array of category IDs
 * @returns {Object} YOLO format { class_id, center_x, center_y, width, height }
 */
annotationSchema.methods.toYOLOFormat = function(categoryOrder) {
  // Find class_id (index of categoryId in categoryOrder)
  const classId = categoryOrder.findIndex(id => id.toString() === this.categoryId.toString());
  
  if (classId === -1) {
    throw new Error(`Category ${this.categoryId} not found in category order`);
  }

  // Convert normalized bbox [x, y, width, height] to YOLO format [center_x, center_y, width, height]
  const [x, y, width, height] = this.bbox;
  const center_x = x + width / 2;
  const center_y = y + height / 2;

  return {
    class_id: classId,
    center_x: center_x,
    center_y: center_y,
    width: width,
    height: height
  };
};

module.exports = mongoose.model('Annotation', annotationSchema);

