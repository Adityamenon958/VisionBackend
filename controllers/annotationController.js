const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const Image = require('../models/Image');
const Annotation = require('../models/Annotation');
const Category = require('../models/Category');
const Dataset = require('../models/Dataset');
const storageAdapter = require('../services/storageAdapter');
const { validateBbox } = require('../utils/bboxValidator');
const { sendError, sendValidationError, sendNotFoundError } = require('../utils/errors');
const { generateLabelFileContent, generateDataYaml, getLabelFilePath } = require('../utils/yoloConverter');

/**
 * Annotation Controller
 * 
 * Handles all annotation-related operations.
 * Authentication is intentionally skipped in this phase.
 */

// System user ID for createdBy (since auth is skipped)
const SYSTEM_USER_ID = new mongoose.Types.ObjectId('000000000000000000000000');

/**
 * GET /api/dataset/:datasetId/images/unannotated
 * 
 * Get images with zero annotations (for good images confirmation)
 */
const getUnannotatedImages = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Get all images in dataset
    const images = await Image.find({ datasetId });

    // Filter images with zero annotations
    const unannotatedImages = [];
    for (const image of images) {
      const annotationCount = await Annotation.countDocuments({
        imageId: image._id,
        deletedAt: null
      });

      if (annotationCount === 0) {
        // Generate signed URLs for image
        const imageUrl = await storageAdapter.generateSignedUrl(image.storedPath, 3600, {
          datasetId: datasetId.toString()
        });
        const thumbnailPath = image.storedPath.replace(/^images\//, 'thumbnails/');
        const datasetPath = storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version);
        const fullThumbnailPath = path.join(datasetPath, thumbnailPath);
        const thumbnailExists = await storageAdapter.exists(fullThumbnailPath);
        const thumbnailUrl = await storageAdapter.generateSignedUrl(
          thumbnailExists ? thumbnailPath : image.storedPath,
          3600,
          { datasetId: datasetId.toString() }
        );

        unannotatedImages.push({
          id: image._id,
          filename: image.filename,
          url: imageUrl,
          thumbnailUrl: thumbnailUrl,
          folder: image.folder,
          size: image.size
        });
      }
    }

    return res.status(200).json({
      unannotatedImages: unannotatedImages,
      count: unannotatedImages.length
    });

  } catch (error) {
    console.error('Error getting unannotated images:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * GET /api/dataset/:datasetId/unlabeled-images
 * 
 * Get unlabeled images for a dataset (paginated)
 */
const getUnlabeledImages = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Get unlabeled images using model static method
    const result = await Image.findUnlabeled(datasetId, page, limit);

    // Format response with signed URLs
    const images = await Promise.all(
      result.images.map(async (img) => {
        // Build full file path relative to dataset root
        const imagePath = img.storedPath; // e.g., "images/unlabeled/image_001.jpg"
        
        // Generate signed URL for image (1 hour expiration)
        const imageUrl = await storageAdapter.generateSignedUrl(imagePath, 3600, {
          datasetId: datasetId.toString()
        });
        
        // Build thumbnail path
        const thumbnailPath = imagePath.replace(/^images\//, 'thumbnails/');
        
        // Check if thumbnail exists, if not use image path
        const datasetPath = storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version);
        const fullThumbnailPath = path.join(datasetPath, thumbnailPath);
        const thumbnailExists = await storageAdapter.exists(fullThumbnailPath);
        
        // Generate signed URL for thumbnail (or use image if thumbnail doesn't exist)
        const thumbnailUrl = await storageAdapter.generateSignedUrl(
          thumbnailExists ? thumbnailPath : imagePath,
          3600,
          { datasetId: datasetId.toString() }
        );
        
        return {
          id: img._id,
          filename: img.filename,
          url: imageUrl,
          thumbnailUrl: thumbnailUrl,
          folder: img.folder,
          size: img.size,
          width: img.width,
          height: img.height
        };
      })
    );

    return res.status(200).json({
      images,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages
    });

  } catch (error) {
    console.error('Error getting unlabeled images:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * GET /api/dataset/:datasetId/annotations
 * 
 * Get annotations for a dataset (optionally filtered by imageId)
 */
const getAnnotations = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { imageId } = req.query;

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Get annotations using model static method
    const annotations = await Annotation.findByDatasetId(
      datasetId,
      imageId ? new mongoose.Types.ObjectId(imageId) : null
    );

    // Get image dimensions if querying by imageId (for frontend coordinate normalization)
    let imageDimensions = null;
    if (imageId) {
      const image = await Image.findById(imageId);
      if (image) {
        imageDimensions = {
          width: image.width,
          height: image.height
        };
      }
    }

    // Format response
    const formattedAnnotations = annotations.map(ann => ({
      id: ann._id,
      imageId: ann.imageId,
      bbox: ann.bbox,
      categoryId: ann.categoryId,
      categoryName: ann.categoryName,
      state: ann.state,
      createdAt: ann.createdAt,
      updatedAt: ann.updatedAt,
      createdBy: ann.createdBy,
      updatedBy: ann.updatedBy,
      reviewedBy: ann.reviewedBy,
      reviewedAt: ann.reviewedAt,
      approvedBy: ann.approvedBy,
      approvedAt: ann.approvedAt
    }));

    const response = {
      annotations: formattedAnnotations,
      total: formattedAnnotations.length
    };

    // Include image dimensions if available (when querying by imageId)
    if (imageDimensions) {
      response.imageDimensions = imageDimensions;
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error getting annotations:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * POST /api/dataset/:datasetId/annotations
 * 
 * Create a new annotation
 */
const createAnnotation = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { imageId, bbox, categoryId } = req.body;

    // Validate required fields
    if (!imageId || !bbox || !categoryId) {
      return sendValidationError(res, 'body', 'Missing required fields: imageId, bbox, categoryId');
    }

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Validate bbox
    const bboxValidation = validateBbox(bbox);
    if (!bboxValidation.valid) {
      return sendValidationError(res, 'bbox', bboxValidation.error);
    }

    // Validate imageId
    if (!mongoose.Types.ObjectId.isValid(imageId)) {
      return sendNotFoundError(res, 'Image', imageId);
    }

    // Check image exists and belongs to dataset
    const image = await Image.findOne({ _id: imageId, datasetId });
    if (!image) {
      return sendNotFoundError(res, 'Image', imageId);
    }

    // CRITICAL: Reject if image already has labels
    if (image.hasLabels === true) {
      return sendError(res, 400, 'Validation Error', 'Image already has labels. Reset labels to re-annotate this image.');
    }

    // Validate categoryId
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return sendNotFoundError(res, 'Category', categoryId);
    }

    // Check category exists and belongs to dataset
    const category = await Category.findOne({ _id: categoryId, datasetId });
    if (!category) {
      return sendNotFoundError(res, 'Category', categoryId);
    }

    // Create annotation
    const annotation = new Annotation({
      datasetId,
      imageId,
      bbox,
      categoryId,
      categoryName: category.name, // Denormalize category name
      state: 'draft',
      createdBy: SYSTEM_USER_ID
    });

    await annotation.save();

    // Format response
    return res.status(200).json({
      annotation: {
        id: annotation._id,
        imageId: annotation.imageId,
        bbox: annotation.bbox,
        categoryId: annotation.categoryId,
        categoryName: annotation.categoryName,
        state: annotation.state,
        createdAt: annotation.createdAt,
        createdBy: annotation.createdBy
      },
      message: 'Annotation saved successfully'
    });

  } catch (error) {
    console.error('Error creating annotation:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * PUT /api/dataset/:datasetId/annotations/:annotationId
 * 
 * Update an existing annotation
 */
const updateAnnotation = async (req, res) => {
  try {
    const { datasetId, annotationId } = req.params;
    const { bbox, categoryId } = req.body;

    // Validate annotationId
    if (!mongoose.Types.ObjectId.isValid(annotationId)) {
      return sendNotFoundError(res, 'Annotation', annotationId);
    }

    // Check annotation exists and belongs to dataset
    const annotation = await Annotation.findOne({ _id: annotationId, datasetId, deletedAt: null });
    if (!annotation) {
      return sendNotFoundError(res, 'Annotation', annotationId);
    }

    // Get image to check hasLabels
    const image = await Image.findById(annotation.imageId);
    if (!image) {
      return sendNotFoundError(res, 'Image', annotation.imageId);
    }

    // CRITICAL: Reject if image already has labels
    if (image.hasLabels === true) {
      return sendError(res, 400, 'Validation Error', 'Image already has labels. Reset labels to re-annotate this image.');
    }

    // Update bbox if provided
    if (bbox !== undefined) {
      const bboxValidation = validateBbox(bbox);
      if (!bboxValidation.valid) {
        return sendValidationError(res, 'bbox', bboxValidation.error);
      }
      annotation.bbox = bbox;
    }

    // Update category if provided
    if (categoryId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return sendNotFoundError(res, 'Category', categoryId);
      }

      const category = await Category.findOne({ _id: categoryId, datasetId });
      if (!category) {
        return sendNotFoundError(res, 'Category', categoryId);
      }

      annotation.categoryId = categoryId;
      annotation.categoryName = category.name; // Update denormalized category name
    }

    // Update timestamps
    annotation.updatedBy = SYSTEM_USER_ID;
    await annotation.save();

    // Format response
    return res.status(200).json({
      annotation: {
        id: annotation._id,
        imageId: annotation.imageId,
        bbox: annotation.bbox,
        categoryId: annotation.categoryId,
        categoryName: annotation.categoryName,
        updatedAt: annotation.updatedAt,
        updatedBy: annotation.updatedBy
      },
      message: 'Annotation updated'
    });

  } catch (error) {
    console.error('Error updating annotation:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * DELETE /api/dataset/:datasetId/annotations/:annotationId
 * 
 * Delete an annotation (soft delete)
 */
const deleteAnnotation = async (req, res) => {
  try {
    const { datasetId, annotationId } = req.params;

    // Validate annotationId
    if (!mongoose.Types.ObjectId.isValid(annotationId)) {
      return sendNotFoundError(res, 'Annotation', annotationId);
    }

    // Check annotation exists and belongs to dataset
    const annotation = await Annotation.findOne({ _id: annotationId, datasetId, deletedAt: null });
    if (!annotation) {
      return sendNotFoundError(res, 'Annotation', annotationId);
    }

    // Soft delete
    annotation.deletedAt = new Date();
    await annotation.save();

    return res.status(200).json({
      message: 'Annotation deleted',
      annotationId: annotationId
    });

  } catch (error) {
    console.error('Error deleting annotation:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * POST /api/dataset/:datasetId/annotations/batch
 * 
 * Save multiple annotations atomically
 * Always creates new annotations (no upsert behavior)
 * For updates, use PUT /api/dataset/:datasetId/annotations/:annotationId
 */
const batchSaveAnnotations = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { annotations } = req.body;

    // Validate input
    if (!Array.isArray(annotations)) {
      return sendValidationError(res, 'annotations', 'annotations must be an array');
    }

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Validate all annotations before processing
    const validationErrors = [];
    const validAnnotations = [];

    for (let i = 0; i < annotations.length; i++) {
      const ann = annotations[i];
      const errors = [];

      // Check required fields
      if (!ann.imageId || !ann.bbox || !ann.categoryId) {
        errors.push('Missing required fields: imageId, bbox, categoryId');
      } else {
        // Validate bbox
        const bboxValidation = validateBbox(ann.bbox);
        if (!bboxValidation.valid) {
          errors.push(`bbox: ${bboxValidation.error}`);
        }

        // Validate imageId
        if (mongoose.Types.ObjectId.isValid(ann.imageId)) {
          const image = await Image.findOne({ _id: ann.imageId, datasetId });
          if (!image) {
            errors.push(`Image not found: ${ann.imageId}`);
          } else {
            // CRITICAL: Reject if image already has labels
            if (image.hasLabels === true) {
              errors.push('Image already has labels');
            }
          }
        } else {
          errors.push(`Invalid imageId: ${ann.imageId}`);
        }

        // Validate categoryId
        if (mongoose.Types.ObjectId.isValid(ann.categoryId)) {
          const category = await Category.findOne({ _id: ann.categoryId, datasetId });
          if (!category) {
            errors.push(`Category not found: ${ann.categoryId}`);
          }
        } else {
          errors.push(`Invalid categoryId: ${ann.categoryId}`);
        }
      }

      if (errors.length > 0) {
        validationErrors.push({
          imageId: ann.imageId,
          error: errors.join('; ')
        });
      } else {
        validAnnotations.push(ann);
      }
    }

    // Process valid annotations in transaction
    let saved = 0;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (validAnnotations.length > 0) {
        // ✅ Option 1 behavior: Replace all annotations per image on batch save
        // For each imageId in this batch, soft-delete existing annotations
        const uniqueImageIds = [
          ...new Set(validAnnotations.map(ann => ann.imageId.toString()))
        ].map(id => new mongoose.Types.ObjectId(id));

        await Annotation.updateMany(
          {
            datasetId,
            imageId: { $in: uniqueImageIds },
            deletedAt: null
          },
          {
            $set: { deletedAt: new Date() }
          },
          { session }
        );
      }

      for (const ann of validAnnotations) {
        // Get image and category for denormalization
        const image = await Image.findById(ann.imageId).session(session);
        const category = await Category.findById(ann.categoryId).session(session);

        // ✅ Always create new annotation (batch save is for creating new annotations only)
        // Updates should use PUT /api/dataset/:datasetId/annotations/:annotationId endpoint
        // This prevents overwriting annotations with the same category on the same image
        const annotation = new Annotation({
          datasetId,
          imageId: ann.imageId,
          bbox: ann.bbox,
          categoryId: ann.categoryId,
          categoryName: category.name,
          state: 'draft',
          createdBy: SYSTEM_USER_ID
        });
        await annotation.save({ session });

        saved++;
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    return res.status(200).json({
      saved,
      failed: validationErrors.length,
      errors: validationErrors
    });

  } catch (error) {
    console.error('Error batch saving annotations:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * POST /api/dataset/:datasetId/convert-annotations-to-labels
 * 
 * Convert annotations to YOLO format label files
 * Only processes images that have annotations (skips images with no annotations)
 * CRITICAL: Sets hasLabels = true only for images with annotations
 */
const convertAnnotationsToYOLO = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { imageIds, createEmptyLabels = false } = req.body; // Optional: if provided, convert only those images. createEmptyLabels: create empty .txt for unannotated images

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Get ordered categories (for class_id mapping)
    const categories = await Category.getOrderedCategories(datasetId);
    if (categories.length === 0) {
      return sendError(res, 400, 'Validation Error', 'No categories found. Create categories before converting annotations.');
    }

    // Store category order snapshot (for reproducibility)
    const categoryOrder = categories.map(cat => cat._id);
    const categoryNames = categories.map(cat => cat.name);

    // Get images to process
    let images;
    if (imageIds && Array.isArray(imageIds) && imageIds.length > 0) {
      // Convert only specified images
      const validImageIds = imageIds
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));
      
      images = await Image.find({
        _id: { $in: validImageIds },
        datasetId
      });
    } else {
      // Convert all images in dataset
      images = await Image.find({ datasetId });
    }

    if (images.length === 0) {
      return sendError(res, 400, 'Validation Error', 'No images found to convert');
    }

    // Build dataset path
    const datasetPath = storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version);
    const labelsBasePath = storageAdapter.buildLabelsPath(dataset.company, dataset.project, dataset.version);

    // Ensure labels directory exists
    await storageAdapter.ensureDir(labelsBasePath);

    let converted = 0;
    let labelFilesCreated = 0;
    let emptyLabelsCreated = 0;
    const unannotatedImageList = [];

    // Process each image
    for (const image of images) {
      // Get annotations for this image
      const annotations = await Annotation.findByImageId(image._id);

      // Get label file path (parallel structure)
      const labelFilePath = getLabelFilePath(image.storedPath);
      const fullLabelPath = path.join(datasetPath, labelFilePath);

      // Ensure label directory exists
      const labelDir = path.dirname(fullLabelPath);
      await storageAdapter.ensureDir(labelDir);

      // ✅ Handle images with no annotations
      if (!annotations || annotations.length === 0) {
        if (createEmptyLabels) {
          // ✅ Create empty label file (good image)
          await fs.writeFile(fullLabelPath, '', 'utf8'); // Empty file
          emptyLabelsCreated++;
          labelFilesCreated++;
        } else {
          // Track unannotated images for response
          unannotatedImageList.push({
            id: image._id,
            filename: image.filename
          });
        }
        continue;
      }

      // Generate label file content
      const labelContent = generateLabelFileContent(annotations, categoryOrder);

      // Write label file (only for images with annotations)
      await fs.writeFile(fullLabelPath, labelContent, 'utf8');
      labelFilesCreated++;

      // Set hasLabels = true for this image (only if it has annotations)
      image.hasLabels = true;
      image.convertedAt = new Date();
      await image.save();

      converted++;
    }

    // Create/update data.yaml
    const dataYamlPath = path.join(datasetPath, 'data.yaml');
    const dataYamlContent = generateDataYaml(categories, datasetPath);
    await fs.writeFile(dataYamlPath, dataYamlContent, 'utf8');

    // ✅ Create class-mapping.json file (Option 1: separate mapping file for reference)
    const classMappingPath = path.join(datasetPath, 'class-mapping.json');
    const classMapping = {};
    categories.forEach((category, index) => {
      classMapping[index.toString()] = category.name;
    });
    await fs.writeFile(classMappingPath, JSON.stringify(classMapping, null, 2), 'utf8');

    // Update Dataset conversion metadata
    dataset.conversionMetadata = {
      convertedAt: new Date(),
      categoryOrder: categoryOrder,
      categoryNames: categoryNames
    };

    // Recalculate labeled/unlabeled counts
    const labeledCount = await Image.countDocuments({ datasetId, hasLabels: true });
    const unlabeledCount = await Image.countDocuments({ datasetId, hasLabels: false });
    
    dataset.labeledImages = labeledCount;
    dataset.unlabeledImages = unlabeledCount;
    
    // ✅ Update dataset status to ready_to_train
    dataset.status = 'ready_to_train';
    
    await dataset.save();

    return res.status(200).json({
      converted: converted,
      labelFilesCreated: labelFilesCreated,
      emptyLabelsCreated: emptyLabelsCreated,
      status: 'ready_to_train',
      unannotatedImages: unannotatedImageList.length > 0 ? unannotatedImageList : undefined,
      message: 'Annotations converted to YOLO format. Dataset ready for training.'
    });

  } catch (error) {
    console.error('Error converting annotations to YOLO:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * GET /api/dataset/:datasetId/image-signed
 * 
 * Serve image file with signed URL verification
 * This endpoint validates the signed URL token and serves the image
 */
const serveSignedImage = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { path: filePath, expires, signature } = req.query;

    // Validate required parameters
    if (!filePath || !expires || !signature) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters: path, expires, signature'
      });
    }

    // Decode file path
    const decodedPath = decodeURIComponent(filePath);

    // Verify signed URL
    const expiresAt = parseInt(expires);
    if (!storageAdapter.verifySignedUrl(decodedPath, expiresAt, signature)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid or expired signed URL'
      });
    }

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Build full file path
    const datasetPath = storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version);
    const fullPath = path.join(datasetPath, decodedPath);

    // Security: Prevent directory traversal
    const resolvedPath = path.resolve(fullPath);
    const resolvedDatasetPath = path.resolve(datasetPath);
    
    if (!resolvedPath.startsWith(resolvedDatasetPath)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid file path'
      });
    }

    // Check if file exists
    if (!await storageAdapter.exists(fullPath)) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Image file not found'
      });
    }

    // Determine content type based on file extension
    const ext = path.extname(decodedPath).toLowerCase();
    let contentType = 'image/jpeg'; // Default
    
    if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    }

    // Read and serve file
    const fileBuffer = await storageAdapter.readFile(fullPath);
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour
    res.send(fileBuffer);

  } catch (error) {
    console.error('Error serving signed image:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

module.exports = {
  getUnlabeledImages,
  getUnannotatedImages,
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  batchSaveAnnotations,
  convertAnnotationsToYOLO,
  serveSignedImage
};

