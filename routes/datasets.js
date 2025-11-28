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
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.txt'];

  // ⚠️ CAUTION: Don't trust file.originalname alone - validate extension
  // Malicious users could upload .exe files with .jpg extension
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
    files: 100 // Maximum 100 files per request
  }
});

/**
 * POST /api/dataset/upload
 * 
 * Accepts multipart/form-data with:
 * - Field name "files" (array of files)
 * - Field "company" (string, required)
 * - Field "project" (string, required)
 * - Field "version" (string, optional, defaults to "v1")
 */
router.post('/upload',
  upload.array('files', 100), // ✅ Accept up to 100 files with field name "files"
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

