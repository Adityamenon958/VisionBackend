# TODOs and Future Enhancements

## Critical TODOs

### 1. Implement Azure Blob Storage in Storage Adapter
**File:** `services/storageAdapter.js`  
**Location:** Lines 36-40, 56-60, 93-100, 127-133  
**Reason:** Currently only local filesystem is implemented. Azure Blob Storage is needed for cloud deployments and multi-tenant scalability.

### 2. Add Authentication/Authorization Middleware
**File:** `routes/datasets.js` or new `middleware/auth.js`  
**Reason:** Currently no authentication - anyone can upload datasets. Need to secure endpoints with JWT or session-based auth to identify users and enforce permissions.

### 3. Implement Custom Train/Val Split Ratio
**File:** `workers/preprocessingWorker.js`  
**Location:** Line 135 (currently hardcoded 80:20)  
**Reason:** Users may want different split ratios (e.g., 70:30, 90:10) based on dataset size or requirements. Should be configurable per dataset or project.

### 4. Add Image Validation and Corruption Checks
**File:** `controllers/datasetController.js` or new `services/imageValidator.js`  
**Reason:** Currently only validates file extensions. Should verify images are actually valid (not corrupted) using sharp or similar library before accepting them.

### 5. Implement Seeded Random Shuffle for Reproducible Splits
**File:** `workers/preprocessingWorker.js`  
**Location:** Line 130-133 (currently deterministic but not truly random)  
**Reason:** For ML reproducibility, need seeded random number generator so same dataset always produces same train/val split.

### 6. Add Dataset Deletion Endpoint
**File:** `controllers/datasetController.js`, `routes/datasets.js`  
**Reason:** Users need ability to delete datasets and clean up storage. Should handle both database records and file cleanup.

### 7. Implement Progress Tracking for Large Uploads
**File:** `controllers/datasetController.js`, `queue/index.js`  
**Reason:** For large datasets (1000+ files), users need real-time progress updates. Should emit progress events via WebSocket or Server-Sent Events.

### 8. Add Class Name Mapping for YOLO Labels
**File:** `models/Dataset.js`, `workers/preprocessingWorker.js`  
**Location:** Line 231 (currently stores "class_0", "class_1")  
**Reason:** Should allow users to map class IDs to meaningful names (e.g., "class_0" → "defect", "class_1" → "normal") for better UI display.

### 9. Implement Thumbnail Generation for All Images
**File:** `workers/preprocessingWorker.js`  
**Location:** Line 190 (currently only first 50 images)  
**Reason:** Currently generates thumbnails for sample only. Should generate for all images or make it configurable.

### 10. Add File Size Validation Per Dataset
**File:** `controllers/datasetController.js`  
**Reason:** Currently validates per-file size (50MB), but should also validate total dataset size to prevent disk filling.

### 11. Implement Retry Logic for Failed File Moves
**File:** `services/storageAdapter.js`  
**Location:** `moveFile()` and `saveFile()` methods  
**Reason:** Network issues or temporary filesystem errors could cause moves to fail. Should retry with exponential backoff.

### 12. Add Dataset Versioning and Rollback
**File:** `models/Dataset.js`, `controllers/datasetController.js`  
**Reason:** Users may want to keep multiple versions of datasets and rollback to previous versions if needed.

### 13. Implement Label File Validation (YOLO Format)
**File:** `controllers/datasetController.js` or new `services/labelValidator.js`  
**Reason:** Should validate that .txt files are actually valid YOLO format (class_id x y w h) before accepting them.

### 14. Add Support for Test Set Split
**File:** `workers/preprocessingWorker.js`  
**Location:** Line 183-185 (currently unlabeled images stay in root)  
**Reason:** Should support train/val/test splits (e.g., 70:20:10) and move unlabeled images to test folder.

### 15. Implement Storage Quota Management
**File:** `controllers/datasetController.js`, new `services/quotaService.js`  
**Reason:** Need to track and enforce storage quotas per company/project to prevent abuse and manage costs.

### 16. Add Comprehensive Error Logging and Monitoring
**File:** All files  
**Reason:** Currently uses console.log/error. Should integrate with logging service (Winston, Pino) and error tracking (Sentry) for production monitoring.

### 17. Implement CORS Configuration for Production
**File:** `server.js`  
**Location:** Line 25-33 (currently allows all origins)  
**Reason:** Security risk - should restrict CORS to specific frontend domains in production.

### 18. Add Request Rate Limiting
**File:** `routes/datasets.js` or new `middleware/rateLimiter.js`  
**Reason:** Prevent abuse by limiting upload requests per user/IP to avoid DoS attacks.

### 19. Implement File Deduplication
**File:** `controllers/datasetController.js`  
**Reason:** Check if identical files already exist (by hash) before storing to save disk space.

### 20. Add Dataset Export/Download Functionality
**File:** `controllers/datasetController.js`, `routes/datasets.js`  
**Reason:** Users should be able to download their processed datasets as ZIP archives for backup or transfer.

## Nice-to-Have TODOs

### 21. Add Dataset Preview/Visualization Endpoint
**File:** `controllers/datasetController.js`  
**Reason:** Return sample images with bounding boxes overlaid for quick dataset quality check.

### 22. Implement Batch Dataset Operations
**File:** `controllers/datasetController.js`  
**Reason:** Allow operations on multiple datasets at once (delete, archive, etc.).

### 23. Add Dataset Statistics Dashboard Data
**File:** `controllers/datasetController.js`  
**Reason:** Provide aggregated statistics (total datasets, storage used, processing times) for admin dashboard.

### 24. Implement Dataset Sharing/Permissions
**File:** `models/Dataset.js`, `controllers/datasetController.js`  
**Reason:** Allow users to share datasets with other users or teams with read/write permissions.

### 25. Add Support for Other Label Formats
**File:** `workers/preprocessingWorker.js`  
**Reason:** Currently only supports YOLO format. Should support COCO, Pascal VOC, etc.

