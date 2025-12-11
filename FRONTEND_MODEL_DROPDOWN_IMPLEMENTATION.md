# 🎯 Model Selection Dropdown - Implementation Details

## 📋 What You Need to Know

The frontend should show a **dropdown that lists available YOLO models** from the backend's `models/base/` directory. Users can select which YOLO model size to use for training.

---

## 🔗 API Endpoint

### **GET /api/train/base-models**

**Purpose:** Get list of available YOLO base models

**Request:**
```http
GET http://localhost:3000/api/train/base-models
```

**Response:**
```json
{
  "models": [
    {
      "filename": "yolov8n.pt",
      "size": "n",
      "name": "YOLOv8 Nano",
      "sizeMB": 6.2
    },
    {
      "filename": "yolov8s.pt",
      "size": "s",
      "name": "YOLOv8 Small",
      "sizeMB": 22.1
    },
    {
      "filename": "yolov8m.pt",
      "size": "m",
      "name": "YOLOv8 Medium",
      "sizeMB": 52.3
    },
    {
      "filename": "yolov8l.pt",
      "size": "l",
      "name": "YOLOv8 Large",
      "sizeMB": 88.5
    }
  ],
  "total": 4
}
```

**If no models downloaded:**
```json
{
  "models": [],
  "message": "Base models directory does not exist. Run: npm run download-models"
}
```

---

## 📡 Updated Start Training API

### **POST /api/train** (Now accepts modelSize)

**Request Body:**
```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "modelType": "YOLO",
  "modelSize": "s",  // ← NEW: 'n', 's', 'm', 'l', or 'x'
  "hyperparameters": { ... }
}
```

**Notes:**
- `modelSize` is **optional** - defaults to `'n'` (nano) if not provided
- Only used when `modelType === 'YOLO'`
- Valid values: `'n'` (nano), `'s'` (small), `'m'` (medium), `'l'` (large), `'x'` (extra large)

**Response:**
```json
{
  "jobId": "job_123",
  "status": "queued",
  "modelType": "YOLO",
  "modelSize": "s",  // ← Returns selected size
  ...
}
```

---

## 💻 Implementation Steps

### **Step 1: Add API Function**

```javascript
// src/services/trainingApi.js

export async function getAvailableBaseModels() {
  const response = await fetch(`${API_BASE}/api/train/base-models`);
  if (!response.ok) {
    throw new Error('Failed to get available models');
  }
  return await response.json();
}

// Update startTraining to accept modelSize
export async function startTraining(datasetId, modelType, modelSize = null, hyperparameters = null) {
  const body = { datasetId, modelType };
  
  if (modelType === 'YOLO' && modelSize) {
    body.modelSize = modelSize;
  }
  
  if (hyperparameters) {
    body.hyperparameters = hyperparameters;
  }

  const response = await fetch(`${API_BASE}/api/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start training');
  }

  return await response.json();
}
```

---

### **Step 2: Create Model Size Selector Component**

```javascript
// src/components/Training/ModelSizeSelector.tsx

import { useState, useEffect } from 'react';
import { getAvailableBaseModels } from '../../services/trainingApi';

function ModelSizeSelector({ onSelect, selectedSize }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const data = await getAvailableBaseModels();
      setModels(data.models);
      
      // Auto-select first model if none selected
      if (data.models.length > 0 && !selectedSize) {
        onSelect(data.models[0].size);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading models...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  if (models.length === 0) {
    return (
      <div className="warning">
        ⚠️ No base models found. Training will use default model.
      </div>
    );
  }

  return (
    <select
      value={selectedSize || models[0]?.size}
      onChange={(e) => onSelect(e.target.value)}
      className="model-size-dropdown"
    >
      {models.map(model => (
        <option key={model.size} value={model.size}>
          {model.name} ({model.sizeMB} MB)
        </option>
      ))}
    </select>
  );
}

export default ModelSizeSelector;
```

---

### **Step 3: Update Training Start Component**

```javascript
// src/components/Training/TrainingStart.tsx

const [modelType, setModelType] = useState('YOLO');
const [modelSize, setModelSize] = useState(null); // ← ADD THIS

// In your JSX, add model size selector:
{modelType === 'YOLO' && (
  <div className="form-group">
    <label>YOLO Model Size</label>
    <ModelSizeSelector
      onSelect={(size) => setModelSize(size)}
      selectedSize={modelSize}
    />
  </div>
)}

// Update startTraining call:
const result = await startTraining(
  selectedDataset._id,
  modelType,
  modelSize, // ← PASS THIS
  useDefaults ? null : hyperparameters
);
```

---

## 🎨 UI Example

```
┌─────────────────────────────────────┐
│  Select Model                        │
├─────────────────────────────────────┤
│                                     │
│  Model Type:                         │
│  (•) YOLO                            │
│  ( ) EfficientNet                    │
│  ( ) Custom                           │
│                                     │
│  YOLO Model Size:                    │
│  ┌─────────────────────────────────┐ │
│  │ YOLOv8 Nano (6.2 MB)         ▼ │ │
│  └─────────────────────────────────┘ │
│                                     │
│  Selected: YOLOv8 Nano              │
│  File Size: 6.2 MB                   │
│                                     │
└─────────────────────────────────────┘
```

---

## 🔄 Complete Flow

1. User selects "YOLO" → Frontend calls `GET /api/train/base-models`
2. Backend returns available models → Frontend shows dropdown
3. User selects model size (e.g., "YOLOv8 Small") → `modelSize = 's'`
4. User clicks "Start Training" → Frontend sends `POST /api/train` with `modelSize: 's'`
5. Backend uses `yolov8s.pt` from `models/base/` for training

---

## ⚠️ Important Notes

1. **Model Size is Optional**: If not provided, defaults to `'n'` (nano)
2. **Only for YOLO**: `modelSize` is ignored for EfficientNet and Custom
3. **Empty List Handling**: If no models found, show warning but allow training
4. **Model Size Codes**: `'n'`, `'s'`, `'m'`, `'l'`, `'x'`

---

## 📝 Quick Reference

**API Function:**
```javascript
getAvailableBaseModels() → { models: [...], total: number }
```

**Start Training:**
```javascript
startTraining(datasetId, 'YOLO', 's', hyperparameters)
//                              ↑ modelSize
```

**Model Size Values:**
- `'n'` = Nano (6 MB)
- `'s'` = Small (22 MB)
- `'m'` = Medium (52 MB)
- `'l'` = Large (88 MB)
- `'x'` = Extra Large (not commonly used)

---

**That's it! The dropdown should dynamically show only available models. 🚀**

