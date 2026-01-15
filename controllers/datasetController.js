const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Dataset = require('../models/Dataset');
const Category = require('../models/Category');
const storageAdapter = require('../services/storageAdapter');
const { preprocessingQueue } = require('../queue');
const { generateDataYaml } = require('../utils/yoloConverter');

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
    console.log('[QUEUE-ENQUEUE] Preparing preprocessing job', {
      datasetId,
      redisHost: process.env.REDIS_HOST,
      redisPort: process.env.REDIS_PORT,
      queueName: preprocessingQueue?.name,
    });

    const jobPayload = {
      datasetId: datasetId,
      storagePath: dataset.storagePath,
      company,
      project,
      version
    };

    const job = await preprocessingQueue.add(jobPayload, {
      attempts: 3, // Retry up to 3 times on failure
      backoff: {
        type: 'exponential',
        delay: 2000 // Start with 2s delay, doubles each retry
      }
    });

    console.log('[QUEUE-ENQUEUE] Preprocessing job enqueued', {
      jobId: job.id,
      datasetId,
      queueName: preprocessingQueue.name,
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

    // ✅ Recalculate unlabeled images count dynamically (ensures frontend always shows annotation option if any image is unlabeled)
    // This ensures the count is always current and not stale
    // Training process is unaffected as it uses YOLO .txt files in labels/train folder, not hasLabels flag
    const Image = require('../models/Image');
    const currentUnlabeledCount = await Image.countDocuments({ datasetId, hasLabels: false });
    const currentLabeledCount = await Image.countDocuments({ datasetId, hasLabels: true });
    
    // Create response object with updated counts
    const datasetObject = dataset.toObject();
    datasetObject.unlabeledImages = currentUnlabeledCount;
    datasetObject.labeledImages = currentLabeledCount;

    // ✅ Include folders summary in response
    res.json({ ...datasetObject, folders });

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
 * Serves thumbnail image if available, falls back to original image if thumbnail doesn't exist
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

    // ✅ Decode fileId (Express should decode, but be safe)
    // Handle URL encoding issues (e.g., spaces as %20, special characters)
    const decodedFileId = decodeURIComponent(fileId);
    
    // ✅ Find file by storedName or _id
    // Try exact match first, then try decoded version
    let file = dataset.files.find(f => 
      f.storedName === fileId || f.storedName === decodedFileId || f._id.toString() === fileId
    );
    
    // If still not found, try case-insensitive match (fallback)
    if (!file) {
      const lowerFileId = fileId.toLowerCase();
      const lowerDecodedFileId = decodedFileId.toLowerCase();
      file = dataset.files.find(f => 
        (f.type === 'image' && (
          f.storedName.toLowerCase() === lowerFileId ||
          f.storedName.toLowerCase() === lowerDecodedFileId
        ))
      );
    }

    // ✅ If still not found, try matching by Image document _id
    // This handles cases where frontend passes Image._id instead of dataset.files[i]._id
    if (!file && mongoose.Types.ObjectId.isValid(fileId)) {
      try {
        const Image = require('../models/Image');
        const imageDoc = await Image.findOne({
          _id: fileId,
          datasetId: dataset._id
        }).lean();

        if (imageDoc) {
          // Try to find matching file entry using Image.filename or extracted filename from storedPath
          // Strategy 1: Match by Image.filename
          file = dataset.files.find(f => 
            f.type === 'image' && f.storedName === imageDoc.filename
          );

          // Strategy 2: Extract filename from Image.storedPath
          if (!file && imageDoc.storedPath) {
            const pathParts = imageDoc.storedPath.split('/');
            const imageFilename = pathParts[pathParts.length - 1];
            file = dataset.files.find(f => 
              f.type === 'image' && f.storedName === imageFilename
            );
          }

          // Strategy 3: Try partial match (filename without extension)
          if (!file && imageDoc.filename) {
            const filenameWithoutExt = path.parse(imageDoc.filename).name;
            file = dataset.files.find(f => {
              if (f.type !== 'image') return false;
              const fileBaseName = path.parse(f.storedName).name;
              return fileBaseName === filenameWithoutExt;
            });
          }
        }
      } catch (imageLookupError) {
        // If Image lookup fails, continue to return 404 below
        console.warn(`[getFileThumbnail] Failed to lookup Image document for fileId ${fileId}:`, imageLookupError.message);
      }
    }

    if (!file || file.type !== 'image') {
      // Enhanced error logging for debugging
      console.warn(`[getFileThumbnail] File not found:`, {
        datasetId,
        fileId,
        decodedFileId,
        totalFiles: dataset.files.length,
        imageFiles: dataset.files.filter(f => f.type === 'image').length,
        sampleStoredNames: dataset.files.filter(f => f.type === 'image').slice(0, 3).map(f => f.storedName)
      });
      
      return res.status(404).json({
        error: 'Image file not found'
      });
    }

    // ✅ Build thumbnail path using storageAdapter helper
    const thumbnailPath = storageAdapter.getThumbnailPath(
      dataset.company,
      dataset.project,
      dataset.version,
      file.storedName
    );

    // ✅ Check if thumbnail exists, if not fall back to original image
    const fileToServe = (await storageAdapter.exists(thumbnailPath)) 
      ? thumbnailPath 
      : path.join(dataset.storagePath, file.storedPath);

    // ✅ Verify file exists before serving
    if (!(await storageAdapter.exists(fileToServe))) {
      return res.status(404).json({
        error: 'Image file not found'
      });
    }

    // ✅ Read file content using storageAdapter
    const fileBuffer = await storageAdapter.readFile(fileToServe);

    // ✅ Set appropriate content type for image
    const ext = path.extname(file.storedName).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 
                       ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 
                       'image/jpeg';

    res.set('Content-Type', contentType);
    res.send(fileBuffer);

  } catch (error) {
    console.error('Get thumbnail error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/dataset/:datasetId/file/:fileId
 * 
 * Serves original full-size image (never thumbnail)
 * fileId can be storedName, file _id, or Image document _id
 */
const getFile = async (req, res) => {
  try {
    const { datasetId, fileId } = req.params;

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found'
      });
    }

    // ✅ Decode fileId (Express should decode, but be safe)
    // Handle URL encoding issues (e.g., spaces as %20, special characters)
    const decodedFileId = decodeURIComponent(fileId);
    
    // ✅ Find file by storedName or _id
    // Try exact match first, then try decoded version
    let file = dataset.files.find(f => 
      f.storedName === fileId || f.storedName === decodedFileId || f._id.toString() === fileId
    );
    
    // If still not found, try case-insensitive match (fallback)
    if (!file) {
      const lowerFileId = fileId.toLowerCase();
      const lowerDecodedFileId = decodedFileId.toLowerCase();
      file = dataset.files.find(f => 
        (f.type === 'image' && (
          f.storedName.toLowerCase() === lowerFileId ||
          f.storedName.toLowerCase() === lowerDecodedFileId
        ))
      );
    }

    // ✅ If still not found, try matching by Image document _id
    // This handles cases where frontend passes Image._id instead of dataset.files[i]._id
    if (!file && mongoose.Types.ObjectId.isValid(fileId)) {
      try {
        const Image = require('../models/Image');
        const imageDoc = await Image.findOne({
          _id: fileId,
          datasetId: dataset._id
        }).lean();

        if (imageDoc) {
          // Try to find matching file entry using Image.filename or extracted filename from storedPath
          // Strategy 1: Match by Image.filename
          file = dataset.files.find(f => 
            f.type === 'image' && f.storedName === imageDoc.filename
          );

          // Strategy 2: Extract filename from Image.storedPath
          if (!file && imageDoc.storedPath) {
            const pathParts = imageDoc.storedPath.split('/');
            const imageFilename = pathParts[pathParts.length - 1];
            file = dataset.files.find(f => 
              f.type === 'image' && f.storedName === imageFilename
            );
          }

          // Strategy 3: Try partial match (filename without extension)
          if (!file && imageDoc.filename) {
            const filenameWithoutExt = path.parse(imageDoc.filename).name;
            file = dataset.files.find(f => {
              if (f.type !== 'image') return false;
              const fileBaseName = path.parse(f.storedName).name;
              return fileBaseName === filenameWithoutExt;
            });
          }
        }
      } catch (imageLookupError) {
        // If Image lookup fails, continue to return 404 below
        console.warn(`[getFile] Failed to lookup Image document for fileId ${fileId}:`, imageLookupError.message);
      }
    }

    if (!file || file.type !== 'image') {
      return res.status(404).json({
        error: 'Image file not found'
      });
    }

    // ✅ Always serve the original file (never thumbnail)
    const originalFilePath = path.join(dataset.storagePath, file.storedPath);

    // ✅ Verify file exists before serving
    if (!(await storageAdapter.exists(originalFilePath))) {
      return res.status(404).json({
        error: 'Image file not found'
      });
    }

    // ✅ Read file content using storageAdapter
    const fileBuffer = await storageAdapter.readFile(originalFilePath);

    // ✅ Set appropriate content type for image
    const ext = path.extname(file.storedName).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 
                       ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 
                       'image/jpeg';

    res.set('Content-Type', contentType);
    res.send(fileBuffer);

  } catch (error) {
    console.error('Get file error:', error);
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

    // ✅ Calculate counts for frontend compatibility
    const counts = {
      trainingJobs: trainingJobs.length,
      models: models.length,
      inferenceJobs: inferenceJobs.length
    };

    // ✅ Return dependencies
    res.json({
      datasetId,
      counts,
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

    // ✅ Validate datasetId format (MongoDB ObjectId)
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      console.warn(`[DELETE] Invalid dataset ID format: ${datasetId}`);
      return res.status(400).json({
        error: 'Invalid dataset ID format',
        message: 'Dataset ID must be a valid MongoDB ObjectId'
      });
    }

    // ✅ Find dataset by ID
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      console.warn(`[DELETE] Dataset not found: ${datasetId}`);
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId: datasetId
      });
    }

    // ✅ Log deletion attempt
    console.log(`[DELETE] Attempting to delete dataset:`, {
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      status: dataset.status,
      deletedAt: dataset.deletedAt
    });

    // ✅ Check if dataset is already deleted
    if (dataset.deletedAt) {
      console.warn(`[DELETE] Dataset already deleted: ${dataset._id.toString()}`);
      return res.status(400).json({
        error: 'Dataset is already deleted',
        datasetId: dataset._id.toString(),
        deletedAt: dataset.deletedAt
      });
    }

    // ✅ Check if dataset is processing or queued (cannot delete)
    if (dataset.status === 'processing' || dataset.status === 'queued') {
      console.warn(`[DELETE] Cannot delete dataset in ${dataset.status} status: ${dataset._id.toString()}`);
      return res.status(400).json({
        error: 'Cannot delete dataset while it is processing or queued',
        currentStatus: dataset.status,
        message: `Please wait for the dataset to finish processing (current status: ${dataset.status}) before deleting`
      });
    }

    // ✅ Delete files from storage
    if (dataset.storagePath && fs.existsSync(dataset.storagePath)) {
      try {
        fs.rmSync(dataset.storagePath, { recursive: true, force: true });
        console.log(`🗑️ [DELETE] Deleted dataset files: ${dataset.storagePath}`);
      } catch (deleteError) {
        console.error(`⚠️ [DELETE] Failed to delete dataset files: ${deleteError.message}`, {
          storagePath: dataset.storagePath,
          error: deleteError
        });
        // Continue with soft delete even if file deletion fails
      }
    } else {
      console.warn(`[DELETE] Storage path does not exist or is missing: ${dataset.storagePath}`);
    }

    // ✅ Soft delete: Mark as deleted but keep document
    dataset.deletedAt = new Date();
    dataset.status = 'failed'; // Mark status as failed to indicate deletion
    await dataset.save();

    console.log(`✅ [DELETE] Dataset soft deleted successfully:`, {
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      deletedAt: dataset.deletedAt
    });

    // ✅ Return success response
    res.json({
      message: 'Dataset deleted successfully',
      datasetId: dataset._id,
      deletedAt: dataset.deletedAt
    });

  } catch (error) {
    console.error('[DELETE] Delete dataset error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * DELETE /api/dataset/:company/:project/:version
 * 
 * Soft delete dataset by company/project/version identifier
 * Delete files but keep MongoDB document
 * References in models/inference jobs will remain but show "Dataset deleted" status
 * 
 * ⚠️ CAUTION: Cannot delete if:
 * - Dataset is processing or queued
 * - Dataset is already deleted
 */
const deleteDatasetByVersion = async (req, res) => {
  try {
    const { company, project, version } = req.params;

    // ✅ Validate required parameters
    if (!company || !project || !version) {
      console.warn(`[DELETE] Missing required parameters:`, { company, project, version });
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Company, project, and version are required'
      });
    }

    // ✅ Log deletion attempt
    console.log(`[DELETE] Attempting to delete dataset by version:`, {
      company,
      project,
      version
    });

    // ✅ Find dataset by company/project/version
    const dataset = await Dataset.findOne({ 
      company, 
      project, 
      version,
      deletedAt: null // Only find non-deleted datasets
    });

    if (!dataset) {
      console.warn(`[DELETE] Dataset version not found:`, { company, project, version });
      return res.status(404).json({
        error: 'Dataset version not found',
        company,
        project,
        version
      });
    }

    // ✅ Log found dataset details
    console.log(`[DELETE] Found dataset for deletion:`, {
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      status: dataset.status
    });

    // ✅ Check if dataset is already deleted (shouldn't happen due to query filter, but double-check)
    if (dataset.deletedAt) {
      console.warn(`[DELETE] Dataset already deleted: ${dataset._id.toString()}`);
      return res.status(400).json({
        error: 'Dataset is already deleted',
        datasetId: dataset._id.toString(),
        company,
        project,
        version,
        deletedAt: dataset.deletedAt
      });
    }

    // ✅ Check if dataset is processing or queued (cannot delete)
    if (dataset.status === 'processing' || dataset.status === 'queued') {
      console.warn(`[DELETE] Cannot delete dataset in ${dataset.status} status:`, {
        datasetId: dataset._id.toString(),
        company,
        project,
        version,
        status: dataset.status
      });
      return res.status(400).json({
        error: 'Cannot delete dataset while it is processing or queued',
        currentStatus: dataset.status,
        message: `Please wait for the dataset to finish processing (current status: ${dataset.status}) before deleting`,
        company,
        project,
        version
      });
    }

    // ✅ Delete files from storage
    if (dataset.storagePath && fs.existsSync(dataset.storagePath)) {
      try {
        fs.rmSync(dataset.storagePath, { recursive: true, force: true });
        console.log(`🗑️ [DELETE] Deleted dataset files: ${dataset.storagePath}`);
      } catch (deleteError) {
        console.error(`⚠️ [DELETE] Failed to delete dataset files: ${deleteError.message}`, {
          storagePath: dataset.storagePath,
          company,
          project,
          version,
          error: deleteError
        });
        // Continue with soft delete even if file deletion fails
      }
    } else {
      console.warn(`[DELETE] Storage path does not exist or is missing:`, {
        storagePath: dataset.storagePath,
        company,
        project,
        version
      });
    }

    // ✅ Soft delete: Mark as deleted but keep document
    dataset.deletedAt = new Date();
    dataset.status = 'failed'; // Mark status as failed to indicate deletion
    await dataset.save();

    console.log(`✅ [DELETE] Dataset version soft deleted successfully:`, {
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      deletedAt: dataset.deletedAt
    });

    // ✅ Return success response
    res.json({
      message: 'Dataset version deleted successfully',
      datasetId: dataset._id,
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      deletedAt: dataset.deletedAt
    });

  } catch (error) {
    console.error('[DELETE] Delete dataset by version error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/dataset/:datasetId/detected-classes
 * 
 * Returns detected class IDs and default class names for labeled datasets.
 * Used by frontend to prompt user to map class IDs to meaningful names.
 */
const getDetectedClasses = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId: datasetId
      });
    }

    // Find dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId: datasetId
      });
    }

    // Extract class IDs from dataset.labels array
    // Labels are stored as ["class_0", "class_1", "class_2", ...]
    const classIds = [];
    const classNames = [];

    if (dataset.labels && Array.isArray(dataset.labels)) {
      for (const label of dataset.labels) {
        // Extract class ID from "class_0" format
        const match = label.match(/^class_(\d+)$/);
        if (match) {
          const classId = parseInt(match[1], 10);
          if (!isNaN(classId)) {
            classIds.push(classId);
            classNames.push(label);
          }
        }
      }
    }

    // Sort class IDs to ensure consistent order
    const sortedPairs = classIds.map((id, idx) => ({ id, name: classNames[idx] }))
      .sort((a, b) => a.id - b.id);
    
    const sortedClassIds = sortedPairs.map(p => p.id);
    const sortedClassNames = sortedPairs.map(p => p.name);

    // Check if categories already exist
    const existingCategories = await Category.countDocuments({ datasetId });

    // ✅ Build samples array: find one representative image per class ID
    const Image = require('../models/Image');
    const samples = [];
    
    for (const classId of sortedClassIds) {
      try {
        // Find one image that contains this class ID
        // Sort by filename for deterministic selection
        const sampleImage = await Image.findOne({
          datasetId: dataset._id,
          classes: classId // MongoDB query: classId is in the classes array
        }).sort({ filename: 1 }).lean(); // Sort by filename for consistent selection
        
        if (sampleImage) {
          // ✅ Find matching file entry in dataset.files
          // The thumbnail endpoint requires a file entry from dataset.files array
          // We need to match Image document to dataset.files entry
          
          let matchingFile = null;
          
          // Strategy 1: Match by storedName (Image.filename should match dataset.files[i].storedName)
          matchingFile = dataset.files.find(f => 
            f.type === 'image' && f.storedName === sampleImage.filename
          );
          
          // Strategy 2: If not found, extract filename from Image.storedPath and match
          // Image.storedPath format: "images/train/xxx.jpg" or "images/val/xxx.jpg"
          if (!matchingFile && sampleImage.storedPath) {
            const pathParts = sampleImage.storedPath.split('/');
            const imageFilename = pathParts[pathParts.length - 1]; // Get last part (filename)
            matchingFile = dataset.files.find(f => 
              f.type === 'image' && f.storedName === imageFilename
            );
          }
          
          // Strategy 3: Try matching by originalName if available (less reliable but worth trying)
          // This handles cases where storedName might have been transformed
          if (!matchingFile && sampleImage.filename) {
            // Try to find by partial match (filename without extension)
            const filenameWithoutExt = path.parse(sampleImage.filename).name;
            matchingFile = dataset.files.find(f => {
              if (f.type !== 'image') return false;
              const fileBaseName = path.parse(f.storedName).name;
              return fileBaseName === filenameWithoutExt;
            });
          }
          
          // ✅ Only add sample if we found a matching file entry in dataset.files
          // This ensures the thumbnail URL will work with getFileThumbnail
          if (matchingFile) {
            // Use storedName for thumbnail URL (more reliable than _id for subdocuments)
            // getFileThumbnail accepts both f.storedName and f._id.toString()
            // Using storedName is safer because it's always a string and explicitly defined
            const fileId = matchingFile.storedName;
            
            if (!fileId) {
              console.warn(`[getDetectedClasses] Matching file found but has no storedName for Image ${sampleImage._id} (filename: ${sampleImage.filename})`);
            } else {
              samples.push({
                classId: classId,
                imageId: sampleImage._id.toString(),
                filename: sampleImage.filename,
                thumbnailUrl: `/api/dataset/${datasetId}/file/${fileId}/thumbnail`
              });
              
              // Debug logging to verify matching
              console.log(`[getDetectedClasses] Found sample for class ${classId}: Image=${sampleImage.filename}, FileStoredName=${matchingFile.storedName}, ThumbnailUrl=/api/dataset/${datasetId}/file/${fileId}/thumbnail`);
            }
          } else {
            // Log detailed warning to help diagnose matching issues
            console.warn(`[getDetectedClasses] Could not find matching dataset.files entry for Image ${sampleImage._id}`);
            console.warn(`  - Image filename: ${sampleImage.filename}`);
            console.warn(`  - Image storedPath: ${sampleImage.storedPath || 'N/A'}`);
            console.warn(`  - Total files in dataset: ${dataset.files.length}`);
            console.warn(`  - Image files in dataset: ${dataset.files.filter(f => f.type === 'image').length}`);
            
            // Try to find any similar filenames for debugging
            const similarFiles = dataset.files.filter(f => 
              f.type === 'image' && 
              (f.storedName.includes(sampleImage.filename) || sampleImage.filename.includes(f.storedName))
            );
            if (similarFiles.length > 0) {
              console.warn(`  - Similar files found: ${similarFiles.map(f => f.storedName).join(', ')}`);
            }
          }
        }
      } catch (sampleError) {
        // If query fails for a class, skip it (don't break the entire response)
        console.warn(`Failed to find sample image for class ${classId}:`, sampleError.message);
      }
    }

    // Build response (keep existing fields for backward compatibility)
    const response = {
      datasetId: dataset._id.toString(),
      classIds: sortedClassIds,
      classNames: sortedClassNames,
      totalClasses: sortedClassIds.length,
      hasCategories: existingCategories > 0
    };

    // Only include samples if we found any (optional field for backward compatibility)
    if (samples.length > 0) {
      response.samples = samples;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting detected classes:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
};

/**
 * POST /api/dataset/:datasetId/create-categories-from-classes
 * 
 * Creates Category documents from detected class IDs using user-provided names.
 * Also updates data.yaml and creates class-mapping.json.
 */
const createCategoriesFromClasses = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { classMappings } = req.body;

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId: datasetId
      });
    }

    // Validate request body
    if (!classMappings || typeof classMappings !== 'object') {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'classMappings is required and must be an object'
      });
    }

    // Find dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId: datasetId
      });
    }

    // Check if categories already exist
    const existingCategories = await Category.countDocuments({ datasetId });
    if (existingCategories > 0) {
      return res.status(400).json({
        error: 'Categories already exist for this dataset',
        message: 'Cannot create categories - they already exist'
      });
    }

    // Extract class IDs from dataset.labels to validate
    const detectedClassIds = [];
    if (dataset.labels && Array.isArray(dataset.labels)) {
      for (const label of dataset.labels) {
        const match = label.match(/^class_(\d+)$/);
        if (match) {
          const classId = parseInt(match[1], 10);
          if (!isNaN(classId)) {
            detectedClassIds.push(classId);
          }
        }
      }
    }

    // Validate that all provided class IDs exist in detected classes
    const providedClassIds = Object.keys(classMappings).map(id => parseInt(id, 10));
    const invalidClassIds = providedClassIds.filter(id => !detectedClassIds.includes(id));
    
    if (invalidClassIds.length > 0) {
      return res.status(400).json({
        error: 'Validation Error',
        message: `Invalid class IDs: ${invalidClassIds.join(', ')}. Expected class IDs: [${detectedClassIds.sort((a, b) => a - b).join(', ')}]`
      });
    }

    // Color palette for categories
    const colorPalette = [
      '#ef4444', // Red
      '#10b981', // Green
      '#3b82f6', // Blue
      '#f59e0b', // Orange
      '#8b5cf6', // Purple
      '#ec4899', // Pink
      '#06b6d4', // Cyan
      '#84cc16', // Lime
      '#f97316', // Orange
      '#6366f1'  // Indigo
    ];

    // System user ID (same as used in categoryController)
    const SYSTEM_USER_ID = new mongoose.Types.ObjectId('000000000000000000000000');

    // Create categories in order (sorted by class ID)
    const sortedClassIds = detectedClassIds.sort((a, b) => a - b);
    const createdCategories = [];

    for (let i = 0; i < sortedClassIds.length; i++) {
      const classId = sortedClassIds[i];
      const providedName = classMappings[classId.toString()];
      
      // Use provided name if available, otherwise use class_X
      const categoryName = providedName && providedName.trim() 
        ? providedName.trim() 
        : `class_${classId}`;

      // Check for duplicate names within this batch
      const isDuplicate = createdCategories.some(cat => cat.name === categoryName);
      if (isDuplicate) {
        return res.status(400).json({
          error: 'Validation Error',
          message: `Duplicate category name: "${categoryName}". Each class must have a unique name.`
        });
      }

      const category = new Category({
        datasetId: dataset._id,
        name: categoryName,
        color: colorPalette[i % colorPalette.length],
        description: `Imported from class ID ${classId}`,
        order: i,
        createdBy: SYSTEM_USER_ID
      });

      await category.save();
      createdCategories.push({
        id: category._id,
        name: category.name,
        color: category.color,
        order: category.order
      });
    }

    // Get all categories (ordered) to update data.yaml
    const allCategories = await Category.getOrderedCategories(datasetId);

    // Build dataset path
    const datasetPath = storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version);

    // Update data.yaml with actual category names
    const dataYamlPath = path.join(datasetPath, 'data.yaml');
    const dataYamlContent = generateDataYaml(allCategories, datasetPath);
    await fsPromises.writeFile(dataYamlPath, dataYamlContent, 'utf8');

    // Create class-mapping.json file
    const classMappingPath = path.join(datasetPath, 'class-mapping.json');
    const classMapping = {};
    sortedClassIds.forEach((classId, index) => {
      const category = allCategories[index];
      classMapping[classId.toString()] = category.name;
    });
    await fsPromises.writeFile(classMappingPath, JSON.stringify(classMapping, null, 2), 'utf8');

    return res.status(200).json({
      message: 'Categories created from class IDs successfully',
      createdCount: createdCategories.length,
      classes: sortedClassIds,
      categories: createdCategories
    });

  } catch (error) {
    console.error('Error creating categories from classes:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
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
  getFile,
  getDatasetDependencies,
  updateDataset,
  deleteDataset,
  deleteDatasetByVersion,
  getDetectedClasses,
  createCategoriesFromClasses
};
