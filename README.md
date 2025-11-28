# Vision Backend - Dataset Ingestion System

This is the first iteration of the dataset ingestion system for the Vision ML pipeline. It handles dataset uploads, validation, storage, and background preprocessing.

## 📋 Prerequisites

Before you start, make sure you have installed:

1. **Node.js** (v16 or higher) - [Download](https://nodejs.org/)
2. **MongoDB** - [Download](https://www.mongodb.com/try/download/community) or use MongoDB Atlas (cloud)
3. **Redis** - [Download](https://redis.io/download) or use Redis Cloud

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

**Redis:**
```bash
# Windows: Download and run redis-server.exe
# Or use WSL:
wsl redis-server

# Linux/Mac:
redis-server
```

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

### Step 5: Start the Preprocessing Worker

**Open a new terminal window** and run:

```bash
node workers/preprocessingWorker.js
```

You should see:
```
✅ Worker connected to MongoDB
✅ Preprocessing worker started. Waiting for jobs...
```

**Important:** Keep both terminals running:
- Terminal 1: API server (`npm run dev`)
- Terminal 2: Preprocessing worker (`node workers/preprocessingWorker.js`)

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
- **Check:** Is Redis running? `redis-server` or check service status
- **Check:** Is `REDIS_URL` correct in `.env`?

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
| `GET` | `/health` | Health check |

## 🤝 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review error messages in terminal
3. Check MongoDB and Redis are running
4. Verify `.env` file is configured correctly

---

**Happy coding! 🚀**

