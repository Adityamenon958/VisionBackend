const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  startBatchInference,
  startLiveInference,
  processLiveFrame,
  stopLiveInference,
  getInferenceStatus,
  getInferenceResults,
  getAnnotatedImage,
  cancelInference,
  deleteInference,
  listInferenceJobs,
  listAvailableModels,
  listDatasetsWithTestFolders
} = require('../controllers/inferenceController');

// ✅ Configure multer for custom image uploads
// ⚠️ CAUTION: Ensure temp directory exists to prevent errors
const tempDir = path.join(process.cwd(), 'uploads', 'inference-temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// ✅ Multer configuration for inference image uploads
const inferenceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // ✅ Save uploaded files to temp directory
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // ✅ Generate unique temp filename to avoid collisions
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `inf-${uniqueSuffix}-${file.originalname}`);
  }
});

// ✅ File filter - only accept image files
const inferenceFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const validExtensions = ['.jpg', '.jpeg', '.png'];
  
  if (validExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${ext}. Only ${validExtensions.join(', ')} are allowed.`), false);
  }
};

// ✅ Create multer instance for inference uploads
const uploadInferenceImages = multer({
  storage: inferenceStorage,
  fileFilter: inferenceFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file limit
    files: 1000 // Maximum 1000 images per upload
  }
});

/**
 * GET /api/inference
 * List all inference jobs for company/project
 * 
 * Query params: company (required), project (required), status (optional)
 */
router.get('/', listInferenceJobs);

/**
 * POST /api/inference/start
 * Start batch inference on test folder OR custom uploaded images
 * 
 * For dataset-based inference:
 *   Body (JSON): { modelId, datasetId, confidenceThreshold? }
 * 
 * For custom image upload:
 *   Body (multipart/form-data): 
 *     - modelId (text field)
 *     - confidenceThreshold? (text field, optional)
 *     - images (file field, multiple images allowed)
 */
router.post('/start', uploadInferenceImages.array('images', 1000), startBatchInference);

/**
 * POST /api/inference/live/start
 * Start live camera inference
 * 
 * Body: { modelId, confidenceThreshold? }
 */
router.post('/live/start', startLiveInference);

/**
 * POST /api/inference/live/:inferenceId/frame
 * Process a single frame from live camera
 * 
 * Body: {
 *   image: "data:image/jpeg;base64,...",
 *   confidenceThreshold?: 0.25
 * }
 */
router.post('/live/:inferenceId/frame', processLiveFrame);

/**
 * POST /api/inference/live/:inferenceId/stop
 * Stop live camera inference
 */
router.post('/live/:inferenceId/stop', stopLiveInference);

/**
 * GET /api/inference/:inferenceId/status
 * Get inference job status and progress
 */
router.get('/:inferenceId/status', getInferenceStatus);

/**
 * GET /api/inference/:inferenceId/results
 * Get inference results (annotated images, metadata)
 */
router.get('/:inferenceId/results', getInferenceResults);

/**
 * GET /api/inference/:inferenceId/image/:filename
 * Serve annotated image file from inference results
 */
router.get('/:inferenceId/image/:filename', getAnnotatedImage);

/**
 * POST /api/inference/:inferenceId/cancel
 * Cancel a running inference job
 */
router.post('/:inferenceId/cancel', cancelInference);

/**
 * DELETE /api/inference/:inferenceId
 * Delete inference job and its results (files + MongoDB document)
 */
router.delete('/:inferenceId', deleteInference);

/**
 * GET /api/inference/models
 * List available trained models for company/project
 * 
 * Query params: company, project
 */
router.get('/models', listAvailableModels);

/**
 * GET /api/inference/datasets
 * List datasets with test folders for company/project
 * 
 * Query params: company, project
 */
router.get('/datasets', listDatasetsWithTestFolders);

module.exports = router;

