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

## Troubleshooting

- **"MongoDB connection error"** → Check MongoDB is running
- **"Redis connection error"** → Check Redis is running
- **"Worker not processing"** → Check worker terminal for errors
- **"Status stuck on queued"** → Check worker is running and Redis is connected
- **"fileMeta parse error"** → Check JSON format is valid, backend will default to 'dataset' folder
- **"Files not in expected folders"** → Verify fileMeta JSON matches uploaded file originalName exactly

