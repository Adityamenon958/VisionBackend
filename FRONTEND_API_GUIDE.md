# 🎨 Frontend API Integration Guide

## 📋 Overview

This document provides **complete API specifications** for the Frontend Engineer to integrate the Training Component. All endpoints are ready and tested.

**Base URL:** `http://localhost:3000` (or `process.env.REACT_APP_API_URL`)

---

## 🔗 API Endpoints Summary

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| `POST` | `/api/train` | Start a new training job | ✅ Ready |
| `GET` | `/api/train/:jobId/status` | Get training status & progress | ✅ Ready |
| `GET` | `/api/train/:jobId/logs` | Get training logs | ✅ Ready |
| `POST` | `/api/train/:jobId/cancel` | Cancel a training job | ✅ Ready |
| `POST` | `/api/train/:jobId/retry` | Retry a failed/cancelled job | ✅ Ready |
| `GET` | `/api/datasets?status=ready` | List ready datasets (for selection) | ✅ Ready |
| `GET` | `/api/dataset/:datasetId` | Get dataset details | ✅ Ready |

**Note:** Model Registry endpoints (Phase 4) will be added later. For now, focus on training workflow.

---

## 📡 Detailed API Specifications

### **1. Start Training**

**Endpoint:** `POST /api/train`

**Description:** Creates a new training job and queues it for processing.

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "modelType": "YOLO",
  "hyperparameters": {
    "epochs": 100,
    "batchSize": 16,
    "imgSize": 640,
    "learningRate": 0.01,
    "workers": 4
  }
}
```

**Request Schema:**
- `datasetId` (string, **required**): MongoDB ObjectId of the dataset
- `modelType` (string, **required**): One of `"YOLO"`, `"EfficientNet"`, `"Custom"`
- `hyperparameters` (object, **optional**): Training parameters
  - `epochs` (number, optional): 1-1000, default: 100
  - `batchSize` (number, optional): 1-128, default: 16
  - `imgSize` (number, optional): 128-2048, default: 640
  - `learningRate` (number, optional): 0.0001-1.0, default: 0.01
  - `workers` (number, optional): 1-16, default: 4

**✅ Success Response (202 Accepted):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "queued",
  "message": "Training job queued successfully",
  "datasetId": "507f1f77bcf86cd799439011",
  "modelType": "YOLO",
  "hyperparameters": {
    "epochs": 100,
    "batchSize": 16,
    "imgSize": 640,
    "learningRate": 0.01,
    "workers": 4
  }
}
```

**❌ Error Responses:**

**400 Bad Request - Missing datasetId:**
```json
{
  "error": "Missing required field: datasetId"
}
```

**400 Bad Request - Invalid modelType:**
```json
{
  "error": "Invalid modelType. Must be one of: YOLO, EfficientNet, Custom"
}
```

**400 Bad Request - Invalid hyperparameters:**
```json
{
  "error": "Invalid hyperparameters",
  "details": "epochs must be a number between 1 and 1000; batchSize must be a number between 1 and 128"
}
```

**404 Not Found - Dataset not found:**
```json
{
  "error": "Dataset not found",
  "datasetId": "507f1f77bcf86cd799439011"
}
```

**409 Conflict - Dataset not ready:**
```json
{
  "error": "Dataset is not ready for training. Current status: processing",
  "datasetId": "507f1f77bcf86cd799439011",
  "status": "processing"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error",
  "message": "Error details..."
}
```

**Implementation Location:**
- **Route:** `routes/training.js` (line 15)
- **Controller:** `controllers/trainingController.js` (function: `startTraining`)

**Frontend Usage:**
```javascript
const response = await fetch('http://localhost:3000/api/train', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    datasetId: selectedDatasetId,
    modelType: 'YOLO',
    hyperparameters: {
      epochs: 100,
      batchSize: 16,
      imgSize: 640,
      learningRate: 0.01,
      workers: 4
    }
  })
});

const data = await response.json();
if (response.ok) {
  // Navigate to training progress page with data.jobId
  navigate(`/training/${data.jobId}`);
} else {
  // Show error: data.error
}
```

---

### **2. Get Training Status**

**Endpoint:** `GET /api/train/:jobId/status`

**Description:** Returns current status, progress, and latest metrics for a training job.

**Path Parameters:**
- `jobId` (string, required): The training job ID

**✅ Success Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "running",
  "progress": {
    "currentEpoch": 25,
    "totalEpochs": 100,
    "progressPercent": 25
  },
  "metrics": {
    "currentLoss": 0.45,
    "currentLR": 0.01,
    "bestLoss": 0.42,
    "bestEpoch": 20,
    "mAP50": 0.72,
    "mAP50_95": 0.58
  },
  "startedAt": "2024-01-15T10:00:00.000Z",
  "estimatedCompletion": "2024-01-15T11:30:00.000Z"
}
```

**Status Values:**
- `queued` - Job waiting in queue (not started yet)
- `running` - Training in progress
- `completed` - Training finished successfully
- `failed` - Training failed with error
- `cancelled` - Training was cancelled by user

**Response Schema:**
- `jobId` (string): The training job ID
- `status` (string): Current job status
- `progress` (object):
  - `currentEpoch` (number): Current epoch number
  - `totalEpochs` (number): Total number of epochs
  - `progressPercent` (number): Progress percentage (0-100)
- `metrics` (object, null if not started): Latest training metrics
  - `currentLoss` (number): Current loss value
  - `currentLR` (number): Current learning rate
  - `bestLoss` (number): Best loss so far
  - `bestEpoch` (number): Epoch with best loss
  - `mAP50` (number, optional): mAP@0.5 metric
  - `mAP50_95` (number, optional): mAP@0.5:0.95 metric
- `startedAt` (string, ISO 8601, null if not started): When training started
- `estimatedCompletion` (string, ISO 8601, null if not calculable): Estimated completion time

**❌ Error Responses:**

**400 Bad Request:**
```json
{
  "error": "Missing required parameter: jobId"
}
```

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

**Implementation Location:**
- **Route:** `routes/training.js` (line 18)
- **Controller:** `controllers/trainingController.js` (function: `getTrainingStatus`)

**Frontend Usage (Polling):**
```javascript
// Poll every 3 seconds
useEffect(() => {
  const interval = setInterval(async () => {
    try {
      const response = await fetch(`http://localhost:3000/api/train/${jobId}/status`);
      const data = await response.json();
      
      if (response.ok) {
        setTrainingStatus(data);
        
        // Stop polling if completed or failed
        if (data.status === 'completed') {
          clearInterval(interval);
          navigate(`/training/${jobId}/results`);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setError('Training failed');
        }
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  }, 3000); // Poll every 3 seconds
  
  return () => clearInterval(interval);
}, [jobId]);
```

---

### **3. Get Training Logs**

**Endpoint:** `GET /api/train/:jobId/logs`

**Description:** Returns training logs for a job.

**Path Parameters:**
- `jobId` (string, required): The training job ID

**Query Parameters:**
- `limit` (number, optional): Maximum number of log lines (default: 100, max: 1000)

**✅ Success Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "logs": [
    "Epoch 1/100: loss=0.85, lr=0.01",
    "Epoch 2/100: loss=0.72, lr=0.01",
    "Epoch 3/100: loss=0.65, lr=0.01"
  ],
  "totalLines": 250,
  "returnedLines": 100
}
```

**Response Schema:**
- `jobId` (string): The training job ID
- `logs` (array of strings): Array of log lines (most recent first if limit is applied)
- `totalLines` (number): Total number of log lines
- `returnedLines` (number): Number of lines returned in this response

**❌ Error Responses:**

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

**Implementation Location:**
- **Route:** `routes/training.js` (line 21)
- **Controller:** `controllers/trainingController.js` (function: `getTrainingLogs`)

**Frontend Usage:**
```javascript
const response = await fetch(`http://localhost:3000/api/train/${jobId}/logs?limit=100`);
const data = await response.json();

if (response.ok) {
  // Display logs in a scrollable container
  setLogs(data.logs);
  // Auto-scroll to bottom for latest logs
}
```

---

### **4. Cancel Training**

**Endpoint:** `POST /api/train/:jobId/cancel`

**Description:** Cancels a training job (only if status is `queued` or `running`).

**Path Parameters:**
- `jobId` (string, required): The training job ID

**✅ Success Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "cancelled",
  "message": "Training job cancelled successfully"
}
```

**❌ Error Responses:**

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

**409 Conflict - Cannot cancel:**
```json
{
  "error": "Training job cannot be cancelled",
  "jobId": "job_1234567890_abc123",
  "status": "completed",
  "reason": "Job is already completed"
}
```

**Implementation Location:**
- **Route:** `routes/training.js` (line 24)
- **Controller:** `controllers/trainingController.js` (function: `cancelTraining`)

**Frontend Usage:**
```javascript
const handleCancel = async () => {
  if (!confirm('Are you sure you want to cancel this training?')) return;
  
  const response = await fetch(`http://localhost:3000/api/train/${jobId}/cancel`, {
    method: 'POST'
  });
  
  const data = await response.json();
  if (response.ok) {
    setTrainingStatus(data);
    showToast('Training cancelled successfully');
  } else {
    showError(data.error);
  }
};
```

---

### **5. Retry Training**

**Endpoint:** `POST /api/train/:jobId/retry`

**Description:** Retries a failed or cancelled training job by creating a new job with the same parameters.

**Path Parameters:**
- `jobId` (string, required): The original training job ID

**✅ Success Response (200 OK):**
```json
{
  "jobId": "job_1234567890_xyz789",
  "status": "queued",
  "message": "Training job retried successfully",
  "originalJobId": "job_1234567890_abc123"
}
```

**❌ Error Responses:**

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

**409 Conflict - Cannot retry:**
```json
{
  "error": "Training job cannot be retried",
  "jobId": "job_1234567890_abc123",
  "status": "running",
  "reason": "Job is still running. Only failed or cancelled jobs can be retried."
}
```

**Implementation Location:**
- **Route:** `routes/training.js` (line 27)
- **Controller:** `controllers/trainingController.js` (function: `retryTraining`)

**Frontend Usage:**
```javascript
const handleRetry = async () => {
  const response = await fetch(`http://localhost:3000/api/train/${jobId}/retry`, {
    method: 'POST'
  });
  
  const data = await response.json();
  if (response.ok) {
    // Navigate to new job
    navigate(`/training/${data.jobId}`);
    showToast('Training job retried successfully');
  } else {
    showError(data.error);
  }
};
```

---

### **6. List Datasets (for Selection)**

**Endpoint:** `GET /api/datasets?status=ready`

**Description:** Lists all datasets, optionally filtered by status. Use this to populate the dataset selector dropdown.

**Query Parameters:**
- `status` (string, optional): Filter by status (e.g., `"ready"`)

**✅ Success Response (200 OK):**
```json
{
  "datasets": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "company": "acme-corp",
      "project": "defect-detection",
      "version": "v1",
      "status": "ready",
      "totalImages": 1000,
      "trainCount": 800,
      "valCount": 200,
      "testCount": 100,
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ],
  "total": 10
}
```

**Implementation Location:**
- **Route:** `server.js` (line 65)
- **Controller:** `controllers/datasetController.js` (function: `listDatasets`)

**Frontend Usage:**
```javascript
const fetchReadyDatasets = async () => {
  const response = await fetch('http://localhost:3000/api/datasets?status=ready');
  const data = await response.json();
  
  if (response.ok) {
    setDatasets(data.datasets);
    // Filter to show only ready datasets in dropdown
  }
};
```

---

### **7. Get Dataset Details**

**Endpoint:** `GET /api/dataset/:datasetId`

**Description:** Returns full dataset details including file manifest, folders, and statistics.

**Path Parameters:**
- `datasetId` (string, required): MongoDB ObjectId of the dataset

**✅ Success Response (200 OK):**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "company": "acme-corp",
  "project": "defect-detection",
  "version": "v1",
  "status": "ready",
  "totalImages": 1000,
  "trainCount": 800,
  "valCount": 200,
  "testCount": 100,
  "labels": ["defect", "no_defect"],
  "folders": {
    "good": { "images": 500, "labels": 500 },
    "defect1": { "images": 300, "labels": 300 }
  },
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

**Implementation Location:**
- **Route:** `routes/datasets.js`
- **Controller:** `controllers/datasetController.js` (function: `getDataset`)

---

## 🎯 Frontend Workflow

### **Step 1: Dataset Selection**
1. Call `GET /api/datasets?status=ready` to get list of ready datasets
2. Display in dropdown/select component
3. Show: `company / project / version` and `totalImages (trainCount train, valCount val)`

### **Step 2: Model Selection**
- Show radio buttons or cards for: YOLO, EfficientNet, Custom
- Default: YOLO

### **Step 3: Hyperparameter Configuration**
- Show form with fields:
  - Epochs (1-1000, default: 100)
  - Batch Size (1-128, default: 16)
  - Image Size (128-2048, default: 640)
  - Learning Rate (0.0001-1.0, default: 0.01)
  - Workers (1-16, default: 4)
- Add "Use Defaults" button (hides form, uses backend defaults)

### **Step 4: Start Training**
1. Validate: dataset selected, model selected
2. Call `POST /api/train` with:
   - `datasetId`
   - `modelType`
   - `hyperparameters` (if customized, or omit for defaults)
3. On success (202), navigate to `/training/:jobId`
4. On error, show error message

### **Step 5: Training Progress Page**
1. Poll `GET /api/train/:jobId/status` every **3 seconds**
2. Display:
   - Status badge (queued/running/completed/failed/cancelled)
   - Progress bar (0-100%)
   - Current epoch / Total epochs
   - Metrics cards (loss, mAP, LR)
   - Logs viewer (scrollable, auto-scroll to bottom)
   - "Cancel Training" button (only if status === 'queued' or 'running')
3. Stop polling when status === 'completed' or 'failed'
4. On completion: Navigate to `/training/:jobId/results`
5. On failure: Show error + "Retry" button

### **Step 6: Training Results Page** (Phase 4 - Coming Soon)
- Will use Model Registry endpoints
- For now, show completion message with jobId

---

## 🔄 Status Flow Diagram

```
User clicks "Train"
    ↓
POST /api/train
    ↓
Response: { jobId, status: "queued" }
    ↓
Navigate to /training/:jobId
    ↓
Poll GET /api/train/:jobId/status every 3s
    ↓
Status: "queued" → "running" → "completed"
    ↓
Navigate to /training/:jobId/results
```

---

## ⚠️ Important Notes

### **1. Polling Interval**
- **Recommended:** 3 seconds (not too frequent, not too slow)
- Stop polling when status is `completed`, `failed`, or `cancelled`

### **2. Error Handling**
- Always check `response.ok` before using data
- Display user-friendly error messages from `error` field
- Handle network errors gracefully

### **3. Default Hyperparameters**
- If user doesn't customize, **omit** `hyperparameters` from request
- Backend will use defaults based on `modelType`
- Or send empty object `{}` - backend will fill defaults

### **4. Status Values**
- `queued`: Job waiting (show "Queued" badge, no progress yet)
- `running`: Training active (show progress bar, metrics, logs)
- `completed`: Success (navigate to results)
- `failed`: Error (show error message + retry button)
- `cancelled`: User cancelled (show cancelled message)

### **5. Metrics Availability**
- `metrics` field is `null` when status is `queued`
- Metrics appear when status is `running` or `completed`
- Check `metrics !== null` before displaying

### **6. Logs**
- Logs array is empty initially
- Logs populate as training progresses
- Use `limit` query param to control how many lines to fetch
- Auto-scroll to bottom for latest logs

---

## 🧪 Testing Checklist

Before integrating, test each endpoint:

- [ ] `POST /api/train` - Start training with valid dataset
- [ ] `POST /api/train` - Error handling (invalid datasetId, not ready)
- [ ] `GET /api/train/:jobId/status` - Get status (polling)
- [ ] `GET /api/train/:jobId/logs` - Get logs
- [ ] `POST /api/train/:jobId/cancel` - Cancel queued job
- [ ] `POST /api/train/:jobId/cancel` - Cancel running job
- [ ] `POST /api/train/:jobId/cancel` - Error (cannot cancel completed)
- [ ] `POST /api/train/:jobId/retry` - Retry failed job
- [ ] `GET /api/datasets?status=ready` - List ready datasets

---

## 📞 Questions?

If you need clarification on any endpoint:
1. Check the implementation location (route/controller files)
2. Test the endpoint with Postman first
3. Check error responses for validation rules

---

## 🚀 Ready to Integrate!

All endpoints are **ready and tested**. You can start building the frontend UI now!

**Next Steps:**
1. Create API client functions (one per endpoint)
2. Build dataset selector component
3. Build model selector component
4. Build hyperparameter form component
5. Build training progress page with polling
6. Build training results page (Phase 4 - coming soon)

---

**Last Updated:** 2024-01-15  
**Version:** 1.0.0

