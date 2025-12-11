# 🚀 API Quick Reference

## Base URL
```
http://localhost:3000
```

## Endpoints

### Training Endpoints

### 0. Get Available Base Models (NEW)
```http
GET /api/train/base-models
```

**Response (200):**
```json
{
  "models": [
    {
      "filename": "yolov8n.pt",
      "size": "n",
      "name": "YOLOv8 Nano",
      "sizeMB": 6.2
    }
  ],
  "total": 4
}
```

---

### 0.5. Get Default Hyperparameters (NEW)
```http
GET /api/train/defaults?modelType=YOLO
```

**Query Parameters:**
- `modelType` (required): `YOLO` | `EfficientNet` | `Custom`

**Response (200):**
```json
{
  "modelType": "YOLO",
  "defaults": {
    "epochs": 20,
    "batchSize": 8,
    "imgSize": 416,
    "learningRate": 0.01,
    "workers": 2
  }
}
```

**Use Case:** Call this when user selects a model type to show them what default parameters will be used.

---

### 1. Start Training (UPDATED)
```http
POST /api/train
Content-Type: application/json

{
  "datasetId": "507f1f77bcf86cd799439011",
  "modelType": "YOLO",
  "modelSize": "n",  // NEW: Optional, 'n'/'s'/'m'/'l'/'x', defaults to 'n'
  "hyperparameters": {
    "epochs": 20,
    "batchSize": 8,
    "imgSize": 416,
    "learningRate": 0.01,
    "workers": 2
  }
}
```

**Response (202):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "queued",
  "datasetId": "...",
  "modelType": "YOLO",
  "modelSize": "n",  // NEW: Returns selected model size
  "hyperparameters": { ... }
}
```

---

### 2. Get Status (Poll Every 3s)
```http
GET /api/train/:jobId/status
```

**Response (200):**
```json
{
  "jobId": "job_123",
  "status": "running",
  "progress": {
    "currentEpoch": 25,
    "totalEpochs": 100,
    "progressPercent": 25
  },
  "metrics": {
    "currentLoss": 0.45,
    "bestLoss": 0.42,
    "mAP50": 0.72
  },
  "startedAt": "2024-01-15T10:00:00.000Z"
}
```

**Status Values:** `queued`, `running`, `completed`, `failed`, `cancelled`

---

### 3. Get Logs
```http
GET /api/train/:jobId/logs?limit=100
```

**Response (200):**
```json
{
  "jobId": "job_123",
  "logs": ["Epoch 1/100: loss=0.85", ...],
  "totalLines": 250,
  "returnedLines": 100
}
```

---

### 4. Cancel Training
```http
POST /api/train/:jobId/cancel
```

**Response (200):**
```json
{
  "jobId": "job_123",
  "status": "cancelled",
  "message": "Training job cancelled successfully"
}
```

---

### 5. Retry Training
```http
POST /api/train/:jobId/retry
```

**Response (200):**
```json
{
  "jobId": "job_new123",
  "status": "queued",
  "message": "Training job retried successfully",
  "originalJobId": "job_123"
}
```

---

### 6. List Ready Datasets
```http
GET /api/datasets?status=ready
```

**Response (200):**
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
      "valCount": 200
    }
  ],
  "total": 10
}
```

---

### Model Registry Endpoints

### 7. List Models
```http
GET /api/models?company=acme-corp&project=defect-detection
```

**Response (200):**
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
        "precision": 0.85,
        "recall": 0.78
      },
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ],
  "total": 5
}
```

---

### 8. Get Model Details
```http
GET /api/models/:modelId
```

**Response (200):**
```json
{
  "modelId": "model_123",
  "jobId": "job_456",
  "company": "acme-corp",
  "project": "defect-detection",
  "modelVersion": "v1",
  "modelType": "YOLO",
  "datasetVersion": "v1",
  "datasetId": "507f1f77bcf86cd799439011",
  "metrics": { ... },
  "insights": { ... },
  "storagePath": "/models/acme-corp/defect-detection/v1",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

---

### 9. Get Model Metrics
```http
GET /api/models/:modelId/metrics
```

**Response (200):**
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
    "perLabelStats": [...]
  },
  "chartData": {
    "lossCurve": [...],
    "precisionCurve": [...],
    "mAPCurve": [...]
  }
}
```

---

### 10. Get Model Insights
```http
GET /api/models/:modelId/insights
```

**Response (200):**
```json
{
  "modelId": "model_123",
  "insights": {
    "bestAccuracy": 0.85,
    "bestmAP": 0.72,
    "weakestLabels": ["defect_type_3"],
    "recommendations": ["Add more samples for defect_type_3"]
  }
}
```

---

### 11. Download Model
```http
GET /api/models/:modelId/download
```

**Response:** Binary file stream (Content-Type: application/octet-stream)

---

### 12. List Checkpoints
```http
GET /api/models/:modelId/checkpoints
```

**Response (200):**
```json
{
  "modelId": "model_123",
  "checkpoints": [
    {
      "epoch": 50,
      "path": "/models/.../checkpoints/epoch_50.pt",
      "isBest": false,
      "metrics": { ... }
    }
  ],
  "total": 10
}
```

---

## Error Responses

**400 Bad Request:**
```json
{ "error": "Missing required field: datasetId" }
```

**404 Not Found:**
```json
{ "error": "Training job not found", "jobId": "..." }
```

**409 Conflict:**
```json
{ "error": "Dataset is not ready for training", "status": "processing" }
```

**500 Internal Server Error:**
```json
{ "error": "Internal server error", "message": "..." }
```

---

## Frontend Flow

1. **Select Dataset** → `GET /api/datasets?status=ready`
2. **Select Model** → User choice (YOLO/EfficientNet/Custom)
3. **Configure Params** → Optional (omit for defaults)
4. **Start Training** → `POST /api/train` → Get `jobId`
5. **Poll Status** → `GET /api/train/:jobId/status` every 3s
6. **Show Logs** → `GET /api/train/:jobId/logs`
7. **On Complete** → Navigate to results page

---

## Implementation Files

- **Routes:** `routes/training.js`
- **Controllers:** `controllers/trainingController.js`
- **Queue:** `queue/index.js`
- **Models:** `models/TrainingJob.js`, `models/Model.js`
- **Services:** `services/trainingService.js`

---

**Full Documentation:** See `FRONTEND_API_GUIDE.md`

