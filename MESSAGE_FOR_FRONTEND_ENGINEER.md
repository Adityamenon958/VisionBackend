# Message for Frontend Engineer - Model Selection & Default Parameters

---

Hey! 👋

I've added two new endpoints to help you build the training UI. Here's how to use them:

## 🎯 **What You Need to Build:**

1. **Model Selection Dropdown** (for YOLO models)
2. **Default Parameters Display** (show what will be used if user doesn't customize)
3. **Custom Parameters Form** (optional - user can change defaults)

---

## 📡 **API Endpoints You'll Use:**

### **1. Get Available YOLO Models**
```
GET http://localhost:3000/api/train/base-models
```

**When to call:** When user selects "YOLO" as model type

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
    }
  ],
  "total": 4
}
```

**What to do:**
- Show a dropdown with model names (e.g., "YOLOv8 Nano (6.2 MB)")
- Store the `size` value ('n', 's', 'm', 'l', 'x') - you'll need this when starting training
- Only show this dropdown when model type is "YOLO"

---

### **2. Get Default Hyperparameters**
```
GET http://localhost:3000/api/train/defaults?modelType=YOLO
```

**When to call:** 
- When user selects a model type (YOLO/EfficientNet/Custom)
- Every time model type changes

**Query params:**
- `modelType`: "YOLO" | "EfficientNet" | "Custom"

**Response:**
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

**What to do:**
- Display these values in a nice card/grid/table
- Show a message like "These are the default parameters. You can customize them below."
- Update the display whenever model type changes

**Default values by model:**
- **YOLO:** epochs=20, batchSize=8, imgSize=416, learningRate=0.01, workers=2
- **EfficientNet:** epochs=10, batchSize=16, imgSize=224, learningRate=0.001, workers=2
- **Custom:** epochs=20, batchSize=8, imgSize=416, learningRate=0.01, workers=2

---

## 🎨 **UI Flow:**

```
1. User selects Dataset
   ↓
2. User selects Model Type (YOLO/EfficientNet/Custom)
   ↓
3. [If YOLO] Show model size dropdown (call /api/train/base-models)
   ↓
4. Show default parameters (call /api/train/defaults?modelType=YOLO)
   ↓
5. User sees defaults and can:
   - Option A: Click "Use Defaults" → Start training with defaults
   - Option B: Click "Customize" → Show form to edit parameters
   ↓
6. When starting training, send:
   - datasetId
   - modelType
   - modelSize (if YOLO, from dropdown selection)
   - hyperparameters (only if user customized, otherwise omit)
```

---

## 💻 **Quick Code Example:**

```javascript
// 1. When model type changes, fetch defaults
useEffect(() => {
  const loadDefaults = async () => {
    try {
      const response = await fetch(
        `http://localhost:3000/api/train/defaults?modelType=${modelType}`
      );
      const data = await response.json();
      setDefaultParams(data.defaults);
    } catch (err) {
      console.error('Failed to load defaults:', err);
    }
  };
  loadDefaults();
}, [modelType]);

// 2. Display defaults in UI
{defaultParams && (
  <div className="default-params-card">
    <h4>Default Training Parameters</h4>
    <div>
      <span>Epochs: {defaultParams.epochs}</span>
      <span>Batch Size: {defaultParams.batchSize}</span>
      <span>Image Size: {defaultParams.imgSize}</span>
      <span>Learning Rate: {defaultParams.learningRate}</span>
      <span>Workers: {defaultParams.workers}</span>
    </div>
  </div>
)}

// 3. When starting training
const startTraining = async () => {
  const body = {
    datasetId: selectedDataset._id,
    modelType: modelType
  };
  
  // Add modelSize if YOLO
  if (modelType === 'YOLO' && selectedModelSize) {
    body.modelSize = selectedModelSize; // 'n', 's', 'm', 'l', or 'x'
  }
  
  // Only add hyperparameters if user customized
  if (!useDefaults && customHyperparameters) {
    body.hyperparameters = customHyperparameters;
  }
  
  // If useDefaults is true, don't send hyperparameters at all
  // Backend will use defaults automatically
  
  const response = await fetch('http://localhost:3000/api/train', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const result = await response.json();
  // Navigate to training progress page with result.jobId
};
```

---

## ✅ **Important Notes:**

1. **Model Size:** Only required for YOLO. For EfficientNet/Custom, don't send `modelSize`.

2. **Hyperparameters:** 
   - If user chooses "Use Defaults" → **Don't send** `hyperparameters` field at all
   - If user customizes → Send the customized `hyperparameters` object
   - Backend will automatically use defaults if `hyperparameters` is missing

3. **Error Handling:**
   - If `/api/train/base-models` returns empty array, show a message like "No models found. Using default."
   - If `/api/train/defaults` fails, you can hardcode the defaults (they're in the message above)

4. **UI Suggestions:**
   - Show defaults in a visually distinct card/box
   - Add a toggle/checkbox: "Use Default Parameters" (checked by default)
   - When unchecked, show input fields pre-filled with default values
   - User can then edit those values

---

## 📚 **Full Documentation:**

Check `FRONTEND_TRAINING_INTEGRATION_GUIDE.md` for complete examples, component code, and all API details.

---

Let me know if you need any clarification! 🚀

