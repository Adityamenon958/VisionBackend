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

## Troubleshooting

- **"MongoDB connection error"** → Check MongoDB is running
- **"Redis connection error"** → Check Redis is running
- **"Worker not processing"** → Check worker terminal for errors
- **"Status stuck on queued"** → Check worker is running and Redis is connected

