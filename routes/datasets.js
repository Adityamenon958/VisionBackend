const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  uploadDataset,
  getDataset,
  getDatasetStatus
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

// ✅ File filter - only allow specific extensions
// For 'files' field: images and labels only
// For 'fileMeta' field: JSON files allowed
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  // ✅ Allow JSON files for fileMeta field
  if (file.fieldname === 'fileMeta') {
    if (ext === '.json' || file.mimetype === 'application/json') {
      cb(null, true);
      return;
    } else {
      cb(new Error('fileMeta must be a JSON file'), false);
      return;
    }
  }
  
  // ✅ For 'files' field: only allow images and labels
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.txt'];
  if (allowedExtensions.includes(ext)) {
    cb(null, true); // Accept file
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`), false);
  }
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

/**
 * POST /api/dataset/upload
 * 
 * Accepts multipart/form-data with:
 * - Field name "files" (array of files)
 * - Field "fileMeta" (optional - JSON string as text field OR JSON file)
 * - Field "company" (string, required)
 * - Field "project" (string, required)
 * - Field "version" (string, optional, defaults to "v1")
 */
router.post('/upload',
  upload.fields([
    { name: 'files', maxCount: 5000 }, // ✅ Accept up to 5000 files
    { name: 'fileMeta', maxCount: 1 } // ✅ Accept optional fileMeta (JSON file)
  ]),
  uploadDataset
);

/**
 * GET /api/dataset/:datasetId
 * 
 * Returns full dataset metadata
 */
router.get('/:datasetId', getDataset);

/**
 * GET /api/dataset/:datasetId/status
 * 
 * Returns minimal status for polling
 */
router.get('/:datasetId/status', getDatasetStatus);

module.exports = router;

