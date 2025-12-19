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
    // Note: With upload.fields(), req.files is an object with arrays, not a flat array
    const uploadedFiles = req.files?.files || [];
    if (!uploadedFiles || uploadedFiles.length === 0) {
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

    // ✅ Parse optional fileMeta (JSON string mapping originalName -> folder)
    // Expected format: [{ originalName: "img1.jpg", folder: "good" }, ...]
    // fileMeta can be sent as:
    // 1. Text field in form-data (req.body.fileMeta)
    // 2. Uploaded JSON file (req.files.fileMeta[0])
    let fileMetaMap = {};
    let fileMetaRaw = req.body.fileMeta;

    // ✅ If the frontend uploaded a JSON file as fileMeta
    if (!fileMetaRaw && req.files?.fileMeta?.length) {
      const metaFilePath = req.files.fileMeta[0].path;
      try {
        fileMetaRaw = await fsPromises.readFile(metaFilePath, 'utf-8');
      } catch (readError) {
        console.warn('Failed to read fileMeta file:', readError.message);
      } finally {
        // ✅ Remove the temp uploaded file
        try {
          await fsPromises.unlink(metaFilePath);
        } catch (unlinkError) {
          // Ignore cleanup errors
        }
      }
    }

    // ✅ Parse JSON safely
    if (fileMetaRaw) {
      try {
        const fileMeta = JSON.parse(fileMetaRaw);
        // Build map for fast lookup
        for (const m of fileMeta) {
          if (m && m.originalName) {
            fileMetaMap[m.originalName] = m.folder || 'dataset';
          }
        }
      } catch (e) {
        // ⚠️ CAUTION: Ignore parse errors and fallback to default folder
        console.warn('Failed to parse fileMeta, using default folder:', e.message);
        fileMetaMap = {};
      }
    }

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
    // Note: Use uploadedFiles array (from req.files.files) instead of req.files
    for (const file of uploadedFiles) {
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

      // ✅ Determine folder name from fileMeta (default: 'dataset')
      const folderName = (fileMetaMap && fileMetaMap[originalName]) ? fileMetaMap[originalName] : 'dataset';

      // ✅ Generate unique filename to avoid collisions
      // Format: {datasetId}_{uuid}_{originalName}
      // ⚠️ CAUTION: This prevents filename collisions when multiple users
      // upload files with the same name
      const uniqueName = `${datasetId}_${uuidv4()}_${originalName}`;
      
      // ✅ Build destination paths to preserve folder grouping
      // For images: ${imagesPath}/${folderName}/${uniqueName}
      // For labels: ${labelsPath}/${folderName}/${uniqueName}
      const destPath = isImage
        ? path.join(imagesPath, folderName, uniqueName)
        : path.join(labelsPath, folderName, uniqueName);

      try {
        // ✅ Ensure folder subdirectory exists
        await storageAdapter.ensureDir(path.dirname(destPath));

        // ✅ Move file from temp to final storage location
        await storageAdapter.saveFile(tempPath, destPath);

        // ✅ Compute storedPath (relative to dataset root)
        const datasetRoot = storageAdapter.buildDatasetPath(company, project, version);
        const storedPath = path.relative(datasetRoot, destPath).replace(/\\/g, '/'); // Normalize to forward slashes

        // ✅ Add file entry to manifest BEFORE saving dataset
        dataset.files.push({
          storedName: uniqueName,
          originalName: originalName,
          type: isImage ? 'image' : 'label',
          size: file.size,
          folder: folderName,
          storedPath: storedPath
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
 * Returns full dataset metadata document with folders summary
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

    // ✅ Compute folders summary (grouped by folder name)
    // This helps the frontend present the separate folders view without extra processing
    const folders = {};
    for (const f of dataset.files) {
      if (!folders[f.folder]) {
        folders[f.folder] = { images: 0, labels: 0, files: [] };
      }
      if (f.type === 'image') folders[f.folder].images++;
      if (f.type === 'label') folders[f.folder].labels++;
      folders[f.folder].files.push({
        storedName: f.storedName,
        originalName: f.originalName,
        type: f.type,
        size: f.size,
        storedPath: f.storedPath
      });
    }

    // ✅ Include folders summary in response
    res.json({ ...dataset.toObject(), folders });

  } catch (error) {
    console.error('Get dataset error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/datasets
 * 
 * List all datasets with optional filtering by company/project
 */
const listDatasets = async (req, res) => {
  try {
    const { company, project } = req.query;

    // ✅ Build query filter
    const filter = { deletedAt: null }; // Only show non-deleted datasets

    if (company) {
      filter.company = company;
    }

    if (project) {
      filter.project = project;
    }

    // ✅ Find datasets matching filter
    const datasets = await Dataset.find(filter)
      .sort({ createdAt: -1 }) // Newest first
      .select('-files'); // Exclude files array for performance (too large)

    // ✅ Return list of datasets
    res.json({
      datasets: datasets.map(d => ({
        _id: d._id,
        company: d.company,
        project: d.project,
        version: d.version,
        totalImages: d.totalImages,
        sizeBytes: d.sizeBytes,
        status: d.status,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      })),
      count: datasets.length
    });

  } catch (error) {
    console.error('List datasets error:', error);
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

/**
 * GET /api/dataset/:datasetId/folders
 * 
 * Returns folder summary with images/labels counts and size statistics
 */
const getDatasetFolders = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Compute folders summary (grouped by folder name)
    const folders = {};
    let totalSize = 0;

    for (const f of dataset.files) {
      const folderName = f.folder || 'dataset';
      
      if (!folders[folderName]) {
        folders[folderName] = {
          images: 0,
          labels: 0,
          sizeBytes: 0
        };
      }

      if (f.type === 'image') {
        folders[folderName].images++;
      } else if (f.type === 'label') {
        folders[folderName].labels++;
      }
      
      folders[folderName].sizeBytes += f.size;
      totalSize += f.size;
    }

    // ✅ Return folders summary with total statistics
    res.json({
      folders,
      totalFolders: Object.keys(folders).length,
      totalImages: dataset.totalImages,
      totalSizeBytes: totalSize
    });

  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/dataset/:datasetId/files
 * 
 * Returns paginated file manifest with filters and sorting
 */
const getDatasetFiles = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { 
      page = 1, 
      limit = 50, 
      folder, 
      type, 
      sortBy = 'originalName',
      sortOrder = 'asc' 
    } = req.query;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Filter files
    let files = [...dataset.files];
    
    if (folder) {
      files = files.filter(f => f.folder === folder);
    }
    
    if (type) {
      files = files.filter(f => f.type === type);
    }

    // ✅ Sort files
    const sortMultiplier = sortOrder === 'desc' ? -1 : 1;
    files.sort((a, b) => {
      const aVal = a[sortBy] || '';
      const bVal = b[sortBy] || '';
      return aVal.localeCompare(bVal) * sortMultiplier;
    });

    // ✅ Paginate
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedFiles = files.slice(startIndex, endIndex);

    // ✅ Return paginated results
    res.json({
      files: paginatedFiles,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: files.length,
        totalPages: Math.ceil(files.length / limitNum)
      },
      filters: {
        folder: folder || null,
        type: type || null
      }
    });

  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/dataset/:datasetId/file/:fileId/thumbnail
 * 
 * Serves thumbnail image if available
 * fileId can be storedName or file _id
 */
const getFileThumbnail = async (req, res) => {
  try {
    const { datasetId, fileId } = req.params;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Find file by storedName or _id
    const file = dataset.files.find(f => 
      f.storedName === fileId || f._id.toString() === fileId
    );

    if (!file || file.type !== 'image') {
      return res.status(404).json({
        error: 'Image file not found'
      });
    }

    // ✅ Build full path to image file
    const datasetRoot = dataset.storagePath;
    const imagePath = path.join(datasetRoot, file.storedPath);

    // ✅ Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        error: 'Image file not found on disk'
      });
    }

    // ✅ Serve image file
    res.sendFile(path.resolve(imagePath));

  } catch (error) {
    console.error('Get thumbnail error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/dataset/:datasetId/dependencies
 * 
 * Get dependencies (training jobs, models, inference jobs) that use this dataset
 * Used for showing confirmation dialog before deletion
 */
const getDatasetDependencies = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Import models for dependency checking
    const TrainingJob = require('../models/TrainingJob');
    const Model = require('../models/Model');
    const InferenceJob = require('../models/InferenceJob');

    // ✅ Find all training jobs using this dataset
    const trainingJobs = await TrainingJob.find({ datasetId });

    // ✅ Find all models trained from this dataset
    const models = await Model.find({ datasetId });

    // ✅ Find all inference jobs using this dataset (test_folder sourceType)
    const inferenceJobs = await InferenceJob.find({ 
      datasetId,
      sourceType: 'test_folder'
    });

    // ✅ Return dependencies
    res.json({
      datasetId,
      dependencies: {
        trainingJobs: trainingJobs.map(job => ({
          jobId: job.jobId,
          status: job.status,
          createdAt: job.createdAt
        })),
        models: models.map(model => ({
          modelId: model.modelId,
          modelVersion: model.modelVersion,
          createdAt: model.createdAt
        })),
        inferenceJobs: inferenceJobs.map(job => ({
          inferenceId: job.inferenceId,
          status: job.status,
          createdAt: job.createdAt
        }))
      },
      hasDependencies: trainingJobs.length > 0 || models.length > 0 || inferenceJobs.length > 0
    });

  } catch (error) {
    console.error('Get dependencies error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * PATCH /api/dataset/:datasetId
 * 
 * Updates dataset company and/or project name
 */
const updateDataset = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { company, project } = req.body;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Validate at least one field is provided
    if (!company && !project) {
      return res.status(400).json({
        error: 'At least one field (company or project) must be provided'
      });
    }

    // ✅ Update fields if provided
    if (company) {
      dataset.company = company;
    }
    
    if (project) {
      dataset.project = project;
    }

    // ✅ Update storage path if company or project changed
    if (company || project) {
      dataset.storagePath = storageAdapter.buildDatasetPath(
        dataset.company,
        dataset.project,
        dataset.version
      );
    }

    await dataset.save();

    // ✅ Return updated dataset
    res.json({
      message: 'Dataset updated successfully',
      dataset: {
        _id: dataset._id,
        company: dataset.company,
        project: dataset.project,
        version: dataset.version,
        storagePath: dataset.storagePath
      }
    });

  } catch (error) {
    console.error('Update dataset error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * DELETE /api/dataset/:datasetId
 * 
 * Soft delete dataset: Delete files but keep MongoDB document
 * References in models/inference jobs will remain but show "Dataset deleted" status
 */
const deleteDataset = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Check if dataset is already deleted
    if (dataset.deletedAt) {
      return res.status(400).json({
        error: 'Dataset is already deleted'
      });
    }

    // ✅ Check if dataset is processing or queued (cannot delete)
    if (dataset.status === 'processing' || dataset.status === 'queued') {
      return res.status(400).json({
        error: 'Cannot delete dataset while it is processing or queued'
      });
    }

    // ✅ Delete files from storage
    if (dataset.storagePath && fs.existsSync(dataset.storagePath)) {
      try {
        fs.rmSync(dataset.storagePath, { recursive: true, force: true });
        console.log(`🗑️ Deleted dataset files: ${dataset.storagePath}`);
      } catch (deleteError) {
        console.error(`⚠️ Failed to delete dataset files: ${deleteError.message}`);
        // Continue with soft delete even if file deletion fails
      }
    }

    // ✅ Soft delete: Mark as deleted but keep document
    dataset.deletedAt = new Date();
    dataset.status = 'failed'; // Mark status as failed to indicate deletion
    await dataset.save();

    // ✅ Return success response
    res.json({
      message: 'Dataset deleted successfully',
      datasetId: dataset._id,
      deletedAt: dataset.deletedAt
    });

  } catch (error) {
    console.error('Delete dataset error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

module.exports = {
  uploadDataset,
  listDatasets,
  getDataset,
  getDatasetStatus,
  getDatasetFolders,
  getDatasetFiles,
  getFileThumbnail,
  getDatasetDependencies,
  updateDataset,
  deleteDataset
};
