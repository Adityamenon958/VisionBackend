const mongoose = require('mongoose');

/**
 * Dataset Schema - Stores metadata about uploaded datasets
 * 
 * This document tracks:
 * - Where files are stored on disk
 * - Upload statistics (counts, sizes)
 * - Processing status
 * - Label information
 * - Any errors during upload
 * - File manifest (mapping of stored names to original names)
 */
const datasetSchema = new mongoose.Schema({
  // Organization identifiers
  company: {
    type: String,
    required: true,
    index: true // ✅ Indexed for faster queries by company
  },
  project: {
    type: String,
    required: true,
    index: true
  },
  version: {
    type: String,
    default: 'v1' // Default version if not provided
  },

  // Storage path on disk/cloud
  storagePath: {
    type: String,
    required: true
  },

  // File manifest - tracks all uploaded files
  files: [{
    storedName: {
      type: String,
      required: true // The actual filename on disk (with UUID prefix)
    },
    originalName: {
      type: String,
      required: true // The original filename from user
    },
    type: {
      type: String,
      enum: ['image', 'label'],
      required: true
    },
    size: {
      type: Number,
      required: true // File size in bytes
    },
    folder: {
      type: String,
      required: true,
      default: 'dataset' // Virtual folder name (e.g., 'good', 'defect1', 'dataset')
    },
    storedPath: {
      type: String,
      required: true // Relative path inside dataset folder e.g. "images/good/....jpg"
    }
  }],

  // File statistics
  totalImages: {
    type: Number,
    default: 0
  },
  sizeBytes: {
    type: Number,
    default: 0
  },

  // Label information
  labels: [{
    type: String // List of class names found in .txt files
  }],

  // Upload errors (invalid files, rejected files)
  uploadErrors: [{
    filename: String,
    reason: String // e.g., "Invalid extension", "File too large"
  }],

  // Processing status
  // States: 'uploaded' → 'queued' → 'processing' → 'ready' → 'failed'
  status: {
    type: String,
    enum: ['uploaded', 'queued', 'processing', 'ready', 'failed'],
    default: 'uploaded',
    index: true
  },

  // Preprocessing statistics (filled by worker)
  labeledImages: {
    type: Number,
    default: 0
  },
  unlabeledImages: {
    type: Number,
    default: 0
  },
  trainCount: {
    type: Number,
    default: 0
  },
  valCount: {
    type: Number,
    default: 0
  },
  testCount: {
    type: Number,
    default: 0
  },
  thumbnailsGenerated: {
    type: Number,
    default: 0
  },

  // Error message if status is 'failed'
  errorMessage: {
    type: String
  },

  // Soft delete: Mark dataset as deleted without removing the document
  deletedAt: {
    type: Date,
    default: null,
    index: true // Indexed for faster queries to filter deleted datasets
  }
}, {
  timestamps: true // ✅ Automatically adds createdAt and updatedAt
});

// ✅ Create compound index for faster queries
datasetSchema.index({ company: 1, project: 1, version: 1 });

module.exports = mongoose.model('Dataset', datasetSchema);
