#!/usr/bin/env node
/**
 * Quick Dataset Class Analysis Script
 * 
 * This script analyzes a dataset to show:
 * - Total number of classes
 * - Number of defects/annotations per class
 * - Distribution across train/val splits
 * 
 * Usage:
 *   node check-dataset-classes.js <datasetId>
 *   OR
 *   node check-dataset-classes.js <company> <project> <version>
 * 
 * Example:
 *   node check-dataset-classes.js 507f1f77bcf86cd799439011
 *   node check-dataset-classes.js gsn ConnectWell v3
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const Dataset = require('./models/Dataset');

// ✅ Connect to MongoDB
async function connectDB() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4, // Force IPv4
    });
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }
}

/**
 * Parse YOLO label file and extract class IDs
 * Format: class_id center_x center_y width height (normalized 0-1)
 */
async function parseLabelFile(labelPath) {
  try {
    const content = await fs.readFile(labelPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    const classIds = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const classId = parseInt(parts[0]);
        if (!isNaN(classId)) {
          classIds.push(classId);
        }
      }
    }
    
    return classIds;
  } catch (error) {
    // File doesn't exist or is empty - return empty array
    return [];
  }
}

/**
 * Analyze dataset labels
 */
async function analyzeDataset(dataset) {
  const datasetPath = path.join(process.cwd(), 'datasets', dataset.company, dataset.project, dataset.version);
  
  // ✅ Check if dataset directory exists
  try {
    await fs.access(datasetPath);
  } catch (error) {
    console.error(`❌ Dataset directory not found: ${datasetPath}`);
    console.error(`   Make sure preprocessing has completed (status: ${dataset.status})`);
    return null;
  }

  // ✅ Paths to label folders
  const trainLabelsPath = path.join(datasetPath, 'labels', 'train');
  const valLabelsPath = path.join(datasetPath, 'labels', 'val');
  const testLabelsPath = path.join(datasetPath, 'labels', 'test');

  // ✅ Statistics
  const stats = {
    totalClasses: new Set(),
    classCounts: {}, // classId -> { train: count, val: count, test: count, total: count }
    totalLabels: { train: 0, val: 0, test: 0, total: 0 },
    labeledFiles: { train: 0, val: 0, test: 0, total: 0 },
    emptyFiles: { train: 0, val: 0, test: 0, total: 0 }
  };

  // ✅ Helper function to process a folder
  async function processFolder(folderPath, splitName) {
    try {
      const files = await fs.readdir(folderPath);
      const labelFiles = files.filter(f => f.endsWith('.txt'));
      
      stats.labeledFiles[splitName] = labelFiles.length;
      
      for (const labelFile of labelFiles) {
        const labelPath = path.join(folderPath, labelFile);
        const classIds = await parseLabelFile(labelPath);
        
        if (classIds.length === 0) {
          stats.emptyFiles[splitName]++;
        } else {
          // Count classes in this file
          for (const classId of classIds) {
            stats.totalClasses.add(classId);
            
            if (!stats.classCounts[classId]) {
              stats.classCounts[classId] = { train: 0, val: 0, test: 0, total: 0 };
            }
            
            stats.classCounts[classId][splitName]++;
            stats.classCounts[classId].total++;
            stats.totalLabels[splitName]++;
            stats.totalLabels.total++;
          }
        }
      }
    } catch (error) {
      // Folder doesn't exist - that's okay
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️  Warning reading ${splitName} folder:`, error.message);
      }
    }
  }

  // ✅ Process all splits
  await processFolder(trainLabelsPath, 'train');
  await processFolder(valLabelsPath, 'val');
  await processFolder(testLabelsPath, 'test');

  // ✅ Calculate totals
  stats.labeledFiles.total = stats.labeledFiles.train + stats.labeledFiles.val + stats.labeledFiles.test;
  stats.emptyFiles.total = stats.emptyFiles.train + stats.emptyFiles.val + stats.emptyFiles.test;

  return stats;
}

/**
 * Display results in a nice format
 */
function displayResults(dataset, stats) {
  if (!stats) {
    return;
  }

  console.log('='.repeat(80));
  console.log('📊 DATASET CLASS ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Dataset: ${dataset.company} / ${dataset.project} / ${dataset.version}`);
  console.log(`Status: ${dataset.status}`);
  console.log(`Storage Path: ${dataset.storagePath}`);
  console.log('='.repeat(80));
  console.log();

  // ✅ Overall Statistics
  console.log('📈 OVERALL STATISTICS');
  console.log('-'.repeat(80));
  console.log(`Total Classes Found: ${stats.totalClasses.size}`);
  console.log(`Total Label Files: ${stats.labeledFiles.total} (Train: ${stats.labeledFiles.train}, Val: ${stats.labeledFiles.val}, Test: ${stats.labeledFiles.test})`);
  console.log(`Total Annotations: ${stats.totalLabels.total} (Train: ${stats.totalLabels.train}, Val: ${stats.totalLabels.val}, Test: ${stats.totalLabels.test})`);
  
  // ✅ Calculate average annotations per file
  const avgAnnotationsPerFile = stats.labeledFiles.total > 0 
    ? (stats.totalLabels.total / stats.labeledFiles.total).toFixed(2)
    : '0.00';
  console.log(`Average Annotations per File: ${avgAnnotationsPerFile}`);
  
  console.log(`Empty Label Files: ${stats.emptyFiles.total} (Train: ${stats.emptyFiles.train}, Val: ${stats.emptyFiles.val}, Test: ${stats.emptyFiles.test})`);
  console.log();

  // ✅ Class Distribution
  if (stats.totalClasses.size > 0) {
    console.log('🏷️  CLASS DISTRIBUTION');
    console.log('-'.repeat(80));
    
    // Sort classes by ID
    const sortedClasses = Array.from(stats.totalClasses).sort((a, b) => a - b);
    
    // Table header
    console.log('Class ID | Train | Val  | Test | Total | Percentage');
    console.log('-'.repeat(80));
    
    for (const classId of sortedClasses) {
      const counts = stats.classCounts[classId];
      const percentage = ((counts.total / stats.totalLabels.total) * 100).toFixed(2);
      console.log(
        `   ${classId.toString().padStart(2)}   | ${counts.train.toString().padStart(5)} | ${counts.val.toString().padStart(4)} | ${counts.test.toString().padStart(4)} | ${counts.total.toString().padStart(5)} | ${percentage.padStart(6)}%`
      );
    }
    
    console.log('-'.repeat(80));
    console.log();
    
    // ✅ Class Imbalance Warning
    const maxCount = Math.max(...sortedClasses.map(id => stats.classCounts[id].total));
    const minCount = Math.min(...sortedClasses.map(id => stats.classCounts[id].total));
    const imbalanceRatio = maxCount / minCount;
    
    if (imbalanceRatio > 5) {
      console.log('⚠️  WARNING: Class imbalance detected!');
      console.log(`   Largest class has ${imbalanceRatio.toFixed(1)}x more samples than smallest class.`);
      console.log(`   Consider using class weights or data augmentation for better training.`);
      console.log();
    }
  } else {
    console.log('⚠️  No classes found in label files!');
    console.log('   Make sure your dataset has been preprocessed and contains .txt label files.');
    console.log();
  }

  console.log('='.repeat(80));
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node check-dataset-classes.js <datasetId>');
    console.log('  OR');
    console.log('  node check-dataset-classes.js <company> <project> <version>');
    console.log();
    console.log('Examples:');
    console.log('  node check-dataset-classes.js 507f1f77bcf86cd799439011');
    console.log('  node check-dataset-classes.js gsn ConnectWell v3');
    process.exit(1);
  }

  await connectDB();

  try {
    let dataset;

    if (args.length === 1) {
      // ✅ Find by dataset ID
      const datasetId = args[0];
      dataset = await Dataset.findById(datasetId);
      
      if (!dataset) {
        console.error(`❌ Dataset not found with ID: ${datasetId}`);
        process.exit(1);
      }
    } else if (args.length === 3) {
      // ✅ Find by company/project/version
      const [company, project, version] = args;
      dataset = await Dataset.findOne({ company, project, version });
      
      if (!dataset) {
        console.error(`❌ Dataset not found: ${company} / ${project} / ${version}`);
        process.exit(1);
      }
    } else {
      console.error('❌ Invalid arguments. Provide either datasetId OR company/project/version');
      process.exit(1);
    }

    console.log(`🔍 Analyzing dataset: ${dataset.company} / ${dataset.project} / ${dataset.version}\n`);

    // ✅ Analyze dataset
    const stats = await analyzeDataset(dataset);

    // ✅ Display results
    displayResults(dataset, stats);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// ✅ Run the script
main();

