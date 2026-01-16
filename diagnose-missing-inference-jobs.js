/**
 * Diagnostic Script: Find Missing MongoDB Inference Job Documents
 * 
 * This script:
 * 1. Scans the file system for inference result folders
 * 2. Extracts inference IDs from folder names
 * 3. Checks if those inference IDs exist in MongoDB
 * 4. Reports missing documents with details
 * 
 * Usage:
 *   node diagnose-missing-inference-jobs.js
 * 
 * Output:
 *   - Console report of missing inference jobs
 *   - JSON file with detailed report
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const InferenceJob = require('./models/InferenceJob');

// Results directory path
const RESULTS_DIR = path.join(process.cwd(), 'results');

/**
 * Recursively scan directory for inference folders
 * @param {string} dirPath - Directory to scan
 * @param {Array} results - Array to collect results
 * @returns {Promise<Array>} Array of found inference folders
 */
async function scanForInferenceFolders(dirPath, results = []) {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Check if this is an inference folder (starts with "inference_")
        if (entry.name.startsWith('inference_')) {
          // Extract inference ID from folder name (remove "inference_" prefix)
          const inferenceId = entry.name.replace(/^inference_/, '');
          
          // Extract company, project, modelId from path
          // Path structure: results/{company}/{project}/{modelId}/inference_{inferenceId}
          const pathParts = fullPath.split(path.sep);
          const resultsIndex = pathParts.indexOf('results');
          
          if (resultsIndex !== -1 && pathParts.length >= resultsIndex + 5) {
            const company = pathParts[resultsIndex + 1];
            const project = pathParts[resultsIndex + 2];
            const modelId = pathParts[resultsIndex + 3];
            
            results.push({
              inferenceId,
              company,
              project,
              modelId,
              folderPath: fullPath,
              folderName: entry.name
            });
          }
        } else {
          // Recursively scan subdirectories
          await scanForInferenceFolders(fullPath, results);
        }
      }
    }
  } catch (error) {
    // Skip directories that can't be read (permissions, etc.)
    if (error.code !== 'EACCES' && error.code !== 'ENOENT') {
      console.warn(`⚠️  Warning: Could not read directory ${dirPath}: ${error.message}`);
    }
  }

  return results;
}

/**
 * Check if inference job exists in MongoDB
 * @param {string} inferenceId - Inference ID to check
 * @returns {Promise<Object|null>} InferenceJob document or null
 */
async function checkInferenceJobExists(inferenceId) {
  try {
    const job = await InferenceJob.findOne({ inferenceId }).lean();
    return job;
  } catch (error) {
    console.error(`❌ Error checking inference job ${inferenceId}:`, error.message);
    return null;
  }
}

/**
 * Read metadata.json if it exists
 * @param {string} folderPath - Path to inference folder
 * @returns {Promise<Object|null>} Metadata object or null
 */
async function readMetadata(folderPath) {
  const metadataPath = path.join(folderPath, 'metadata.json');
  try {
    if (await fs.promises.access(metadataPath).then(() => true).catch(() => false)) {
      const metadataContent = await fs.promises.readFile(metadataPath, 'utf8');
      return JSON.parse(metadataContent);
    }
  } catch (error) {
    // Metadata file doesn't exist or can't be read - that's okay
  }
  return null;
}

/**
 * Check if folder has results (metadata.json, annotated folder, etc.)
 * @param {string} folderPath - Path to inference folder
 * @returns {Promise<Object>} Status information
 */
async function checkFolderStatus(folderPath) {
  const status = {
    hasMetadata: false,
    hasAnnotatedFolder: false,
    hasGoodFolder: false,
    hasDefectFolder: false,
    metadata: null
  };

  try {
    // Check for metadata.json
    const metadataPath = path.join(folderPath, 'metadata.json');
    if (await fs.promises.access(metadataPath).then(() => true).catch(() => false)) {
      status.hasMetadata = true;
      status.metadata = await readMetadata(folderPath);
    }

    // Check for subfolders
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'annotated') status.hasAnnotatedFolder = true;
        if (entry.name === 'good') status.hasGoodFolder = true;
        if (entry.name === 'defect') status.hasDefectFolder = true;
      }
    }
  } catch (error) {
    // Folder might not be readable
  }

  return status;
}

/**
 * Main diagnostic function
 */
async function diagnoseMissingInferenceJobs() {
  console.log('🔍 Starting diagnostic scan for missing inference jobs...\n');

  // ✅ Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    console.error('   Make sure MONGO_URI is set in .env file or MongoDB is running');
    process.exit(1);
  }

  // ✅ Check if results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    console.log(`⚠️  Results directory not found: ${RESULTS_DIR}`);
    console.log('   No inference result folders to scan.');
    await mongoose.connection.close();
    process.exit(0);
  }

  console.log(`📁 Scanning results directory: ${RESULTS_DIR}\n`);

  // ✅ Scan for inference folders
  const inferenceFolders = await scanForInferenceFolders(RESULTS_DIR);
  console.log(`📊 Found ${inferenceFolders.length} inference result folders\n`);

  if (inferenceFolders.length === 0) {
    console.log('✅ No inference folders found. Nothing to check.');
    await mongoose.connection.close();
    process.exit(0);
  }

  // ✅ Check each inference folder against MongoDB
  const results = {
    total: inferenceFolders.length,
    found: [],
    missing: [],
    errors: [],
    summary: {
      byCompany: {},
      byProject: {},
      byStatus: {
        hasMetadata: 0,
        hasAnnotated: 0,
        hasGoodDefect: 0
      }
    }
  };

  console.log('🔎 Checking inference jobs in MongoDB...\n');

  for (let i = 0; i < inferenceFolders.length; i++) {
    const folder = inferenceFolders[i];
    const progress = `[${i + 1}/${inferenceFolders.length}]`;

    try {
      // Check MongoDB
      const mongoJob = await checkInferenceJobExists(folder.inferenceId);

      // Check folder status
      const folderStatus = await checkFolderStatus(folder.folderPath);

      const result = {
        inferenceId: folder.inferenceId,
        company: folder.company,
        project: folder.project,
        modelId: folder.modelId,
        folderPath: folder.folderPath,
        folderName: folder.folderName,
        existsInMongoDB: !!mongoJob,
        mongoDBStatus: mongoJob ? mongoJob.status : null,
        mongoDBCompany: mongoJob ? mongoJob.company : null,
        mongoDBProject: mongoJob ? mongoJob.project : null,
        folderStatus: folderStatus,
        hasResults: folderStatus.hasMetadata || folderStatus.hasAnnotatedFolder
      };

      if (mongoJob) {
        results.found.push(result);
        console.log(`✅ ${progress} ${folder.inferenceId} - EXISTS in MongoDB (status: ${mongoJob.status})`);
      } else {
        results.missing.push(result);
        console.log(`❌ ${progress} ${folder.inferenceId} - MISSING from MongoDB`);
        console.log(`   Path: ${folder.folderPath}`);
        console.log(`   Company: ${folder.company}, Project: ${folder.project}`);
        
        // Update summary
        if (!results.summary.byCompany[folder.company]) {
          results.summary.byCompany[folder.company] = 0;
        }
        results.summary.byCompany[folder.company]++;

        if (!results.summary.byProject[`${folder.company}/${folder.project}`]) {
          results.summary.byProject[`${folder.company}/${folder.project}`] = 0;
        }
        results.summary.byProject[`${folder.company}/${folder.project}`]++;

        if (folderStatus.hasMetadata) results.summary.byStatus.hasMetadata++;
        if (folderStatus.hasAnnotatedFolder) results.summary.byStatus.hasAnnotated++;
        if (folderStatus.hasGoodFolder || folderStatus.hasDefectFolder) {
          results.summary.byStatus.hasGoodDefect++;
        }
      }
    } catch (error) {
      results.errors.push({
        inferenceId: folder.inferenceId,
        error: error.message,
        folderPath: folder.folderPath
      });
      console.error(`❌ ${progress} Error checking ${folder.inferenceId}:`, error.message);
    }
  }

  // ✅ Generate report
  console.log('\n' + '='.repeat(80));
  console.log('📋 DIAGNOSTIC REPORT');
  console.log('='.repeat(80));
  console.log(`\nTotal inference folders found: ${results.total}`);
  console.log(`✅ Found in MongoDB: ${results.found.length}`);
  console.log(`❌ Missing from MongoDB: ${results.missing.length}`);
  console.log(`⚠️  Errors: ${results.errors.length}`);

  if (results.missing.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('❌ MISSING INFERENCE JOBS SUMMARY');
    console.log('-'.repeat(80));

    // By company
    console.log('\n📊 Missing by Company:');
    Object.entries(results.summary.byCompany)
      .sort((a, b) => b[1] - a[1])
      .forEach(([company, count]) => {
        console.log(`   ${company}: ${count} missing`);
      });

    // By project
    console.log('\n📊 Missing by Project:');
    Object.entries(results.summary.byProject)
      .sort((a, b) => b[1] - a[1])
      .forEach(([project, count]) => {
        console.log(`   ${project}: ${count} missing`);
      });

    // By status
    console.log('\n📊 Missing with Results:');
    console.log(`   Has metadata.json: ${results.summary.byStatus.hasMetadata}`);
    console.log(`   Has annotated folder: ${results.summary.byStatus.hasAnnotated}`);
    console.log(`   Has good/defect folders: ${results.summary.byStatus.hasGoodDefect}`);

    // List all missing
    console.log('\n📋 All Missing Inference Jobs:');
    results.missing.forEach((job, index) => {
      console.log(`\n   ${index + 1}. ${job.inferenceId}`);
      console.log(`      Company: ${job.company}`);
      console.log(`      Project: ${job.project}`);
      console.log(`      Model ID: ${job.modelId}`);
      console.log(`      Path: ${job.folderPath}`);
      console.log(`      Has Results: ${job.hasResults ? 'Yes' : 'No'}`);
      if (job.folderStatus.hasMetadata) {
        console.log(`      Metadata: Available`);
      }
    });
  }

  // ✅ Save detailed report to JSON file
  const reportPath = path.join(process.cwd(), 'inference-jobs-diagnostic-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n💾 Detailed report saved to: ${reportPath}`);

  // ✅ Close MongoDB connection
  await mongoose.connection.close();
  console.log('\n✅ Diagnostic scan completed');

  // Exit with error code if missing jobs found
  if (results.missing.length > 0) {
    console.log(`\n⚠️  WARNING: ${results.missing.length} inference jobs are missing from MongoDB!`);
    process.exit(1);
  } else {
    console.log('\n✅ All inference jobs found in MongoDB!');
    process.exit(0);
  }
}

// ✅ Run diagnostic
diagnoseMissingInferenceJobs().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
