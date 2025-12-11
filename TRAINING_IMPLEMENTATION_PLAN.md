# 🚀 Training Component Implementation Plan

## 📋 Overview

This document provides a **step-by-step implementation plan** for the Training Component, with **parallel backend and frontend tasks** that can be worked on simultaneously.

**Goal:** Build a complete training pipeline where users can:
1. Select a dataset
2. Choose a model type
3. Configure hyperparameters (or use defaults)
4. Start training and see live progress
5. View training results and metrics
6. Access trained models in the models list

---

## 🏗️ Architecture Overview

```
Frontend (React/UI)
    ↓ (API calls)
Backend API (Express)
    ↓ (enqueue job)
Training Queue (Bull + Redis)
    ↓ (pick up job)
Training Worker (Node.js + Python subprocess)
    ↓ (save checkpoints/metrics)
Model Storage + MongoDB
```

---

## 📁 New File Structure

```
VisionBackend/
├── models/
│   ├── Dataset.js          ✅ (exists)
│   └── TrainingJob.js       🆕 (new - training job schema)
│   └── Model.js            🆕 (new - model registry schema)
├── routes/
│   ├── datasets.js         ✅ (exists)
│   └── training.js         🆕 (new - training routes)
│   └── models.js           🆕 (new - model registry routes)
├── controllers/
│   ├── datasetController.js ✅ (exists)
│   └── trainingController.js 🆕 (new - training logic)
│   └── modelController.js   🆕 (new - model registry logic)
├── services/
│   ├── storageAdapter.js   ✅ (exists)
│   ├── datasetService.js   ✅ (exists)
│   └── trainingService.js  🆕 (new - training helpers)
│   └── modelService.js     🆕 (new - model helpers)
├── queue/
│   └── index.js            ✅ (exists - add trainingQueue)
├── workers/
│   ├── preprocessingWorker.js ✅ (exists)
│   └── trainingWorker.js   🆕 (new - training job processor)
├── configs/
│   └── training/           🆕 (new - YOLO config templates)
│       └── yolo-default.yaml
└── models/                 🆕 (new - trained model storage)
    └── {company}/
        └── {project}/
            └── {modelVersion}/
                ├── checkpoints/
                ├── metrics/
                └── best.pt
```

---

## 🎯 Implementation Phases

### **Phase 1: Foundation & Data Models** (Backend Only)
**Goal:** Set up database schemas and basic structure

### **Phase 2: Core Training API** (Backend Only)
**Goal:** Create endpoints to start, monitor, and manage training jobs

### **Phase 3: Training Worker** (Backend Only)
**Goal:** Implement background worker that actually runs training

### **Phase 4: Model Registry** (Backend Only)
**Goal:** Store and retrieve trained models with metadata

### **Phase 5: Frontend Integration** (Frontend Only)
**Goal:** Build UI components for training workflow

### **Phase 6: Testing & Polish** (Both)
**Goal:** End-to-end testing and bug fixes

---

## 📝 Phase 1: Foundation & Data Models

### **Backend Tasks**

#### **Step 1.1: Create TrainingJob Model**
**File:** `models/TrainingJob.js`

**What to create:**
- MongoDB schema for training jobs
- Fields: `jobId`, `datasetId`, `modelType`, `status`, `hyperparameters`, `progress`, `metrics`, `logs`, `checkpoints`, `createdAt`, `updatedAt`

**Status values:**
- `queued` - Job added to queue
- `running` - Training in progress
- `completed` - Training finished successfully
- `failed` - Training failed
- `cancelled` - User cancelled training

**Key fields:**
```javascript
{
  jobId: String (unique, auto-generated),
  datasetId: ObjectId (ref: Dataset),
  company: String,
  project: String,
  modelType: String (enum: ['YOLO', 'EfficientNet', 'Custom']),
  status: String,
  hyperparameters: {
    epochs: Number,
    batchSize: Number,
    imgSize: Number,
    learningRate: Number,
    workers: Number
  },
  progress: {
    currentEpoch: Number,
    totalEpochs: Number,
    progressPercent: Number
  },
  metrics: {
    bestEpoch: Number,
    bestLoss: Number,
    precision: Number,
    recall: Number,
    mAP50: Number,
    mAP50_95: Number,
    perLabelStats: [Object]
  },
  logs: [String],
  checkpoints: [{
    epoch: Number,
    path: String,
    isBest: Boolean,
    metrics: Object
  }],
  error: String,
  startedAt: Date,
  completedAt: Date
}
```

**✅ Acceptance Criteria:**
- Schema compiles without errors
- Can create a test job document in MongoDB
- All required fields are present

---

#### **Step 1.2: Create Model Registry Schema**
**File:** `models/Model.js`

**What to create:**
- MongoDB schema for trained models
- Fields: `modelId`, `jobId`, `company`, `project`, `modelVersion`, `modelType`, `datasetVersion`, `metrics`, `storagePath`, `downloadUrl`, `createdAt`

**Key fields:**
```javascript
{
  modelId: String (unique, auto-generated),
  jobId: ObjectId (ref: TrainingJob),
  company: String,
  project: String,
  modelVersion: String (e.g., "v1", "v2"),
  modelType: String,
  datasetVersion: String,
  datasetId: ObjectId (ref: Dataset),
  metrics: {
    bestEpoch: Number,
    bestLoss: Number,
    precision: Number,
    recall: Number,
    mAP50: Number,
    mAP50_95: Number,
    perLabelStats: [Object]
  },
  insights: {
    bestAccuracy: Number,
    bestmAP: Number,
    weakestLabels: [String],
    classImbalanceWarnings: [String],
    recommendations: [String]
  },
  storagePath: String,
  downloadUrl: String,
  createdAt: Date
}
```

**✅ Acceptance Criteria:**
- Schema compiles without errors
- Can create a test model document in MongoDB

---

#### **Step 1.3: Add Training Queue to Queue Setup**
**File:** `queue/index.js`

**What to add:**
- Create `trainingQueue` using Bull (similar to `preprocessingQueue`)
- Add queue event listeners (completed, failed, stalled)

**Code pattern:**
```javascript
const trainingQueue = new Bull('train-model', {
  createClient: (type) => {
    return createRedisClient();
  }
});

trainingQueue.on('completed', (job) => {
  console.log(`✅ Training job ${job.id} completed`);
});

trainingQueue.on('failed', (job, err) => {
  console.error(`❌ Training job ${job.id} failed:`, err?.message || err);
});

module.exports = {
  preprocessingQueue,
  trainingQueue  // ← Add this
};
```

**✅ Acceptance Criteria:**
- Queue initializes without errors
- Can enqueue a test job
- Queue events fire correctly

---

#### **Step 1.4: Create Training Service Helper**
**File:** `services/trainingService.js`

**What to create:**
- Helper functions for training operations
- Functions: `validateDatasetForTraining()`, `generateJobId()`, `getDefaultHyperparameters()`, `computeProgressPercent()`

**Functions needed:**
```javascript
// Check if dataset is ready for training
async function validateDatasetForTraining(datasetId) {
  // Check dataset exists
  // Check status === 'ready'
  // Check trainCount > 0
  // Return { valid: true/false, error: string }
}

// Generate unique job ID
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get default hyperparameters based on model type
function getDefaultHyperparameters(modelType) {
  // Return default values for YOLO/EfficientNet/Custom
}

// Compute progress percentage
function computeProgressPercent(currentEpoch, totalEpochs) {
  return Math.round((currentEpoch / totalEpochs) * 100);
}
```

**✅ Acceptance Criteria:**
- All helper functions work correctly
- Validation catches invalid datasets
- Default hyperparameters are sensible

---

**📋 Phase 1 Checklist:**
- [ ] TrainingJob model created
- [ ] Model registry schema created
- [ ] Training queue added
- [ ] Training service helpers created
- [ ] All tests pass (manual testing)

---

## 📝 Phase 2: Core Training API

### **Backend Tasks**

#### **Step 2.1: Create Training Routes**
**File:** `routes/training.js`

**What to create:**
- Express router with all training endpoints
- Routes: POST `/api/train`, GET `/api/train/:jobId/status`, GET `/api/train/:jobId/logs`, POST `/api/train/:jobId/cancel`, POST `/api/train/:jobId/retry`

**Route structure:**
```javascript
const express = require('express');
const router = express.Router();
const {
  startTraining,
  getTrainingStatus,
  getTrainingLogs,
  cancelTraining,
  retryTraining
} = require('../controllers/trainingController');

router.post('/', startTraining);                    // POST /api/train
router.get('/:jobId/status', getTrainingStatus);     // GET /api/train/:jobId/status
router.get('/:jobId/logs', getTrainingLogs);         // GET /api/train/:jobId/logs
router.post('/:jobId/cancel', cancelTraining);       // POST /api/train/:jobId/cancel
router.post('/:jobId/retry', retryTraining);         // POST /api/train/:jobId/retry

module.exports = router;
```

**✅ Acceptance Criteria:**
- All routes are defined
- Routes are registered in `server.js`
- Routes respond (even if controllers are stubs)

---

#### **Step 2.2: Create Training Controller - Start Training**
**File:** `controllers/trainingController.js`

**Function:** `startTraining(req, res)`

**What it does:**
1. Validate request body (`datasetId`, `modelType`, optional `hyperparameters`)
2. Validate dataset exists and status === 'ready'
3. Get default hyperparameters if not provided
4. Create TrainingJob document in MongoDB
5. Enqueue job to trainingQueue
6. Return 202 Accepted with `jobId`

**Request body:**
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

**Response (202 Accepted):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "queued",
  "message": "Training job queued successfully",
  "datasetId": "507f1f77bcf86cd799439011",
  "modelType": "YOLO"
}
```

**Error responses:**
- 400: Invalid request (missing datasetId, invalid modelType)
- 404: Dataset not found
- 409: Dataset not ready (status !== 'ready')
- 500: Server error

**✅ Acceptance Criteria:**
- Validates all inputs
- Creates job document
- Enqueues job successfully
- Returns correct response format

---

#### **Step 2.3: Create Training Controller - Get Status**
**Function:** `getTrainingStatus(req, res)`

**What it does:**
1. Find TrainingJob by `jobId`
2. Return current status, progress, and latest metrics

**Response (200 OK):**
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
    "bestEpoch": 20
  },
  "startedAt": "2024-01-15T10:00:00Z",
  "estimatedCompletion": "2024-01-15T11:30:00Z"
}
```

**✅ Acceptance Criteria:**
- Returns correct status
- Progress updates in real-time
- Handles missing jobId (404)

---

#### **Step 2.4: Create Training Controller - Get Logs**
**Function:** `getTrainingLogs(req, res)`

**What it does:**
1. Find TrainingJob by `jobId`
2. Return logs array (last N lines, or all)

**Query params:**
- `limit` (optional): Number of log lines to return (default: 100)

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "logs": [
    "Epoch 1/100: loss=0.85, lr=0.01",
    "Epoch 2/100: loss=0.72, lr=0.01",
    "..."
  ],
  "totalLines": 250
}
```

**✅ Acceptance Criteria:**
- Returns logs correctly
- Respects limit parameter
- Handles missing jobId (404)

---

#### **Step 2.5: Create Training Controller - Cancel Training**
**Function:** `cancelTraining(req, res)`

**What it does:**
1. Find TrainingJob by `jobId`
2. Check if job is cancellable (status === 'queued' or 'running')
3. Remove job from queue (if queued) or signal cancellation (if running)
4. Update job status to 'cancelled'
5. Return success

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "cancelled",
  "message": "Training job cancelled successfully"
}
```

**Error responses:**
- 404: Job not found
- 409: Job cannot be cancelled (already completed/failed)

**✅ Acceptance Criteria:**
- Cancels queued jobs
- Signals cancellation to running jobs
- Updates status correctly

---

#### **Step 2.6: Create Training Controller - Retry Training**
**Function:** `retryTraining(req, res)`

**What it does:**
1. Find TrainingJob by `jobId`
2. Check if job is retryable (status === 'failed' or 'cancelled')
3. Create new TrainingJob with same parameters
4. Enqueue new job
5. Return new jobId

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_xyz789",
  "status": "queued",
  "message": "Training job retried successfully",
  "originalJobId": "job_1234567890_abc123"
}
```

**✅ Acceptance Criteria:**
- Creates new job correctly
- Copies all parameters
- Enqueues successfully

---

#### **Step 2.7: Register Training Routes in Server**
**File:** `server.js`

**What to add:**
```javascript
const trainingRoutes = require('./routes/training');
app.use('/api/train', trainingRoutes);
```

**✅ Acceptance Criteria:**
- Routes are accessible
- CORS headers work
- Error handling works

---

**📋 Phase 2 Checklist:**
- [ ] Training routes created
- [ ] Start training endpoint works
- [ ] Get status endpoint works
- [ ] Get logs endpoint works
- [ ] Cancel endpoint works
- [ ] Retry endpoint works
- [ ] All endpoints tested with Postman

---

## 📝 Phase 3: Training Worker

### **Backend Tasks**

#### **Step 3.1: Create Training Worker File**
**File:** `workers/trainingWorker.js`

**What to create:**
- Worker that processes training jobs from queue
- Similar structure to `preprocessingWorker.js`

**Worker structure:**
```javascript
require('dotenv').config();
const mongoose = require('mongoose');
const { trainingQueue } = require('../queue');
const TrainingJob = require('../models/TrainingJob');
const Model = require('../models/Model');
const Dataset = require('../models/Dataset');
const storageAdapter = require('../services/storageAdapter');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

// Connect to MongoDB
// Process jobs from queue
// Run Python training script
// Stream logs and metrics
// Save checkpoints
// Update job status
```

**✅ Acceptance Criteria:**
- Worker starts without errors
- Connects to MongoDB and Redis
- Can pick up jobs from queue

---

#### **Step 3.2: Implement Job Processing Logic**
**Function:** `processTrainingJob(job)`

**What it does:**
1. Load job data from MongoDB
2. Update status to 'running'
3. Get dataset path from storageAdapter
4. Generate YOLO config file
5. Spawn Python training process
6. Stream stdout/stderr to logs
7. Parse metrics from logs
8. Update job progress periodically
9. Handle completion/failure

**Key steps:**
```javascript
async function processTrainingJob(job) {
  const { jobId, datasetId, modelType, hyperparameters } = job.data;
  
  // 1. Load job
  const trainingJob = await TrainingJob.findOne({ jobId });
  
  // 2. Get dataset
  const dataset = await Dataset.findById(datasetId);
  const datasetPath = storageAdapter.getDatasetPath(
    dataset.company,
    dataset.project,
    dataset.version
  );
  
  // 3. Generate config
  const configPath = await generateTrainingConfig(hyperparameters, datasetPath);
  
  // 4. Spawn Python process
  const pythonProcess = spawn('python', ['train.py', '--config', configPath], {
    cwd: path.join(__dirname, '../training-scripts')
  });
  
  // 5. Stream logs
  pythonProcess.stdout.on('data', (data) => {
    const logLine = data.toString();
    parseAndUpdateMetrics(logLine, trainingJob);
    appendLog(trainingJob, logLine);
  });
  
  // 6. Handle completion
  pythonProcess.on('close', async (code) => {
    if (code === 0) {
      await finalizeTraining(trainingJob);
    } else {
      await markJobFailed(trainingJob, 'Training process exited with error');
    }
  });
}
```

**✅ Acceptance Criteria:**
- Job status updates correctly
- Logs are captured
- Progress updates periodically

---

#### **Step 3.3: Implement Config Generation**
**Function:** `generateTrainingConfig(hyperparameters, datasetPath)`

**What it does:**
1. Load YOLO config template
2. Replace placeholders with actual values
3. Write config to temp file
4. Return config path

**Config template:** `configs/training/yolo-default.yaml`
```yaml
# YOLO Training Config
epochs: {EPOCHS}
batch: {BATCH_SIZE}
imgsz: {IMG_SIZE}
lr0: {LEARNING_RATE}
workers: {WORKERS}
data: {DATASET_PATH}/data.yaml
```

**✅ Acceptance Criteria:**
- Config file generated correctly
- All placeholders replaced
- File is readable by Python script

---

#### **Step 3.4: Implement Log Parsing & Metric Extraction**
**Function:** `parseAndUpdateMetrics(logLine, trainingJob)`

**What it does:**
1. Parse log line for epoch, loss, lr, mAP values
2. Update trainingJob.progress
3. Update trainingJob.metrics
4. Save to MongoDB periodically

**Log format to parse:**
```
Epoch 25/100: loss=0.45, lr=0.01, mAP50=0.72, mAP50-95=0.58
```

**✅ Acceptance Criteria:**
- Metrics extracted correctly
- Progress updates in real-time
- MongoDB updates don't overwhelm database

---

#### **Step 3.5: Implement Checkpoint Management**
**Function:** `saveCheckpoint(trainingJob, epoch, metrics, isBest)`

**What it does:**
1. Determine checkpoint path
2. Copy checkpoint file from Python output
3. Register checkpoint in trainingJob.checkpoints
4. Update job document

**Checkpoint path:**
```
/models/{company}/{project}/{modelVersion}/checkpoints/epoch_{epoch}.pt
```

**✅ Acceptance Criteria:**
- Checkpoints saved correctly
- Best checkpoint marked
- Checkpoints accessible via API

---

#### **Step 3.6: Implement Final Metrics & Model Registration**
**Function:** `finalizeTraining(trainingJob)`

**What it does:**
1. Compute final metrics from validation
2. Generate insights (weakest labels, recommendations)
3. Copy best checkpoint to model storage
4. Create Model registry entry
5. Update trainingJob status to 'completed'
6. Save all data

**✅ Acceptance Criteria:**
- Final metrics computed
- Model registered correctly
- Insights generated
- Job marked as completed

---

#### **Step 3.7: Add Worker Script to package.json**
**File:** `package.json`

**What to add:**
```json
{
  "scripts": {
    "start:worker": "node workers/preprocessingWorker.js",
    "start:training-worker": "node workers/trainingWorker.js"
  }
}
```

**✅ Acceptance Criteria:**
- Script runs correctly
- Worker processes jobs

---

**📋 Phase 3 Checklist:**
- [ ] Training worker created
- [ ] Job processing works
- [ ] Config generation works
- [ ] Log parsing works
- [ ] Checkpoints saved
- [ ] Final metrics computed
- [ ] Model registration works
- [ ] Worker script added

---

## 📝 Phase 4: Model Registry

### **Backend Tasks**

#### **Step 4.1: Create Model Routes**
**File:** `routes/models.js`

**What to create:**
- Routes: GET `/api/models`, GET `/api/models/:modelId`, GET `/api/models/:modelId/metrics`, GET `/api/models/:modelId/insights`, GET `/api/models/:modelId/download`, GET `/api/models/:modelId/checkpoints`

**Route structure:**
```javascript
const express = require('express');
const router = express.Router();
const {
  listModels,
  getModel,
  getModelMetrics,
  getModelInsights,
  downloadModel,
  listCheckpoints
} = require('../controllers/modelController');

router.get('/', listModels);                           // GET /api/models?company=X&project=Y
router.get('/:modelId', getModel);                     // GET /api/models/:modelId
router.get('/:modelId/metrics', getModelMetrics);      // GET /api/models/:modelId/metrics
router.get('/:modelId/insights', getModelInsights);    // GET /api/models/:modelId/insights
router.get('/:modelId/download', downloadModel);       // GET /api/models/:modelId/download
router.get('/:modelId/checkpoints', listCheckpoints);  // GET /api/models/:modelId/checkpoints

module.exports = router;
```

**✅ Acceptance Criteria:**
- All routes defined
- Routes registered in server.js

---

#### **Step 4.2: Create Model Controller - List Models**
**Function:** `listModels(req, res)`

**What it does:**
1. Filter by `company` and `project` (query params)
2. Return list of models with basic info

**Query params:**
- `company` (required)
- `project` (required)

**Response (200 OK):**
```json
{
  "models": [
    {
      "modelId": "model_123",
      "modelVersion": "v1",
      "modelType": "YOLO",
      "status": "completed",
      "metrics": {
        "mAP50": 0.72,
        "precision": 0.85
      },
      "createdAt": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 5
}
```

**✅ Acceptance Criteria:**
- Filters correctly
- Returns only models for specified company/project

---

#### **Step 4.3: Create Model Controller - Get Model Details**
**Function:** `getModel(req, res)`

**What it does:**
1. Find model by `modelId`
2. Return full model details

**Response (200 OK):**
```json
{
  "modelId": "model_123",
  "jobId": "job_456",
  "company": "acme-corp",
  "project": "defect-detection",
  "modelVersion": "v1",
  "modelType": "YOLO",
  "datasetVersion": "v1",
  "metrics": { ... },
  "insights": { ... },
  "storagePath": "/models/acme-corp/defect-detection/v1",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

**✅ Acceptance Criteria:**
- Returns full model data
- Handles missing modelId (404)

---

#### **Step 4.4: Create Model Controller - Get Metrics**
**Function:** `getModelMetrics(req, res)`

**What it does:**
1. Find model by `modelId`
2. Return detailed metrics (including per-label stats)

**Response (200 OK):**
```json
{
  "modelId": "model_123",
  "metrics": {
    "bestEpoch": 85,
    "bestLoss": 0.42,
    "precision": 0.85,
    "recall": 0.78,
    "mAP50": 0.72,
    "mAP50_95": 0.58,
    "perLabelStats": [
      {
        "label": "defect",
        "precision": 0.88,
        "recall": 0.82,
        "mAP50": 0.75
      }
    ]
  },
  "chartData": {
    "lossCurve": [...],
    "precisionCurve": [...],
    "mAPCurve": [...]
  }
}
```

**✅ Acceptance Criteria:**
- Returns all metrics
- Includes chart data if available

---

#### **Step 4.5: Create Model Controller - Get Insights**
**Function:** `getModelInsights(req, res)`

**What it does:**
1. Find model by `modelId`
2. Return insights summary

**Response (200 OK):**
```json
{
  "modelId": "model_123",
  "insights": {
    "bestAccuracy": 0.85,
    "bestmAP": 0.72,
    "weakestLabels": ["defect_type_3", "defect_type_7"],
    "classImbalanceWarnings": [
      "Label 'defect_type_3' has only 50 samples (recommended: 200+)"
    ],
    "recommendations": [
      "Add more training samples for 'defect_type_3'",
      "Consider data augmentation for underrepresented classes"
    ]
  }
}
```

**✅ Acceptance Criteria:**
- Returns insights
- Recommendations are actionable

---

#### **Step 4.6: Create Model Controller - Download Model**
**Function:** `downloadModel(req, res)`

**What it does:**
1. Find model by `modelId`
2. Get best checkpoint path
3. Stream file to response

**Response:**
- Content-Type: `application/octet-stream`
- Content-Disposition: `attachment; filename="model_v1.pt"`

**✅ Acceptance Criteria:**
- File downloads correctly
- Filename is correct
- Handles missing file (404)

---

#### **Step 4.7: Register Model Routes in Server**
**File:** `server.js`

**What to add:**
```javascript
const modelRoutes = require('./routes/models');
app.use('/api/models', modelRoutes);
```

**✅ Acceptance Criteria:**
- Routes accessible
- CORS works

---

**📋 Phase 4 Checklist:**
- [ ] Model routes created
- [ ] List models works
- [ ] Get model details works
- [ ] Get metrics works
- [ ] Get insights works
- [ ] Download model works
- [ ] All endpoints tested

---

## 📝 Phase 5: Frontend Integration

### **Frontend Tasks**

#### **Step 5.1: API Client Setup**
**File:** `src/services/trainingApi.js` (or similar)

**What to create:**
- API client functions for all training endpoints
- Functions: `startTraining()`, `getTrainingStatus()`, `getTrainingLogs()`, `cancelTraining()`, `retryTraining()`, `listModels()`, `getModel()`, etc.

**Example:**
```javascript
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export async function startTraining(datasetId, modelType, hyperparameters) {
  const response = await fetch(`${API_BASE}/api/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datasetId, modelType, hyperparameters })
  });
  return response.json();
}

export async function getTrainingStatus(jobId) {
  const response = await fetch(`${API_BASE}/api/train/${jobId}/status`);
  return response.json();
}

// ... more functions
```

**✅ Acceptance Criteria:**
- All API functions work
- Error handling implemented
- TypeScript types defined (if using TS)

---

#### **Step 5.2: Dataset Selection Component**
**File:** `src/components/Training/DatasetSelector.tsx` (or .jsx)

**What to create:**
- Dropdown/select component to choose dataset
- Shows: company, project, version, status, image count
- Only shows datasets with status === 'ready'

**Props:**
- `onSelect: (datasetId: string) => void`
- `selectedDatasetId?: string`

**UI Elements:**
- Dropdown with dataset list
- Dataset info card (shows selected dataset details)

**✅ Acceptance Criteria:**
- Lists all ready datasets
- Selection works
- Shows dataset details

---

#### **Step 5.3: Model Selection Component**
**File:** `src/components/Training/ModelSelector.tsx`

**What to create:**
- Radio buttons or dropdown for model type
- Options: YOLO, EfficientNet, Custom
- Shows model description/icon

**Props:**
- `onSelect: (modelType: string) => void`
- `selectedModelType?: string`

**✅ Acceptance Criteria:**
- Model selection works
- UI is clear

---

#### **Step 5.4: Hyperparameter Configuration Component**
**File:** `src/components/Training/HyperparameterForm.tsx`

**What to create:**
- Form with hyperparameter inputs
- Fields: epochs, batchSize, imgSize, learningRate, workers
- "Use Defaults" button
- Validation

**Props:**
- `modelType: string`
- `onChange: (hyperparameters: object) => void`
- `defaults?: object`

**Fields:**
- Epochs: Number input (1-1000, default: 100)
- Batch Size: Number input (1-128, default: 16)
- Image Size: Number input (128-2048, default: 640)
- Learning Rate: Number input (0.0001-1.0, default: 0.01)
- Workers: Number input (1-16, default: 4)

**✅ Acceptance Criteria:**
- Form validates inputs
- Defaults load correctly
- Changes trigger onChange

---

#### **Step 5.5: Training Start Component**
**File:** `src/components/Training/TrainingStart.tsx`

**What to create:**
- Combines DatasetSelector, ModelSelector, HyperparameterForm
- "Start Training" button
- Validates all inputs before enabling button
- Calls `startTraining()` API
- Shows loading state
- Navigates to training progress on success

**Flow:**
1. User selects dataset
2. User selects model
3. User configures hyperparameters (or uses defaults)
4. User clicks "Start Training"
5. API call → get jobId
6. Navigate to `/training/:jobId`

**✅ Acceptance Criteria:**
- All validations work
- API call succeeds
- Navigation works

---

#### **Step 5.6: Training Progress Component**
**File:** `src/components/Training/TrainingProgress.tsx`

**What to create:**
- Shows live training progress
- Polls `/api/train/:jobId/status` every 2-5 seconds
- Displays: status, progress bar, current epoch, metrics, logs

**UI Elements:**
- Status badge (queued/running/completed/failed)
- Progress bar (0-100%)
- Metrics cards (loss, lr, mAP, etc.)
- Logs viewer (scrollable, auto-scroll to bottom)
- "Cancel Training" button (if running)

**Polling:**
```javascript
useEffect(() => {
  const interval = setInterval(async () => {
    const status = await getTrainingStatus(jobId);
    setTrainingStatus(status);
    
    if (status.status === 'completed' || status.status === 'failed') {
      clearInterval(interval);
      // Navigate to results
    }
  }, 3000);
  
  return () => clearInterval(interval);
}, [jobId]);
```

**✅ Acceptance Criteria:**
- Progress updates in real-time
- Metrics display correctly
- Logs stream correctly
- Cancel works

---

#### **Step 5.7: Training Results Component**
**File:** `src/components/Training/TrainingResults.tsx`

**What to create:**
- Shows final training results
- Displays: final metrics, insights, charts, model download

**UI Sections:**
1. **Summary Card:** Best epoch, best loss, mAP, precision, recall
2. **Metrics Charts:** Loss curve, precision/recall curve, mAP curve
3. **Per-Label Stats:** Table with precision/recall per label
4. **Insights:** Weakest labels, recommendations, warnings
5. **Actions:** Download model, View in model registry, Start new training

**Data Sources:**
- `GET /api/models/:modelId` (full model data)
- `GET /api/models/:modelId/metrics` (detailed metrics)
- `GET /api/models/:modelId/insights` (insights)

**✅ Acceptance Criteria:**
- All data displays correctly
- Charts render
- Download works
- Navigation works

---

#### **Step 5.8: Models List Component**
**File:** `src/components/Models/ModelsList.tsx`

**What to create:**
- Lists all models for current company/project
- Shows: model version, type, metrics, date, actions

**UI Elements:**
- Table/cards with model info
- Filter by model type
- Sort by date/metrics
- "View Details" button → navigate to model details page
- "Download" button

**Data Source:**
- `GET /api/models?company=X&project=Y`

**✅ Acceptance Criteria:**
- Lists models correctly
- Filters work
- Navigation works

---

#### **Step 5.9: Model Details Component**
**File:** `src/components/Models/ModelDetails.tsx`

**What to create:**
- Shows full model information
- Similar to TrainingResults but for any model (not just completed training)

**UI Sections:**
- Model info (version, type, dataset, date)
- Metrics (same as TrainingResults)
- Insights (same as TrainingResults)
- Checkpoints list
- Download actions

**✅ Acceptance Criteria:**
- All data displays
- Checkpoints list works
- Download works

---

#### **Step 5.10: Add Routing**
**File:** `src/App.tsx` or router config

**What to add:**
- Routes for training workflow
- Routes for models

**Routes:**
- `/training` → TrainingStart component
- `/training/:jobId` → TrainingProgress component
- `/training/:jobId/results` → TrainingResults component
- `/models` → ModelsList component
- `/models/:modelId` → ModelDetails component

**✅ Acceptance Criteria:**
- All routes work
- Navigation flows correctly

---

**📋 Phase 5 Checklist:**
- [ ] API client created
- [ ] Dataset selector works
- [ ] Model selector works
- [ ] Hyperparameter form works
- [ ] Training start works
- [ ] Training progress works (with polling)
- [ ] Training results works
- [ ] Models list works
- [ ] Model details works
- [ ] Routing configured

---

## 📝 Phase 6: Testing & Polish

### **Both Backend & Frontend**

#### **Step 6.1: End-to-End Testing**
**What to test:**
1. Start training with valid dataset
2. Monitor progress (polling works)
3. View logs in real-time
4. Cancel training (if needed)
5. Complete training
6. View results
7. Download model
8. View model in models list

**Test scenarios:**
- ✅ Happy path (full training)
- ✅ Cancel training
- ✅ Retry failed training
- ✅ Invalid dataset (not ready)
- ✅ Missing hyperparameters (use defaults)
- ✅ Large dataset (performance)
- ✅ Multiple concurrent trainings

**✅ Acceptance Criteria:**
- All scenarios pass
- No errors in console
- UI is responsive

---

#### **Step 6.2: Error Handling**
**What to add:**
- Backend: Proper error messages
- Frontend: Error toast/notifications
- Network error handling
- Timeout handling

**✅ Acceptance Criteria:**
- Errors are user-friendly
- No crashes on errors

---

#### **Step 6.3: Performance Optimization**
**What to optimize:**
- Backend: Limit log array size (keep last 1000 lines)
- Backend: Batch MongoDB updates (don't save on every log line)
- Frontend: Debounce polling (don't poll too frequently)
- Frontend: Virtualize logs list (if 1000+ lines)

**✅ Acceptance Criteria:**
- No performance issues
- UI stays responsive

---

#### **Step 6.4: Documentation**
**What to create:**
- API documentation (Swagger/OpenAPI or markdown)
- Frontend component documentation
- Deployment guide

**✅ Acceptance Criteria:**
- Documentation is complete
- Examples provided

---

**📋 Phase 6 Checklist:**
- [ ] End-to-end tests pass
- [ ] Error handling works
- [ ] Performance is good
- [ ] Documentation complete

---

## 🔄 Parallel Work Strategy

### **Week 1: Foundation**
- **Backend:** Phases 1-2 (Models, API endpoints)
- **Frontend:** Can start API client setup (Step 5.1) once backend endpoints are ready

### **Week 2: Core Functionality**
- **Backend:** Phase 3 (Training Worker)
- **Frontend:** Steps 5.2-5.5 (UI components for starting training)

### **Week 3: Integration**
- **Backend:** Phase 4 (Model Registry)
- **Frontend:** Steps 5.6-5.7 (Progress & Results components)

### **Week 4: Polish**
- **Backend & Frontend:** Phase 6 (Testing, error handling, optimization)

---

## 📞 Communication Points

### **Backend → Frontend (API Contracts)**
1. **After Phase 2:** Share API endpoint specs (request/response formats)
2. **After Phase 3:** Share log format (so frontend can parse if needed)
3. **After Phase 4:** Share model registry API specs

### **Frontend → Backend (Requirements)**
1. **Before Phase 2:** Confirm polling interval preference (2s vs 5s)
2. **Before Phase 5:** Share UI mockups/wireframes
3. **During Phase 5:** Report any missing API fields

---

## 🎯 Success Criteria

**Backend:**
- ✅ Can start training job
- ✅ Job processes in background
- ✅ Progress updates in real-time
- ✅ Metrics computed correctly
- ✅ Model registered after completion
- ✅ All endpoints work

**Frontend:**
- ✅ User can select dataset and start training
- ✅ Progress displays in real-time
- ✅ Results show all metrics and insights
- ✅ Models list shows trained models
- ✅ Model download works

**Together:**
- ✅ End-to-end flow works smoothly
- ✅ No errors or crashes
- ✅ Performance is acceptable
- ✅ User experience is good

---

## 🚨 Important Notes

1. **Python Training Script:** You'll need to create a Python script (`training-scripts/train.py`) that:
   - Accepts config file path
   - Runs YOLO training
   - Outputs logs in parseable format
   - Saves checkpoints
   - This is **separate from this plan** but required for Phase 3

2. **Model Storage:** Decide on storage location:
   - Local filesystem: `/models/{company}/{project}/{version}/`
   - Cloud storage: Azure Blob / AWS S3 (via storageAdapter)

3. **Checkpoint Strategy:** Decide checkpoint frequency:
   - Every N epochs (e.g., every 5 epochs)
   - Best checkpoint only
   - Both (recommended)

4. **Log Format:** Agree on log format with Python script:
   - Structured JSON logs (easier to parse)
   - Or text logs with regex parsing

---

## 📚 Additional Resources

- **Bull Queue Docs:** https://github.com/OptimalBits/bull
- **YOLO Training:** https://docs.ultralytics.com/
- **Express Best Practices:** https://expressjs.com/en/advanced/best-practice-performance.html

---

**Ready to start? Begin with Phase 1, Step 1.1! 🚀**

