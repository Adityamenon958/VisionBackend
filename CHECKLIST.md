# Runnable Checklist

## Prerequisites Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Create .env file** (copy from ENV_SETUP.md or create manually)
   ```bash
   # Windows PowerShell:
   Copy-Item ENV_SETUP.md .env
   # Then edit .env with your actual values
   
   # Linux/Mac:
   cp ENV_SETUP.md .env
   # Then edit .env with your actual values
   ```

3. **Start MongoDB**
   ```bash
   # Windows: If installed as service, it should auto-start
   # Or run: mongod
   
   # Linux/Mac:
   sudo systemctl start mongod
   # Or: mongod
   ```

4. **Start Redis**
   ```bash
   # Windows: Download and run redis-server.exe
   # Or use WSL: wsl redis-server
   
   # Linux/Mac:
   redis-server
   ```

## Running the Application

### Terminal 1: Start API Server
```bash
npm run dev
```

**Expected Output:**
```
✅ Connected to MongoDB
✅ Server running on http://localhost:3000
📁 Dataset upload: POST http://localhost:3000/api/dataset/upload
📊 Dataset status: GET http://localhost:3000/api/dataset/:datasetId/status
```

### Terminal 2: Start Preprocessing Worker
```bash
node workers/preprocessingWorker.js
```

**Expected Output:**
```
✅ Worker connected to MongoDB
✅ Redis connected
✅ Preprocessing worker started. Waiting for jobs...
```

## Testing with Postman

### 1. Upload Dataset

**Request:**
- **Method:** `POST`
- **URL:** `http://localhost:3000/api/dataset/upload`
- **Body Type:** `form-data`

**Form Fields:**
| Key | Type | Value |
|-----|------|-------|
| `company` | Text | `acme-corp` |
| `project` | Text | `defect-detection` |
| `version` | Text | `v1` (optional) |
| `files` | File | Select image file (.jpg, .png) |
| `files` | File | Select another image file |
| `files` | File | Select label file (.txt) |

**Note:** Click "Add" next to the `files` field to add multiple files.

**Expected Response (202 Accepted):**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "status": "queued",
  "message": "Dataset uploaded successfully. Preprocessing started.",
  "totalImages": 2,
  "uploadErrors": []
}
```

**Save the `datasetId` for next steps!**

### 2. Check Dataset Status (Polling)

**Request:**
- **Method:** `GET`
- **URL:** `http://localhost:3000/api/dataset/{datasetId}/status`
  - Replace `{datasetId}` with the ID from step 1

**Expected Response (while processing):**
```json
{
  "status": "processing",
  "totalImages": 2,
  "uploadErrors": []
}
```

**Expected Response (when ready):**
```json
{
  "status": "ready",
  "totalImages": 2,
  "uploadErrors": []
}
```

**Tip:** Click "Send" multiple times to poll for status updates.

### 3. Get Full Dataset Metadata

**Request:**
- **Method:** `GET`
- **URL:** `http://localhost:3000/api/dataset/{datasetId}`

**Expected Response:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "company": "acme-corp",
  "project": "defect-detection",
  "version": "v1",
  "storagePath": "C:\\Gsn Soln\\VisionBackend\\datasets\\acme-corp\\defect-detection\\v1",
  "files": [
    {
      "storedName": "507f1f77bcf86cd799439011_abc123_image1.jpg",
      "originalName": "image1.jpg",
      "type": "image",
      "size": 524288
    },
    {
      "storedName": "507f1f77bcf86cd799439011_def456_image1.txt",
      "originalName": "image1.txt",
      "type": "label",
      "size": 1024
    }
  ],
  "totalImages": 2,
  "sizeBytes": 525312,
  "status": "ready",
  "labeledImages": 1,
  "unlabeledImages": 1,
  "trainCount": 0,
  "valCount": 1,
  "labels": ["class_0"],
  "uploadErrors": [],
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

## Verification Steps

1. **Check Worker Terminal** - Should show processing logs:
   ```
   🔄 Processing dataset 507f1f77bcf86cd799439011...
   ✅ Dataset 507f1f77bcf86cd799439011 processed successfully
      - Train: 0, Val: 1
      - Labeled: 1, Unlabeled: 1
      - Thumbnails: 1
   ✅ Job 1 completed
   ```

2. **Check File Structure** - Verify files are organized:
   ```
   datasets/
   └── acme-corp/
       └── defect-detection/
           └── v1/
               ├── images/
               │   ├── train/
               │   └── val/
               │       └── {datasetId}_{uuid}_image1.jpg
               ├── labels/
               │   └── val/
               │       └── {datasetId}_{uuid}_image1.txt
               └── thumbnails/
                   └── thumb_{datasetId}_{uuid}_image1.jpg
   ```

3. **Check MongoDB** - Verify dataset document exists with files manifest

## Testing Multi-Folder Upload Support

### Test 1: Single Folder Upload (No fileMeta) - Backward Compatibility

**Purpose:** Verify that uploads without fileMeta default to folder='dataset'

**cURL Command (Windows):**
```bash
curl -v -X POST "http://localhost:3000/api/dataset/upload" ^
-F "company=acme" ^
-F "project=line1" ^
-F "version=v1" ^
-F "files=@C:/Gsn Soln/VisionBackend/test_dataset/020250221_021215_lmc_8.4.jpg" ^
-F "files=@C:/Gsn Soln/VisionBackend/test_dataset/020250221_021215_lmc_8.4.txt"
```

**Expected Result:**
- Files stored in `images/dataset/` and `labels/dataset/`
- GET `/api/dataset/{datasetId}` shows `folders.dataset` with all files
- All files have `folder: "dataset"` in manifest

**Verification:**
```bash
# Check dataset response includes folders summary
curl http://localhost:3000/api/dataset/{datasetId}
# Should show: "folders": { "dataset": { "images": 1, "labels": 1, "files": [...] } }
```

---

### Test 2: Multi-Folder Upload (With fileMeta)

**Purpose:** Verify files are stored in folder subdirectories and grouped correctly

**Step 1: Create fileMeta.json**
Create `test_dataset/fileMeta.json`:
```json
[
  {"originalName":"020250221_021215_lmc_8.4.jpg","folder":"good"},
  {"originalName":"020250221_021215_lmc_8.4.txt","folder":"good"},
  {"originalName":"020250221_021215_lmc_8.4 (1).jpg","folder":"defect1"},
  {"originalName":"020250221_021215_lmc_8.4 (1).txt","folder":"defect1"}
]
```

**cURL Command (Windows):**
```bash
curl -v -X POST "http://localhost:3000/api/dataset/upload" ^
-F "company=acme" ^
-F "project=line1" ^
-F "version=v2" ^
-F "fileMeta=@C:/Gsn Soln/VisionBackend/test_dataset/fileMeta.json;type=application/json" ^
-F "files=@C:/Gsn Soln/VisionBackend/test_dataset/020250221_021215_lmc_8.4.jpg" ^
-F "files=@C:/Gsn Soln/VisionBackend/test_dataset/020250221_021215_lmc_8.4.txt" ^
-F "files=@C:/Gsn Soln/VisionBackend/test_dataset/020250221_021215_lmc_8.4 (1).jpg" ^
-F "files=@C:/Gsn Soln/VisionBackend/test_dataset/020250221_021215_lmc_8.4 (1).txt"
```

**Expected Result:**
- Files stored in `images/good/` and `images/defect1/` (and corresponding label folders)
- GET `/api/dataset/{datasetId}` shows `folders.good` and `folders.defect1`
- Each file has correct `folder` and `storedPath` in manifest

**Verification:**
```bash
# Check folder structure on disk
# Should see: datasets/acme/line1/v2/images/good/... and images/defect1/...

# Check API response
curl http://localhost:3000/api/dataset/{datasetId}
# Should show: "folders": { "good": {...}, "defect1": {...} }
```

---

### Test 3: Preprocessing Worker Generates Flat Train/Val Structure

**Purpose:** Verify worker copies files to flat train/val directories (no folder hierarchy)

**After Test 2 completes preprocessing:**

**Verification:**
```bash
# Check train/val structure is flat (no folders)
# Should see:
# datasets/acme/line1/v2/images/train/{storedName}.jpg (flat, no subfolders)
# datasets/acme/line1/v2/images/val/{storedName}.jpg (flat, no subfolders)
# datasets/acme/line1/v2/labels/train/{storedName}.txt (flat, no subfolders)
# datasets/acme/line1/v2/labels/val/{storedName}.txt (flat, no subfolders)

# Original folder structure should still exist:
# datasets/acme/line1/v2/images/good/{storedName}.jpg (preserved)
# datasets/acme/line1/v2/images/defect1/{storedName}.jpg (preserved)
```

**Expected Result:**
- Train/val folders contain files directly (flat structure for YOLO training)
- Original folder structure (`images/good/`, `images/defect1/`) remains intact
- Files are copied (not moved), so originals exist for dashboard view

---

### Test 4: Thumbnails Generated from Original Folder Locations

**Purpose:** Verify thumbnails are created from original folder paths, not train/val

**After preprocessing completes:**

**Verification:**
```bash
# Check thumbnails folder
# Should see: datasets/acme/line1/v2/thumbnails/thumb_{storedName}.jpg

# Verify thumbnails were generated from original locations
# Worker should read from: images/good/{storedName}.jpg (not train/images/)
```

**Expected Result:**
- Thumbnails exist in `thumbnails/` folder
- Worker reads from original folder locations (`images/{folder}/...`)
- Thumbnails accessible for dashboard preview

---

### Test 5: Dataset Files Manifest Includes Folder and storedPath

**Purpose:** Verify manifest contains folder and storedPath fields

**cURL Command:**
```bash
curl http://localhost:3000/api/dataset/{datasetId}
```

**Expected Response Structure:**
```json
{
  "files": [
    {
      "storedName": "6925603e_abc123_image.jpg",
      "originalName": "image.jpg",
      "type": "image",
      "size": 524288,
      "folder": "good",
      "storedPath": "images/good/6925603e_abc123_image.jpg"
    },
    {
      "storedName": "6925603e_def456_image.txt",
      "originalName": "image.txt",
      "type": "label",
      "size": 1024,
      "folder": "good",
      "storedPath": "labels/good/6925603e_def456_image.txt"
    }
  ],
  "folders": {
    "good": {
      "images": 1,
      "labels": 1,
      "files": [...]
    }
  }
}
```

**Verification:**
- Every file entry has `folder` field
- Every file entry has `storedPath` field (relative to dataset root)
- `folders` summary groups files by folder name

---

## Testing Split Strategy and Progress Updates

### Test 6: Combined Split Strategy (Default) - All Images in Train/Val

**Purpose:** Verify that all images (labeled + unlabeled) are split 80:20 into train/val folders

**Setup:**
- Upload dataset with mix of labeled and unlabeled images
- Ensure `SPLIT_STRATEGY` is not set (defaults to 'combined')

**Expected Result:**
- All images appear in either `images/train/` or `images/val/` (flattened structure)
- Labels only appear in `labels/train/` or `labels/val/` if corresponding image has label
- Unlabeled images are included in the split
- Dataset metadata shows: `trainCount + valCount = totalImages`
- Progress updates visible during processing (poll status endpoint)

**Verification:**
```bash
# Check train/val folders are populated
# Should see: datasets/acme/line1/v1/images/train/*.jpg (flat, no subfolders)
# Should see: datasets/acme/line1/v1/images/val/*.jpg (flat, no subfolders)

# Check progress during processing
curl http://localhost:3000/api/dataset/{datasetId}/status
# Should show trainCount and valCount updating as worker processes
```

---

### Test 7: Labeled-Only Split Strategy

**Purpose:** Verify that only labeled images are split, unlabeled go to test folder

**Setup:**
- Set environment variable: `SPLIT_STRATEGY=labeled-only`
- Upload dataset with mix of labeled and unlabeled images

**Expected Result:**
- Labeled images split 80:20 into `images/train/` and `images/val/`
- Unlabeled images copied to `images/test/` folder
- Dataset metadata shows: `testCount > 0` if unlabeled images exist
- Labels appear in `labels/train/` and `labels/val/` for labeled images only

**Verification:**
```bash
# Set environment variable (Windows PowerShell):
$env:SPLIT_STRATEGY="labeled-only"

# Restart worker, then upload dataset

# Check test folder exists with unlabeled images
# Should see: datasets/acme/line1/v1/images/test/*.jpg (unlabeled images)

# Check dataset metadata
curl http://localhost:3000/api/dataset/{datasetId}
# Should show: "testCount": <number of unlabeled images>
```

---

### Test 8: Thumbnail Generation Reliability

**Purpose:** Verify thumbnails are generated for train+val images

**Expected Result:**
- Thumbnails generated for up to first 50 images from train+val combined
- Thumbnails saved in `thumbnails/` folder
- Dataset metadata shows `thumbnailsGenerated` count
- Thumbnails read from original folder locations (not train/val copies)

**Verification:**
```bash
# Check thumbnails folder
# Should see: datasets/acme/line1/v1/thumbnails/thumb_*.jpg

# Check dataset metadata
curl http://localhost:3000/api/dataset/{datasetId}
# Should show: "thumbnailsGenerated": <number up to 50>
```

---

### Test 9: Progress Updates During Processing

**Purpose:** Verify frontend can poll and see progress updates

**Steps:**
1. Upload dataset
2. Poll status endpoint every 2 seconds: `GET /api/dataset/{datasetId}/status`
3. Watch for updates

**Expected Result:**
- Status changes: `queued` → `processing` → `ready`
- During processing, `trainCount` and `valCount` update incrementally
- Final status shows complete counts

**Verification:**
```bash
# Poll status endpoint multiple times
curl http://localhost:3000/api/dataset/{datasetId}/status
# First: { "status": "queued", "totalImages": 10 }
# Then:  { "status": "processing", "totalImages": 10, "trainCount": 0, "valCount": 0 }
# Then:  { "status": "processing", "totalImages": 10, "trainCount": 6, "valCount": 0 }
# Then:  { "status": "processing", "totalImages": 10, "trainCount": 6, "valCount": 2 }
# Final: { "status": "ready", "totalImages": 10 }
```

---

### Test 10: Test Folder Sample Copy

**Purpose:** Verify 10% of images are copied to test folder (images only, no labels)

**Steps:**
1. Upload dataset with multiple images (e.g., 20+ images)
2. Wait for preprocessing to complete
3. Check test folder and dataset metadata

**Expected Result:**
- `images/test/` folder contains approximately 10% of total images (rounded up, minimum 1)
- Test images are copies (original folder structure preserved)
- No `labels/test/` folder created
- Dataset metadata shows `testCount` field with actual count
- Test images may also exist in train/val (acceptable)
- Train/val logic remains unchanged

**Verification:**
```bash
# Check test folder exists with images
# Should see: datasets/acme/line1/v1/images/test/*.jpg
# Count should be: Math.ceil(totalImages * 0.10), minimum 1

# Check no labels/test folder
# Should NOT exist: datasets/acme/line1/v1/labels/test/

# Check dataset metadata
curl http://localhost:3000/api/dataset/{datasetId}
# Should show: "testCount": <number approximately 10% of totalImages>

# Verify train/val still work correctly
# Should see: images/train/ and images/val/ populated as before
```

---

## Testing New Dataset Management Endpoints

### Test 11: Get Dataset Folders Summary

**Purpose:** Verify folder summary endpoint returns correct statistics

**cURL Command:**
```bash
# Replace {datasetId} with actual dataset ID
curl http://localhost:3000/api/dataset/{datasetId}/folders
```

**Expected Response:**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "company": "acme-corp",
  "project": "defect-detection",
  "version": "v1",
  "totalImages": 150,
  "sizeBytes": 52428800,
  "folders": {
    "good": {
      "images": 80,
      "labels": 80,
      "sizeBytes": 41943040
    },
    "defect": {
      "images": 40,
      "labels": 40,
      "sizeBytes": 10485760
    },
    "dataset": {
      "images": 30,
      "labels": 0,
      "sizeBytes": 0
    }
  }
}
```

**Verification:**
- Each folder shows correct image and label counts
- `sizeBytes` is sum of all file sizes in that folder
- Response includes dataset metadata (company, project, version)

---

### Test 12: Get Dataset Files (Paginated with Filters)

**Purpose:** Verify paginated file listing with filters and sorting

**cURL Commands:**

**Basic request (first page):**
```bash
curl "http://localhost:3000/api/dataset/{datasetId}/files?page=1&limit=10"
```

**Filter by folder:**
```bash
curl "http://localhost:3000/api/dataset/{datasetId}/files?folder=good&limit=20"
```

**Filter by type:**
```bash
curl "http://localhost:3000/api/dataset/{datasetId}/files?type=image&page=1&limit=50"
```

**Sort by size (descending):**
```bash
curl "http://localhost:3000/api/dataset/{datasetId}/files?sort=size&order=desc&limit=10"
```

**Combined filters:**
```bash
curl "http://localhost:3000/api/dataset/{datasetId}/files?folder=good&type=image&sort=name&order=asc&page=1&limit=25"
```

**Expected Response:**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "page": 1,
  "limit": 10,
  "totalFiles": 150,
  "totalPages": 15,
  "files": [
    {
      "id": "507f1f77bcf86cd799439012",
      "storedName": "507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg",
      "originalName": "image1.jpg",
      "type": "image",
      "size": 245760,
      "folder": "good",
      "storedPath": "images/good/507f1f77bcf86cd799439011_a1b2c3d4_image1.jpg",
      "thumbnailAvailable": true
    },
    {
      "id": "507f1f77bcf86cd799439013",
      "storedName": "507f1f77bcf86cd799439011_e5f6g7h8_image1.txt",
      "originalName": "image1.txt",
      "type": "label",
      "size": 1024,
      "folder": "good",
      "storedPath": "labels/good/507f1f77bcf86cd799439011_e5f6g7h8_image1.txt",
      "thumbnailAvailable": false
    }
  ]
}
```

**Verification:**
- Pagination works correctly (page, limit, totalPages)
- Folder filter returns only files from specified folder
- Type filter returns only images or labels
- Sorting works (by name or size, asc/desc)
- `thumbnailAvailable` is true only for images with thumbnails
- Each file has unique `id` (subdocument _id)

**Error Cases:**
```bash
# Invalid page
curl "http://localhost:3000/api/dataset/{datasetId}/files?page=0"
# Expected: 400 Bad Request

# Invalid type
curl "http://localhost:3000/api/dataset/{datasetId}/files?type=invalid"
# Expected: 400 Bad Request

# Limit exceeds max (500)
curl "http://localhost:3000/api/dataset/{datasetId}/files?limit=1000"
# Expected: Limit capped at 500
```

---

### Test 13: Get File Thumbnail

**Purpose:** Verify thumbnail serving endpoint

**Prerequisites:**
- Dataset must be processed (status: 'ready')
- Thumbnails must exist (generated during preprocessing)

**Step 1: Get file ID from files endpoint**
```bash
# Get first image file ID
curl "http://localhost:3000/api/dataset/{datasetId}/files?type=image&limit=1"
# Copy the "id" field from response
```

**Step 2: Request thumbnail**
```bash
# Replace {datasetId} and {fileId} with actual values
curl -o thumbnail.jpg "http://localhost:3000/api/dataset/{datasetId}/file/{fileId}/thumbnail"
```

**Expected Behavior:**
- Returns image file (JPEG or PNG) with correct Content-Type
- Sets Cache-Control header: `public, max-age=3600`
- File can be saved and viewed

**Error Cases:**
```bash
# Non-existent file ID
curl "http://localhost:3000/api/dataset/{datasetId}/file/invalid_id/thumbnail"
# Expected: 404 Not Found - "File not found"

# Label file (no thumbnail)
curl "http://localhost:3000/api/dataset/{datasetId}/file/{labelFileId}/thumbnail"
# Expected: 404 Not Found - "Thumbnail not available for non-image files"

# Thumbnail doesn't exist
curl "http://localhost:3000/api/dataset/{datasetId}/file/{imageFileId}/thumbnail"
# Expected: 404 Not Found - "Thumbnail not found"
```

**Verification:**
- Thumbnail file is served correctly
- Content-Type header is set (image/jpeg or image/png)
- Cache-Control header is present
- File can be opened in image viewer

---

### Test 14: Integration Test - Complete Workflow

**Purpose:** Test all new endpoints together in a realistic workflow

**Steps:**

1. **Upload a dataset** (from Test 1)
   - Save the `datasetId`

2. **Wait for preprocessing to complete**
   - Poll status endpoint until `status: "ready"`

3. **Get folders summary**
   ```bash
   curl http://localhost:3000/api/dataset/{datasetId}/folders
   ```
   - Verify folder counts match uploaded files

4. **List all files (paginated)**
   ```bash
   curl "http://localhost:3000/api/dataset/{datasetId}/files?page=1&limit=50"
   ```
   - Verify all files are listed
   - Check `thumbnailAvailable` flags

5. **Filter files by folder**
   ```bash
   curl "http://localhost:3000/api/dataset/{datasetId}/files?folder=good"
   ```
   - Verify only files from "good" folder are returned

6. **Get a thumbnail**
   ```bash
   # Get file ID from step 4
   curl -o test_thumbnail.jpg "http://localhost:3000/api/dataset/{datasetId}/file/{fileId}/thumbnail"
   ```
   - Verify thumbnail is served and can be viewed

**Expected Result:**
- All endpoints work correctly
- Data is consistent across endpoints
- Thumbnails are accessible for processed images

---

## Troubleshooting

- **"MongoDB connection error"** → Check MongoDB is running
- **"Redis connection error"** → Check Redis is running
- **"Worker not processing"** → Check worker terminal for errors
- **"Status stuck on queued"** → Check worker is running and Redis is connected
- **"fileMeta parse error"** → Check JSON format is valid, backend will default to 'dataset' folder
- **"Files not in expected folders"** → Verify fileMeta JSON matches uploaded file originalName exactly
- **"Train/val folders empty"** → Check worker logs for copy errors, verify source files exist
- **"Thumbnails not generated"** → Check worker logs, verify images are readable, check disk space
- **"Progress not updating"** → Worker saves dataset periodically; if stuck, check for errors in worker terminal
- **"Folder summary shows wrong counts"** → Verify dataset.files array is populated correctly in MongoDB
- **"Files endpoint returns empty"** → Check filters (folder/type) match actual data, verify pagination parameters
- **"Thumbnail returns 404"** → Ensure dataset is processed (status: 'ready'), check thumbnails folder exists, verify fileId is correct
- **"Route not found"** → Verify route ordering in routes/datasets.js (specific routes before wildcard /:datasetId)

