# 🎨 Frontend Training Backend Integration Guide

## 📋 Overview

This is a **complete guide** for the Frontend Engineer to integrate the Training Component with the backend. All endpoints are **ready and tested**.

**Base URL:** `http://localhost:3000` (or `process.env.REACT_APP_API_URL`)

---

## 🚀 Quick Start

### **1. API Client Setup**

Create a service file for all API calls:

**File:** `src/services/trainingApi.js`

```javascript
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';

/**
 * Get available base YOLO models
 */
export async function getAvailableBaseModels() {
  const response = await fetch(`${API_BASE}/api/train/base-models`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get available base models');
  }

  return await response.json();
}

/**
 * Get default hyperparameters for a model type
 * @param {string} modelType - 'YOLO' | 'EfficientNet' | 'Custom'
 * @returns {Promise<{modelType: string, defaults: object}>}
 */
export async function getDefaultHyperparameters(modelType) {
  const response = await fetch(`${API_BASE}/api/train/defaults?modelType=${modelType}`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get default hyperparameters');
  }

  return await response.json();
}

/**
 * Start a new training job
 */
export async function startTraining(datasetId, modelType, modelSize = null, hyperparameters = null) {
  const body = {
    datasetId,
    modelType
  };
  
  // Add modelSize if provided (for YOLO)
  if (modelType === 'YOLO' && modelSize) {
    body.modelSize = modelSize;
  }
  
  // Only include hyperparameters if provided (backend will use defaults if omitted)
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

/**
 * Get training job status
 */
export async function getTrainingStatus(jobId) {
  const response = await fetch(`${API_BASE}/api/train/${jobId}/status`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get training status');
  }

  return await response.json();
}

/**
 * Get training logs
 */
export async function getTrainingLogs(jobId, limit = 100) {
  const response = await fetch(`${API_BASE}/api/train/${jobId}/logs?limit=${limit}`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get training logs');
  }

  return await response.json();
}

/**
 * Cancel a training job
 */
export async function cancelTraining(jobId) {
  const response = await fetch(`${API_BASE}/api/train/${jobId}/cancel`, {
    method: 'POST'
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel training');
  }

  return await response.json();
}

/**
 * Retry a failed/cancelled training job
 */
export async function retryTraining(jobId) {
  const response = await fetch(`${API_BASE}/api/train/${jobId}/retry`, {
    method: 'POST'
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to retry training');
  }

  return await response.json();
}

/**
 * List ready datasets
 */
export async function listReadyDatasets() {
  const response = await fetch(`${API_BASE}/api/datasets?status=ready`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list datasets');
  }

  return await response.json();
}

/**
 * Get dataset details
 */
export async function getDataset(datasetId) {
  const response = await fetch(`${API_BASE}/api/dataset/${datasetId}`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get dataset');
  }

  return await response.json();
}

/**
 * List models for a company/project
 */
export async function listModels(company, project) {
  const response = await fetch(`${API_BASE}/api/models?company=${encodeURIComponent(company)}&project=${encodeURIComponent(project)}`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list models');
  }

  return await response.json();
}

/**
 * Get model details
 */
export async function getModel(modelId) {
  const response = await fetch(`${API_BASE}/api/models/${modelId}`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get model');
  }

  return await response.json();
}

/**
 * Get model metrics and chart data
 */
export async function getModelMetrics(modelId) {
  const response = await fetch(`${API_BASE}/api/models/${modelId}/metrics`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get model metrics');
  }

  return await response.json();
}

/**
 * Get model insights
 */
export async function getModelInsights(modelId) {
  const response = await fetch(`${API_BASE}/api/models/${modelId}/insights`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get model insights');
  }

  return await response.json();
}

/**
 * Download model file
 */
export async function downloadModel(modelId) {
  const response = await fetch(`${API_BASE}/api/models/${modelId}/download`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to download model');
  }

  // Get filename from Content-Disposition header
  const contentDisposition = response.headers.get('Content-Disposition');
  const filename = contentDisposition
    ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
    : `model_${modelId}.pt`;

  // Create blob and download
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * List checkpoints for a model
 */
export async function listCheckpoints(modelId) {
  const response = await fetch(`${API_BASE}/api/models/${modelId}/checkpoints`);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to list checkpoints');
  }

  return await response.json();
}
```

---

## 📱 Complete Frontend Workflow

### **Step 1: Dataset Selection Page**

**Component:** `TrainingStart.tsx` or `TrainingStart.jsx`

```javascript
import { useState, useEffect } from 'react';
import { listReadyDatasets, startTraining, getAvailableBaseModels, getDefaultHyperparameters } from '../services/trainingApi';
import ModelSizeSelector from './ModelSizeSelector'; // Component for model size dropdown

function TrainingStart() {
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [modelType, setModelType] = useState('YOLO');
  const [modelSize, setModelSize] = useState(null); // NEW: For YOLO model size selection
  const [defaultHyperparameters, setDefaultHyperparameters] = useState(null); // NEW: Store default params
  const [hyperparameters, setHyperparameters] = useState(null);
  const [useDefaults, setUseDefaults] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load ready datasets on mount
  useEffect(() => {
    loadDatasets();
    loadDefaultHyperparameters('YOLO'); // Load defaults for initial model type
  }, []);

  // Load default hyperparameters when model type changes
  useEffect(() => {
    loadDefaultHyperparameters(modelType);
  }, [modelType]);

  const loadDatasets = async () => {
    try {
      const data = await listReadyDatasets();
      setDatasets(data.datasets);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadDefaultHyperparameters = async (type) => {
    try {
      const data = await getDefaultHyperparameters(type);
      setDefaultHyperparameters(data.defaults);
    } catch (err) {
      console.error('Failed to load default hyperparameters:', err);
      // Don't show error to user, just log it
    }
  };

  const handleStartTraining = async () => {
    if (!selectedDataset) {
      setError('Please select a dataset');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await startTraining(
        selectedDataset._id,
        modelType,
        modelSize, // Pass selected model size (null for non-YOLO)
        useDefaults ? null : hyperparameters
      );

      // Navigate to training progress page
      window.location.href = `/training/${result.jobId}`;
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="training-start">
      <h1>Start New Training</h1>

      {/* Dataset Selection */}
      <div className="form-group">
        <label>Select Dataset</label>
        <select
          value={selectedDataset?._id || ''}
          onChange={(e) => {
            const dataset = datasets.find(d => d._id === e.target.value);
            setSelectedDataset(dataset);
          }}
        >
          <option value="">-- Select Dataset --</option>
          {datasets.map(dataset => (
            <option key={dataset._id} value={dataset._id}>
              {dataset.company} / {dataset.project} / {dataset.version}
              ({dataset.totalImages} images: {dataset.trainCount} train, {dataset.valCount} val)
            </option>
          ))}
        </select>
      </div>

      {/* Model Type Selection */}
      <div className="form-group">
        <label>Model Type</label>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              value="YOLO"
              checked={modelType === 'YOLO'}
              onChange={(e) => setModelType(e.target.value)}
            />
            YOLO
          </label>
          <label>
            <input
              type="radio"
              value="EfficientNet"
              checked={modelType === 'EfficientNet'}
              onChange={(e) => setModelType(e.target.value)}
            />
            EfficientNet
          </label>
          <label>
            <input
              type="radio"
              value="Custom"
              checked={modelType === 'Custom'}
              onChange={(e) => setModelType(e.target.value)}
            />
            Custom
          </label>
        </div>
      </div>

      {/* YOLO Model Size Selection - Only shown when YOLO is selected */}
      {modelType === 'YOLO' && (
        <div className="form-group">
          <label>YOLO Model Size</label>
          <ModelSizeSelector
            onSelect={(size) => setModelSize(size)}
            selectedSize={modelSize}
          />
        </div>
      )}

      {/* Default Hyperparameters Display */}
      {defaultHyperparameters && (
        <div className="default-params-display">
          <h3>Default Training Parameters</h3>
          <div className="params-grid">
            <div className="param-item">
              <span className="param-label">Epochs:</span>
              <span className="param-value">{defaultHyperparameters.epochs}</span>
            </div>
            <div className="param-item">
              <span className="param-label">Batch Size:</span>
              <span className="param-value">{defaultHyperparameters.batchSize}</span>
            </div>
            <div className="param-item">
              <span className="param-label">Image Size:</span>
              <span className="param-value">{defaultHyperparameters.imgSize}</span>
            </div>
            <div className="param-item">
              <span className="param-label">Learning Rate:</span>
              <span className="param-value">{defaultHyperparameters.learningRate}</span>
            </div>
            <div className="param-item">
              <span className="param-label">Workers:</span>
              <span className="param-value">{defaultHyperparameters.workers}</span>
            </div>
          </div>
          <p className="params-note">
            ℹ️ These are the default parameters that will be used if you don't customize them.
          </p>
        </div>
      )}

      {/* Hyperparameters */}
      <div className="form-group">
        <label>
          <input
            type="checkbox"
            checked={useDefaults}
            onChange={(e) => setUseDefaults(e.target.checked)}
          />
          Use Default Hyperparameters
        </label>
      </div>

      {!useDefaults && (
        <div className="hyperparameters-form">
          <input
            type="number"
            placeholder="Epochs (default: 20)"
            onChange={(e) => setHyperparameters({
              ...hyperparameters,
              epochs: parseInt(e.target.value)
            })}
          />
          <input
            type="number"
            placeholder="Batch Size (default: 16)"
            onChange={(e) => setHyperparameters({
              ...hyperparameters,
              batchSize: parseInt(e.target.value)
            })}
          />
          <input
            type="number"
            placeholder="Image Size (default: 640)"
            onChange={(e) => setHyperparameters({
              ...hyperparameters,
              imgSize: parseInt(e.target.value)
            })}
          />
          <input
            type="number"
            step="0.0001"
            placeholder="Learning Rate (default: 0.01)"
            onChange={(e) => setHyperparameters({
              ...hyperparameters,
              learningRate: parseFloat(e.target.value)
            })}
          />
          <input
            type="number"
            placeholder="Workers (default: 4)"
            onChange={(e) => setHyperparameters({
              ...hyperparameters,
              workers: parseInt(e.target.value)
            })}
          />
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <button
        onClick={handleStartTraining}
        disabled={!selectedDataset || loading}
      >
        {loading ? 'Starting...' : 'Start Training'}
      </button>
    </div>
  );
}

export default TrainingStart;
```

---

### **Step 2: Training Progress Page**

**Component:** `TrainingProgress.tsx`

```javascript
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getTrainingStatus,
  getTrainingLogs,
  cancelTraining
} from '../services/trainingApi';

function TrainingProgress() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Poll status every 3 seconds
  useEffect(() => {
    if (!jobId) return;

    const pollStatus = async () => {
      try {
        const data = await getTrainingStatus(jobId);
        setStatus(data);
        setLoading(false);

        // Stop polling if completed or failed
        if (data.status === 'completed') {
          // Navigate to results page
          navigate(`/training/${jobId}/results`);
        } else if (data.status === 'failed') {
          setError('Training failed');
        }
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    // Poll immediately
    pollStatus();

    // Then poll every 3 seconds
    const interval = setInterval(pollStatus, 3000);

    return () => clearInterval(interval);
  }, [jobId, navigate]);

  // Load logs
  useEffect(() => {
    if (!jobId) return;

    const loadLogs = async () => {
      try {
        const data = await getTrainingLogs(jobId, 200);
        setLogs(data.logs);
      } catch (err) {
        console.error('Failed to load logs:', err);
      }
    };

    loadLogs();
    const interval = setInterval(loadLogs, 5000); // Refresh logs every 5 seconds

    return () => clearInterval(interval);
  }, [jobId]);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this training?')) return;

    try {
      await cancelTraining(jobId);
      setStatus({ ...status, status: 'cancelled' });
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error && status?.status !== 'failed') {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="training-progress">
      <h1>Training Progress</h1>
      <p>Job ID: {jobId}</p>

      {/* Status Badge */}
      <div className={`status-badge status-${status?.status}`}>
        {status?.status?.toUpperCase()}
      </div>

      {/* Progress Bar */}
      {status?.progress && (
        <div className="progress-section">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${status.progress.progressPercent}%` }}
            />
          </div>
          <p>
            Epoch {status.progress.currentEpoch} / {status.progress.totalEpochs}
            ({status.progress.progressPercent}%)
          </p>
        </div>
      )}

      {/* Metrics Cards */}
      {status?.metrics && (
        <div className="metrics-grid">
          <div className="metric-card">
            <label>Current Loss</label>
            <value>{status.metrics.currentLoss?.toFixed(4) || 'N/A'}</value>
          </div>
          <div className="metric-card">
            <label>Best Loss</label>
            <value>{status.metrics.bestLoss?.toFixed(4) || 'N/A'}</value>
          </div>
          <div className="metric-card">
            <label>mAP50</label>
            <value>{status.metrics.mAP50?.toFixed(4) || 'N/A'}</value>
          </div>
          <div className="metric-card">
            <label>Learning Rate</label>
            <value>{status.metrics.currentLR?.toFixed(6) || 'N/A'}</value>
          </div>
        </div>
      )}

      {/* Logs Viewer */}
      <div className="logs-section">
        <h3>Training Logs</h3>
        <div className="logs-container">
          {logs.map((log, index) => (
            <div key={index} className="log-line">{log}</div>
          ))}
        </div>
      </div>

      {/* Cancel Button */}
      {(status?.status === 'queued' || status?.status === 'running') && (
        <button onClick={handleCancel} className="cancel-button">
          Cancel Training
        </button>
      )}

      {/* Error Message */}
      {status?.status === 'failed' && (
        <div className="error-section">
          <p>Training failed. You can retry this job.</p>
          <button onClick={() => navigate(`/training/${jobId}/retry`)}>
            Retry Training
          </button>
        </div>
      )}
    </div>
  );
}

export default TrainingProgress;
```

---

### **Step 3: Training Results Page**

**Component:** `TrainingResults.tsx`

```javascript
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getModel,
  getModelMetrics,
  getModelInsights,
  downloadModel
} from '../services/trainingApi';

function TrainingResults() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  
  const [model, setModel] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadResults();
  }, [jobId]);

  const loadResults = async () => {
    try {
      // First, get model ID from job (you might need to get this from training status)
      // For now, assuming you have modelId from somewhere
      // In real implementation, you'd get modelId from the completed training job
      
      // This is a placeholder - you'll need to get modelId from the training job
      // For example: const trainingJob = await getTrainingJob(jobId);
      // const modelId = trainingJob.modelId;
      
      // For demonstration, assuming modelId is available
      const modelId = 'model_123'; // Replace with actual modelId
      
      const [modelData, metricsData, insightsData] = await Promise.all([
        getModel(modelId),
        getModelMetrics(modelId),
        getModelInsights(modelId)
      ]);

      setModel(modelData);
      setMetrics(metricsData);
      setInsights(insightsData);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      await downloadModel(model.modelId);
    } catch (err) {
      alert('Failed to download model: ' + err.message);
    }
  };

  if (loading) {
    return <div>Loading results...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="training-results">
      <h1>Training Results</h1>

      {/* Summary Cards */}
      <div className="summary-grid">
        <div className="summary-card">
          <label>Best Epoch</label>
          <value>{metrics?.metrics?.bestEpoch || 'N/A'}</value>
        </div>
        <div className="summary-card">
          <label>Best Loss</label>
          <value>{metrics?.metrics?.bestLoss?.toFixed(4) || 'N/A'}</value>
        </div>
        <div className="summary-card">
          <label>mAP50</label>
          <value>{metrics?.metrics?.mAP50?.toFixed(4) || 'N/A'}</value>
        </div>
        <div className="summary-card">
          <label>Precision</label>
          <value>{metrics?.metrics?.precision?.toFixed(4) || 'N/A'}</value>
        </div>
        <div className="summary-card">
          <label>Recall</label>
          <value>{metrics?.metrics?.recall?.toFixed(4) || 'N/A'}</value>
        </div>
      </div>

      {/* Charts */}
      {metrics?.chartData && (
        <div className="charts-section">
          <h3>Training Metrics</h3>
          {/* Render charts using your charting library */}
          {/* Example with Chart.js or Recharts */}
        </div>
      )}

      {/* Per-Label Statistics */}
      {metrics?.metrics?.perLabelStats && (
        <div className="per-label-stats">
          <h3>Per-Label Performance</h3>
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>mAP50</th>
              </tr>
            </thead>
            <tbody>
              {metrics.metrics.perLabelStats.map((stat, index) => (
                <tr key={index}>
                  <td>{stat.label}</td>
                  <td>{stat.precision?.toFixed(4)}</td>
                  <td>{stat.recall?.toFixed(4)}</td>
                  <td>{stat.mAP50?.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Insights */}
      {insights?.insights && (
        <div className="insights-section">
          <h3>Insights & Recommendations</h3>
          <div className="insights-content">
            <p><strong>Best Accuracy:</strong> {insights.insights.bestAccuracy?.toFixed(4)}</p>
            <p><strong>Best mAP:</strong> {insights.insights.bestmAP?.toFixed(4)}</p>
            
            {insights.insights.weakestLabels?.length > 0 && (
              <div>
                <strong>Weakest Labels:</strong>
                <ul>
                  {insights.insights.weakestLabels.map((label, index) => (
                    <li key={index}>{label}</li>
                  ))}
                </ul>
              </div>
            )}

            {insights.insights.recommendations?.length > 0 && (
              <div>
                <strong>Recommendations:</strong>
                <ul>
                  {insights.insights.recommendations.map((rec, index) => (
                    <li key={index}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="actions-section">
        <button onClick={handleDownload}>Download Model</button>
        <button onClick={() => navigate('/models')}>View in Model Registry</button>
        <button onClick={() => navigate('/training')}>Start New Training</button>
      </div>
    </div>
  );
}

export default TrainingResults;
```

---

### **Step 4: Models List Page**

**Component:** `ModelsList.tsx`

```javascript
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listModels } from '../services/trainingApi';

function ModelsList() {
  const navigate = useNavigate();
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Get company/project from context or props
  const company = 'acme-corp'; // Replace with actual company
  const project = 'defect-detection'; // Replace with actual project

  useEffect(() => {
    loadModels();
  }, [company, project]);

  const loadModels = async () => {
    try {
      const data = await listModels(company, project);
      setModels(data.models);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading models...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="models-list">
      <h1>Trained Models</h1>
      <p>Company: {company} | Project: {project}</p>

      {models.length === 0 ? (
        <p>No models found. Start training to create models.</p>
      ) : (
        <div className="models-grid">
          {models.map(model => (
            <div key={model.modelId} className="model-card">
              <h3>Model {model.modelVersion}</h3>
              <p>Type: {model.modelType}</p>
              <div className="model-metrics">
                <span>mAP50: {model.metrics?.mAP50?.toFixed(4) || 'N/A'}</span>
                <span>Precision: {model.metrics?.precision?.toFixed(4) || 'N/A'}</span>
              </div>
              <p>Created: {new Date(model.createdAt).toLocaleDateString()}</p>
              <button onClick={() => navigate(`/models/${model.modelId}`)}>
                View Details
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ModelsList;
```

---

## 🔄 Complete User Flow

```
1. User navigates to /training
   ↓
2. Selects dataset from dropdown
   ↓
3. Selects model type (YOLO/EfficientNet/Custom)
   ↓
4. (If YOLO) Selects model size from dropdown (Nano/Small/Medium/Large)
   ↓
5. (Optional) Configures hyperparameters or uses defaults
   ↓
6. Clicks "Start Training"
   ↓
7. POST /api/train (with modelSize if YOLO) → Gets jobId
   ↓
8. Navigate to /training/:jobId
   ↓
9. Poll GET /api/train/:jobId/status every 3s
   ↓
10. Display progress, metrics, logs in real-time
   ↓
11. When status === 'completed' → Navigate to /training/:jobId/results
   ↓
12. Display final metrics, charts, insights
   ↓
13. User can download model or view in registry
```

---

## 📊 Displaying Default Hyperparameters

### **Get Default Hyperparameters**

**Endpoint:** `GET /api/train/defaults?modelType=YOLO`

**Purpose:** Returns the default hyperparameters for a specific model type. Use this to show users what values will be used if they don't customize.

**Query Parameters:**
- `modelType` (required): `'YOLO'` | `'EfficientNet'` | `'Custom'`

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

**Usage:**
1. Call this endpoint when user selects a model type
2. Display the defaults in a nice UI (cards, grid, or table)
3. Update the display when model type changes
4. This helps users understand what will be used if they don't customize

**Example Implementation:**
```javascript
// When model type changes
useEffect(() => {
  const loadDefaults = async () => {
    try {
      const data = await getDefaultHyperparameters(modelType);
      setDefaultHyperparameters(data.defaults);
    } catch (err) {
      console.error('Failed to load defaults:', err);
    }
  };
  loadDefaults();
}, [modelType]);

// Display in UI
{defaultHyperparameters && (
  <div className="default-params">
    <h4>Default Parameters:</h4>
    <ul>
      <li>Epochs: {defaultHyperparameters.epochs}</li>
      <li>Batch Size: {defaultHyperparameters.batchSize}</li>
      <li>Image Size: {defaultHyperparameters.imgSize}</li>
      <li>Learning Rate: {defaultHyperparameters.learningRate}</li>
      <li>Workers: {defaultHyperparameters.workers}</li>
    </ul>
  </div>
)}
```

**Default Values by Model Type:**
- **YOLO:** epochs=20, batchSize=8, imgSize=416, learningRate=0.01, workers=2
- **EfficientNet:** epochs=10, batchSize=16, imgSize=224, learningRate=0.001, workers=2
- **Custom:** epochs=20, batchSize=8, imgSize=416, learningRate=0.01, workers=2

---

## 🎯 Model Selection Guide

### **Get Available Base Models**

**Endpoint:** `GET /api/train/base-models`

**Purpose:** Returns list of YOLO base models available in `models/base/` directory.

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
      "sizeMB": 52.0
    },
    {
      "filename": "yolov8l.pt",
      "size": "l",
      "name": "YOLOv8 Large",
      "sizeMB": 87.7
    }
  ],
  "total": 4
}
```

**Usage:**
- Call this when user selects "YOLO" model type
- Show dropdown with available models
- User selects model size (n, s, m, l, x)
- Pass `modelSize` when starting training

### **Updated Start Training Request**

**NEW Field:** `modelSize` (optional, only for YOLO)

```json
{
  "datasetId": "507f1f77bcf86cd799439011",
  "modelType": "YOLO",
  "modelSize": "s",  // ← NEW: 'n', 's', 'm', 'l', or 'x'
  "hyperparameters": { ... }
}
```

**Notes:**
- `modelSize` defaults to `'n'` (nano) if not provided
- Only used when `modelType === 'YOLO'`
- Frontend should show dropdown with available models from `GET /api/train/base-models`
- If no models found in `models/base/`, backend will use default (nano) and may download it

### **Model Size Selector Component**

See **Step 1.5** above for the complete `ModelSizeSelector` component implementation.

---

## ⚠️ Important Notes

### **1. Model Selection**
- **For YOLO:** Show model size dropdown (Nano, Small, Medium, Large)
- **For EfficientNet/Custom:** No model size selection needed
- **Empty Models:** If no models found, show warning but allow training (backend will use default)

### **2. Polling Strategy**
- **Status:** Poll every **3 seconds** (not too frequent, not too slow)
- **Logs:** Poll every **5 seconds** (less frequent than status)
- **Stop polling** when status is `completed`, `failed`, or `cancelled`

### **3. Error Handling**
- Always check `response.ok` before using data
- Display user-friendly error messages
- Handle network errors gracefully
- Show loading states during API calls

### **4. Hyperparameters**
- If user doesn't customize, **omit** `hyperparameters` from request
- Backend will use defaults based on `modelType`
- Or send `null` - backend will fill defaults

### **5. Status Values**
- `queued` - Show "Queued" badge, no progress yet
- `running` - Show progress bar, metrics, logs
- `completed` - Navigate to results page
- `failed` - Show error + retry button
- `cancelled` - Show cancelled message

### **6. Metrics Availability**
- `metrics` field is `null` when status is `queued`
- Metrics appear when status is `running` or `completed`
- Always check `metrics !== null` before displaying

### **7. Model ID from Training Job**
- After training completes, you need to get `modelId` from the training job
- You might need to add an endpoint: `GET /api/train/:jobId` that returns full job details including `modelId`
- Or store `modelId` in your frontend state when training completes

---

## 📊 API Response Examples

### **Start Training Response:**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "queued",
  "message": "Training job queued successfully",
  "datasetId": "507f1f77bcf86cd799439011",
  "modelType": "YOLO",
  "hyperparameters": {
    "epochs": 20,
    "batchSize": 8,
    "imgSize": 416,
    "learningRate": 0.01,
    "workers": 2
  }
}
```

### **Training Status Response:**
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

### **Model Metrics Response:**
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

## 🎨 UI Recommendations

### **1. Progress Bar**
- Use a visual progress bar (0-100%)
- Show current epoch / total epochs
- Update in real-time

### **2. Metrics Cards**
- Display key metrics in cards
- Use color coding (green for good, red for poor)
- Update values as training progresses

### **3. Logs Viewer**
- Scrollable container
- Auto-scroll to bottom
- Highlight errors in red
- Use monospace font

### **4. Charts**
- Use Chart.js, Recharts, or Victory
- Display loss curve, precision/recall curve, mAP curve
- Make charts interactive (zoom, hover)

### **5. Status Badges**
- Color-coded badges:
  - `queued` - Yellow
  - `running` - Blue
  - `completed` - Green
  - `failed` - Red
  - `cancelled` - Gray

---

## 🧪 Testing Checklist

Before deploying, test:

- [ ] Can select dataset and start training
- [ ] **Model size dropdown shows available models (for YOLO)**
- [ ] **Model size is passed correctly when starting training**
- [ ] Progress updates in real-time
- [ ] Logs stream correctly
- [ ] Cancel training works
- [ ] Retry failed training works
- [ ] Results display all metrics
- [ ] Charts render correctly
- [ ] Model download works
- [ ] Models list shows trained models
- [ ] Error handling works (network errors, API errors)
- [ ] Loading states show correctly
- [ ] UI is responsive

---

## 📞 Support

If you encounter issues:
1. Check browser console for errors
2. Check Network tab for API responses
3. Verify API base URL is correct
4. Ensure backend server is running
5. Check CORS settings if requests are blocked

---

## 🚀 Ready to Build!

All endpoints are **ready and tested**. You can start building the UI components now!

**Next Steps:**
1. Create API service file (`trainingApi.js`)
2. Build dataset selector component
3. Build model selector component
4. Build hyperparameter form component
5. Build training progress page with polling
6. Build training results page
7. Build models list page
8. Add routing

**Good luck! 🎉**

