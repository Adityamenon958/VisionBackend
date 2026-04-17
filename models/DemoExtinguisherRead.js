const mongoose = require('mongoose');

/**
 * DemoExtinguisherRead
 *
 * Temporary demo-only collection for extinguisher code reads.
 * This is intentionally isolated from existing production modules.
 */
const demoExtinguisherReadSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  code: {
    type: String,
    required: true,
    index: true
  },
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  capturedAt: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  sourceType: {
    type: String,
    enum: ['manual', 'ocr'],
    default: 'ocr'
  },
  duplicateSuppressed: {
    type: Boolean,
    default: false
  },
  meta: {
    frameId: String,
    snapshotPath: String,
    ocrRawText: String,
    notes: String,
    extractedFields: {
      type: Map,
      of: String,
      default: {}
    },
    requestedFields: [String],
    requestedFieldConfigs: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    }
  }
}, {
  timestamps: true
});

demoExtinguisherReadSchema.index({ sessionId: 1, capturedAt: -1 });

module.exports = mongoose.model('DemoExtinguisherRead', demoExtinguisherReadSchema);
