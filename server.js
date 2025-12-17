require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const datasetRoutes = require('./routes/datasets');
const trainingRoutes = require('./routes/training');
const modelRoutes = require('./routes/models');
const inferenceRoutes = require('./routes/inference');

/**
 * Main Server File
 * 
 * This is the entry point of your backend application.
 * It sets up Express, connects to MongoDB, and registers routes.
 */

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware: Parse JSON request bodies
// This allows you to read JSON data from POST/PUT requests
app.use(express.json());

// ✅ Middleware: Parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));

// --- production-safe CORS (replace existing CORS middleware) ---
const allowedOrigin = process.env.CORS_ORIGIN || '*'; // set in Azure later

app.set('trust proxy', 1); // required for Azure behind proxy

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigin === '*' || (origin && origin === allowedOrigin)) {
    res.header('Access-Control-Allow-Origin', allowedOrigin === '*' ? '*' : origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  } else {
    return res.status(403).json({ error: 'CORS origin denied' });
  }
});

// ✅ Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ✅ Request logging middleware (for debugging)
app.use((req, res, next) => {
  // Log ALL requests (for debugging thumbnail issue)
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`, {
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    origin: req.headers.origin,
    referer: req.headers.referer
  });
  next();
});

// ✅ Register dataset routes
// All routes in routes/datasets.js will be prefixed with /api/dataset
app.use('/api/dataset', datasetRoutes);

// ✅ Register training routes
// All routes in routes/training.js will be prefixed with /api/train
app.use('/api/train', trainingRoutes);

// ✅ Register model registry routes
// All routes in routes/models.js will be prefixed with /api/models
app.use('/api/models', modelRoutes);

// ✅ Register inference routes
// All routes in routes/inference.js will be prefixed with /api/inference
app.use('/api/inference', inferenceRoutes);

// ✅ Register list datasets endpoint (plural) - separate route for clarity
// GET /api/datasets - List all datasets
const { listDatasets } = require('./controllers/datasetController');
app.get('/api/datasets', listDatasets);

// ✅ 404 handler (route not found)
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path
  });
});

// ✅ Error handler middleware
// ⚠️ CAUTION: This catches all errors from route handlers
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

/**
 * Connect to MongoDB and start server
 */
const startServer = async () => {
  try {
    // ✅ Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // ✅ Start Express server
    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
      console.log(`📁 Dataset upload: POST http://localhost:${PORT}/api/dataset/upload`);
      console.log(`📊 Dataset status: GET http://localhost:${PORT}/api/dataset/:datasetId/status`);
      console.log(`🚀 Training start: POST http://localhost:${PORT}/api/train`);
      console.log(`📈 Training status: GET http://localhost:${PORT}/api/train/:jobId/status`);
      console.log(`🤖 Models list: GET http://localhost:${PORT}/api/models?company=X&project=Y`);
      console.log(`📦 Model details: GET http://localhost:${PORT}/api/models/:modelId`);
      console.log(`🗑️  Model delete: DELETE http://localhost:${PORT}/api/models/:modelId`);
      console.log(`📋 Inference list: GET http://localhost:${PORT}/api/inference?company=X&project=Y`);
      console.log(`🔮 Inference start: POST http://localhost:${PORT}/api/inference/start`);
      console.log(`📊 Inference status: GET http://localhost:${PORT}/api/inference/:inferenceId/status`);
      console.log(`📋 Inference results: GET http://localhost:${PORT}/api/inference/:inferenceId/results`);
      console.log(`🖼️  Inference images: GET http://localhost:${PORT}/api/inference/:inferenceId/image/:filename`);
      console.log(`❌ Inference cancel: POST http://localhost:${PORT}/api/inference/:inferenceId/cancel`);
      console.log(`🗑️  Inference delete: DELETE http://localhost:${PORT}/api/inference/:inferenceId`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// ✅ Handle MongoDB connection errors
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected');
});

// ✅ Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// ✅ Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

// ✅ Start the server
startServer();

module.exports = app;

