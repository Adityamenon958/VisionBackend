# Dataset Upload & Ingestion API Documentation

Complete API documentation for the dataset upload and ingestion system.

---

## API 1: Upload Dataset

### 1) **Endpoint**
```
POST /api/dataset/upload
```

### 2) **Method**
`POST`

### 3) **Description (what it does)**
Uploads dataset files (images and labels) to the system. The endpoint:
- Accepts multiple files via multipart/form-data
- Validates file types and sizes
- Saves files to organized storage structure
- Creates a dataset record in MongoDB
- Enqueues a preprocessing job for background processing
- Returns immediately with a `datasetId` for status tracking

**Status Flow:** `uploaded` → `queued` → `processing` → `ready` (or `failed`)

### 4) **Request fields / query params / body**

**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| `files` | File[] | ✅ Yes | Array of files (images: `.jpg`, `.jpeg`, `.png` or labels: `.txt`). Maximum 5000 files per request. |
| `company` | String | ✅ Yes | Company/organization identifier (e.g., `"acme-corp"`) |
| `project` | String | ✅ Yes | Project identifier (e.g., `"defect-detection"`) |
| `version` | String | ❌ No | Version identifier (defaults to `"v1"` if not provided) |
| `fileMeta` | String/File | ❌ No | Optional JSON string (as text field) OR JSON file containing folder mapping. Format: `[{ "originalName": "img1.jpg", "folder": "good" }, ...]` |

**Example Request (cURL):**
```bash
curl -X POST http://localhost:3000/api/dataset/upload \
  -F "company=acme-corp" \
  -F "project=defect-detection" \
  -F "version=v1" \
  -F "files=@image1.jpg" \
  -F "files=@image2.png" \
  -F "files=@label1.txt" \
  -F "fileMeta=@metadata.json"
```

### 5) **Files expected (Multer)**

**Multer Configuration:**
- **Storage:** Files are temporarily saved to `uploads/tmp/` directory
- **Temp Filename Format:** `temp-{timestamp}-{random}-{originalName}`
- **File Size Limit:** 50MB per file
- **Max Files:** 5000 files per request

**File Type Restrictions:**
- **For `files` field:**
  - Allowed extensions: `.jpg`, `.jpeg`, `.png`, `.txt`
  - Images: `.jpg`, `.jpeg`, `.png` → stored in `images/{folder}/` directory
  - Labels: `.txt` → stored in `labels/{folder}/` directory
- **For `fileMeta` field:**
  - Must be a JSON file (`.json` extension) or `application/json` MIME type

**File Filter Behavior:**
- Invalid file types are rejected with error message
- Rejected files are cleaned up from temp directory automatically

### 6) **Response JSON examples**

**Success Response (202 Accepted):**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "status": "queued",
  "message": "Dataset uploaded successfully. Preprocessing started.",
  "totalImages": 150,
  "uploadErrors": []
}
```

**Success Response with Upload Errors (202 Accepted):**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "status": "queued",
  "message": "Dataset uploaded successfully. Preprocessing started.",
  "totalImages": 145,
  "uploadErrors": [
    {
      "filename": "invalid.pdf",
      "reason": "Invalid extension: .pdf. Allowed: .jpg, .jpeg, .png, .txt"
    },
    {
      "filename": "corrupted.jpg",
      "reason": "Storage error: ENOENT: no such file or directory"
    }
  ]
}
```

### 7) **Error cases**

**400 Bad Request - Missing Required Fields:**
```json
{
  "error": "Missing required fields: company and project are required"
}
```

**400 Bad Request - No Files Uploaded:**
```json
{
  "error": "No files uploaded"
}
```

**400 Bad Request - Invalid File Type (Multer Filter):**
```
Error: Invalid file type. Allowed: .jpg, .jpeg, .png, .txt
```
*Note: This error is thrown by Multer middleware before reaching the controller.*

**400 Bad Request - File Too Large:**
```
Error: File too large
```
*Note: This error is thrown by Multer when file exceeds 50MB limit.*

**500 Internal Server Error:**
```json
{
  "error": "Internal server error",
  "message": "Detailed error message here"
}
```

### 8) **Notes / important behaviors**

- **Asynchronous Processing:** The endpoint returns immediately (202 Accepted) after enqueuing the preprocessing job. Actual processing happens in the background worker.

- **File Naming:** Uploaded files are renamed with UUID prefix to prevent collisions: `{datasetId}_{uuid}_{originalName}`

- **Folder Organization:** Files can be organized into virtual folders using `fileMeta`. If `fileMeta` is not provided, all files default to `"dataset"` folder.

- **File Manifest:** Each uploaded file is tracked in the dataset's `files` array with:
  - `storedName`: Unique filename on disk
  - `originalName`: Original filename from user
  - `type`: `"image"` or `"label"`
  - `size`: File size in bytes
  - `folder`: Virtual folder name
  - `storedPath`: Relative path within dataset

- **Storage Structure:**
  ```
  {storagePath}/
    ├── images/
    │   ├── {folder}/
    │   │   └── {datasetId}_{uuid}_{originalName}
    │   └── ...
    └── labels/
        ├── {folder}/
        │   └── {datasetId}_{uuid}_{originalName}
        └── ...
  ```

- **Preprocessing Queue:** After successful upload, a job is added to the preprocessing queue with:
  - `datasetId`
  - `storagePath`
  - `company`, `project`, `version`
  - Retry configuration: 3 attempts with exponential backoff (starts at 2s)

- **Status Transitions:** 
  - Initial: `uploaded` (when dataset record created)
  - After enqueue: `queued` (returned in response)
  - Worker starts: `processing`
  - Worker completes: `ready`
  - Worker fails: `failed`

- **Error Handling:** Upload errors (invalid files, storage failures) are collected in `uploadErrors` array but don't fail the entire upload. The dataset is still created and processing is enqueued.

### 9) **Where the logic is implemented (file + function name)**
- **Route Definition:** `routes/datasets.js` - Line 89-95
- **Controller Function:** `controllers/datasetController.js` - `uploadDataset` (Line 26-246)
- **Multer Configuration:** `routes/datasets.js` - Lines 30-77
- **Model:** `models/Dataset.js` - Dataset schema

---

## API 2: Get Dataset Status (Polling)

### 1) **Endpoint**
```
GET /api/dataset/:datasetId/status
```

### 2) **Method**
`GET`

### 3) **Description (what it does)**
Returns minimal status information for a dataset. This endpoint is optimized for frequent polling to check processing progress without fetching the full dataset metadata.

**Use Case:** Frontend can poll this endpoint every few seconds to show progress updates during preprocessing.

### 4) **Request fields / query params / body**

**URL Parameters:**
- `datasetId` (path parameter) - MongoDB ObjectId of the dataset

**Example Request:**
```
GET /api/dataset/507f1f77bcf86cd799439011/status
```

### 5) **Files expected (Multer)**
N/A - This endpoint does not accept file uploads.

### 6) **Response JSON examples**

**Success Response - Queued Status:**
```json
{
  "status": "queued",
  "totalImages": 150,
  "uploadErrors": []
}
```

**Success Response - Processing Status (with progress):**
```json
{
  "status": "processing",
  "totalImages": 150,
  "trainCount": 80,
  "valCount": 20,
  "uploadErrors": []
}
```

**Success Response - Ready Status:**
```json
{
  "status": "ready",
  "totalImages": 150,
  "uploadErrors": []
}
```

**Success Response - Failed Status:**
```json
{
  "status": "failed",
  "totalImages": 150,
  "uploadErrors": [
    {
      "filename": "image1.jpg",
      "reason": "Processing error: File not found"
    }
  ]
}
```

**Success Response - With Upload Errors:**
```json
{
  "status": "processing",
  "totalImages": 145,
  "trainCount": 70,
  "valCount": 18,
  "uploadErrors": [
    {
      "filename": "invalid.pdf",
      "reason": "Invalid extension: .pdf. Allowed: .jpg, .jpeg, .png, .txt"
    }
  ]
}
```

### 7) **Error cases**

**404 Not Found:**
```json
{
  "error": "Dataset not found"
}
```
*Occurs when the `datasetId` doesn't exist in the database.*

**500 Internal Server Error:**
```json
{
  "error": "Internal server error",
  "message": "Detailed error message here"
}
```

### 8) **Notes / important behaviors**

- **Minimal Response:** This endpoint returns only essential status fields to minimize response size for frequent polling.

- **Status Values:**
  - `uploaded`: Files uploaded, dataset record created
  - `queued`: Preprocessing job added to queue
  - `processing`: Worker is actively processing the dataset
  - `ready`: Preprocessing completed successfully
  - `failed`: Processing failed (check `errorMessage` in full dataset metadata)

- **Progress Fields:** When `status` is `"processing"`, the response includes:
  - `trainCount`: Number of images copied to training set
  - `valCount`: Number of images copied to validation set
  - These values update incrementally as the worker processes files

- **Upload Errors:** The `uploadErrors` array is only included if there are errors. If empty, the field is `undefined` (not included in response).

- **Polling Recommendation:** 
  - Poll every 2-5 seconds during `processing` status
  - Poll every 10-30 seconds during `queued` status
  - Stop polling when status is `ready` or `failed`

- **Performance:** This endpoint is lightweight and queries only the dataset status fields, making it suitable for frequent polling.

### 9) **Where the logic is implemented (file + function name)**
- **Route Definition:** `routes/datasets.js` - Line 109
- **Controller Function:** `controllers/datasetController.js` - `getDatasetStatus` (Line 301-332)
- **Model:** `models/Dataset.js` - Dataset schema

---

## API 3: Get Dataset Metadata

### 1) **Endpoint**
```
GET /api/dataset/:datasetId
```

### 2) **Method**
`GET`

### 3) **Description (what it does)**
Returns complete dataset metadata including:
- All dataset information (company, project, version, status)
- Complete file manifest with all uploaded files
- Processing statistics (train/val/test counts, labeled/unlabeled counts)
- Folders summary (grouped by folder name with image/label counts)
- Upload errors
- Labels extracted from label files
- Storage paths and timestamps

**Use Case:** Fetch full dataset details for display in dashboard, dataset management UI, or detailed analysis.

### 4) **Request fields / query params / body**

**URL Parameters:**
- `datasetId` (path parameter) - MongoDB ObjectId of the dataset

**Example Request:**
```
GET /api/dataset/507f1f77bcf86cd799439011
```

### 5) **Files expected (Multer)**
N/A - This endpoint does not accept file uploads.

### 6) **Response JSON examples**

**Success Response - Complete Dataset Metadata:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "company": "acme-corp",
  "project": "defect-detection",
  "version": "v1",
  "storagePath": "/data/datasets/acme-corp/defect-detection/v1",
  "status": "ready",
  "totalImages": 150,
  "sizeBytes": 52428800,
  "labeledImages": 120,
  "unlabeledImages": 30,
  "trainCount": 96,
  "valCount": 24,
  "testCount": 15,
  "thumbnailsGenerated": 50,
  "labels": [
    "class_0",
    "class_1",
    "class_2"
  ],
  "uploadErrors": [],
  "files": [
    {
      "storedName": "507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg",
      "originalName": "image1.jpg",
      "type": "image",
      "size": 245760,
      "folder": "good",
      "storedPath": "images/good/507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg"
    },
    {
      "storedName": "507f1f77bcf86cd799439011_e5f6g7h8_image1.txt",
      "originalName": "image1.txt",
      "type": "label",
      "size": 1024,
      "folder": "good",
      "storedPath": "labels/good/507f1f77bcf86cd799439011_e5f6g7h8_image1.txt"
    }
  ],
  "folders": {
    "good": {
      "images": 80,
      "labels": 80,
      "files": [
        {
          "storedName": "507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg",
          "originalName": "image1.jpg",
          "type": "image",
          "size": 245760,
          "storedPath": "images/good/507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg"
        }
      ]
    },
    "defect": {
      "images": 40,
      "labels": 40,
      "files": [
        {
          "storedName": "507f1f77bcf86cd799439011_i9j0k1l2_defect1.jpg",
          "originalName": "defect1.jpg",
          "type": "image",
          "size": 189440,
          "storedPath": "images/defect/507f1f77bcf86cd799439011_i9j0k1l2_defect1.jpg"
        }
      ]
    },
    "dataset": {
      "images": 30,
      "labels": 0,
      "files": [
        {
          "storedName": "507f1f77bcf86cd799439011_m3n4o5p6_unlabeled.jpg",
          "originalName": "unlabeled.jpg",
          "type": "image",
          "size": 156672,
          "storedPath": "images/dataset/507f1f77bcf86cd799439011_m3n4o5p6_unlabeled.jpg"
        }
      ]
    }
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

**Success Response - Processing Status:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "company": "acme-corp",
  "project": "defect-detection",
  "version": "v1",
  "storagePath": "/data/datasets/acme-corp/defect-detection/v1",
  "status": "processing",
  "totalImages": 150,
  "sizeBytes": 52428800,
  "trainCount": 80,
  "valCount": 20,
  "files": [
    {
      "storedName": "507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg",
      "originalName": "image1.jpg",
      "type": "image",
      "size": 245760,
      "folder": "good",
      "storedPath": "images/good/507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg"
    }
  ],
  "folders": {
    "good": {
      "images": 80,
      "labels": 80,
      "files": []
    }
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:33:00.000Z"
}
```

**Success Response - Failed Status:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "company": "acme-corp",
  "project": "defect-detection",
  "version": "v1",
  "storagePath": "/data/datasets/acme-corp/defect-detection/v1",
  "status": "failed",
  "errorMessage": "Processing error: File not found",
  "totalImages": 150,
  "uploadErrors": [
    {
      "filename": "image1.jpg",
      "reason": "Processing error: File not found"
    }
  ],
  "files": [],
  "folders": {},
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

### 7) **Error cases**

**404 Not Found:**
```json
{
  "error": "Dataset not found"
}
```
*Occurs when the `datasetId` doesn't exist in the database or is invalid.*

**500 Internal Server Error:**
```json
{
  "error": "Internal server error",
  "message": "Detailed error message here"
}
```

### 8) **Notes / important behaviors**

- **Complete Metadata:** This endpoint returns the full dataset document with all fields, unlike the status endpoint which returns minimal data.

- **Folders Summary:** The response includes a `folders` object that groups files by their virtual folder name. Each folder entry contains:
  - `images`: Count of image files in that folder
  - `labels`: Count of label files in that folder
  - `files`: Array of file objects in that folder (for detailed view)

- **File Manifest:** The `files` array contains all uploaded files with:
  - `storedName`: Unique filename on disk (with UUID prefix)
  - `originalName`: Original filename from upload
  - `type`: `"image"` or `"label"`
  - `size`: File size in bytes
  - `folder`: Virtual folder name
  - `storedPath`: Relative path from dataset root

- **Processing Statistics:** When status is `ready`, the response includes:
  - `labeledImages`: Count of images with corresponding label files
  - `unlabeledImages`: Count of images without label files
  - `trainCount`: Images in training set
  - `valCount`: Images in validation set
  - `testCount`: Images in test set
  - `thumbnailsGenerated`: Number of thumbnails created (max 50)

- **Labels:** The `labels` array contains unique class IDs extracted from label files (YOLO format). Format: `["class_0", "class_1", ...]`

- **Timestamps:** Includes `createdAt` and `updatedAt` timestamps (automatically managed by Mongoose).

- **Storage Path:** The `storagePath` field shows the root directory where the dataset is stored. Actual files are organized under `images/` and `labels/` subdirectories.

- **Performance:** This endpoint loads the complete dataset document and computes the folders summary, so it's heavier than the status endpoint. Use for detailed views, not for frequent polling.

### 9) **Where the logic is implemented (file + function name)**
- **Route Definition:** `routes/datasets.js` - Line 102
- **Controller Function:** `controllers/datasetController.js` - `getDataset` (Line 253-294)
- **Model:** `models/Dataset.js` - Dataset schema

---

## Additional Information

### Background Processing (Not an API Endpoint)

The preprocessing worker (`workers/preprocessingWorker.js`) processes datasets in the background. It is triggered automatically when a dataset is uploaded and enqueued.

**Worker Function:** `processPreprocessingJob` (Line 59-459)

**What it does:**
1. Updates dataset status to `processing`
2. Performs 80:20 train/validation split
3. Copies images and labels to train/val/test folders (flattened structure)
4. Generates thumbnails (up to 50 samples)
5. Extracts labels from label files
6. Computes final statistics
7. Updates dataset status to `ready` or `failed`

**Split Strategy:** Controlled by `SPLIT_STRATEGY` environment variable:
- `combined` (default): Combines labeled and unlabeled images for split
- `labeled-only`: Only splits labeled images, places unlabeled in test folder

**Note:** The worker is not directly accessible via API. It processes jobs from the queue automatically.

---

## Dataset Status Flow

```
uploaded → queued → processing → ready
                              ↓
                           failed
```

- **uploaded**: Dataset record created, files uploaded
- **queued**: Preprocessing job added to queue
- **processing**: Worker is actively processing
- **ready**: Processing completed successfully
- **failed**: Processing failed (check `errorMessage`)

---

## File Storage Structure

```
{storagePath}/
├── images/
│   ├── {folder}/
│   │   └── {datasetId}_{uuid}_{originalName}
│   └── train/
│       └── {datasetId}_{uuid}_{originalName}  (flattened)
│   └── val/
│       └── {datasetId}_{uuid}_{originalName}  (flattened)
│   └── test/
│       └── {datasetId}_{uuid}_{originalName}  (flattened)
├── labels/
│   ├── {folder}/
│   │   └── {datasetId}_{uuid}_{originalName}
│   └── train/
│       └── {datasetId}_{uuid}_{originalName}  (flattened)
│   └── val/
│       └── {datasetId}_{uuid}_{originalName}  (flattened)
└── thumbnails/
    └── thumb_{datasetId}_{uuid}_{originalName}
```

---

## Error Handling Summary

All endpoints follow consistent error handling:
- **400 Bad Request**: Invalid input, missing required fields, validation errors
- **404 Not Found**: Resource (dataset) doesn't exist
- **500 Internal Server Error**: Server-side errors, database issues, unexpected exceptions

Error responses include:
- `error`: Error type/category
- `message`: Detailed error message (for 500 errors)

---

## Notes on Implementation

- **Multer Configuration**: File uploads are handled by Multer middleware configured in `routes/datasets.js`
- **Queue System**: Uses Bull queue (Redis-based) for background job processing
- **Storage Adapter**: Abstracted storage layer supports local filesystem and cloud storage
- **File Matching**: Images and labels are matched by base filename (without extension)
- **UUID Prefixing**: All stored files are prefixed with UUID to prevent collisions
- **Folder Preservation**: Original folder structure is preserved in `images/{folder}/` and `labels/{folder}/`, while training uses flattened structure

---

*Documentation generated from backend codebase analysis.*
*Last updated: Based on current codebase state*




