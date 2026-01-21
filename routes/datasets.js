const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/authorizationMiddleware');

const {
  uploadDataset,
  getDataset,
  getDatasetStatus,
  getDatasetFolders,
  getDatasetFiles,
  getFileThumbnail,
  getFile,
  updateDataset,
  getDatasetDependencies,
  deleteDataset,
  deleteDatasetByVersion,
  getDetectedClasses,
  createCategoriesFromClasses
} = require('../controllers/datasetController');

/**
 * Routes for Dataset Management
 * 
 * What are Routes?
 * Routes define the URL paths (endpoints) your API responds to.
 * Example: POST /api/dataset/upload → calls uploadDataset function
 */

// ✅ Configure multer for file uploads
// Multer is middleware that handles multipart/form-data (file uploads)

// ⚠️ CAUTION: Ensure temp directory exists to prevent errors
const tempDir = path.join(process.cwd(), 'uploads', 'tmp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// ✅ Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // ✅ Save uploaded files to temp directory
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // ✅ Generate unique temp filename to avoid collisions
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `temp-${uniqueSuffix}-${file.originalname}`);
  }
});

// ✅ File filter - validate fileMeta only
// For 'files' field: Accept all files, let controller validate and skip invalid ones
// For 'fileMeta' field: JSON files only (strict validation)
const fileFilter = (req, file, cb) => {
  // ✅ Only validate fileMeta field (must be JSON)
  if (file.fieldname === 'fileMeta') {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.json' || file.mimetype === 'application/json') {
      cb(null, true);
      return;
    } else {
      cb(new Error('fileMeta must be a JSON file'), false);
      return;
    }
  }
  
  // ✅ For 'files' field: Accept all files
  // Controller will validate extensions and skip invalid files gracefully
  // This allows mixed valid/invalid files to upload successfully
  cb(null, true);
};

// ✅ Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // ⚠️ CAUTION: 50MB per file limit
    files: 5000 // Maximum 5000 files per request
  }
});

// Note: GET /api/datasets is handled in server.js directly

/**
 * POST /api/dataset/upload
 * 
 * Accepts multipart/form-data with:
 * - Field name "files" (array of files)
 * - Field "fileMeta" (optional - JSON string as text field OR JSON file)
 * - Field "company" (string, required)
 * - Field "project" (string, required)
 * - Field "version" (string, optional, defaults to "v1")
 * 
 * Note: Invalid files in 'files' field are skipped and reported in uploadErrors.
 * Controller handles validation gracefully.
 */
router.post('/upload',
  upload.fields([
    { name: 'files', maxCount: 5000 }, // ✅ Accept up to 5000 files (controller validates)
    { name: 'fileMeta', maxCount: 1 } // ✅ Accept optional fileMeta (JSON file, validated by fileFilter)
  ]),
  // ✅ Error handler for Multer errors (e.g., fileMeta validation fails)
  (err, req, res, next) => {
    if (err) {
      // Multer error (e.g., fileMeta is not JSON)
      return res.status(400).json({
        error: 'Upload error',
        message: err.message
      });
    }
    next();
  },
  uploadDataset
);

/**
 * GET /api/dataset/:datasetId/status
 * 
 * Returns minimal status for polling
 */
router.get('/:datasetId/status', authenticateToken, requirePermission('viewDatasets'), getDatasetStatus);

/**
 * GET /api/dataset/:datasetId/detected-classes
 * 
 * Returns detected class IDs and default class names for labeled datasets.
 * Used by frontend to prompt user to map class IDs to meaningful names.
 */
router.get('/:datasetId/detected-classes', authenticateToken, requirePermission('viewDatasets'), getDetectedClasses);

/**
 * POST /api/dataset/:datasetId/create-categories-from-classes
 * 
 * Creates Category documents from detected class IDs using user-provided names.
 */
router.post('/:datasetId/create-categories-from-classes', authenticateToken, requirePermission('manageDatasets'), createCategoriesFromClasses);

/**
 * GET /api/dataset/:datasetId/folders
 * 
 * Returns folder summary with images/labels counts and size statistics
 */
router.get('/:datasetId/folders', authenticateToken, requirePermission('viewDatasets'), getDatasetFolders);

/**
 * GET /api/dataset/:datasetId/files
 * 
 * Returns paginated file manifest with filters and sorting
 */
router.get('/:datasetId/files', authenticateToken, requirePermission('viewDatasets'), getDatasetFiles);

/**
 * GET /api/dataset/:datasetId/file/:fileId/thumbnail
 * 
 * Serves thumbnail image if available
 * fileId can be storedName or file _id
 */
router.get('/:datasetId/file/:fileId/thumbnail', authenticateToken, requirePermission('viewDatasets'), getFileThumbnail);

/**
 * GET /api/dataset/:datasetId/file/:fileId
 * 
 * Serves original full-size image (never thumbnail)
 * fileId can be storedName or file _id
 * 
 * ⚠️ CAUTION: This route must be AFTER /thumbnail route to avoid route conflicts
 */
router.get('/:datasetId/file/:fileId', authenticateToken, requirePermission('viewDatasets'), getFile);

/**
 * GET /api/dataset/:datasetId/dependencies
 * 
 * Get dependencies (training jobs, models, inference jobs) that use this dataset
 * Used for showing confirmation dialog before deletion
 */
router.get('/:datasetId/dependencies', authenticateToken, requirePermission('viewDatasets'), getDatasetDependencies);

/**
 * PATCH /api/dataset/:datasetId
 * 
 * Updates dataset company and/or project name
 * 
 * Request body:
 * {
 *   "company": "newCompanyName",  // Optional
 *   "project": "newProjectName"    // Optional
 * }
 * 
 * ⚠️ CAUTION: This route must be BEFORE GET /:datasetId to avoid route conflicts
 */
router.patch('/:datasetId', authenticateToken, requirePermission('manageDatasets'), updateDataset);

/**
 * DELETE /api/dataset/:company/:project/:version
 * 
 * Soft delete dataset by company/project/version identifier
 * Delete files but keep MongoDB document
 * References in models/inference jobs will remain but show "Dataset deleted" status
 * 
 * ⚠️ CAUTION: 
 * - This route must be BEFORE DELETE /:datasetId to avoid route conflicts
 * - Cannot delete if:
 *   - Dataset is processing or queued
 *   - Dataset is already deleted
 */
router.delete('/:company/:project/:version', authenticateToken, requirePermission('deleteProjects'), deleteDatasetByVersion);

/**
 * DELETE /api/dataset/:datasetId
 * 
 * Soft delete dataset: Delete files but keep MongoDB document
 * References in models/inference jobs will remain but show "Dataset deleted" status
 * 
 * ⚠️ CAUTION: Cannot delete if:
 * - Dataset is processing or queued
 * - Dataset is already deleted
 */
router.delete('/:datasetId', authenticateToken, requirePermission('manageDatasets'), deleteDataset);

/**
 * GET /api/dataset/:datasetId
 * 
 * Returns full dataset metadata
 * 
 * ⚠️ CAUTION: This route must be LAST to avoid matching /folders, /files, etc.
 */
router.get('/:datasetId', authenticateToken, requirePermission('viewDatasets'), getDataset);

module.exports = router;

