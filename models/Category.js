const mongoose = require('mongoose');

/**
 * Category Schema - Defines annotation categories for datasets
 * 
 * This document tracks:
 * - Category names (unique per dataset)
 * - Display colors
 * - Display order
 * - Creation metadata
 */
const categorySchema = new mongoose.Schema({
  // Reference to dataset
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true
  },

  // Category information
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  color: {
    type: String,
    required: true,
    validate: {
      validator: function(color) {
        // Validate hex color format: #RRGGBB
        return /^#[0-9A-Fa-f]{6}$/.test(color);
      },
      message: 'Color must be a valid hex color code (#RRGGBB)'
    }
  },
  description: {
    type: String,
    maxlength: 500
  },

  // Display order (0, 1, 2, ...)
  order: {
    type: Number,
    required: true,
    default: 0
  },

  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true // User ID from auth token
  }
}, {
  timestamps: true // Automatically adds createdAt and updatedAt
});

// ✅ Create indexes for faster queries
// Index for filtering by dataset
categorySchema.index({ datasetId: 1 });

// Composite unique index for name per dataset (CRITICAL)
categorySchema.index({ datasetId: 1, name: 1 }, { unique: true });

// Composite index for sorting by order
categorySchema.index({ datasetId: 1, order: 1 });

/**
 * Static method: Get ordered categories for a dataset
 * @param {ObjectId} datasetId - Dataset ID
 * @returns {Promise<Array>} Array of categories sorted by order
 */
categorySchema.statics.getOrderedCategories = async function(datasetId) {
  return this.find({ datasetId })
    .sort({ order: 1, createdAt: 1 })
    .lean();
};

/**
 * Static method: Create default categories for a dataset
 * Creates: "Defect", "Good", "Unknown"
 * @param {ObjectId} datasetId - Dataset ID
 * @param {ObjectId} userId - User ID (for createdBy)
 * @returns {Promise<Array>} Array of created categories
 */
categorySchema.statics.createDefaults = async function(datasetId, userId) {
  const defaults = [
    {
      datasetId,
      name: 'Defect',
      color: '#ef4444', // Red
      description: 'Defective items',
      order: 0,
      createdBy: userId
    },
    {
      datasetId,
      name: 'Good',
      color: '#10b981', // Green
      description: 'Good items',
      order: 1,
      createdBy: userId
    },
    {
      datasetId,
      name: 'Unknown',
      color: '#6b7280', // Gray
      description: 'Unknown or unclassified items',
      order: 2,
      createdBy: userId
    }
  ];

  // Check if categories already exist
  const existingCount = await this.countDocuments({ datasetId });
  if (existingCount > 0) {
    // Categories already exist, return existing ones
    return this.getOrderedCategories(datasetId);
  }

  // Create default categories
  const created = await this.insertMany(defaults);
  return created;
};

module.exports = mongoose.model('Category', categorySchema);

