const mongoose = require('mongoose');
const InferenceJob = require('../models/InferenceJob');
const Model = require('../models/Model');
const Dataset = require('../models/Dataset');
const { inferenceQueue } = require('../queue');
const storageAdapter = require('../services/storageAdapter');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Inference Controller - Handles inference/prediction job management
 * 
 * This controller provides endpoints for:
 * - Starting batch inference on test folders
 * - Starting live camera inference
 * - Checking inference status and progress
 * - Retrieving inference results
 * - Cancelling inference jobs
 * - Listing available models and datasets
 */

/**
 * POST /api/inference/start
 * 
 * Start batch inference on test folder from a dataset
 * 
 * Body: { modelId, datasetId }
 */
const startBatchInference = async (req, res) => {
  try {
    const { modelId, datasetId, confidenceThreshold } = req.body;

    // ✅ Validate required fields
    if (!modelId || !datasetId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['modelId', 'datasetId']
      });
    }

    // ✅ Validate confidence threshold (optional, default 0.25)
    let conf = 0.25; // Default value
    if (confidenceThreshold !== undefined) {
      conf = parseFloat(confidenceThreshold);
      if (isNaN(conf) || conf < 0 || conf > 1) {
        return res.status(400).json({
          error: 'Invalid confidence threshold',
          message: 'Confidence threshold must be a number between 0 and 1',
          provided: confidenceThreshold
        });
      }
    }

    // ✅ Validate model exists and get model info
    // Support both MongoDB _id (ObjectId) and custom modelId field
    let model;
    if (mongoose.Types.ObjectId.isValid(modelId) && modelId.length === 24) {
      // If it's a valid ObjectId, try finding by _id first
      model = await Model.findById(modelId);
    }
    // If not found or not a valid ObjectId, try finding by custom modelId field
    if (!model) {
      model = await Model.findOne({ modelId: modelId });
    }
    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: modelId
      });
    }

    // ✅ Validate model file exists
    if (!model.bestCheckpointPath || !fs.existsSync(model.bestCheckpointPath)) {
      return res.status(404).json({
        error: 'Model checkpoint file not found',
        modelId: modelId,
        path: model.bestCheckpointPath
      });
    }

    // ✅ Validate dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId: datasetId
      });
    }

    // ✅ Validate dataset is ready
    if (dataset.status !== 'ready') {
      return res.status(400).json({
        error: 'Dataset is not ready for inference',
        status: dataset.status,
        message: 'Dataset must be in "ready" status'
      });
    }

    // ✅ Validate dataset has test images
    if (!dataset.testCount || dataset.testCount === 0) {
      return res.status(400).json({
        error: 'Dataset has no test images',
        testCount: dataset.testCount
      });
    }

    // ✅ Validate company/project match
    if (model.company !== dataset.company || model.project !== dataset.project) {
      return res.status(400).json({
        error: 'Model and dataset must belong to the same company and project',
        modelCompany: model.company,
        modelProject: model.project,
        datasetCompany: dataset.company,
        datasetProject: dataset.project
      });
    }

    // ✅ Get test folder path
    const testFolderPath = path.join(
      storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version),
      'images',
      'test'
    );

    // ✅ Validate test folder exists
    if (!fs.existsSync(testFolderPath)) {
      return res.status(404).json({
        error: 'Test folder not found',
        path: testFolderPath
      });
    }

    // ✅ Generate unique inference ID
    const inferenceId = `inf_${Date.now()}_${uuidv4().substring(0, 8)}`;

    // ✅ Create InferenceJob document
    const inferenceJob = new InferenceJob({
      inferenceId,
      modelId: model._id,
      company: model.company,
      project: model.project,
      sourceType: 'test_folder',
      datasetId: dataset._id,
      testFolderPath: testFolderPath,
      status: 'queued',
      progress: {
        totalImages: dataset.testCount,
        processedImages: 0,
        progressPercent: 0
      }
    });

    await inferenceJob.save();

    // ✅ Enqueue inference job
    await inferenceQueue.add({
      inferenceId,
      modelId: model._id.toString(),
      company: model.company,
      project: model.project,
      sourceType: 'test_folder',
      datasetId: dataset._id.toString(),
      testFolderPath: testFolderPath,
      confidenceThreshold: conf
    }, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false
    });

    return res.status(202).json({
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      message: 'Inference job queued successfully'
    });

  } catch (error) {
    console.error('Error starting batch inference:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/inference/live/start
 * 
 * Start live camera inference
 * 
 * Body: { modelId }
 * 
 * Note: Live camera implementation will be handled differently (see Phase 5)
 */
const startLiveInference = async (req, res) => {
  try {
    const { modelId } = req.body;

    // ✅ Validate required fields
    if (!modelId) {
      return res.status(400).json({
        error: 'Missing required field: modelId'
      });
    }

    // ✅ Validate model exists
    const model = await Model.findById(modelId);
    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: modelId
      });
    }

    // ✅ Validate model file exists
    if (!model.bestCheckpointPath || !fs.existsSync(model.bestCheckpointPath)) {
      return res.status(404).json({
        error: 'Model checkpoint file not found',
        modelId: modelId
      });
    }

    // ✅ Generate unique inference ID
    const inferenceId = `inf_${Date.now()}_${uuidv4().substring(0, 8)}`;

    // ✅ Create InferenceJob document (status: 'running' for live camera)
    const inferenceJob = new InferenceJob({
      inferenceId,
      modelId: model._id,
      company: model.company,
      project: model.project,
      sourceType: 'live_camera',
      status: 'running',
      startedAt: new Date()
    });

    await inferenceJob.save();

    return res.status(200).json({
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      message: 'Live camera inference started',
      note: 'Use POST /api/inference/live/frame to send frames for inference'
    });

  } catch (error) {
    console.error('Error starting live inference:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/inference/:inferenceId/status
 * 
 * Get inference job status and progress
 */
const getInferenceStatus = async (req, res) => {
  try {
    const { inferenceId } = req.params;

    if (!inferenceId) {
      return res.status(400).json({
        error: 'Missing required parameter: inferenceId'
      });
    }

    // ✅ Find inference job
    const inferenceJob = await InferenceJob.findOne({ inferenceId })
      .populate('modelId', 'modelId modelVersion modelType metrics')
      .populate('datasetId', 'company project version testCount')
      .lean();

    if (!inferenceJob) {
      return res.status(404).json({
        error: 'Inference job not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Format response
    const response = {
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      progress: inferenceJob.progress,
      sourceType: inferenceJob.sourceType,
      model: {
        modelId: inferenceJob.modelId?.modelId,
        modelVersion: inferenceJob.modelId?.modelVersion,
        modelType: inferenceJob.modelId?.modelType,
        metrics: inferenceJob.modelId?.metrics
      },
      startedAt: inferenceJob.startedAt,
      completedAt: inferenceJob.completedAt,
      cancelledAt: inferenceJob.cancelledAt,
      error: inferenceJob.error
    };

    // ✅ Include results summary if completed
    if (inferenceJob.status === 'completed' && inferenceJob.results) {
      response.results = {
        totalDetections: inferenceJob.results.totalDetections,
        averageConfidence: inferenceJob.results.averageConfidence,
        detectionsByClass: inferenceJob.results.detectionsByClass
      };
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting inference status:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/inference/:inferenceId/results
 * 
 * Get full inference results (annotated images list, metadata)
 */
const getInferenceResults = async (req, res) => {
  try {
    const { inferenceId } = req.params;

    if (!inferenceId) {
      return res.status(400).json({
        error: 'Missing required parameter: inferenceId'
      });
    }

    // ✅ Find inference job
    const inferenceJob = await InferenceJob.findOne({ inferenceId }).lean();

    if (!inferenceJob) {
      return res.status(404).json({
        error: 'Inference job not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Check if results are available
    if (inferenceJob.status !== 'completed') {
      return res.status(400).json({
        error: 'Inference job is not completed',
        status: inferenceJob.status,
        message: 'Results are only available for completed jobs'
      });
    }

    if (!inferenceJob.results || !inferenceJob.results.resultsPath) {
      return res.status(404).json({
        error: 'Results not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Read metadata JSON file if it exists
    let metadata = null;
    if (inferenceJob.results.metadataPath && fs.existsSync(inferenceJob.results.metadataPath)) {
      try {
        const metadataContent = fs.readFileSync(inferenceJob.results.metadataPath, 'utf8');
        metadata = JSON.parse(metadataContent);
      } catch (error) {
        console.warn(`Could not read metadata file: ${error.message}`);
      }
    }

    // ✅ List annotated images if directory exists
    let annotatedImages = [];
    if (inferenceJob.results.annotatedImagesPath && fs.existsSync(inferenceJob.results.annotatedImagesPath)) {
      try {
        const files = fs.readdirSync(inferenceJob.results.annotatedImagesPath);
        annotatedImages = files
          .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
          .map(file => ({
            filename: file,
            url: `/api/inference/${inferenceId}/image/${file}` // Frontend can use this to display images
          }));
      } catch (error) {
        console.warn(`Could not list annotated images: ${error.message}`);
      }
    }

    // ✅ Format response
    const response = {
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      results: {
        resultsPath: inferenceJob.results.resultsPath,
        annotatedImagesPath: inferenceJob.results.annotatedImagesPath,
        metadataPath: inferenceJob.results.metadataPath,
        totalDetections: inferenceJob.results.totalDetections,
        averageConfidence: inferenceJob.results.averageConfidence,
        detectionsByClass: inferenceJob.results.detectionsByClass,
        annotatedImages: annotatedImages,
        metadata: metadata
      },
      completedAt: inferenceJob.completedAt
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting inference results:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/inference/:inferenceId/image/:filename
 * 
 * Serve annotated image file from inference results
 */
const getAnnotatedImage = async (req, res) => {
  try {
    const { inferenceId, filename } = req.params;

    if (!inferenceId || !filename) {
      return res.status(400).json({
        error: 'Missing required parameters: inferenceId and filename'
      });
    }

    // ✅ Find inference job to get results path
    const inferenceJob = await InferenceJob.findOne({ inferenceId }).lean();

    if (!inferenceJob) {
      return res.status(404).json({
        error: 'Inference job not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Check if results are available
    if (inferenceJob.status !== 'completed') {
      return res.status(400).json({
        error: 'Inference job is not completed',
        status: inferenceJob.status,
        message: 'Images are only available for completed jobs'
      });
    }

    if (!inferenceJob.results || !inferenceJob.results.annotatedImagesPath) {
      return res.status(404).json({
        error: 'Results not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Build full image path
    const imagePath = path.join(inferenceJob.results.annotatedImagesPath, filename);

    // ✅ Security: Prevent directory traversal
    const resolvedPath = path.resolve(imagePath);
    const resolvedBasePath = path.resolve(inferenceJob.results.annotatedImagesPath);
    
    if (!resolvedPath.startsWith(resolvedBasePath)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Invalid file path'
      });
    }

    // ✅ Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        error: 'Image not found',
        filename: filename,
        inferenceId: inferenceId
      });
    }

    // ✅ Send image file
    res.sendFile(imagePath);

  } catch (error) {
    console.error('Error serving annotated image:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/inference/:inferenceId/cancel
 * 
 * Cancel a running inference job
 */
const cancelInference = async (req, res) => {
  try {
    const { inferenceId } = req.params;

    if (!inferenceId) {
      return res.status(400).json({
        error: 'Missing required parameter: inferenceId'
      });
    }

    // ✅ Find inference job
    const inferenceJob = await InferenceJob.findOne({ inferenceId });

    if (!inferenceJob) {
      return res.status(404).json({
        error: 'Inference job not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Check if job can be cancelled
    if (inferenceJob.status === 'completed') {
      return res.status(400).json({
        error: 'Cannot cancel a completed job',
        status: inferenceJob.status
      });
    }

    if (inferenceJob.status === 'cancelled') {
      return res.status(400).json({
        error: 'Job is already cancelled',
        status: inferenceJob.status
      });
    }

    // ✅ Update status to cancelled
    inferenceJob.status = 'cancelled';
    inferenceJob.cancelledAt = new Date();
    await inferenceJob.save();

    // ✅ Try to remove from queue if still queued
    // Note: If job is already running, worker will check status and stop processing

    return res.status(200).json({
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      message: 'Inference job cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling inference:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * DELETE /api/inference/:inferenceId
 * 
 * Delete inference job and its results (files + MongoDB document)
 */
const deleteInference = async (req, res) => {
  try {
    const { inferenceId } = req.params;

    if (!inferenceId) {
      return res.status(400).json({
        error: 'Missing required parameter: inferenceId'
      });
    }

    // ✅ Find inference job
    const inferenceJob = await InferenceJob.findOne({ inferenceId });

    if (!inferenceJob) {
      return res.status(404).json({
        error: 'Inference job not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Check if job is running (cannot delete running jobs)
    if (inferenceJob.status === 'running' || inferenceJob.status === 'queued') {
      return res.status(400).json({
        error: 'Cannot delete a running or queued job',
        status: inferenceJob.status,
        message: 'Please cancel the job first, then delete it'
      });
    }

    // ✅ Delete results folder from disk if it exists
    if (inferenceJob.results && inferenceJob.results.resultsPath) {
      const resultsPath = inferenceJob.results.resultsPath;
      
      if (fs.existsSync(resultsPath)) {
        try {
          // Use fs.rmSync with recursive option (Node.js 14+)
          fs.rmSync(resultsPath, { recursive: true, force: true });
          console.log(`✅ Deleted results folder: ${resultsPath}`);
        } catch (error) {
          console.warn(`⚠️ Could not delete results folder: ${error.message}`);
          // Continue with MongoDB deletion even if file deletion fails
        }
      }
    }

    // ✅ Delete MongoDB document
    await InferenceJob.deleteOne({ inferenceId });

    return res.status(200).json({
      inferenceId: inferenceId,
      message: 'Inference job and results deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting inference:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/inference/models
 * 
 * List available trained models for company/project
 * 
 * Query params: company, project
 */
const listAvailableModels = async (req, res) => {
  try {
    const { company, project } = req.query;

    // ✅ Validate required query parameters
    if (!company || !project) {
      return res.status(400).json({
        error: 'Missing required query parameters',
        required: ['company', 'project']
      });
    }

    // ✅ Find all models for company/project
    const models = await Model.find({ company, project })
      .sort({ createdAt: -1 }) // Newest first
      .select('modelId modelVersion modelType metrics bestCheckpointPath createdAt')
      .lean();

    // ✅ Filter models that have valid checkpoint files
    const validModels = models.filter(model => {
      return model.bestCheckpointPath && fs.existsSync(model.bestCheckpointPath);
    });

    // ✅ Format response
    const formattedModels = validModels.map(model => {
      const mAP50 = model.metrics?.mAP50 || 0;
      const mAP50Percent = (mAP50 * 100).toFixed(0);

      return {
        modelId: model.modelId,
        modelVersion: model.modelVersion,
        modelType: model.modelType,
        name: `${model.modelType} - ${model.modelVersion} (mAP: ${mAP50Percent}%)`,
        metrics: {
          mAP50: model.metrics?.mAP50,
          precision: model.metrics?.precision,
          recall: model.metrics?.recall
        },
        createdAt: model.createdAt
      };
    });

    return res.status(200).json({
      models: formattedModels,
      total: formattedModels.length
    });

  } catch (error) {
    console.error('Error listing available models:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/inference
 * 
 * List all inference jobs for company/project
 * 
 * Query params: company (required), project (required), status (optional)
 */
const listInferenceJobs = async (req, res) => {
  try {
    const { company, project, status } = req.query;

    // ✅ Validate required query parameters
    if (!company || !project) {
      return res.status(400).json({
        error: 'Missing required query parameters',
        required: ['company', 'project']
      });
    }

    // ✅ Build query filter
    const filter = { company, project };
    if (status) {
      filter.status = status;
    }

    // ✅ Find inference jobs
    const inferenceJobs = await InferenceJob.find(filter)
      .populate('modelId', 'modelId modelVersion modelType metrics')
      .populate('datasetId', 'company project version testCount')
      .sort({ createdAt: -1 }) // Newest first
      .lean();

    // ✅ Format response
    const formattedJobs = inferenceJobs.map(job => {
      const formatted = {
        inferenceId: job.inferenceId,
        status: job.status,
        sourceType: job.sourceType,
        progress: job.progress,
        model: job.modelId ? {
          modelId: job.modelId.modelId,
          modelVersion: job.modelId.modelVersion,
          modelType: job.modelId.modelType,
          metrics: job.modelId.metrics
        } : null,
        dataset: job.datasetId ? {
          datasetId: job.datasetId._id.toString(),
          version: job.datasetId.version,
          testCount: job.datasetId.testCount
        } : null,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        cancelledAt: job.cancelledAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      };

      // ✅ Include results summary if completed
      if (job.status === 'completed' && job.results) {
        formatted.results = {
          totalDetections: job.results.totalDetections,
          averageConfidence: job.results.averageConfidence,
          detectionsByClass: job.results.detectionsByClass,
          hasAnnotatedImages: !!job.results.annotatedImagesPath
        };
      }

      // ✅ Include error if failed
      if (job.status === 'failed' && job.error) {
        formatted.error = job.error;
      }

      return formatted;
    });

    return res.status(200).json({
      inferenceJobs: formattedJobs,
      total: formattedJobs.length,
      company,
      project
    });

  } catch (error) {
    console.error('Error listing inference jobs:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/inference/datasets
 * 
 * List datasets with test folders for company/project
 * 
 * Query params: company, project
 */
const listDatasetsWithTestFolders = async (req, res) => {
  try {
    const { company, project } = req.query;

    // ✅ Validate required query parameters
    if (!company || !project) {
      return res.status(400).json({
        error: 'Missing required query parameters',
        required: ['company', 'project']
      });
    }

    // ✅ Find datasets with status 'ready' and testCount > 0
    const datasets = await Dataset.find({
      company,
      project,
      status: 'ready',
      testCount: { $gt: 0 }
    })
      .sort({ createdAt: -1 }) // Newest first
      .select('_id company project version status testCount totalImages createdAt')
      .lean();

    // ✅ Format response
    const formattedDatasets = datasets.map(dataset => ({
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      status: dataset.status,
      testCount: dataset.testCount,
      totalImages: dataset.totalImages,
      createdAt: dataset.createdAt
    }));

    return res.status(200).json({
      datasets: formattedDatasets,
      total: formattedDatasets.length
    });

  } catch (error) {
    console.error('Error listing datasets with test folders:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

module.exports = {
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
};

