# 🎨 Frontend Training Component Implementation Guide

## 📋 Overview

This guide is **specifically for the Frontend Engineer** working on the Training Component UI. It provides step-by-step instructions, API contracts, and UI requirements.

**Goal:** Build a complete training UI where users can:
1. Select a dataset
2. Choose a model type
3. Configure hyperparameters
4. Start training and see live progress
5. View training results
6. Access trained models

---

## 🔗 API Base URL

```javascript
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';
```

---

## 📡 API Endpoints Reference

### **1. Start Training**
**Endpoint:** `POST /api/train`

**Request:**
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

**Error Responses:**
- `400`: Invalid request (missing datasetId, invalid modelType)
- `404`: Dataset not found
- `409`: Dataset not ready (status !== 'ready')
- `500`: Server error

---

### **2. Get Training Status**
**Endpoint:** `GET /api/train/:jobId/status`

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
  "startedAt": "2024-01-15T10:00:00Z",
  "estimatedCompletion": "2024-01-15T11:30:00Z"
}
```

**Status Values:**
- `queued` - Job waiting in queue
- `running` - Training in progress
- `completed` - Training finished successfully
- `failed` - Training failed
- `cancelled` - User cancelled

---

### **3. Get Training Logs**
**Endpoint:** `GET /api/train/:jobId/logs?limit=100`

**Query Params:**
- `limit` (optional): Number of log lines (default: 100)

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "logs": [
    "Epoch 1/100: loss=0.85, lr=0.01",
    "Epoch 2/100: loss=0.72, lr=0.01",
    "Epoch 3/100: loss=0.65, lr=0.01"
  ],
  "totalLines": 250
}
```

---

### **4. Cancel Training**
**Endpoint:** `POST /api/train/:jobId/cancel`

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "cancelled",
  "message": "Training job cancelled successfully"
}
```

**Error Responses:**
- `404`: Job not found
- `409`: Job cannot be cancelled (already completed/failed)

---

### **5. Retry Training**
**Endpoint:** `POST /api/train/:jobId/retry`

**Response (200 OK):**
```json
{
  "jobId": "job_1234567890_xyz789",
  "status": "queued",
  "message": "Training job retried successfully",
  "originalJobId": "job_1234567890_abc123"
}
```

---

### **6. List Models**
**Endpoint:** `GET /api/models?company=acme-corp&project=defect-detection`

**Query Params:**
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

---

### **7. Get Model Details**
**Endpoint:** `GET /api/models/:modelId`

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
    "weakestLabels": ["defect_type_3"],
    "recommendations": ["Add more samples for defect_type_3"]
  },
  "storagePath": "/models/acme-corp/defect-detection/v1",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

---

### **8. Get Model Metrics**
**Endpoint:** `GET /api/models/:modelId/metrics`

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
    "lossCurve": [
      { "epoch": 1, "loss": 0.85 },
      { "epoch": 2, "loss": 0.72 }
    ],
    "precisionCurve": [...],
    "mAPCurve": [...]
  }
}
```

---

### **9. Get Model Insights**
**Endpoint:** `GET /api/models/:modelId/insights`

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

---

### **10. Download Model**
**Endpoint:** `GET /api/models/:modelId/download`

**Response:**
- Content-Type: `application/octet-stream`
- Content-Disposition: `attachment; filename="model_v1.pt"`
- Binary file stream

---

### **11. List Datasets (for selection)**
**Endpoint:** `GET /api/datasets?status=ready`

**Query Params:**
- `status` (optional): Filter by status (e.g., "ready")

**Response (200 OK):**
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

## 🎨 UI Component Requirements

### **Component 1: Training Start Page**
**Route:** `/training`

**Layout:**
```
┌─────────────────────────────────────┐
│  Start New Training                 │
├─────────────────────────────────────┤
│                                     │
│  1. Select Dataset                  │
│     [Dropdown: Dataset Selector]   │
│     Selected: acme-corp / defect... │
│     Images: 1000 (800 train, 200 val)│
│                                     │
│  2. Select Model Type               │
│     ( ) YOLO                        │
│     ( ) EfficientNet                │
│     ( ) Custom                      │
│                                     │
│  3. Configure Hyperparameters       │
│     [Use Defaults] [Customize]     │
│     Epochs:        [100]            │
│     Batch Size:    [16]             │
│     Image Size:    [640]            │
│     Learning Rate: [0.01]           │
│     Workers:       [4]              │
│                                     │
│  [Cancel]  [Start Training]         │
└─────────────────────────────────────┘
```

**Behavior:**
- Dataset dropdown shows only datasets with `status === 'ready'`
- Model type selection is required
- Hyperparameters can be customized or use defaults
- "Start Training" button is disabled until:
  - Dataset is selected
  - Model type is selected
- On "Start Training" click:
  - Show loading spinner
  - Call `POST /api/train`
  - On success: Navigate to `/training/:jobId`
  - On error: Show error toast

---

### **Component 2: Training Progress Page**
**Route:** `/training/:jobId`

**Layout:**
```
┌─────────────────────────────────────┐
│  Training Progress                   │
│  Job ID: job_123...                  │
├─────────────────────────────────────┤
│                                     │
│  Status: [Running]                  │
│                                     │
│  Progress: [████████░░] 25%        │
│  Epoch: 25 / 100                    │
│                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐│
│  │ Loss    │ │ mAP50   │ │ LR      ││
│  │ 0.45    │ │ 0.72    │ │ 0.01    ││
│  └─────────┘ └─────────┘ └─────────┘│
│                                     │
│  Training Logs:                     │
│  ┌─────────────────────────────────┐│
│  │ Epoch 1/100: loss=0.85, lr=0.01 ││
│  │ Epoch 2/100: loss=0.72, lr=0.01 ││
│  │ ...                             ││
│  └─────────────────────────────────┘│
│                                     │
│  [Cancel Training]                  │
└─────────────────────────────────────┘
```

**Behavior:**
- Poll `GET /api/train/:jobId/status` every **3 seconds**
- Update progress bar, metrics, logs in real-time
- Auto-scroll logs to bottom
- Show "Cancel Training" button (only if status === 'running' or 'queued')
- On status === 'completed': Navigate to `/training/:jobId/results`
- On status === 'failed': Show error message + "Retry" button
- On "Cancel" click: Call `POST /api/train/:jobId/cancel`, show confirmation

**Polling Implementation:**
```javascript
useEffect(() => {
  const interval = setInterval(async () => {
    try {
      const status = await getTrainingStatus(jobId);
      setTrainingStatus(status);
      
      if (status.status === 'completed') {
        clearInterval(interval);
        navigate(`/training/${jobId}/results`);
      } else if (status.status === 'failed') {
        clearInterval(interval);
        setError('Training failed');
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  }, 3000);
  
  return () => clearInterval(interval);
}, [jobId]);
```

---

### **Component 3: Training Results Page**
**Route:** `/training/:jobId/results`

**Layout:**
```
┌─────────────────────────────────────┐
│  Training Results                    │
│  Model: model_123                   │
├─────────────────────────────────────┤
│                                     │
│  Summary                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐│
│  │ Best    │ │ mAP50   │ │ Prec.   ││
│  │ Epoch   │ │ 0.72    │ │ 0.85    ││
│  │ 85      │ │         │ │         ││
│  └─────────┘ └─────────┘ └─────────┘│
│                                     │
│  Metrics Charts                     │
│  [Loss Curve] [Precision/Recall]   │
│  [Line Charts Here]                 │
│                                     │
│  Per-Label Statistics               │
│  [Table: Label | Precision | Recall]│
│                                     │
│  Insights & Recommendations         │
│  • Weakest labels: defect_type_3    │
│  • Recommendation: Add more samples │
│                                     │
│  [Download Model] [View in Registry]│
│  [Start New Training]               │
└─────────────────────────────────────┘
```

**Behavior:**
- Fetch model data: `GET /api/models/:modelId` (get modelId from jobId)
- Fetch metrics: `GET /api/models/:modelId/metrics`
- Fetch insights: `GET /api/models/:modelId/insights`
- Display all data in organized sections
- Render charts using a charting library (Chart.js, Recharts, etc.)
- "Download Model" button: Call `GET /api/models/:modelId/download`
- "View in Registry" button: Navigate to `/models/:modelId`

---

### **Component 4: Models List Page**
**Route:** `/models`

**Layout:**
```
┌─────────────────────────────────────┐
│  Trained Models                      │
│  Company: acme-corp                  │
│  Project: defect-detection           │
├─────────────────────────────────────┤
│                                     │
│  [Filter: All | YOLO | EfficientNet]│
│  [Sort: Date | mAP | Precision]     │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Model v1 (YOLO)                 ││
│  │ mAP50: 0.72 | Precision: 0.85   ││
│  │ Created: Jan 15, 2024            ││
│  │ [View Details] [Download]        ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Model v2 (YOLO)                 ││
│  │ mAP50: 0.78 | Precision: 0.88   ││
│  │ Created: Jan 20, 2024            ││
│  │ [View Details] [Download]        ││
│  └─────────────────────────────────┘│
│                                     │
└─────────────────────────────────────┘
```

**Behavior:**
- Fetch models: `GET /api/models?company=X&project=Y`
- Filter by model type
- Sort by date or metrics
- "View Details" → Navigate to `/models/:modelId`
- "Download" → Call `GET /api/models/:modelId/download`

---

### **Component 5: Model Details Page**
**Route:** `/models/:modelId`

**Layout:**
- Similar to Training Results Page
- Shows full model information
- Includes checkpoints list (if available)

---

## 🛠️ Implementation Steps

### **Step 1: API Client Setup**
**File:** `src/services/trainingApi.js`

Create all API functions:
- `startTraining(datasetId, modelType, hyperparameters)`
- `getTrainingStatus(jobId)`
- `getTrainingLogs(jobId, limit)`
- `cancelTraining(jobId)`
- `retryTraining(jobId)`
- `listModels(company, project)`
- `getModel(modelId)`
- `getModelMetrics(modelId)`
- `getModelInsights(modelId)`
- `downloadModel(modelId)`
- `listDatasets(status)`

**✅ Test:** All functions work, error handling implemented

---

### **Step 2: Dataset Selector Component**
**File:** `src/components/Training/DatasetSelector.tsx`

**Props:**
```typescript
interface DatasetSelectorProps {
  onSelect: (datasetId: string) => void;
  selectedDatasetId?: string;
}
```

**Features:**
- Dropdown with dataset list
- Shows: company, project, version, image count
- Only shows `status === 'ready'` datasets
- Displays selected dataset details

**✅ Test:** Selection works, displays correctly

---

### **Step 3: Model Selector Component**
**File:** `src/components/Training/ModelSelector.tsx`

**Props:**
```typescript
interface ModelSelectorProps {
  onSelect: (modelType: string) => void;
  selectedModelType?: string;
}
```

**Features:**
- Radio buttons or cards for model types
- Options: YOLO, EfficientNet, Custom
- Shows model description/icon

**✅ Test:** Selection works

---

### **Step 4: Hyperparameter Form Component**
**File:** `src/components/Training/HyperparameterForm.tsx`

**Props:**
```typescript
interface HyperparameterFormProps {
  modelType: string;
  onChange: (hyperparameters: Hyperparameters) => void;
  defaults?: Hyperparameters;
}
```

**Fields:**
- Epochs (1-1000, default: 100)
- Batch Size (1-128, default: 16)
- Image Size (128-2048, default: 640)
- Learning Rate (0.0001-1.0, default: 0.01)
- Workers (1-16, default: 4)

**Features:**
- "Use Defaults" button
- Input validation
- Real-time onChange

**✅ Test:** Form validates, defaults work, onChange fires

---

### **Step 5: Training Start Component**
**File:** `src/components/Training/TrainingStart.tsx`

**Features:**
- Combines DatasetSelector, ModelSelector, HyperparameterForm
- "Start Training" button
- Validates all inputs
- Calls `startTraining()` API
- Shows loading state
- Navigates to `/training/:jobId` on success

**✅ Test:** Full flow works, validation works, navigation works

---

### **Step 6: Training Progress Component**
**File:** `src/components/Training/TrainingProgress.tsx`

**Features:**
- Polls status every 3 seconds
- Shows progress bar, metrics, logs
- "Cancel Training" button
- Auto-navigate on completion/failure

**✅ Test:** Polling works, UI updates, cancel works

---

### **Step 7: Training Results Component**
**File:** `src/components/Training/TrainingResults.tsx`

**Features:**
- Fetches model data, metrics, insights
- Displays charts (loss, precision/recall, mAP)
- Shows per-label stats table
- Shows insights and recommendations
- "Download Model" button

**✅ Test:** All data displays, charts render, download works

---

### **Step 8: Models List Component**
**File:** `src/components/Models/ModelsList.tsx`

**Features:**
- Lists models for company/project
- Filter and sort
- "View Details" and "Download" buttons

**✅ Test:** List displays, filters work, navigation works

---

### **Step 9: Model Details Component**
**File:** `src/components/Models/ModelDetails.tsx`

**Features:**
- Similar to Training Results
- Shows full model info
- Checkpoints list

**✅ Test:** All data displays

---

### **Step 10: Add Routing**
**File:** `src/App.tsx` or router config

**Routes:**
- `/training` → TrainingStart
- `/training/:jobId` → TrainingProgress
- `/training/:jobId/results` → TrainingResults
- `/models` → ModelsList
- `/models/:modelId` → ModelDetails

**✅ Test:** All routes work, navigation flows correctly

---

## 🎯 Testing Checklist

- [ ] Can select dataset and start training
- [ ] Progress updates in real-time
- [ ] Logs stream correctly
- [ ] Cancel training works
- [ ] Results display all metrics
- [ ] Charts render correctly
- [ ] Model download works
- [ ] Models list shows trained models
- [ ] Error handling works (network errors, API errors)
- [ ] Loading states show correctly
- [ ] UI is responsive

---

## 🚨 Important Notes

1. **Polling Interval:** Use 3 seconds (not too frequent, not too slow)
2. **Error Handling:** Always show user-friendly error messages
3. **Loading States:** Show spinners/loaders during API calls
4. **Logs Auto-Scroll:** Keep logs scrolled to bottom during training
5. **Chart Library:** Choose one (Chart.js, Recharts, Victory, etc.)
6. **TypeScript:** Use TypeScript if your project uses it
7. **State Management:** Use Redux/Context if needed for shared state

---

## 📞 Questions for Backend Engineer

1. What is the exact log format? (for parsing if needed)
2. Will chart data be available immediately or computed on-demand?
3. What is the maximum log array size? (for performance)
4. Can we get WebSocket support for real-time updates? (optional, polling works too)

---

**Ready to start? Begin with Step 1: API Client Setup! 🚀**

