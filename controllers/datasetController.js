const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Dataset = require('../models/Dataset');
const storageAdapter = require('../services/storageAdapter');
const { preprocessingQueue } = require('../queue');

/**
 * Dataset Controller - Handles dataset upload and retrieval
 * 
 * Key Concepts:
 * - async/await: Allows us to write asynchronous code that looks synchronous
 *   Example: const data = await fetchData(); (waits for fetchData to finish)
 * 
 * - Middleware: Functions that run before your main route handler
 *   Example: multer middleware processes file uploads before this controller runs
 */

/**
 * POST /api/dataset/upload
 * 
 * Handles multipart file uploads, validates files, saves to storage,
 * creates database record, and enqueues preprocessing job.
 */
const uploadDataset = async (req, res) => {
  try {
    // ✅ Extract form fields (company, project, version)
    const { company, project, version = 'v1' } = req.body;

    // ✅ Validate required fields
    if (!company || !project) {
      return res.status(400).json({
        error: 'Missing required fields: company and project are required'
      });
    }

    // ✅ Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No files uploaded'
      });
    }

    // ✅ Create Dataset document in MongoDB with initial status
    const dataset = new Dataset({
      company,
      project,
      version,
      storagePath: storageAdapter.buildDatasetPath(company, project, version),
      status: 'uploaded',
      uploadErrors: [],
      files: [] // ✅ Initialize files manifest array
    });

    await dataset.save();
    const datasetId = dataset._id.toString();

    // ✅ Process uploaded files
    const validExtensions = ['.jpg', '.jpeg', '.png', '.txt'];
    let totalImages = 0;
    let totalSize = 0;
    const uploadErrors = [];

    // ✅ Ensure storage directories exist
    const imagesPath = storageAdapter.buildImagesPath(company, project, version);
    const labelsPath = storageAdapter.buildLabelsPath(company, project, version);
    await storageAdapter.ensureDir(imagesPath);
    await storageAdapter.ensureDir(labelsPath);

    // ✅ Process each uploaded file
    for (const file of req.files) {
      const originalName = file.originalname;
      const ext = path.extname(originalName).toLowerCase();
      const tempPath = file.path; // Multer saves to temp folder

      // ✅ Validate file extension
      if (!validExtensions.includes(ext)) {
        uploadErrors.push({
          filename: originalName,
          reason: `Invalid extension: ${ext}. Allowed: ${validExtensions.join(', ')}`
        });
        // ⚠️ CAUTION: Clean up invalid temp file to prevent disk filling
        try {
          await fsPromises.unlink(tempPath);
        } catch (err) {
          console.error(`Failed to delete temp file ${tempPath}:`, err);
        }
        continue;
      }

      // ✅ Determine destination folder (images or labels)
      const isImage = ['.jpg', '.jpeg', '.png'].includes(ext);
      const isLabel = ext === '.txt';
      
      if (!isImage && !isLabel) {
        uploadErrors.push({
          filename: originalName,
          reason: 'File type not recognized'
        });
        continue;
      }

      // ✅ Generate unique filename to avoid collisions
      // Format: {datasetId}_{uuid}_{originalName}
      // ⚠️ CAUTION: This prevents filename collisions when multiple users
      // upload files with the same name
      const uniqueName = `${datasetId}_${uuidv4()}_${originalName}`;
      const destPath = isImage
        ? path.join(imagesPath, uniqueName)
        : path.join(labelsPath, uniqueName);

      try {
        // ✅ Move file from temp to final storage location
        await storageAdapter.saveFile(tempPath, destPath);

        // ✅ Add file entry to manifest BEFORE saving dataset
        dataset.files.push({
          storedName: uniqueName,
          originalName: originalName,
          type: isImage ? 'image' : 'label',
          size: file.size
        });

        // ✅ Update statistics
        if (isImage) {
          totalImages++;
        }
        totalSize += file.size;
      } catch (error) {
        // ⚠️ CAUTION: File move failed - log error and continue
        console.error(`Failed to save file ${originalName}:`, error);
        uploadErrors.push({
          filename: originalName,
          reason: `Storage error: ${error.message}`
        });
        // Clean up temp file
        try {
          await fsPromises.unlink(tempPath);
        } catch (err) {
          console.error(`Failed to delete temp file ${tempPath}:`, err);
        }
      }
    }

    // ✅ Update dataset metadata (including files manifest)
    dataset.totalImages = totalImages;
    dataset.sizeBytes = totalSize;
    dataset.uploadErrors = uploadErrors;
    dataset.status = 'queued'; // Ready for preprocessing
    await dataset.save();

    // ✅ Enqueue preprocessing job
    // ⚠️ CAUTION: Job payload must be serializable (plain objects, no functions)
    await preprocessingQueue.add({
      datasetId: datasetId,
      storagePath: dataset.storagePath,
      company,
      project,
      version
    }, {
      attempts: 3, // Retry up to 3 times on failure
      backoff: {
        type: 'exponential',
        delay: 2000 // Start with 2s delay, doubles each retry
      }
    });

    // ✅ Return 202 Accepted (async processing started)
    res.status(202).json({
      datasetId,
      status: 'queued',
      message: 'Dataset uploaded successfully. Preprocessing started.',
      totalImages,
      uploadErrors: uploadErrors.length > 0 ? uploadErrors : undefined
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/dataset/:datasetId
 * 
 * Returns full dataset metadata document
 */
const getDataset = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    res.json(dataset);

  } catch (error) {
    console.error('Get dataset error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/dataset/:datasetId/status
 * 
 * Returns minimal status information for polling
 */
const getDatasetStatus = async (req, res) => {
  try {
    const { datasetId } = req.params;

    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Return minimal status info (good for frequent polling)
    res.json({
      status: dataset.status,
      totalImages: dataset.totalImages,
      uploadErrors: dataset.uploadErrors.length > 0 ? dataset.uploadErrors : undefined,
      // Include progress info if processing
      ...(dataset.status === 'processing' && {
        trainCount: dataset.trainCount,
        valCount: dataset.valCount
      })
    });

  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

module.exports = {
  uploadDataset,
  getDataset,
  getDatasetStatus
};
