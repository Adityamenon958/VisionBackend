require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const datasetRoutes = require('./routes/datasets');

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

// ✅ CORS middleware (allow frontend to make requests)
// ⚠️ CAUTION: In production, replace '*' with your frontend domain
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ✅ Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ✅ Register dataset routes
// All routes in routes/datasets.js will be prefixed with /api/dataset
app.use('/api/dataset', datasetRoutes);

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

