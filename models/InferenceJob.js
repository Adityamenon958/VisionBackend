const mongoose = require('mongoose');

/**
 * InferenceJob Schema - Stores metadata about inference/prediction jobs
 * 
 * This document tracks:
 * - Which model was used for inference
 * - Source of images (test folder or live camera)
 * - Job status and progress
 * - Results metadata (detections, confidence scores, annotated images)
 * - Error information if inference fails
 */
const inferenceJobSchema = new mongoose.Schema({
  // Unique inference job identifier
  inferenceId: {
    type: String,
    required: true,
    unique: true,
    index: true // ✅ Indexed for faster queries
  },

  // Reference to the trained model used for inference
  modelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Model',
    required: true
    // Note: Index created explicitly below to avoid duplicate
  },

  // Organization identifiers (for filtering)
  company: {
    type: String,
    required: true,
    index: true
  },
  project: {
    type: String,
    required: true,
    index: true
  },

  // Source type: 'test_folder', 'custom_folder', or 'live_camera'
  sourceType: {
    type: String,
    enum: ['test_folder', 'custom_folder', 'live_camera'],
    required: true
  },

  // Reference to dataset (only for test_folder sourceType)
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: function() {
      return this.sourceType === 'test_folder';
    }
  },

  // Path to test folder (only for test_folder sourceType)
  testFolderPath: {
    type: String,
    required: function() {
      return this.sourceType === 'test_folder';
    }
  },

  // Path to custom uploaded folder (only for custom_folder sourceType)
  customFolderPath: {
    type: String,
    required: function() {
      return this.sourceType === 'custom_folder';
    }
  },

  // Inference job status
  status: {
    type: String,
    enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true
  },

  // Progress tracking
  progress: {
    totalImages: {
      type: Number,
      default: 0
    },
    processedImages: {
      type: Number,
      default: 0
    },
    progressPercent: {
      type: Number,
      default: 0
    }
  },

  // Results metadata
  results: {
    resultsPath: {
      type: String // Full path to results folder
    },
    annotatedImagesPath: {
      type: String // Path to annotated images directory
    },
    metadataPath: {
      type: String // Path to JSON metadata file
    },
    totalDetections: {
      type: Number,
      default: 0
    },
    averageConfidence: {
      type: Number,
      default: 0
    },
    detectionsByClass: [{
      className: {
        type: String,
        required: true
      },
      count: {
        type: Number,
        default: 0
      },
      avgConfidence: {
        type: Number,
        default: 0
      }
    }]
  },

  // Error information (if inference fails)
  error: {
    type: String
  },

  // Timestamps
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  }
}, {
  timestamps: true // Automatically adds createdAt and updatedAt
});

// ✅ Create compound indexes for faster queries
inferenceJobSchema.index({ company: 1, project: 1 });
inferenceJobSchema.index({ company: 1, project: 1, status: 1 }); // For filtering by status
inferenceJobSchema.index({ modelId: 1 }); // For model-based queries
inferenceJobSchema.index({ createdAt: -1 }); // For sorting by newest first

module.exports = mongoose.model('InferenceJob', inferenceJobSchema);

