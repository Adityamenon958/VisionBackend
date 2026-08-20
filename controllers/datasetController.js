const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const Dataset = require('../models/Dataset');
const Category = require('../models/Category');
const Annotation = require('../models/Annotation');
const Image = require('../models/Image');
const storageAdapter = require('../services/storageAdapter');
const { preprocessingQueue, augmentationQueue } = require('../queue');
const { generateDataYaml } = require('../utils/yoloConverter');
const auditService = require('../services/auditService');
const { buildWorkspaceFilter, validateWorkspaceAccess, canAccessAllWorkspaces } = require('../utils/workspaceScoping');
const { sanitizeString } = require('../middleware/xssSanitizer');

/**
 * Derive labelSource for frontend badges (Unlabeled, Pre-Labelled, Manually Labelled).
 * Augmented datasets use stored labelSource; non-augmented derive from status/datasetType.
 */
function getLabelSource(dataset) {
  if (dataset.isAugmented && dataset.labelSource) return dataset.labelSource;
  const dt = dataset.datasetType ?? (dataset.status === 'ready_to_train' ? 'labeled' : null);
  if (dt === 'unlabeled') return 'unlabeled';
  if (dataset.status === 'ready_to_train') return 'manually_labeled';
  if (dataset.status === 'ready' && dt === 'labeled') return 'pre_labelled';
  return null;
}

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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this workspace'
        });
      }
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
        // Build map for fast lookup (sanitize folder names)
        for (const m of fileMeta) {
          if (m && m.originalName) {
            const folder = m.folder || 'dataset';
            // ✅ Sanitize folder name before using it
            fileMetaMap[m.originalName] = sanitizeString(folder);
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

    // ✅ Hash cache: same baseName (image+label pair) → same hash, compute once per pair
    const hashCache = new Map();

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

      // ✅ Generate unique filename using 12-char hash (avoids Windows 260-char path limit)
      // Image+label pairs share same base name → same hash (YOLO expects matching base names)
      // Cache hash per baseName to avoid recomputing for image+label pairs (~2x faster)
      const baseName = path.parse(originalName).name;
      let hash = hashCache.get(baseName);
      if (hash === undefined) {
        const hashInput = `${datasetId}_${baseName}`;
        hash = crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 12);
        hashCache.set(baseName, hash);
      }
      const uniqueName = `${hash}${ext}`;
      
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

    // ================= DATASET LIFECYCLE METADATA =================
    // Decide datasetType / annotationStatus / unlabeledImagesCount based on
    // whether any label files (.txt) were uploaded for this dataset version.
    const hasLabelFiles = dataset.files.some((f) => f.type === 'label');
    if (hasLabelFiles) {
      // Labeled dataset: labels are present at upload time (pre-labelled).
      dataset.datasetType = 'labeled';
      dataset.annotationStatus = null; // Not used for labeled datasets
      dataset.labelSource = 'pre_labelled';
      dataset.unlabeledImagesCount = 0;
    } else {
      // Unlabeled dataset: no label files yet; will go through annotation flow.
      dataset.datasetType = 'unlabeled';
      dataset.annotationStatus = 'pending';
      dataset.labelSource = 'unlabeled';
      dataset.unlabeledImagesCount = totalImages;
    }
    // ==============================================================

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

    // Log dataset upload activity
    await auditService.logAction({
      action: 'create',
      resourceType: 'dataset',
      resourceId: datasetId,
      details: {
        company: company,
        project: project,
        datasetName: `${company}/${project}/${version}`,
        projectName: project,
        totalImages: totalImages
      },
      req
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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, dataset.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this dataset'
        });
      }
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

    // ✅ Compute labeledImages / unlabeledImages
    // IMPORTANT: split folders (train/val/test) exist for both labeled and unlabeled datasets after preprocessing.
    // Do not infer "labeled" from split presence. Use dataset lifecycle metadata first.
    let currentLabeledCount;
    let currentUnlabeledCount;

    const derivedLabelSource = getLabelSource(dataset);
    const totalImages = dataset.totalImages ?? 0;
    const splitTotal = (dataset.trainCount ?? 0) + (dataset.valCount ?? 0) + (dataset.testCount ?? 0);

    if (derivedLabelSource === 'unlabeled' || dataset.datasetType === 'unlabeled') {
      // Unlabeled uploads should remain annotatable regardless of split folders.
      currentLabeledCount = 0;
      currentUnlabeledCount = totalImages;
    } else if (
      derivedLabelSource === 'pre_labelled' ||
      derivedLabelSource === 'manually_labeled' ||
      dataset.datasetType === 'labeled'
    ) {
      // Labeled datasets are fully labeled at dataset level.
      currentLabeledCount = totalImages;
      currentUnlabeledCount = 0;
    } else if (dataset.isAugmented) {
      // Augmented datasets inherit labels from source and are treated as labeled.
      currentLabeledCount = splitTotal > 0 ? splitTotal : totalImages;
      currentUnlabeledCount = 0;
    } else {
      // Fallback for legacy records with missing lifecycle metadata.
      const Image = require('../models/Image');
      currentUnlabeledCount = await Image.countDocuments({ datasetId, hasLabels: false });
      currentLabeledCount = await Image.countDocuments({ datasetId, hasLabels: true });
    }

    // Create response object with updated counts
    const datasetObject = dataset.toObject();
    datasetObject.labeledImages = currentLabeledCount;
    datasetObject.unlabeledImages = currentUnlabeledCount;
    datasetObject.labeled_images = currentLabeledCount;
    datasetObject.unlabeled_images = currentUnlabeledCount;
    // ✅ Ensure frontend badge fields (datasetType, annotationStatus, is_augmented, labelSource)
    datasetObject.datasetType = dataset.datasetType ?? (dataset.status === 'ready_to_train' ? 'labeled' : null);
    datasetObject.annotationStatus = dataset.annotationStatus ?? null;
    datasetObject.is_augmented = dataset.isAugmented ?? false;
    let labelSource = getLabelSource(dataset);
    if (dataset.isAugmented && !labelSource && dataset.backupDatasetId) {
      const source = await Dataset.findById(dataset.backupDatasetId).select('status labelSource').lean();
      labelSource = source?.labelSource ?? (source?.status === 'ready_to_train' ? 'manually_labeled' : 'pre_labelled');
    }
    datasetObject.labelSource = labelSource;
    datasetObject.backup_dataset_id = dataset.backupDatasetId ? dataset.backupDatasetId.toString() : null;
    datasetObject.augmentedFromVersion = dataset.augmentedFromVersion || null;

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

    // Optional: filter by isActive (default: show all, but frontend can filter)
    // If includeInactive query param is not set, prefer active datasets
    const includeInactive = req.query.includeInactive === 'true';
    if (!includeInactive) {
      // By default, only show active datasets (augmented dataset replaces original)
      filter.isActive = true;
    }

    // ✅ Find datasets matching filter
    const datasets = await Dataset.find(filter)
      .sort({ createdAt: -1 }) // Newest first
      .select('-files'); // Exclude files array for performance (too large)

    // ✅ For augmented datasets with null labelSource (created before fix), fetch source to derive correct labelSource
    const augmentedWithoutLabelSource = datasets.filter(
      (d) => d.isAugmented && !d.labelSource && d.backupDatasetId
    );
    const sourceLabelSourceMap = new Map();
    if (augmentedWithoutLabelSource.length > 0) {
      const sourceIds = [...new Set(augmentedWithoutLabelSource.map((d) => d.backupDatasetId.toString()))];
      const sources = await Dataset.find({ _id: { $in: sourceIds } })
        .select('_id status labelSource')
        .lean();
      for (const src of sources) {
        const ls = src.labelSource ?? (src.status === 'ready_to_train' ? 'manually_labeled' : 'pre_labelled');
        sourceLabelSourceMap.set(src._id.toString(), ls);
      }
    }

    // ✅ Unique image counts from Image index (fixes inflated totalImages when train/test overlapped)
    const datasetIds = datasets.map((d) => d._id);
    const uniqueCountByDatasetId = new Map();
    if (datasetIds.length > 0) {
      const uniqueAgg = await Image.aggregate([
        { $match: { datasetId: { $in: datasetIds } } },
        {
          $group: {
            _id: {
              datasetId: '$datasetId',
              filename: { $toLower: { $ifNull: ['$filename', ''] } },
            },
          },
        },
        {
          $group: {
            _id: '$_id.datasetId',
            uniqueImages: { $sum: 1 },
          },
        },
      ]);
      for (const row of uniqueAgg) {
        uniqueCountByDatasetId.set(row._id.toString(), row.uniqueImages);
      }
    }

    // ✅ Return list of datasets (include datasetType, annotationStatus, is_augmented, labelSource for frontend badges)
    const responseDatasets = [];
    for (const d of datasets) {
      let labelSource = getLabelSource(d);
      if (d.isAugmented && !labelSource && d.backupDatasetId) {
        labelSource = sourceLabelSourceMap.get(d.backupDatasetId.toString()) ?? 'pre_labelled';
      }
      const uniqueFromIndex = uniqueCountByDatasetId.get(d._id.toString());
      let totalImages = d.totalImages;
      let trainCount = d.trainCount;
      let valCount = d.valCount;
      let testCount = d.testCount;
      if (typeof uniqueFromIndex === 'number' && uniqueFromIndex > 0) {
        totalImages = uniqueFromIndex;
        const splitSum = (Number(trainCount) || 0) + (Number(valCount) || 0) + (Number(testCount) || 0);
        // ✅ Hide stale split counts when they include overlapping copies (e.g. 84+21+10 > 105)
        if (splitSum > uniqueFromIndex) {
          trainCount = undefined;
          valCount = undefined;
          testCount = undefined;
        }
        // Self-heal stored totalImages when it was inflated by overlapping splits
        if (d.totalImages !== uniqueFromIndex) {
          Dataset.updateOne(
            { _id: d._id },
            { $set: { totalImages: uniqueFromIndex, labeledImages: uniqueFromIndex } },
          ).catch((err) => {
            console.warn('[listDatasets] Could not heal totalImages:', err.message);
          });
        }
      }
      responseDatasets.push({
        _id: d._id,
        company: d.company,
        project: d.project,
        version: d.version,
        totalImages,
        trainCount,
        valCount,
        testCount,
        sizeBytes: d.sizeBytes,
        status: d.status,
        datasetType: d.datasetType ?? (d.status === 'ready_to_train' ? 'labeled' : null),
        annotationStatus: d.annotationStatus ?? null,
        labelSource,
        is_augmented: d.isAugmented ?? false,
        isActive: d.isActive,
        isAugmented: d.isAugmented,
        augmentationStatus: d.augmentationStatus,
        backup_dataset_id: d.backupDatasetId ? d.backupDatasetId.toString() : null,
        augmentedFromVersion: d.augmentedFromVersion || null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      });
    }

    res.json({
      datasets: responseDatasets,
      count: responseDatasets.length
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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, dataset.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this dataset'
        });
      }
    }

    // ✅ Derive labelSource (for augmented with null, fetch source)
    let labelSource = getLabelSource(dataset);
    if (dataset.isAugmented && !labelSource && dataset.backupDatasetId) {
      const source = await Dataset.findById(dataset.backupDatasetId).select('status labelSource').lean();
      labelSource = source?.labelSource ?? (source?.status === 'ready_to_train' ? 'manually_labeled' : 'pre_labelled');
    }

    // ✅ Return minimal status info (good for frequent polling)
    res.json({
      id: dataset._id.toString(),
      status: dataset.status,
      version: dataset.version,
      totalImages: dataset.totalImages,
      sizeBytes: dataset.sizeBytes,
      createdAt: dataset.createdAt,
      uploadErrors: dataset.uploadErrors.length > 0 ? dataset.uploadErrors : undefined,
      datasetType: dataset.datasetType ?? (dataset.status === 'ready_to_train' ? 'labeled' : null),
      annotationStatus: dataset.annotationStatus ?? null,
      labelSource,
      is_augmented: dataset.isAugmented ?? false,
      backup_dataset_id: dataset.backupDatasetId ? dataset.backupDatasetId.toString() : null,
      augmentedFromVersion: dataset.augmentedFromVersion || null,
      // Include preprocessing progress info if processing
      ...(dataset.status === 'processing' && {
        trainCount: dataset.trainCount,
        valCount: dataset.valCount
      }),
      // Augmentation fields for frontend polling
      augmentation_status: dataset.augmentationStatus,
      backup_dataset_id: dataset.backupDatasetId || null,
      augmentation_error: dataset.augmentationError || null,
      // Active dataset flag (indicates if this is the active version for the project)
      is_active: dataset.isActive
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
 * GET /api/dataset/:datasetId/annotation-summary
 *
 * Returns high-level annotation progress summary for a dataset.
 * This endpoint is additive and does not change existing behavior.
 */
const getAnnotationSummary = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId
      });
    }

    // Find dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found',
        datasetId
      });
    }

    // Use Image model to compute annotation-based counts (independent of hasLabels)
    const Image = require('../models/Image');

    const allImages = await Image.find({ datasetId }).select('filename storedPath hasAnnotations').lean();
    // ✅ Unique by filename so overlapping train/test copies don't inflate totals
    const byFilename = new Map();
    for (const img of allImages) {
      const key = String(img.filename || path.basename(img.storedPath || '') || img._id).toLowerCase();
      const existing = byFilename.get(key);
      if (!existing || (img.hasAnnotations && !existing.hasAnnotations)) {
        byFilename.set(key, img);
      }
    }
    const unique = Array.from(byFilename.values());
    const totalImages = unique.length;
    const annotatedImages = unique.filter((i) => i.hasAnnotations === true).length;
    const unannotatedImages = totalImages - annotatedImages;

    return res.status(200).json({
      datasetId,
      totalImages,
      annotatedImages,
      unannotatedImages
    });
  } catch (error) {
    console.error('Get annotation summary error:', error);
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
    // Include totalFiles/filesCount/firstFile for frontend compatibility (DatasetManager expects these)
    const firstFile = paginatedFiles.find(f => f.type === 'image') || paginatedFiles[0];
    res.json({
      files: paginatedFiles,
      totalFiles: files.length,
      filesCount: paginatedFiles.length,
      firstFile: firstFile || null,
      firstFileId: firstFile ? (firstFile.storedName || firstFile._id?.toString()) : undefined,
      firstFileThumbnailAvailable: firstFile && firstFile.type === 'image',
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
 * Serves dataset file by type:
 * - Image: original full-size image (Content-Type by extension)
 * - Label (e.g. .txt): raw file content as text/plain; charset=utf-8
 * fileId can be storedName, file _id, or (for images) Image document _id
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

    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // ✅ Resolve path and verify file exists
    const originalFilePath = path.join(dataset.storagePath, file.storedPath);
    if (!(await storageAdapter.exists(originalFilePath))) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    const fileBuffer = await storageAdapter.readFile(originalFilePath);

    // ✅ Branch by file type: image (binary) or label (text/plain)
    if (file.type === 'label') {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(fileBuffer);
      return;
    }

    if (file.type === 'image') {
      const ext = path.extname(file.storedName).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' :
                         ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                         'image/jpeg';
      res.set('Content-Type', contentType);
      res.send(fileBuffer);
      return;
    }

    return res.status(404).json({
      error: 'File not found'
    });

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
    const trainingJobs = await TrainingJob.find({ datasetId }).select('jobId status createdAt');

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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, dataset.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this dataset'
        });
      }
    }

    // ✅ Validate at least one field is provided
    if (!company && !project) {
      return res.status(400).json({
        error: 'At least one field (company or project) must be provided'
      });
    }

    // ✅ If updating company, validate workspace access to new company
    if (company && company !== dataset.company && !canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to the new workspace'
        });
      }
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

    // ✅ Validate workspace access (same as delete by version)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, dataset.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this dataset'
        });
      }
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

    // ✅ Block delete when augmentation is running (source dataset is in use)
    if (dataset.augmentationStatus === 'running') {
      console.warn(`[DELETE] Cannot delete dataset while augmentation is running: ${dataset._id.toString()}`);
      return res.status(400).json({
        error: 'Cannot delete dataset while augmentation is running',
        message: 'Wait for augmentation to finish or cancel it before deleting this dataset'
      });
    }

    // ✅ Delete files from storage (local or Azure via adapter)
    const dirPathToDelete = path.normalize(storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version));
    const deleteResult = await storageAdapter.deleteDirectory(dirPathToDelete);

    if (!deleteResult.deleted) {
      console.error(`[DELETE] Failed to delete dataset files: ${deleteResult.error}`, { dirPath: dirPathToDelete });
      return res.status(500).json({
        error: 'Failed to delete dataset files',
        message: deleteResult.error || 'Storage deletion failed. Dataset was not deleted.'
      });
    }
    console.log(`🗑️ [DELETE] Deleted dataset files: ${dirPathToDelete}`);

    // ✅ Delete related metadata (annotations, categories, images)
    const datasetIdObj = dataset._id;
    await Annotation.deleteMany({ datasetId: datasetIdObj });
    await Category.deleteMany({ datasetId: datasetIdObj });
    await Image.deleteMany({ datasetId: datasetIdObj });

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

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this workspace'
        });
      }
    }

    // ✅ Log deletion attempt
    console.log(`[DELETE] Attempting to delete dataset by version:`, {
      company,
      project,
      version
    });

    // ✅ Find dataset by company/project/version (case-insensitive)
    const dataset = await Dataset.findOne({ company, project, version, deletedAt: null })
      .collation({ locale: 'en', strength: 2 });

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

    // ✅ Block delete when augmentation is running
    if (dataset.augmentationStatus === 'running') {
      console.warn(`[DELETE] Cannot delete dataset while augmentation is running:`, { company, project, version });
      return res.status(400).json({
        error: 'Cannot delete dataset while augmentation is running',
        message: 'Wait for augmentation to finish or cancel it before deleting this dataset',
        company,
        project,
        version
      });
    }

    // ✅ Delete files from storage (local or Azure via adapter)
    const dirPathToDelete = path.normalize(storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version));
    const deleteResult = await storageAdapter.deleteDirectory(dirPathToDelete);

    if (!deleteResult.deleted) {
      console.error(`[DELETE] Failed to delete dataset files (by version): ${deleteResult.error}`, { dirPath: dirPathToDelete });
      return res.status(500).json({
        error: 'Failed to delete dataset files',
        message: deleteResult.error || 'Storage deletion failed. Dataset was not deleted.',
        company,
        project,
        version
      });
    }
    console.log(`🗑️ [DELETE] Deleted dataset files: ${dirPathToDelete}`);

    // ✅ Delete related metadata (annotations, categories, images)
    await Annotation.deleteMany({ datasetId: dataset._id });
    await Category.deleteMany({ datasetId: dataset._id });
    await Image.deleteMany({ datasetId: dataset._id });

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
 * Parse YOLO label file and extract unique class IDs.
 * Format: class_id center_x center_y width height (per line)
 * @param {string} content - File content as string
 * @returns {number[]} Sorted unique class IDs
 */
function parseYoloLabelContent(content) {
  const classIds = new Set();
  const lines = (content || '').trim().split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5) {
      const classId = parseInt(parts[0], 10);
      if (!isNaN(classId) && classId >= 0) classIds.add(classId);
    }
  }
  return Array.from(classIds).sort((a, b) => a - b);
}

/**
 * GET /api/dataset/:datasetId/detected-classes
 * 
 * Returns detected class IDs and default class names for labeled datasets.
 * Used by frontend to prompt user to map class IDs to meaningful names.
 * 
 * Sources (in order):
 * 1. dataset.labels (populated by preprocessing when status=ready)
 * 2. Fallback: parse label files from dataset.files (handles pre-processing or when labels not yet populated)
 * 3. Fallback: parse labels/train, labels/val, labels/test on disk (local storage only)
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

    // Extract class IDs from dataset.labels array (populated by preprocessing)
    // Labels are stored as ["class_0", "class_1", "class_2", ...]
    let classIds = [];
    let classNames = [];

    if (dataset.labels && Array.isArray(dataset.labels) && dataset.labels.length > 0) {
      for (const label of dataset.labels) {
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

    // Fallback: parse label files when dataset.labels is empty (e.g. before processing, or Azure where preprocessing skips label extraction)
    if (classIds.length === 0 && dataset.storagePath && dataset.files && dataset.files.length > 0) {
      const labelFiles = dataset.files.filter((f) => f.type === 'label' && f.storedPath);
      const allClassIds = new Set();
      for (const file of labelFiles) {
        try {
          const fullPath = path.join(dataset.storagePath, file.storedPath);
          if (await storageAdapter.exists(fullPath)) {
            const buffer = await storageAdapter.readFile(fullPath);
            const content = buffer.toString('utf-8');
            const ids = parseYoloLabelContent(content);
            ids.forEach((id) => allClassIds.add(id));
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
      if (allClassIds.size > 0) {
        classIds = Array.from(allClassIds).sort((a, b) => a - b);
        classNames = classIds.map((id) => `class_${id}`);
      }
    }

    // Fallback 2: parse labels/train, labels/val, labels/test on disk (local storage)
    if (classIds.length === 0 && dataset.storagePath && fs.existsSync(dataset.storagePath)) {
      const allClassIds = new Set();
      for (const split of ['train', 'val', 'test']) {
        const splitPath = path.join(dataset.storagePath, 'labels', split);
        try {
          const entries = await fsPromises.readdir(splitPath, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.isFile() && ent.name.endsWith('.txt')) {
              const labelPath = path.join(splitPath, ent.name);
              const content = await fsPromises.readFile(labelPath, 'utf-8');
              const ids = parseYoloLabelContent(content);
              ids.forEach((id) => allClassIds.add(id));
            }
          }
        } catch {
          // Folder may not exist
        }
      }
      if (allClassIds.size > 0) {
        classIds = Array.from(allClassIds).sort((a, b) => a - b);
        classNames = classIds.map((id) => `class_${id}`);
      }
    }

    // Fallback 3: recursively walk labels/ folder (handles labels/good/, labels/dataset/, etc. when dataset.files empty)
    if (classIds.length === 0 && dataset.storagePath && fs.existsSync(dataset.storagePath)) {
      const labelsRoot = path.join(dataset.storagePath, 'labels');
      const allClassIds = new Set();
      async function walkLabels(dir) {
        try {
          const entries = await fsPromises.readdir(dir, { withFileTypes: true });
          for (const ent of entries) {
            const fullPath = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              await walkLabels(fullPath);
            } else if (ent.isFile() && ent.name.endsWith('.txt')) {
              const content = await fsPromises.readFile(fullPath, 'utf-8');
              const ids = parseYoloLabelContent(content);
              ids.forEach((id) => allClassIds.add(id));
            }
          }
        } catch {
          // Ignore
        }
      }
      if (fs.existsSync(labelsRoot)) {
        await walkLabels(labelsRoot);
      }
      if (allClassIds.size > 0) {
        classIds = Array.from(allClassIds).sort((a, b) => a - b);
        classNames = classIds.map((id) => `class_${id}`);
      }
    }

    // Sort class IDs to ensure consistent order
    const sortedPairs = classIds.map((id, idx) => ({ id, name: classNames[idx] }))
      .sort((a, b) => a.id - b.id);
    
    const sortedClassIds = sortedPairs.map(p => p.id);
    const sortedClassNames = sortedPairs.map(p => p.name);

    // Check if categories already exist
    const existingCategories = await Category.countDocuments({ datasetId });

    // Debug: log when no classes found (helps diagnose empty detected-classes)
    if (sortedClassIds.length === 0) {
      const labelsRoot = dataset.storagePath ? path.join(dataset.storagePath, 'labels') : null;
      console.warn(`[getDetectedClasses] No classes found for dataset ${datasetId}:`, {
        status: dataset.status,
        isAugmented: dataset.isAugmented,
        filesCount: dataset.files?.length ?? 0,
        labelFilesCount: dataset.files?.filter(f => f.type === 'label').length ?? 0,
        storagePathExists: dataset.storagePath ? fs.existsSync(dataset.storagePath) : false,
        labelsFolderExists: labelsRoot ? fs.existsSync(labelsRoot) : false,
        datasetLabelsLength: dataset.labels?.length ?? 0
      });
    }

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

/**
 * POST /api/dataset/:datasetId/augment
 *
 * Starts augmentation job for a dataset using the augmentation worker.
 * This endpoint is additive and does not change existing upload/preprocessing flows.
 */
const startAugmentation = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { options, versionName: rawVersionName } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        error: 'Invalid dataset ID',
      });
    }

    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found',
      });
    }

    // Validate workspace access
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, dataset.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this dataset',
        });
      }
    }

    // Dataset must be in a ready state
    if (dataset.status !== 'ready' && dataset.status !== 'ready_to_train') {
      return res.status(400).json({
        error: 'Dataset must be annotated/ready before augmentation',
      });
    }

    if (dataset.augmentationStatus === 'running') {
      return res.status(409).json({
        error: 'Augmentation already running for this dataset',
      });
    }

    // Validate and sanitize versionName (required for augmentation)
    const versionName = typeof rawVersionName === 'string' ? rawVersionName.trim() : '';
    if (!versionName) {
      return res.status(400).json({
        error: 'Version name is required.',
      });
    }
    if (versionName.length > 50) {
      return res.status(400).json({
        error: 'Version name must be at most 50 characters.',
      });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(versionName)) {
      return res.status(400).json({
        error: 'Version name may only contain letters, numbers, underscores, and hyphens.',
      });
    }
    if (versionName === dataset.version) {
      return res.status(400).json({
        error: 'Version name cannot be the same as the source version.',
      });
    }
    const existingWithVersion = await Dataset.findOne({
      company: dataset.company,
      project: dataset.project,
      version: versionName,
      deletedAt: null,
    });
    if (existingWithVersion) {
      return res.status(400).json({
        error: 'Version name already exists for this project.',
      });
    }

    // Prepare options with safe defaults
    const targetTrainTotal =
      typeof options?.targetTrainTotal === 'number' && options.targetTrainTotal > 0
        ? options.targetTrainTotal
        : 0; // 0 means "let worker decide" (may use augmentationMultiplier or default)
    const valTestMultiplier =
      typeof options?.valTestMultiplier === 'number' && options.valTestMultiplier > 0
        ? options.valTestMultiplier
        : 2;
    const augmentationMultiplier =
      typeof options?.augmentationMultiplier === 'number' && options.augmentationMultiplier > 0
        ? options.augmentationMultiplier
        : null;

    // Enqueue augmentation job (versionName is validated and sanitized)
    const jobPayload = {
      datasetId: dataset._id.toString(),
      versionName,
      targetTrainTotal,
      valTestMultiplier,
      augmentationMultiplier,
    };

    const job = await augmentationQueue.add(jobPayload, {
      attempts: 1,
    });

    console.log('[AUGMENTATION] augmentation_started', {
      jobId: job.id,
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      sourceVersion: dataset.version,
      versionName,
      targetTrainTotal,
      valTestMultiplier,
      augmentationMultiplier
    });

    // Optimistically update dataset augmentationStatus to running for faster feedback
    dataset.augmentationStatus = 'running';
    await dataset.save();

    return res.status(202).json({
      datasetId: dataset._id.toString(),
      message: 'Augmentation started',
    });
  } catch (error) {
    console.error('Start augmentation error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
};

/**
 * GET /api/dataset/active/:company/:project
 * 
 * Returns the active dataset for a given company/project.
 * Useful for file browser and training to resolve which dataset version to use.
 */
const getActiveDataset = async (req, res) => {
  try {
    const { company, project } = req.params;

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this workspace'
        });
      }
    }

    // ✅ Find active dataset for this company/project
    const activeDataset = await Dataset.findOne({
      company,
      project,
      deletedAt: null,
      isActive: true
    })
      .sort({ createdAt: -1 }) // If multiple active (shouldn't happen), get newest
      .select('-files'); // Exclude files array for performance

    if (!activeDataset) {
      return res.status(404).json({
        error: 'No active dataset found',
        company,
        project
      });
    }

    // ✅ Return active dataset info
    res.json({
      datasetId: activeDataset._id.toString(),
      company: activeDataset.company,
      project: activeDataset.project,
      version: activeDataset.version,
      status: activeDataset.status,
      isAugmented: activeDataset.isAugmented,
      augmentationStatus: activeDataset.augmentationStatus,
      totalImages: activeDataset.totalImages,
      sizeBytes: activeDataset.sizeBytes,
      createdAt: activeDataset.createdAt
    });

  } catch (error) {
    console.error('Get active dataset error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/dataset/:datasetId/augment/cancel
 *
 * Cancels a running augmentation job for a dataset.
 * - Marks source dataset augmentationStatus as 'cancelled'.
 * - Sends SIGTERM to active Python process; worker performs cleanup (delete augmented folder + document).
 * - Idempotent: already cancelled / completed / no job → return 200 with appropriate message.
 */
const cancelAugmentation = async (req, res) => {
  try {
    const { datasetId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        error: 'Invalid dataset ID',
      });
    }

    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'Dataset not found',
      });
    }

    // Validate workspace access
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, dataset.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this dataset',
        });
      }
    }

    // Idempotent: already cancelled, completed, or never started → return 200
    if (dataset.augmentationStatus === 'cancelled') {
      return res.status(200).json({
        message: 'Augmentation already cancelled',
        datasetId: dataset._id.toString(),
      });
    }
    if (dataset.augmentationStatus === 'succeeded') {
      return res.status(200).json({
        message: 'Augmentation already completed',
        datasetId: dataset._id.toString(),
      });
    }
    if (dataset.augmentationStatus !== 'running') {
      return res.status(200).json({
        message: 'No active augmentation to cancel',
        datasetId: dataset._id.toString(),
      });
    }

    console.log('[AUGMENTATION] Cancellation requested', {
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
    });

    // Mark dataset as cancelled (worker will detect this and clean up)
    const cancellationMessage = 'Cancelled by user';
    await Dataset.findByIdAndUpdate(dataset._id, {
      augmentationStatus: 'cancelled',
      augmentationError: cancellationMessage,
    });

    // Find and terminate active Python process if job is running
    const { activeAugmentations } = require('../workers/augmentationWorker');
    let jobId = null;
    let pythonProcessKilled = false;

    try {
      const jobs = await augmentationQueue.getJobs(['waiting', 'active', 'delayed']);
      const matchingJob = jobs.find(
        (job) => job?.data?.datasetId === dataset._id.toString(),
      );

      if (matchingJob) {
        jobId = matchingJob.id;

        // Check if job is active (has Python process)
        const active = activeAugmentations.get(jobId);
        if (active?.pythonProcess && !active.pythonProcess.killed) {
          // Job is active - kill Python process
          try {
            active.pythonProcess.kill('SIGTERM');
            pythonProcessKilled = true;
            console.log('[AUGMENTATION] Sent SIGTERM to active process', {
              jobId,
              datasetId: dataset._id.toString(),
              pid: active.pythonProcess.pid,
            });
          } catch (killError) {
            console.warn('[AUGMENTATION] Failed to kill Python process', {
              jobId,
              error: killError.message,
            });
          }
        } else {
          // Job is waiting/delayed - remove from queue
          try {
            await matchingJob.remove();
            console.log('[AUGMENTATION] Removed job from queue', {
              jobId,
              datasetId: dataset._id.toString(),
            });
          } catch (removeError) {
            console.warn('[AUGMENTATION] Failed to remove job from queue', {
              jobId,
              error: removeError.message,
            });
          }
        }
      } else {
        console.log('[AUGMENTATION] No matching job found in queue', {
          datasetId: dataset._id.toString(),
        });
      }
    } catch (queueError) {
      console.warn('[AUGMENTATION] Failed to inspect/remove augmentation job', {
        datasetId: dataset._id.toString(),
        error: queueError.message,
      });
      // Continue - dataset is already marked as cancelled, worker will handle cleanup
    }

    console.log('[AUGMENTATION] augmentation_cancelled', {
      datasetId: dataset._id.toString(),
      company: dataset.company,
      project: dataset.project,
      version: dataset.version,
      jobId: jobId || null,
      pythonProcessKilled,
    });

    return res.status(200).json({
      message: 'Augmentation cancelled',
      datasetId: dataset._id.toString(),
    });
  } catch (error) {
    console.error('Cancel augmentation error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
};

/**
 * GET /api/dataset/:datasetId/download
 *
 * Streams the dataset as a ZIP file. Files are named using originalName for usability.
 * Includes images, labels, data.yaml, and class-mapping.json when present.
 *
 * Query params:
 *   - flat=true  → All images in images/, all labels in labels/ (no train/val/test subdirs)
 *   - flat=false (default) → Full structure: images/train/, images/val/, labels/train/, etc.
 */
const downloadDataset = async (req, res) => {
  const archiver = require('archiver');
  try {
    const { datasetId } = req.params;
    const flat = req.query.flat === 'true' || req.query.flat === '1';

    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found' });
    }

    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, dataset.company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this dataset',
        });
      }
    }

    const storagePath = dataset.storagePath;
    const exists = await storageAdapter.exists(storagePath);
    if (!exists) {
      return res.status(404).json({
        error: 'Dataset files not found',
        message: 'The dataset storage path does not exist.',
      });
    }

    const safeVersion = (dataset.version || 'dataset').replace(/[^a-zA-Z0-9_-]/g, '_');
    const zipFilename = `${dataset.company}_${dataset.project}_${safeVersion}${flat ? '_flat' : ''}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[downloadDataset] Archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to create archive' });
    });
    archive.pipe(res);

    // Build map: storedName (basename) -> originalName (files may be in train/val/test after preprocessing)
    const storedNameToOriginal = new Map();
    if (dataset.files && dataset.files.length > 0) {
      for (const f of dataset.files) {
        const storedName = f.storedName || path.basename(f.storedPath || '');
        if (storedName && f.originalName) storedNameToOriginal.set(storedName, f.originalName);
      }
    }

    // Recursively collect or add files
    async function addDirToArchive(dirPath, zipPrefix, currentSplit) {
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dirPath, e.name);
        const split = ['train', 'val', 'test'].includes(e.name) ? e.name : currentSplit;
        if (e.isDirectory()) {
          const nextPrefix = flat ? zipPrefix : (zipPrefix ? `${zipPrefix}/${e.name}` : e.name);
          await addDirToArchive(full, nextPrefix, split);
        } else {
          const originalName = storedNameToOriginal.get(e.name) || e.name;
          let zipName;
          if (flat) {
            zipName = split ? `${zipPrefix}/${split}_${originalName}` : `${zipPrefix}/${originalName}`;
          } else {
            zipName = zipPrefix ? `${zipPrefix}/${originalName}` : originalName;
          }
          const exists = await storageAdapter.exists(full);
          if (exists) {
            const buffer = await storageAdapter.readFile(full);
            archive.append(buffer, { name: zipName.replace(/\\/g, '/') });
          }
        }
      }
    }

    const imagesDir = path.join(storagePath, 'images');
    const labelsDir = path.join(storagePath, 'labels');
    if (await storageAdapter.exists(imagesDir)) {
      await addDirToArchive(imagesDir, 'images', null);
    }
    if (await storageAdapter.exists(labelsDir)) {
      await addDirToArchive(labelsDir, 'labels', null);
    }

    // Add root metadata files
    for (const name of ['data.yaml', 'class-mapping.json']) {
      const fullPath = path.join(storagePath, name);
      if (await storageAdapter.exists(fullPath)) {
        const buffer = await storageAdapter.readFile(fullPath);
        archive.append(buffer, { name });
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('[downloadDataset] Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: error.message,
      });
    }
  }
};

module.exports = {
  uploadDataset,
  listDatasets,
  getDataset,
  getDatasetStatus,
  getActiveDataset,
  getAnnotationSummary,
  getDatasetFolders,
  getDatasetFiles,
  getFileThumbnail,
  getFile,
  getDatasetDependencies,
  updateDataset,
  deleteDataset,
  deleteDatasetByVersion,
  getDetectedClasses,
  createCategoriesFromClasses,
  startAugmentation,
  cancelAugmentation,
  downloadDataset
};
