const express = require('express');
const router = express.Router();

const {
  startBatchInference,
  startLiveInference,
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
 * GET /api/inference
 * List all inference jobs for company/project
 * 
 * Query params: company (required), project (required), status (optional)
 */
router.get('/', listInferenceJobs);

/**
 * POST /api/inference/start
 * Start batch inference on test folder
 * 
 * Body: { modelId, datasetId }
 */
router.post('/start', startBatchInference);

/**
 * POST /api/inference/live/start
 * Start live camera inference
 * 
 * Body: { modelId }
 */
router.post('/live/start', startLiveInference);

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

