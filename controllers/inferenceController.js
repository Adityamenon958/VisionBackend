const mongoose = require('mongoose');
const InferenceJob = require('../models/InferenceJob');
const Model = require('../models/Model');
const Dataset = require('../models/Dataset');
const { inferenceQueue } = require('../queue');
const storageAdapter = require('../services/storageAdapter');
const fs = require('fs');
const fsPromises = require('fs').promises;
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
 * Start batch inference on test folder from a dataset OR custom uploaded images/videos
 * 
 * For dataset-based inference:
 *   Body (JSON): { modelId, datasetId, confidenceThreshold? }
 * 
 * For custom image/video upload:
 *   Body (multipart/form-data): 
 *     - modelId (text field, required)
 *     - confidenceThreshold? (text field, optional)
 *     - images (file field, multiple images/videos allowed, required if no datasetId)
 */
const startBatchInference = async (req, res) => {
  try {
    // ✅ Log incoming request for debugging
    console.log('🔍 [Inference Start] Request received:', {
      method: req.method,
      contentType: req.headers['content-type'],
      body: req.body,
      filesCount: Array.isArray(req.files) ? req.files.length : 0,
      hasFiles: !!req.files
    });

    // ✅ Extract fields - support both JSON and form-data
    // ⚠️ NOTE: When using multer.array('images'), files are stored directly in req.files as an array
    // NOT in req.files.images (that would be for .fields() with named fields)
    const modelId = req.body.modelId;
    const datasetId = req.body.datasetId;
    const confidenceThreshold = req.body.confidenceThreshold;
    const uploadedImages = Array.isArray(req.files) ? req.files : [];

    // ✅ Determine inference type: dataset-based or custom upload
    const isCustomUpload = uploadedImages.length > 0;
    const isDatasetBased = !!datasetId;

    // ✅ Validate that either datasetId OR images are provided (not both, not neither)
    if (!modelId) {
      console.error('❌ [Inference Start] Missing modelId');
      return res.status(400).json({
        error: 'Missing required field: modelId',
        received: { body: req.body, files: req.files ? 'present' : 'missing' }
      });
    }

    if (!isDatasetBased && !isCustomUpload) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Either datasetId (for dataset-based inference) or images (for custom upload) must be provided',
        required: ['modelId', 'datasetId OR images']
      });
    }

    if (isDatasetBased && isCustomUpload) {
      return res.status(400).json({
        error: 'Conflicting parameters',
        message: 'Cannot provide both datasetId and custom images. Use either dataset-based inference OR custom upload.'
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

    let sourceType;
    let testFolderPath = null;
    let customFolderPath = null;
    let totalImages = 0;
    let datasetIdForJob = null;

    // ✅ Handle dataset-based inference
    if (isDatasetBased) {
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
      testFolderPath = path.join(
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

      sourceType = 'test_folder';
      totalImages = dataset.testCount;
      datasetIdForJob = dataset._id.toString();
    }

    // ✅ Handle custom image/video upload
    if (isCustomUpload) {
      // ✅ Validate at least one file was uploaded
      if (uploadedImages.length === 0) {
        return res.status(400).json({
          error: 'No files uploaded',
          message: 'At least one image or video file is required for custom inference'
        });
      }

      // ✅ Create temporary folder for uploaded files (images/videos)
      const tempInferenceDir = path.join(process.cwd(), 'uploads', 'inference-temp', `inf_${Date.now()}_${uuidv4().substring(0, 8)}`);
      await storageAdapter.ensureDir(tempInferenceDir);

      // ✅ Move uploaded files to temp folder
      for (const file of uploadedImages) {
        const destPath = path.join(tempInferenceDir, file.originalname);
        try {
          await fs.promises.rename(file.path, destPath);
        } catch (error) {
          // If rename fails (cross-device), copy instead
          await fs.promises.copyFile(file.path, destPath);
          await fs.promises.unlink(file.path); // Delete temp file
        }
      }

      customFolderPath = tempInferenceDir;
      sourceType = 'custom_folder';
      totalImages = uploadedImages.length;
    }

    // ✅ Generate unique inference ID
    const inferenceId = `inf_${Date.now()}_${uuidv4().substring(0, 8)}`;

    // ✅ Create InferenceJob document
    const inferenceJobData = {
      inferenceId,
      modelId: model._id,
      company: model.company,
      project: model.project,
      sourceType: sourceType,
      status: 'queued',
      progress: {
        totalImages: totalImages,
        processedImages: 0,
        progressPercent: 0
      }
    };

    // ✅ Add source-specific fields
    if (sourceType === 'test_folder') {
      inferenceJobData.datasetId = datasetIdForJob;
      inferenceJobData.testFolderPath = testFolderPath;
    } else if (sourceType === 'custom_folder') {
      inferenceJobData.customFolderPath = customFolderPath;
    }

    const inferenceJob = new InferenceJob(inferenceJobData);
    await inferenceJob.save();

    // ✅ Prepare job data for queue
    const jobData = {
      inferenceId,
      modelId: model._id.toString(),
      company: model.company,
      project: model.project,
      sourceType: sourceType,
      confidenceThreshold: conf
    };

    // ✅ Add source-specific fields to job data
    if (sourceType === 'test_folder') {
      jobData.datasetId = datasetIdForJob;
      jobData.testFolderPath = testFolderPath;
    } else if (sourceType === 'custom_folder') {
      jobData.customFolderPath = customFolderPath;
    }

    // ✅ Enqueue inference job
    await inferenceQueue.add(jobData, {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false
    });

    return res.status(202).json({
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      message: isCustomUpload 
        ? 'Inference job queued successfully with custom files' 
        : 'Inference job queued successfully',
      sourceType: sourceType,
      totalImages: totalImages // Note: includes videos for backward compatibility
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
    // Try finding by MongoDB _id first (if it's a valid ObjectId), then by custom modelId field
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
        modelId: modelId
      });
    }

    // ✅ Generate unique inference ID
    const inferenceId = `inf_${Date.now()}_${uuidv4().substring(0, 8)}`;

    // ✅ Create temp directory for storing frames
    const framesDir = path.join(process.cwd(), 'uploads', 'live-frames', inferenceId);
    await storageAdapter.ensureDir(framesDir);

    // ✅ Create InferenceJob document (status: 'running' for live camera)
    const inferenceJob = new InferenceJob({
      inferenceId,
      modelId: model._id,
      company: model.company,
      project: model.project,
      sourceType: 'live_camera',
      status: 'running',
      startedAt: new Date(),
      results: {
        framesPath: framesDir // Store frames directory path
      }
    });

    await inferenceJob.save();

    return res.status(200).json({
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      message: 'Live camera inference started',
      frameEndpoint: `/api/inference/live/${inferenceId}/frame`
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
 * POST /api/inference/live/:inferenceId/frame
 * 
 * Process a single frame from live camera
 * 
 * Body: {
 *   image: "data:image/jpeg;base64,..." // Base64 encoded image
 *   confidenceThreshold?: 0.25 // Optional, overrides default
 * }
 */
const processLiveFrame = async (req, res) => {
  try {
    const { inferenceId } = req.params;
    const { image, confidenceThreshold } = req.body;

    // ✅ Validate inferenceId
    if (!inferenceId) {
      return res.status(400).json({
        error: 'Missing required parameter: inferenceId'
      });
    }

    // ✅ Validate image data
    if (!image || typeof image !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid image data',
        message: 'Image must be a base64 encoded string (data URL format)'
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

    // ✅ Validate job is running
    if (inferenceJob.status !== 'running') {
      return res.status(400).json({
        error: 'Inference job is not running',
        status: inferenceJob.status,
        message: 'Only running inference jobs can process frames'
      });
    }

    // ✅ Validate job is live camera type
    if (inferenceJob.sourceType !== 'live_camera') {
      return res.status(400).json({
        error: 'Invalid inference job type',
        sourceType: inferenceJob.sourceType,
        message: 'This endpoint is only for live camera inference'
      });
    }

    // ✅ Get model
    const model = await Model.findById(inferenceJob.modelId);
    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId: inferenceJob.modelId
      });
    }

    // ✅ Validate model checkpoint exists
    if (!model.bestCheckpointPath || !fs.existsSync(model.bestCheckpointPath)) {
      return res.status(404).json({
        error: 'Model checkpoint file not found',
        modelId: model.modelId
      });
    }

    // ✅ Get frames directory
    const framesDir = inferenceJob.results?.framesPath || 
                     path.join(process.cwd(), 'uploads', 'live-frames', inferenceId);
    
    // ✅ Ensure frames directory exists
    await storageAdapter.ensureDir(framesDir);

    // ✅ Generate unique filenames for input and output
    const timestamp = Date.now();
    const inputFramePath = path.join(framesDir, `frame_${timestamp}_input.jpg`);
    const outputFramePath = path.join(framesDir, `frame_${timestamp}_annotated.jpg`);

    // ✅ Decode base64 image and save to temp file
    try {
      // Remove data URL prefix if present
      let base64Data = image;
      if (image.includes(',')) {
        base64Data = image.split(',')[1];
      }

      // Decode and save
      const imageBuffer = Buffer.from(base64Data, 'base64');
      await fsPromises.writeFile(inputFramePath, imageBuffer);
    } catch (decodeError) {
      return res.status(400).json({
        error: 'Invalid image data',
        message: 'Failed to decode base64 image',
        details: decodeError.message
      });
    }

    // ✅ Get confidence threshold (use provided or default)
    const conf = confidenceThreshold !== undefined 
      ? parseFloat(confidenceThreshold) 
      : 0.25;

    if (isNaN(conf) || conf < 0 || conf > 1) {
      return res.status(400).json({
        error: 'Invalid confidence threshold',
        message: 'Confidence threshold must be a number between 0 and 1',
        provided: confidenceThreshold
      });
    }

    // ✅ Run Python inference script
    const pythonScriptPath = path.join(__dirname, '../inference-scripts/process_frame.py');
    
    // Check if Python script exists
    const scriptExists = await fsPromises.access(pythonScriptPath).then(() => true).catch(() => false);
    if (!scriptExists) {
      return res.status(500).json({
        error: 'Inference script not found',
        path: pythonScriptPath
      });
    }

    const startTime = Date.now();
    
    // ✅ Spawn Python process
    const { spawn } = require('child_process');
    const pythonProcess = spawn('python', [
      '-u', // Unbuffered output
      pythonScriptPath,
      '--model', model.bestCheckpointPath,
      '--image', inputFramePath,
      '--output', outputFramePath,
      '--conf', conf.toString()
    ], {
      cwd: path.join(__dirname, '../inference-scripts'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    let stdout = '';
    let stderr = '';

    // ✅ Collect stdout (JSON result)
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // ✅ Collect stderr (errors)
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // ✅ Wait for process to complete
    const exitCode = await new Promise((resolve) => {
      pythonProcess.on('close', (code) => {
        resolve(code);
      });
    });

    const processingTime = Date.now() - startTime;

    // ✅ Check if process failed
    if (exitCode !== 0) {
      console.error(`Python process failed with code ${exitCode}:`, stderr);
      
      // Clean up input file
      try {
        await fsPromises.unlink(inputFramePath);
      } catch (e) {
        // Ignore cleanup errors
      }

      return res.status(500).json({
        error: 'Frame processing failed',
        message: stderr || 'Python inference script failed',
        exitCode: exitCode
      });
    }

    // ✅ Check if output file was created
    if (!fs.existsSync(outputFramePath)) {
      return res.status(500).json({
        error: 'Annotated image not generated',
        message: 'Python script completed but output file not found'
      });
    }

    // ✅ Parse detection results from stdout (JSON)
    let detectionData = null;
    try {
      if (stdout.trim()) {
        detectionData = JSON.parse(stdout.trim());
      }
    } catch (parseError) {
      console.warn('Failed to parse detection data from Python output:', parseError);
    }

    // ✅ Read annotated image and convert to base64
    const annotatedImageBuffer = await fsPromises.readFile(outputFramePath);
    const annotatedImageBase64 = annotatedImageBuffer.toString('base64');
    const annotatedImageDataUrl = `data:image/jpeg;base64,${annotatedImageBase64}`;

    // ✅ Clean up temp files (keep only last N frames to prevent disk filling)
    try {
      // Delete input frame (we only need annotated output)
      await fsPromises.unlink(inputFramePath);

      // Clean up old frames (keep only last 10 annotated frames)
      const files = await fsPromises.readdir(framesDir);
      const annotatedFiles = files
        .filter(f => f.includes('_annotated.jpg'))
        .sort()
        .reverse(); // Newest first

      // Delete files beyond the 10 most recent
      if (annotatedFiles.length > 10) {
        for (const oldFile of annotatedFiles.slice(10)) {
          try {
            await fsPromises.unlink(path.join(framesDir, oldFile));
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }
    } catch (cleanupError) {
      console.warn('Frame cleanup warning:', cleanupError.message);
      // Continue even if cleanup fails
    }

    // ✅ Update inference job statistics (optional - track frame count)
    if (!inferenceJob.results) {
      inferenceJob.results = {};
    }
    if (!inferenceJob.results.totalFramesProcessed) {
      inferenceJob.results.totalFramesProcessed = 0;
    }
    inferenceJob.results.totalFramesProcessed = (inferenceJob.results.totalFramesProcessed || 0) + 1;
    await inferenceJob.save();

    // ✅ Return annotated frame and detection data
    return res.status(200).json({
      annotatedImage: annotatedImageDataUrl,
      detections: detectionData?.detections || [],
      totalDetections: detectionData?.totalDetections || 0,
      processingTime: processingTime // milliseconds
    });

  } catch (error) {
    console.error('Error processing live frame:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/inference/live/:inferenceId/stop
 * 
 * Stop live camera inference
 */
const stopLiveInference = async (req, res) => {
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

    // ✅ Check if job is already stopped
    if (inferenceJob.status !== 'running') {
      return res.status(400).json({
        error: 'Inference job is not running',
        status: inferenceJob.status,
        message: 'Job is already stopped or completed'
      });
    }

    // ✅ Update job status
    inferenceJob.status = 'completed';
    inferenceJob.completedAt = new Date();
    await inferenceJob.save();

    // ✅ Clean up frames directory (optional - can keep for debugging)
    const framesDir = inferenceJob.results?.framesPath;
    if (framesDir && fs.existsSync(framesDir)) {
      try {
        // Delete all files in frames directory
        const files = await fsPromises.readdir(framesDir);
        for (const file of files) {
          try {
            await fsPromises.unlink(path.join(framesDir, file));
          } catch (e) {
            // Ignore individual file errors
          }
        }
        // Remove directory (recursive)
        await fsPromises.rm(framesDir, { recursive: true, force: true });
        console.log(`✅ Cleaned up frames directory: ${framesDir}`);
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup frames directory: ${cleanupError.message}`);
        // Continue even if cleanup fails
      }
    }

    return res.status(200).json({
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      message: 'Live camera inference stopped',
      totalFramesProcessed: inferenceJob.results?.totalFramesProcessed || 0,
      stoppedAt: inferenceJob.completedAt
    });

  } catch (error) {
    console.error('Error stopping live inference:', error);
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
      .populate('datasetId', 'company project version testCount deletedAt')
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

    // ✅ Check if dataset is deleted (for test_folder type)
    if (inferenceJob.datasetId) {
      if (inferenceJob.datasetId.deletedAt) {
        response.dataset = {
          datasetId: inferenceJob.datasetId._id.toString(),
          deleted: true,
          deletedAt: inferenceJob.datasetId.deletedAt,
          message: 'Dataset has been deleted'
        };
      } else {
        response.dataset = {
          datasetId: inferenceJob.datasetId._id.toString(),
          company: inferenceJob.datasetId.company,
          project: inferenceJob.datasetId.project,
          version: inferenceJob.datasetId.version,
          testCount: inferenceJob.datasetId.testCount
        };
      }
    }

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
 * 
 * Query params:
 *   - filter: 'all' | 'good' | 'defect' (default: 'all')
 */
const getInferenceResults = async (req, res) => {
  try {
    const { inferenceId } = req.params;
    const { filter = 'all' } = req.query; // Filter: 'all', 'good', or 'defect'

    if (!inferenceId) {
      return res.status(400).json({
        error: 'Missing required parameter: inferenceId'
      });
    }

    // ✅ Validate filter parameter
    if (!['all', 'good', 'defect'].includes(filter)) {
      return res.status(400).json({
        error: 'Invalid filter parameter',
        message: 'Filter must be one of: all, good, defect',
        provided: filter
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

    // ✅ List images from good/ and defect/ folders
    let goodImages = [];
    let defectImages = [];

    // ✅ Get good images
    if (inferenceJob.results.goodImagesPath && fs.existsSync(inferenceJob.results.goodImagesPath)) {
      try {
        const files = fs.readdirSync(inferenceJob.results.goodImagesPath);
        goodImages = files
          .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
          .map(file => ({
            filename: file,
            tag: 'good',
            url: `/api/inference/${inferenceId}/image/${file}?folder=good`
          }));
      } catch (error) {
        console.warn(`Could not list good images: ${error.message}`);
      }
    }

    // ✅ Get defect images
    if (inferenceJob.results.defectImagesPath && fs.existsSync(inferenceJob.results.defectImagesPath)) {
      try {
        const files = fs.readdirSync(inferenceJob.results.defectImagesPath);
        defectImages = files
          .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
          .map(file => ({
            filename: file,
            tag: 'defect',
            url: `/api/inference/${inferenceId}/image/${file}?folder=defect`
          }));
      } catch (error) {
        console.warn(`Could not list defect images: ${error.message}`);
      }
    }

    // ✅ Always get videos from annotated folder (videos are not categorized into good/defect)
    let videos = [];
    if (inferenceJob.results.annotatedImagesPath && fs.existsSync(inferenceJob.results.annotatedImagesPath)) {
      try {
        const files = fs.readdirSync(inferenceJob.results.annotatedImagesPath);
        videos = files
          .filter(file => /\.(mp4|avi|mov|mkv|webm|flv|wmv|m4v)$/i.test(file))
          .map(file => ({
            filename: file,
            fileType: 'video',
            url: `/api/inference/${inferenceId}/image/${file}` // Uses same endpoint as images
          }));
      } catch (error) {
        console.warn(`Could not list videos from annotated folder: ${error.message}`);
      }
    }

    // ✅ Backward compatibility: If no good/defect folders exist, fall back to annotated folder for images
    let fallbackImages = [];
    const hasNewStructure = goodImages.length > 0 || defectImages.length > 0 || 
                            (inferenceJob.results.goodImagesPath && inferenceJob.results.defectImagesPath);
    
    if (!hasNewStructure && inferenceJob.results.annotatedImagesPath && fs.existsSync(inferenceJob.results.annotatedImagesPath)) {
      try {
        const files = fs.readdirSync(inferenceJob.results.annotatedImagesPath);
        fallbackImages = files
          .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
          .map(file => ({
            filename: file,
            tag: 'unreviewed', // Old jobs don't have tags
            url: `/api/inference/${inferenceId}/image/${file}` // No folder param for old jobs
          }));
      } catch (error) {
        console.warn(`Could not list annotated images: ${error.message}`);
      }
    }

    // ✅ Calculate statistics
    const totalImages = hasNewStructure 
      ? (goodImages.length + defectImages.length)
      : fallbackImages.length;
    const totalVideos = videos.length;
    const totalFiles = totalImages + totalVideos;
    const goodCount = hasNewStructure 
      ? (inferenceJob.results.goodCount || goodImages.length)
      : 0;
    const defectCount = hasNewStructure
      ? (inferenceJob.results.defectCount || defectImages.length)
      : 0;

    // ✅ Apply filter if specified
    let filteredImages = [];
    if (hasNewStructure) {
      // New structure: filter by good/defect
      if (filter === 'good') {
        filteredImages = goodImages;
      } else if (filter === 'defect') {
        filteredImages = defectImages;
      } else {
        // 'all' - combine both arrays
        filteredImages = [...goodImages, ...defectImages];
      }
    } else {
      // Old structure: return all from annotated folder (filtering not supported)
      filteredImages = fallbackImages;
    }

    // ✅ Format response
    const response = {
      inferenceId: inferenceJob.inferenceId,
      status: inferenceJob.status,
      filter: filter,
      results: {
        resultsPath: inferenceJob.results.resultsPath,
        annotatedImagesPath: inferenceJob.results.annotatedImagesPath,
        goodImagesPath: inferenceJob.results.goodImagesPath,
        defectImagesPath: inferenceJob.results.defectImagesPath,
        metadataPath: inferenceJob.results.metadataPath,
        totalDetections: inferenceJob.results.totalDetections || 0,
        averageConfidence: inferenceJob.results.averageConfidence || 0,
        detectionsByClass: inferenceJob.results.detectionsByClass || [],
        // ✅ Images grouped by tag
        annotatedImages: {
          good: goodImages,
          defect: defectImages,
          all: filteredImages // Filtered results based on query param
        },
        // ✅ Videos (always from annotated folder, not categorized)
        videos: videos,
        // ✅ Backward compatibility: flat array for old jobs (deprecated, use annotatedImages.all)
        // This ensures old frontend code still works
        ...(fallbackImages.length > 0 && !hasNewStructure ? { 
          images: fallbackImages // Old format for backward compatibility
        } : {}),
        // ✅ Statistics
        statistics: {
          total: totalFiles, // Total files (images + videos)
          totalImages: totalImages,
          totalVideos: totalVideos,
          good: goodCount,
          defect: defectCount,
          // Indicate if this is an old job without tagging
          hasTags: hasNewStructure
        },
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
 * Serve annotated image or video file from inference results
 * 
 * Query params:
 *   - folder: 'good' | 'defect' | undefined (default: searches annotated folder, then good/defect)
 * 
 * Note: Videos are always served from annotated folder (not good/defect)
 */
const getAnnotatedImage = async (req, res) => {
  try {
    const { inferenceId, filename } = req.params;
    const { folder } = req.query; // Optional: 'good' or 'defect'

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

    if (!inferenceJob.results || !inferenceJob.results.resultsPath) {
      return res.status(404).json({
        error: 'Results not found',
        inferenceId: inferenceId
      });
    }

    // ✅ Determine which folder to look in
    let imagePath = null;
    let basePath = null;

    if (folder === 'good' && inferenceJob.results.goodImagesPath) {
      imagePath = path.join(inferenceJob.results.goodImagesPath, filename);
      basePath = inferenceJob.results.goodImagesPath;
    } else if (folder === 'defect' && inferenceJob.results.defectImagesPath) {
      imagePath = path.join(inferenceJob.results.defectImagesPath, filename);
      basePath = inferenceJob.results.defectImagesPath;
    } else {
      // ✅ Default: try good/, then defect/, then annotated/ (for backward compatibility)
      const searchPaths = [
        { path: inferenceJob.results.goodImagesPath, name: 'good' },
        { path: inferenceJob.results.defectImagesPath, name: 'defect' },
        { path: inferenceJob.results.annotatedImagesPath, name: 'annotated' }
      ].filter(p => p.path); // Filter out null/undefined paths

      for (const searchPath of searchPaths) {
        const testPath = path.join(searchPath.path, filename);
        if (fs.existsSync(testPath)) {
          imagePath = testPath;
          basePath = searchPath.path;
          break;
        }
      }
    }

    // ✅ If still not found, return 404
    if (!imagePath || !basePath) {
      return res.status(404).json({
        error: 'File not found',
        filename: filename,
        inferenceId: inferenceId,
        searchedFolders: folder ? [folder] : ['good', 'defect', 'annotated'],
        message: 'Note: Videos are stored in annotated folder'
      });
    }

    // ✅ Security: Prevent directory traversal
    const resolvedPath = path.resolve(imagePath);
    const resolvedBasePath = path.resolve(basePath);
    
    if (!resolvedPath.startsWith(resolvedBasePath)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Invalid file path'
      });
    }

    // ✅ Check if file exists (double check)
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        error: 'File not found',
        filename: filename,
        inferenceId: inferenceId
      });
    }

    // ✅ Send file (works for both images and videos)
    // Set appropriate content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    if (['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v'].includes(ext)) {
      res.setHeader('Content-Type', 'video/mp4'); // Default to mp4, browser will handle it
    }
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
      .populate('datasetId', 'company project version testCount deletedAt')
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
        dataset: job.datasetId ? (job.datasetId.deletedAt ? {
          datasetId: job.datasetId._id.toString(),
          deleted: true,
          deletedAt: job.datasetId.deletedAt,
          message: 'Dataset has been deleted'
        } : {
          datasetId: job.datasetId._id.toString(),
          version: job.datasetId.version,
          testCount: job.datasetId.testCount
        }) : null,
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
};

