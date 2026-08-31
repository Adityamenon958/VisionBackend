const mongoose = require('mongoose');

/**
 * Pinned YOLO_SEG model used by the Android inspect app.
 * One config per company + project. The phone never sends a modelId.
 */
const mobileInspectConfigSchema = new mongoose.Schema(
  {
    company: {
      type: String,
      required: true,
      index: true,
    },
    project: {
      type: String,
      required: true,
      index: true,
    },
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Model',
      required: true,
    },
    confidenceThreshold: {
      type: Number,
      default: 0.25,
      min: 0,
      max: 1,
    },
    updatedBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

mobileInspectConfigSchema.index({ company: 1, project: 1 }, { unique: true });

module.exports = mongoose.model('MobileInspectConfig', mobileInspectConfigSchema);
