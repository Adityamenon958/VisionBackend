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

/**
 * Inference Routes
 * 
 * These routes handle inference job management:
 * - Start batch inference (images/videos)
 * - Start/stop live camera inference
 * - Get inference status and results
 * - Get annotated images/videos
 * - Cancel/delete inference jobs
 * - List inference history
 */

// ✅ Configure multer for inference file uploads
const inferenceTempDir = path.join(process.cwd(), 'uploads', 'inference-temp');
if (!fs.existsSync(inferenceTempDir)) {
  fs.mkdirSync(inferenceTempDir, { recursive: true });
}

// ✅ File filter - accept image and video files
const inferenceFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const validExtensions = ['.jpg', '.jpeg', '.png', '.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'];

  if (validExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${ext}. Only ${validExtensions.join(', ')} are allowed.`), false);
  }
};

// ✅ Create multer instance for inference uploads
const uploadInferenceImages = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, inferenceTempDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, `inf-${uniqueSuffix}-${file.originalname}`);
    }
  }),
  fileFilter: inferenceFileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB per file limit (increased for videos)
    files: 1000 // Maximum 1000 files per upload
  }
});

// GET /api/inference/models - List available models for inference
router.get('/models', listAvailableModels);

// GET /api/inference/datasets - List datasets with test folders
router.get('/datasets', listDatasetsWithTestFolders);

// GET /api/inference/history - List inference jobs (with filters)
router.get('/history', listInferenceJobs);

// POST /api/inference/start - Start batch inference (images/videos)
router.post('/start', uploadInferenceImages.array('files', 1000), startBatchInference);

// POST /api/inference/live/start - Start live camera inference
router.post('/live/start', startLiveInference);

// POST /api/inference/live/:inferenceId/frame - Process a frame from live camera
router.post('/live/:inferenceId/frame', processLiveFrame);

// POST /api/inference/live/:inferenceId/stop - Stop live camera inference
router.post('/live/:inferenceId/stop', stopLiveInference);

// GET /api/inference/:inferenceId/status - Get inference job status
router.get('/:inferenceId/status', getInferenceStatus);

// GET /api/inference/:inferenceId/results - Get inference results
router.get('/:inferenceId/results', getInferenceResults);

// GET /api/inference/:inferenceId/image/:filename - Get annotated image/video
router.get('/:inferenceId/image/:filename', getAnnotatedImage);

// POST /api/inference/:inferenceId/cancel - Cancel a running inference job
router.post('/:inferenceId/cancel', cancelInference);

// DELETE /api/inference/:inferenceId - Delete an inference job
router.delete('/:inferenceId', deleteInference);

module.exports = router;
