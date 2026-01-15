# Vision Backend - Dataset Ingestion System

This is the first iteration of the dataset ingestion system for the Vision ML pipeline. It handles dataset uploads, validation, storage, and background preprocessing.

## 📋 Prerequisites

Before you start, make sure you have installed:

1. **Node.js** (v16 or higher) - [Download](https://nodejs.org/)
2. **MongoDB** - [Download](https://www.mongodb.com/try/download/community) or use MongoDB Atlas (cloud)
3. **Redis/Memurai** - 
   - **Windows:** Use [Memurai Desktop](https://www.memurai.com/get-memurai) (free for development) - See [MEMURAI_SETUP_WINDOWS.md](./MEMURAI_SETUP_WINDOWS.md) for detailed setup
   - **Linux/Mac:** [Download Redis](https://redis.io/download) or use Redis Cloud

## 🚀 Quick Start

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Set Up Environment Variables

Create a `.env` file in the root directory (copy from `.env.example`):

```bash
# Copy the example file
# On Windows PowerShell:
Copy-Item .env.example .env

# On Linux/Mac:
cp .env.example .env
```

Edit `.env` and update these values:

```env
MONGO_URI=mongodb://localhost:27017/visiondb
REDIS_URL=redis://localhost:6379
STORAGE_MODE=local
PORT=3000
```

**Note:** 
- If using MongoDB Atlas, your `MONGO_URI` will look like: `mongodb+srv://username:password@cluster.mongodb.net/visiondb`
- If using Redis Cloud, your `REDIS_URL` will look like: `redis://:password@host:port`

### Step 3: Start MongoDB and Redis

**MongoDB:**
```bash
# Windows (if installed as service, it should be running)
# Or start manually:
mongod

# Linux/Mac:
sudo systemctl start mongod
# Or:
mongod
```

**Redis/Memurai:**
```bash
# Windows: Use Memurai (Redis-compatible for Windows)
# Option 1: Install Memurai Desktop (recommended)
# Download from: https://www.memurai.com/get-memurai
# After installation, start the service:
Start-Service Memurai

# Option 2: Run Memurai manually
memurai-server

# Option 3: Use WSL with Redis
wsl redis-server

# Option 4: Use Docker
docker run -d -p 6379:6379 --name redis redis:latest

# Linux/Mac:
redis-server
```

**📖 For detailed Memurai setup instructions on Windows, see [MEMURAI_SETUP_WINDOWS.md](./MEMURAI_SETUP_WINDOWS.md)**

### Step 4: Start the API Server

```bash
# Development mode (auto-restart on file changes):
npm run dev

# Production mode:
npm start
```

You should see:
```
✅ Connected to MongoDB
✅ Server running on http://localhost:3000
```

### Step 5: Install Python Dependencies (Required for Training)

**For actual YOLO training**, install Python dependencies:

```bash
cd training-scripts
pip install -r requirements.txt
```

Or install manually:
```bash
pip install ultralytics torch torchvision
```

**Note:** The training worker will use simulation mode if Python dependencies are not installed.

### Step 6: Download Base YOLO Models (Optional but Recommended)

**For faster training starts**, download base YOLO models locally:

```bash
npm run download-models
```

This downloads YOLOv11s model to `models/base/` directory.

**Benefits:**
- ✅ Faster training starts (no download delay)
- ✅ Works offline
- ✅ More predictable for production

**Note:** If you skip this step, YOLO will download models automatically on first use (slower).

### Step 6: Start the Preprocessing Worker

**Open a new terminal window** and run:

```bash
node workers/preprocessingWorker.js
```

You should see:
```
✅ Worker connected to MongoDB
✅ Preprocessing worker started. Waiting for jobs...
```

### Step 7: Start the Training Worker (Required for Training)

**⚠️ IMPORTANT:** The training worker must run as a **separate process** from the dev server. This ensures training continues even if:
- The frontend page reloads
- The dev server restarts (via nodemon)
- HTTP connections close

The training worker is **independent** and processes jobs from the queue.

**For training functionality**, open another terminal and run:

```bash
npm run start:training-worker
```

You should see:
```
✅ Training worker connected to MongoDB
✅ Training worker started. Waiting for jobs...
```

**Important:** Keep these terminals running:
- Terminal 1: API server (`npm run dev`)
- Terminal 2: Preprocessing worker (`npm run start:worker`)
- Terminal 3: Training worker (`npm run start:training-worker`) - if using training features

## 📁 Project Structure

```
VisionBackend/
├── server.js                 # Main Express server
├── package.json              # Dependencies and scripts
├── .env                      # Environment variables (create this)
├── .env.example              # Example environment variables
├── models/
│   └── Dataset.js            # MongoDB schema for datasets
├── services/
│   └── storageAdapter.js     # File storage abstraction (local/Azure)
├── routes/
│   └── datasets.js           # API route definitions
├── controllers/
│   └── datasetController.js  # Business logic for dataset operations
├── queue/
│   └── index.js              # Bull queue setup (Redis)
├── workers/
│   └── preprocessingWorker.js # Background job processor
├── uploads/
│   └── tmp/                  # Temporary upload folder (auto-created)
└── datasets/                 # Final dataset storage (auto-created)
    └── {company}/
        └── {project}/
            └── {version}/
                ├── images/
                │   ├── train/
                │   └── val/
                ├── labels/
                │   ├── train/
                │   └── val/
                └── thumbnails/
```

## 🧪 Testing with Postman

### Test 1: Upload Dataset

1. **Open Postman** and create a new request
2. **Method:** `POST`
3. **URL:** `http://localhost:3000/api/dataset/upload`
4. **Body Type:** Select `form-data`
5. **Add these fields:**

   | Key | Type | Value |
   |-----|------|-------|
   | `company` | Text | `acme-corp` |
   | `project` | Text | `defect-detection` |
   | `version` | Text | `v1` (optional) |
   | `files` | File | Select multiple image files (.jpg, .png) |
   | `files` | File | Select label files (.txt) |

   **Important:** 
   - The field name must be exactly `files` (not `file`)
   - You can add multiple `files` entries by clicking "Add" next to the field
   - Allowed file types: `.jpg`, `.jpeg`, `.png`, `.txt`
   - Max file size: 50MB per file

6. **Click "Send"**

**Expected Response (202 Accepted):**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "status": "queued",
  "message": "Dataset uploaded successfully. Preprocessing started.",
  "totalImages": 10,
  "uploadErrors": []
}
```

**Save the `datasetId`** - you'll need it for the next steps!

### Test 2: Check Dataset Status

1. **New Request:** `GET`
2. **URL:** `http://localhost:3000/api/dataset/{datasetId}/status`
   - Replace `{datasetId}` with the ID from Test 1
3. **Click "Send"**

**Expected Response:**
```json
{
  "status": "processing",
  "totalImages": 10,
  "uploadErrors": []
}
```

**Status values:**
- `uploaded` - Files uploaded, waiting for preprocessing
- `queued` - Job added to queue
- `processing` - Worker is processing the dataset
- `ready` - Preprocessing complete
- `failed` - Error occurred

**Polling Tip:** You can click "Send" multiple times to monitor progress. The status will change from `queued` → `processing` → `ready`.

### Test 3: Get Full Dataset Metadata

1. **New Request:** `GET`
2. **URL:** `http://localhost:3000/api/dataset/{datasetId}`
3. **Click "Send"**

**Expected Response (when ready):**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "company": "acme-corp",
  "project": "defect-detection",
  "version": "v1",
  "storagePath": "C:\\Gsn Soln\\VisionBackend\\datasets\\acme-corp\\defect-detection\\v1",
  "totalImages": 10,
  "sizeBytes": 5242880,
  "status": "ready",
  "labeledImages": 8,
  "unlabeledImages": 2,
  "trainCount": 6,
  "valCount": 2,
  "labels": ["class_0", "class_1"],
  "uploadErrors": [],
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

### Test 4: Get Dataset Dependencies

**Purpose:** Check what training jobs, models, and inference jobs depend on this dataset before deletion.

1. **New Request:** `GET`
2. **URL:** `http://localhost:3000/api/dataset/{datasetId}/dependencies`
3. **Click "Send"**

**Expected Response (with dependencies):**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "counts": {
    "trainingJobs": 2,
    "models": 1,
    "inferenceJobs": 3
  },
  "dependencies": {
    "trainingJobs": [
      {
        "jobId": "job_12345",
        "status": "completed",
        "createdAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "jobId": "job_67890",
        "status": "running",
        "createdAt": "2024-01-15T11:00:00.000Z"
      }
    ],
    "models": [
      {
        "modelId": "model_abc123",
        "modelVersion": "v1.0",
        "createdAt": "2024-01-15T12:00:00.000Z"
      }
    ],
    "inferenceJobs": [
      {
        "inferenceId": "inf_xyz789",
        "status": "completed",
        "createdAt": "2024-01-15T13:00:00.000Z"
      }
    ]
  },
  "hasDependencies": true
}
```

**Expected Response (no dependencies):**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "counts": {
    "trainingJobs": 0,
    "models": 0,
    "inferenceJobs": 0
  },
  "dependencies": {
    "trainingJobs": [],
    "models": [],
    "inferenceJobs": []
  },
  "hasDependencies": false
}
```

**Response Fields:**
- `counts`: Object with numeric counts for each dependency type (used by frontend for quick checks)
- `dependencies`: Object with arrays of dependency details
- `hasDependencies`: Boolean indicating if any dependencies exist

### Test 5: Delete Dataset by ID

**Purpose:** Soft delete a dataset using its MongoDB ObjectId.

1. **New Request:** `DELETE`
2. **URL:** `http://localhost:3000/api/dataset/{datasetId}`
   - Replace `{datasetId}` with a valid MongoDB ObjectId
3. **Click "Send"**

**Expected Response (Success - 200 OK):**
```json
{
  "message": "Dataset deleted successfully",
  "datasetId": "507f1f77bcf86cd799439011",
  "deletedAt": "2024-01-15T14:30:00.000Z"
}
```

**Error Responses:**

**Invalid ID Format (400 Bad Request):**
```json
{
  "error": "Invalid dataset ID format",
  "message": "Dataset ID must be a valid MongoDB ObjectId"
}
```

**Dataset Not Found (404 Not Found):**
```json
{
  "error": "Dataset not found",
  "datasetId": "507f1f77bcf86cd799439011"
}
```

**Already Deleted (400 Bad Request):**
```json
{
  "error": "Dataset is already deleted",
  "datasetId": "507f1f77bcf86cd799439011",
  "deletedAt": "2024-01-15T10:00:00.000Z"
}
```

**Cannot Delete (Processing/Queued - 400 Bad Request):**
```json
{
  "error": "Cannot delete dataset while it is processing or queued",
  "currentStatus": "processing",
  "message": "Please wait for the dataset to finish processing (current status: processing) before deleting"
}
```

**Important Notes:**
- ⚠️ **Soft Delete:** Files are deleted from disk, but the MongoDB document is kept with `deletedAt` timestamp
- ⚠️ **Cannot Delete:** Datasets with status `processing` or `queued` cannot be deleted
- ⚠️ **Validation:** Invalid ObjectId format returns 400 error immediately

### Test 6: Delete Dataset by Version

**Purpose:** Soft delete a dataset using company/project/version identifier instead of ObjectId.

1. **New Request:** `DELETE`
2. **URL:** `http://localhost:3000/api/dataset/{company}/{project}/{version}`
   - Replace `{company}`, `{project}`, and `{version}` with actual values
   - **Important:** URL-encode special characters (e.g., spaces as `%20`)
   - Example: `http://localhost:3000/api/dataset/gsn/annotation%20test/v4`
3. **Click "Send"**

**Expected Response (Success - 200 OK):**
```json
{
  "message": "Dataset version deleted successfully",
  "datasetId": "507f1f77bcf86cd799439011",
  "company": "gsn",
  "project": "annotation test",
  "version": "v4",
  "deletedAt": "2024-01-15T14:30:00.000Z"
}
```

**Error Responses:**

**Missing Parameters (400 Bad Request):**
```json
{
  "error": "Missing required parameters",
  "message": "Company, project, and version are required"
}
```

**Dataset Version Not Found (404 Not Found):**
```json
{
  "error": "Dataset version not found",
  "company": "gsn",
  "project": "annotation test",
  "version": "v4"
}
```

**Already Deleted (400 Bad Request):**
```json
{
  "error": "Dataset is already deleted",
  "datasetId": "507f1f77bcf86cd799439011",
  "company": "gsn",
  "project": "annotation test",
  "version": "v4",
  "deletedAt": "2024-01-15T10:00:00.000Z"
}
```

**Cannot Delete (Processing/Queued - 400 Bad Request):**
```json
{
  "error": "Cannot delete dataset while it is processing or queued",
  "currentStatus": "queued",
  "message": "Please wait for the dataset to finish processing (current status: queued) before deleting",
  "company": "gsn",
  "project": "annotation test",
  "version": "v4"
}
```

**Important Notes:**
- ⚠️ **URL Encoding:** Special characters in company/project names must be URL-encoded (e.g., `annotation test` → `annotation%20test`)
- ⚠️ **Route Order:** This route must be placed before the generic `DELETE /:datasetId` route to avoid conflicts
- ⚠️ **Soft Delete:** Same behavior as delete by ID - files deleted, document kept with `deletedAt` timestamp

## 🔍 Understanding Key Concepts

### 1. **Middleware**
Middleware are functions that run before your route handler. Examples:
- `express.json()` - Parses JSON request bodies
- `multer` - Handles file uploads
- Custom middleware - Logs requests, validates auth, etc.

### 2. **Queue (Async Worker Pattern)**
Instead of processing 1000 images immediately (which would timeout), we:
1. **Upload files** → Save to disk → Return immediately (fast!)
2. **Add job to queue** → Redis stores the job
3. **Worker picks up job** → Processes in background
4. **Update status** → Frontend polls for progress

**Why?** Keeps API fast, allows parallel processing, enables retries.

### 3. **async/await**
Modern way to handle asynchronous operations (like database queries):

```javascript
// Old way (callbacks):
db.find({}, (err, data) => {
  if (err) throw err;
  console.log(data);
});

// New way (async/await):
const data = await db.find({});
console.log(data);
```

The `await` keyword "waits" for the operation to complete before continuing.

## ⚠️ Important Security & Caution Points

### 1. **Filename Collisions**
- **Problem:** Multiple users upload `image.jpg` → files overwrite each other
- **Solution:** We prefix filenames with `{datasetId}_{uuid}_` to make them unique
- **Location:** `controllers/datasetController.js` line ~80

### 2. **Temp File Cleanup**
- **Problem:** Invalid files stay in `uploads/tmp/` → disk fills up
- **Solution:** We delete invalid files immediately after validation
- **Location:** `controllers/datasetController.js` line ~60

### 3. **Cross-Device File Moves**
- **Problem:** `fs.rename()` fails when temp and destination are on different drives
- **Solution:** We catch `EXDEV` error and fall back to copy + delete
- **Location:** `services/storageAdapter.js` line ~60

### 4. **File Extension Validation**
- **Problem:** User uploads `virus.exe` with name `virus.jpg` → bypasses validation
- **Solution:** We validate actual file extensions, not just filenames
- **Location:** `routes/datasets.js` line ~30

### 5. **Disk Space**
- **Problem:** Large uploads can fill disk → server crashes
- **Solution:** Set file size limits (50MB per file) and monitor disk space
- **Location:** `routes/datasets.js` line ~45

## 🐛 Troubleshooting

### "MongoDB connection error"
- **Check:** Is MongoDB running? `mongod` or check service status
- **Check:** Is `MONGO_URI` correct in `.env`?

### "Redis connection error"
- **Windows:** Check if Memurai is running: `Get-Service Memurai` or `memurai-cli ping`
- **Linux/Mac:** Check if Redis is running: `redis-server` or check service status
- **Check:** Is `REDIS_URL` correct in `.env`? Should be `redis://localhost:6379`
- **Windows users:** See [MEMURAI_SETUP_WINDOWS.md](./MEMURAI_SETUP_WINDOWS.md) for troubleshooting

### "Worker not processing jobs"
- **Check:** Is the worker running? (Terminal 2)
- **Check:** Are Redis and MongoDB connected?
- **Check:** Look for error messages in worker terminal

### "File upload fails"
- **Check:** File size under 50MB?
- **Check:** File extension is `.jpg`, `.jpeg`, `.png`, or `.txt`?
- **Check:** `uploads/tmp/` directory exists and is writable

### "Status stuck on 'queued'"
- **Check:** Is preprocessing worker running?
- **Check:** Redis connection in worker terminal
- **Check:** Look for errors in worker terminal

## 📝 Next Steps

After this first iteration works, you can:
1. Add authentication/authorization
2. Implement Azure Blob Storage
3. Add more validation (image corruption checks)
4. Improve error handling and logging
5. Add dataset deletion endpoint
6. Implement custom train/val split ratios

## 📚 API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/dataset/upload` | Upload dataset files |
| `GET` | `/api/dataset/:datasetId` | Get full dataset metadata |
| `GET` | `/api/dataset/:datasetId/status` | Get minimal status (for polling) |
| `GET` | `/api/dataset/:datasetId/dependencies` | Get dependencies (training jobs, models, inference jobs) |
| `DELETE` | `/api/dataset/:datasetId` | Delete dataset by ID |
| `DELETE` | `/api/dataset/:company/:project/:version` | Delete dataset by version identifier |
| `GET` | `/health` | Health check |

## 🤝 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review error messages in terminal
3. Check MongoDB and Redis are running
4. Verify `.env` file is configured correctly

---

**Happy coding! 🚀**

