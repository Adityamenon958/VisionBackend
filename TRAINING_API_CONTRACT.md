# 📡 Training API Contract

## Overview

This document defines the **complete API contract** for the Training Component. Both **Backend** and **Frontend** engineers should reference this document to ensure compatibility.

**Base URL:** `http://localhost:3000` (or `process.env.API_URL`)

---

## 🔐 Authentication

**Status:** Not implemented yet (will be added later)

For now, all endpoints are **public** (no auth required).

---

## 📋 Endpoints

### **1. Start Training**

**Endpoint:** `POST /api/train`

**Description:** Creates a new training job and enqueues it for processing.

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
- `datasetId` (string, required): MongoDB ObjectId of the dataset
- `modelType` (string, required): One of `"YOLO"`, `"EfficientNet"`, `"Custom"`
- `hyperparameters` (object, optional): Training hyperparameters
  - `epochs` (number, optional): Number of training epochs (default: 100)
  - `batchSize` (number, optional): Batch size (default: 16)
  - `imgSize` (number, optional): Image size (default: 640)
  - `learningRate` (number, optional): Learning rate (default: 0.01)
  - `workers` (number, optional): Number of worker threads (default: 4)

**Response (202 Accepted):**
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

**Error Responses:**

**400 Bad Request:**
```json
{
  "error": "Invalid request",
  "details": "datasetId is required"
}
```

**404 Not Found:**
```json
{
  "error": "Dataset not found",
  "datasetId": "507f1f77bcf86cd799439011"
}
```

**409 Conflict:**
```json
{
  "error": "Dataset not ready for training",
  "datasetId": "507f1f77bcf86cd799439011",
  "status": "processing"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error",
  "message": "Failed to create training job"
}
```

---

### **2. Get Training Status**

**Endpoint:** `GET /api/train/:jobId/status`

**Description:** Returns the current status, progress, and latest metrics for a training job.

**Path Parameters:**
- `jobId` (string, required): The training job ID

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
    "bestEpoch": 20,
    "mAP50": 0.72,
    "mAP50_95": 0.58
  },
  "startedAt": "2024-01-15T10:00:00.000Z",
  "estimatedCompletion": "2024-01-15T11:30:00.000Z"
}
```

**Status Values:**
- `queued` - Job is waiting in the queue
- `running` - Training is in progress
- `completed` - Training finished successfully
- `failed` - Training failed with an error
- `cancelled` - Training was cancelled by user

**Response Schema:**
- `jobId` (string): The training job ID
- `status` (string): Current job status
- `progress` (object):
  - `currentEpoch` (number): Current epoch number
  - `totalEpochs` (number): Total number of epochs
  - `progressPercent` (number): Progress percentage (0-100)
- `metrics` (object, optional): Latest training metrics
  - `currentLoss` (number): Current loss value
  - `currentLR` (number): Current learning rate
  - `bestLoss` (number): Best loss so far
  - `bestEpoch` (number): Epoch with best loss
  - `mAP50` (number, optional): mAP@0.5 metric
  - `mAP50_95` (number, optional): mAP@0.5:0.95 metric
- `startedAt` (string, ISO 8601): When training started
- `estimatedCompletion` (string, ISO 8601, optional): Estimated completion time

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

---

### **3. Get Training Logs**

**Endpoint:** `GET /api/train/:jobId/logs`

**Description:** Returns the training logs for a job.

**Path Parameters:**
- `jobId` (string, required): The training job ID

**Query Parameters:**
- `limit` (number, optional): Maximum number of log lines to return (default: 100, max: 1000)

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "logs": [
    "Epoch 1/100: loss=0.85, lr=0.01",
    "Epoch 2/100: loss=0.72, lr=0.01",
    "Epoch 3/100: loss=0.65, lr=0.01",
    "..."
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

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

---

### **4. Cancel Training**

**Endpoint:** `POST /api/train/:jobId/cancel`

**Description:** Cancels a training job (only if status is `queued` or `running`).

**Path Parameters:**
- `jobId` (string, required): The training job ID

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "cancelled",
  "message": "Training job cancelled successfully"
}
```

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

**409 Conflict:**
```json
{
  "error": "Training job cannot be cancelled",
  "jobId": "job_1234567890_abc123",
  "status": "completed",
  "reason": "Job is already completed"
}
```

---

### **5. Retry Training**

**Endpoint:** `POST /api/train/:jobId/retry`

**Description:** Retries a failed or cancelled training job by creating a new job with the same parameters.

**Path Parameters:**
- `jobId` (string, required): The original training job ID

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_xyz789",
  "status": "queued",
  "message": "Training job retried successfully",
  "originalJobId": "job_1234567890_abc123"
}
```

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Training job not found",
  "jobId": "job_1234567890_abc123"
}
```

**409 Conflict:**
```json
{
  "error": "Training job cannot be retried",
  "jobId": "job_1234567890_abc123",
  "status": "running",
  "reason": "Job is still running"
}
```

---

### **6. List Models**

**Endpoint:** `GET /api/models`

**Description:** Lists all trained models for a specific company and project.

**Query Parameters:**
- `company` (string, required): Company name
- `project` (string, required): Project name

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
        "precision": 0.85,
        "recall": 0.78
      },
      "createdAt": "2024-01-15T10:00:00.000Z"
    },
    {
      "modelId": "model_456",
      "modelVersion": "v2",
      "modelType": "YOLO",
      "status": "completed",
      "metrics": {
        "mAP50": 0.78,
        "precision": 0.88,
        "recall": 0.82
      },
      "createdAt": "2024-01-20T14:30:00.000Z"
    }
  ],
  "total": 2
}
```

**Response Schema:**
- `models` (array): Array of model objects
  - `modelId` (string): Unique model ID
  - `modelVersion` (string): Model version (e.g., "v1", "v2")
  - `modelType` (string): Model type ("YOLO", "EfficientNet", "Custom")
  - `status` (string): Model status ("completed", "failed")
  - `metrics` (object): Key metrics
    - `mAP50` (number): mAP@0.5
    - `precision` (number): Precision
    - `recall` (number): Recall
  - `createdAt` (string, ISO 8601): Creation timestamp
- `total` (number): Total number of models

**Error Responses:**

**400 Bad Request:**
```json
{
  "error": "Missing required query parameters",
  "required": ["company", "project"]
}
```

---

### **7. Get Model Details**

**Endpoint:** `GET /api/models/:modelId`

**Description:** Returns full details for a specific model.

**Path Parameters:**
- `modelId` (string, required): The model ID

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
  "datasetId": "507f1f77bcf86cd799439011",
  "metrics": {
    "bestEpoch": 85,
    "bestLoss": 0.42,
    "precision": 0.85,
    "recall": 0.78,
    "mAP50": 0.72,
    "mAP50_95": 0.58
  },
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
  },
  "storagePath": "/models/acme-corp/defect-detection/v1",
  "createdAt": "2024-01-15T10:00:00.000Z"
}
```

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Model not found",
  "modelId": "model_123"
}
```

---

### **8. Get Model Metrics**

**Endpoint:** `GET /api/models/:modelId/metrics`

**Description:** Returns detailed metrics including per-label statistics and chart data.

**Path Parameters:**
- `modelId` (string, required): The model ID

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
      },
      {
        "label": "no_defect",
        "precision": 0.92,
        "recall": 0.90,
        "mAP50": 0.85
      }
    ]
  },
  "chartData": {
    "lossCurve": [
      { "epoch": 1, "loss": 0.85 },
      { "epoch": 2, "loss": 0.72 },
      { "epoch": 3, "loss": 0.65 }
    ],
    "precisionCurve": [
      { "epoch": 1, "precision": 0.65 },
      { "epoch": 2, "precision": 0.72 },
      { "epoch": 3, "precision": 0.78 }
    ],
    "mAPCurve": [
      { "epoch": 1, "mAP50": 0.55 },
      { "epoch": 2, "mAP50": 0.62 },
      { "epoch": 3, "mAP50": 0.68 }
    ]
  }
}
```

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Model not found",
  "modelId": "model_123"
}
```

---

### **9. Get Model Insights**

**Endpoint:** `GET /api/models/:modelId/insights`

**Description:** Returns insights and recommendations for a model.

**Path Parameters:**
- `modelId` (string, required): The model ID

**Response (200 OK):**
```json
{
  "modelId": "model_123",
  "insights": {
    "bestAccuracy": 0.85,
    "bestmAP": 0.72,
    "weakestLabels": ["defect_type_3", "defect_type_7"],
    "classImbalanceWarnings": [
      "Label 'defect_type_3' has only 50 samples (recommended: 200+)",
      "Label 'defect_type_7' has only 30 samples (recommended: 200+)"
    ],
    "recommendations": [
      "Add more training samples for 'defect_type_3'",
      "Add more training samples for 'defect_type_7'",
      "Consider data augmentation for underrepresented classes",
      "Review label quality for low-performing classes"
    ]
  }
}
```

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Model not found",
  "modelId": "model_123"
}
```

---

### **10. Download Model**

**Endpoint:** `GET /api/models/:modelId/download`

**Description:** Downloads the best checkpoint file for a model.

**Path Parameters:**
- `modelId` (string, required): The model ID

**Response:**
- **Content-Type:** `application/octet-stream`
- **Content-Disposition:** `attachment; filename="model_v1.pt"`
- **Body:** Binary file stream

**Error Responses:**

**404 Not Found:**
```json
{
  "error": "Model not found",
  "modelId": "model_123"
}
```

**404 Not Found (file missing):**
```json
{
  "error": "Model file not found",
  "modelId": "model_123",
  "path": "/models/acme-corp/defect-detection/v1/best.pt"
}
```

---

## 🔄 Status Flow

```
queued → running → completed
              ↓
           failed
              ↓
         (can retry)
```

**Transitions:**
- `queued` → `running`: Worker picks up job
- `running` → `completed`: Training finishes successfully
- `running` → `failed`: Training encounters error
- `queued` → `cancelled`: User cancels before start
- `running` → `cancelled`: User cancels during training
- `failed` → `queued`: User retries (new job created)
- `cancelled` → `queued`: User retries (new job created)

---

## 📊 Data Types

### **Hyperparameters**
```typescript
interface Hyperparameters {
  epochs: number;        // 1-1000, default: 100
  batchSize: number;     // 1-128, default: 16
  imgSize: number;       // 128-2048, default: 640
  learningRate: number;  // 0.0001-1.0, default: 0.01
  workers: number;       // 1-16, default: 4
}
```

### **Progress**
```typescript
interface Progress {
  currentEpoch: number;
  totalEpochs: number;
  progressPercent: number;  // 0-100
}
```

### **Metrics**
```typescript
interface Metrics {
  currentLoss?: number;
  currentLR?: number;
  bestLoss: number;
  bestEpoch: number;
  mAP50?: number;
  mAP50_95?: number;
  precision?: number;
  recall?: number;
}
```

---

## 🚨 Error Handling

All endpoints should return consistent error responses:

**Format:**
```json
{
  "error": "Error message",
  "details": "Additional details (optional)",
  "field": "fieldName (if validation error)"
}
```

**Status Codes:**
- `200` - Success
- `202` - Accepted (job queued)
- `400` - Bad Request (validation error)
- `404` - Not Found
- `409` - Conflict (business logic error)
- `500` - Internal Server Error

---

## 📝 Notes

1. **Polling:** Frontend should poll `GET /api/train/:jobId/status` every 3-5 seconds during training
2. **Logs:** Logs are returned as an array of strings (most recent first if limit is applied)
3. **Dates:** All dates are in ISO 8601 format (UTC)
4. **File Downloads:** Model downloads are binary streams, not JSON
5. **Default Hyperparameters:** If not provided, backend uses sensible defaults based on model type

---

**Last Updated:** 2024-01-15

**Version:** 1.0.0

