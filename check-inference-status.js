/**
 * Quick script to check if an inference job exists in MongoDB
 * Usage: node check-inference-status.js <inferenceId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const InferenceJob = require('./models/InferenceJob');
const Model = require('./models/Model');
const Dataset = require('./models/Dataset');

async function checkInferenceStatus(inferenceId) {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Find inference job
    const job = await InferenceJob.findOne({ inferenceId })
      .populate('modelId', 'modelId modelVersion modelType company project')
      .populate('datasetId', 'company project version')
      .lean();

    if (job) {
      console.log('✅ INFERENCE JOB FOUND IN MONGODB');
      console.log('='.repeat(80));
      console.log(`Inference ID: ${job.inferenceId}`);
      console.log(`Status: ${job.status}`);
      console.log(`Company: ${job.company}`);
      console.log(`Project: ${job.project}`);
      console.log(`Source Type: ${job.sourceType}`);
      console.log(`Created At: ${job.createdAt}`);
      console.log(`Started At: ${job.startedAt || 'N/A'}`);
      console.log(`Completed At: ${job.completedAt || 'N/A'}`);
      
      if (job.modelId) {
        console.log(`\nModel:`);
        console.log(`  Model ID: ${job.modelId.modelId}`);
        console.log(`  Version: ${job.modelId.modelVersion}`);
        console.log(`  Type: ${job.modelId.modelType}`);
      }
      
      if (job.datasetId) {
        console.log(`\nDataset:`);
        console.log(`  Version: ${job.datasetId.version}`);
        console.log(`  Company: ${job.datasetId.company}`);
        console.log(`  Project: ${job.datasetId.project}`);
      }
      
      if (job.results) {
        console.log(`\nResults:`);
        console.log(`  Total Detections: ${job.results.totalDetections || 0}`);
        console.log(`  Average Confidence: ${job.results.averageConfidence || 0}`);
        console.log(`  Results Path: ${job.results.resultsPath || 'N/A'}`);
      }
      
      if (job.error) {
        console.log(`\nError: ${job.error}`);
      }
    } else {
      console.log('❌ INFERENCE JOB NOT FOUND IN MONGODB');
      console.log('='.repeat(80));
      console.log(`Inference ID: ${inferenceId}`);
      console.log('\nThis inference job does not exist in MongoDB.');
      console.log('It may exist only in the file system (results folder).');
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Get inference ID from command line
const inferenceId = process.argv[2];
if (!inferenceId) {
  console.error('Usage: node check-inference-status.js <inferenceId>');
  process.exit(1);
}

checkInferenceStatus(inferenceId);
