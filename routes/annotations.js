const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizationMiddleware');

const {
  getUnlabeledImages,
  getUnannotatedImages,
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  batchSaveAnnotations,
  convertAnnotationsToYOLO,
  serveSignedImage
} = require('../controllers/annotationController');

const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories
} = require('../controllers/categoryController');

/**
 * Annotation Routes
 * 
 * Routes for managing annotations, categories, and unlabeled images.
 */

// Image Management
// GET /api/dataset/:datasetId/unlabeled-images
router.get('/:datasetId/unlabeled-images', authenticateToken, requirePermission('viewDatasets'), getUnlabeledImages);

// GET /api/dataset/:datasetId/images/unannotated
router.get('/:datasetId/images/unannotated', authenticateToken, requirePermission('viewDatasets'), getUnannotatedImages);

// GET /api/dataset/:datasetId/image-signed - Serve image with signed URL verification
router.get('/:datasetId/image-signed', authenticateToken, requirePermission('viewDatasets'), serveSignedImage);

// Annotation CRUD
// GET /api/dataset/:datasetId/annotations
router.get('/:datasetId/annotations', authenticateToken, requirePermission('viewDatasets'), getAnnotations);

// POST /api/dataset/:datasetId/annotations
router.post('/:datasetId/annotations', authenticateToken, requirePermission('uploadDatasets'), createAnnotation);

// PUT /api/dataset/:datasetId/annotations/:annotationId
router.put('/:datasetId/annotations/:annotationId', authenticateToken, requirePermission('uploadDatasets'), updateAnnotation);

// DELETE /api/dataset/:datasetId/annotations/:annotationId
router.delete('/:datasetId/annotations/:annotationId', authenticateToken, requirePermission('uploadDatasets'), deleteAnnotation);

// POST /api/dataset/:datasetId/annotations/batch
router.post('/:datasetId/annotations/batch', authenticateToken, requirePermission('uploadDatasets'), batchSaveAnnotations);

// YOLO Conversion
// POST /api/dataset/:datasetId/convert-annotations-to-labels
router.post('/:datasetId/convert-annotations-to-labels', authenticateToken, requirePermission('uploadDatasets'), convertAnnotationsToYOLO);

// Category Management
// GET /api/dataset/:datasetId/categories
router.get('/:datasetId/categories', authenticateToken, requirePermission('viewDatasets'), getCategories);

// POST /api/dataset/:datasetId/categories
router.post('/:datasetId/categories', authenticateToken, requirePermission('uploadDatasets'), createCategory);

// PUT /api/dataset/:datasetId/categories/:categoryId
router.put('/:datasetId/categories/:categoryId', authenticateToken, requirePermission('uploadDatasets'), updateCategory);

// DELETE /api/dataset/:datasetId/categories/:categoryId
router.delete('/:datasetId/categories/:categoryId', authenticateToken, requirePermission('uploadDatasets'), deleteCategory);

// PUT /api/dataset/:datasetId/categories/reorder
router.put('/:datasetId/categories/reorder', authenticateToken, requirePermission('uploadDatasets'), reorderCategories);

module.exports = router;

