const express = require('express');
const router = express.Router();

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
 * Authentication is intentionally skipped in this phase.
 */

// Image Management
// GET /api/dataset/:datasetId/unlabeled-images
router.get('/:datasetId/unlabeled-images', getUnlabeledImages);

// GET /api/dataset/:datasetId/images/unannotated
router.get('/:datasetId/images/unannotated', getUnannotatedImages);

// GET /api/dataset/:datasetId/image-signed - Serve image with signed URL verification
router.get('/:datasetId/image-signed', serveSignedImage);

// Annotation CRUD
// GET /api/dataset/:datasetId/annotations
router.get('/:datasetId/annotations', getAnnotations);

// POST /api/dataset/:datasetId/annotations
router.post('/:datasetId/annotations', createAnnotation);

// PUT /api/dataset/:datasetId/annotations/:annotationId
router.put('/:datasetId/annotations/:annotationId', updateAnnotation);

// DELETE /api/dataset/:datasetId/annotations/:annotationId
router.delete('/:datasetId/annotations/:annotationId', deleteAnnotation);

// POST /api/dataset/:datasetId/annotations/batch
router.post('/:datasetId/annotations/batch', batchSaveAnnotations);

// YOLO Conversion
// POST /api/dataset/:datasetId/convert-annotations-to-labels
router.post('/:datasetId/convert-annotations-to-labels', convertAnnotationsToYOLO);

// Category Management
// GET /api/dataset/:datasetId/categories
router.get('/:datasetId/categories', getCategories);

// POST /api/dataset/:datasetId/categories
router.post('/:datasetId/categories', createCategory);

// PUT /api/dataset/:datasetId/categories/:categoryId
router.put('/:datasetId/categories/:categoryId', updateCategory);

// DELETE /api/dataset/:datasetId/categories/:categoryId
router.delete('/:datasetId/categories/:categoryId', deleteCategory);

// PUT /api/dataset/:datasetId/categories/reorder
router.put('/:datasetId/categories/reorder', reorderCategories);

module.exports = router;

