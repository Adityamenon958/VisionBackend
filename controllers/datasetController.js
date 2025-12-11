const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Dataset = require('../models/Dataset');
const storageAdapter = require('../services/storageAdapter');
const datasetService = require('../services/datasetService');
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
        id: f._id.toString(),
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
 * List all datasets with optional filtering by company, project, and status
 * Query params: ?company=xxx&project=xxx&status=ready (all optional)
 */
const listDatasets = async (req, res) => {
  try {
    const { company, project, status } = req.query;

    // Build query filter
    const filter = {};
    if (company) filter.company = company;
    if (project) filter.project = project;
    if (status) filter.status = status;

    // Find datasets
    const datasets = await Dataset.find(filter)
      .sort({ createdAt: -1 }) // Newest first
      .select('_id company project version status totalImages trainCount valCount testCount sizeBytes labels createdAt')
      .lean();

    return res.status(200).json({
      datasets: datasets,
      total: datasets.length
    });

  } catch (error) {
    console.error('List datasets error:', error);
    return res.status(500).json({
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
 * GET /api/dataset/:datasetId/file/:fileId/thumbnail
 * 
 * Serves thumbnail image if available
 * fileId is the storedName of the file
 */
const getFileThumbnail = async (req, res) => {
  try {
    const { datasetId, fileId } = req.params;

    // Find dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // Find file in dataset
    const file = dataset.files.find(f => f.storedName === fileId || f._id.toString() === fileId);
    if (!file) {
      return res.status(404).json({
        error: 'File not found in dataset'
      });
    }

    // Only serve thumbnails for images
    if (file.type !== 'image') {
      return res.status(400).json({
        error: 'Thumbnails are only available for image files'
      });
    }

    // Build thumbnail path
    const thumbnailPath = storageAdapter.getThumbnailPath(
      dataset.company,
      dataset.project,
      dataset.version,
      file.storedName
    );

    // Check if thumbnail exists
    if (!await storageAdapter.exists(thumbnailPath)) {
      return res.status(404).json({
        error: 'Thumbnail not found'
      });
    }

    // Serve thumbnail file
    res.sendFile(thumbnailPath);

  } catch (error) {
    console.error('Get thumbnail error:', error);
    return res.status(500).json({
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

    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    const folders = datasetService.buildFoldersSummary(dataset);

    return res.status(200).json({
      datasetId: dataset._id.toString(),
      folders: folders
    });

  } catch (error) {
    console.error('Get folders error:', error);
    return res.status(500).json({
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
    const { folder, type, sort = 'name', order = 'asc', page = 1, limit = 50 } = req.query;

    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    const result = await datasetService.filterAndPaginateFiles(dataset, {
      folder,
      type,
      sort,
      order,
      page: parseInt(page),
      limit: Math.min(parseInt(limit) || 50, 500)
    });

    // Add thumbnail availability info for images
    const itemsWithThumbnails = await Promise.all(
      result.items.map(async (file) => {
        const item = {
          id: file._id.toString(),
          storedName: file.storedName,
          originalName: file.originalName,
          type: file.type,
          size: file.size,
          folder: file.folder,
          storedPath: file.storedPath
        };

        // Check if thumbnail exists for images
        if (file.type === 'image') {
          item.thumbnailAvailable = await datasetService.checkThumbnailExists(
            dataset.company,
            dataset.project,
            dataset.version,
            file.storedName
          );
        }

        return item;
      })
    );

    return res.status(200).json({
      datasetId: dataset._id.toString(),
      items: itemsWithThumbnails,
      total: result.total,
      page: parseInt(page),
      limit: parseInt(limit) || 50
    });

  } catch (error) {
    console.error('Get files error:', error);
    return res.status(500).json({
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

    // Validate datasetId
    if (!datasetId) {
      return res.status(400).json({
        error: 'Missing required parameter: datasetId'
      });
    }

    // Find dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // Validate at least one field to update
    if (!company && !project) {
      return res.status(400).json({
        error: 'At least one field (company or project) must be provided'
      });
    }

    // Validate fields are not empty
    if (company !== undefined && (!company || company.trim() === '')) {
      return res.status(400).json({
        error: 'Company name cannot be empty'
      });
    }

    if (project !== undefined && (!project || project.trim() === '')) {
      return res.status(400).json({
        error: 'Project name cannot be empty'
      });
    }

    // Check if dataset is processing (can't rename while processing)
    if (dataset.status === 'processing' || dataset.status === 'queued') {
      return res.status(409).json({
        error: 'Cannot update dataset while it is being processed',
        currentStatus: dataset.status
      });
    }

    const oldCompany = dataset.company;
    const oldProject = dataset.project;
    const newCompany = company || oldCompany;
    const newProject = project || oldProject;

    // Check for conflicts (duplicate company/project/version)
    if (newCompany !== oldCompany || newProject !== oldProject) {
      const existing = await Dataset.findOne({
        company: newCompany,
        project: newProject,
        version: dataset.version,
        _id: { $ne: dataset._id }
      });

      if (existing) {
        return res.status(409).json({
          error: 'A dataset with this company, project, and version already exists',
          conflictingDatasetId: existing._id.toString()
        });
      }
    }

    // Cancel any active preprocessing jobs for this dataset
    // (This would require checking the queue, but for now we'll just update)

    // Update storage path if company or project changed
    if (newCompany !== oldCompany || newProject !== oldProject) {
      const oldPath = dataset.storagePath;
      const newPath = storageAdapter.buildDatasetPath(newCompany, newProject, dataset.version);

      // Rename directory on disk
      try {
        await storageAdapter.renameDirectory(oldPath, newPath);
        dataset.storagePath = newPath;
      } catch (error) {
        console.error('Error renaming directory:', error);
        return res.status(500).json({
          error: 'Failed to rename dataset directory',
          message: error.message
        });
      }
    }

    // Update dataset fields
    if (company) dataset.company = company.trim();
    if (project) dataset.project = project.trim();

    await dataset.save();

    return res.status(200).json({
      message: 'Dataset updated successfully',
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      storagePath: dataset.storagePath
    });

  } catch (error) {
    console.error('Update dataset error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

module.exports = {
  uploadDataset,
  getDataset,
  getDatasetStatus,
  listDatasets,
  getFileThumbnail,
  getDatasetFolders,
  getDatasetFiles,
  updateDataset
};