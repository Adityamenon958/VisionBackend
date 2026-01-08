/**
 * Migration Script: Initialize Annotation System for Existing Datasets
 * 
 * This script migrates existing datasets to support the annotation feature:
 * - Creates Image documents for all existing images
 * - Extracts image dimensions (width, height)
 * - Detects existing .txt label files and sets hasLabels = true
 * - Creates default categories for datasets
 * - Updates Dataset labeled/unlabeled counts
 * 
 * This script is idempotent - safe to run multiple times.
 * 
 * Usage: node scripts/migrate-annotations.js
 */

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const fs = require('fs');
const fsPromises = require('fs').promises;
const sharp = require('sharp');
const Dataset = require('../models/Dataset');
const Image = require('../models/Image');
const Category = require('../models/Category');
const storageAdapter = require('../services/storageAdapter');

// System user ID for createdBy (since auth is skipped)
const SYSTEM_USER_ID = new mongoose.Types.ObjectId('000000000000000000000000');

/**
 * Recursively find all image files in a directory
 */
async function findImageFiles(dirPath, extensions = ['.jpg', '.jpeg', '.png']) {
  const files = [];
  
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subFiles = await findImageFiles(fullPath, extensions);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    // Directory might not exist, that's ok
    if (error.code !== 'ENOENT') {
      console.warn(`Warning: Could not read directory ${dirPath}:`, error.message);
    }
  }
  
  return files;
}

/**
 * Check if corresponding label file exists for an image
 */
async function checkLabelFileExists(imagePath, datasetPath) {
  try {
    // Convert image path to label path (parallel structure)
    // e.g., datasets/company/project/v1/images/good/image.jpg
    //   -> datasets/company/project/v1/labels/good/image.txt
    const relativePath = path.relative(datasetPath, imagePath);
    const labelPath = relativePath.replace(/^images\//, 'labels/').replace(/\.(jpg|jpeg|png)$/i, '.txt');
    const fullLabelPath = path.join(datasetPath, labelPath);
    
    try {
      await fsPromises.access(fullLabelPath);
      return true;
    } catch {
      return false;
    }
  } catch (error) {
    return false;
  }
}

/**
 * Get folder name from image path
 * e.g., datasets/company/project/v1/images/train/image.jpg -> train
 *      datasets/company/project/v1/images/good/image.jpg -> good
 */
function getFolderFromPath(imagePath, datasetPath) {
  const relativePath = path.relative(datasetPath, imagePath);
  const parts = relativePath.split(path.sep);
  
  // parts[0] should be 'images', parts[1] should be folder name
  if (parts.length >= 2 && parts[0] === 'images') {
    const folder = parts[1];
    // Validate folder is one of the expected values
    if (['train', 'val', 'test', 'unlabeled'].includes(folder)) {
      return folder;
    }
    // Otherwise return the folder name (e.g., 'good', 'defect1')
    return folder;
  }
  
  return 'unlabeled'; // Default
}

/**
 * Migrate a single dataset
 */
async function migrateDataset(dataset) {
  console.log(`\n📦 Migrating dataset: ${dataset.company}/${dataset.project}/${dataset.version} (${dataset._id})`);
  
  const datasetPath = storageAdapter.buildDatasetPath(dataset.company, dataset.project, dataset.version);
  const imagesPath = storageAdapter.buildImagesPath(dataset.company, dataset.project, dataset.version);
  
  // Check if dataset directory exists
  try {
    await fsPromises.access(datasetPath);
  } catch (error) {
    console.warn(`⚠️  Dataset directory not found: ${datasetPath}, skipping...`);
    return { created: 0, updated: 0, skipped: 0 };
  }
  
  // Find all image files in the dataset
  console.log(`   - Scanning for images in: ${imagesPath}`);
  const imageFiles = await findImageFiles(imagesPath);
  console.log(`   - Found ${imageFiles.length} image files`);
  
  if (imageFiles.length === 0) {
    console.log(`   - No images found, skipping...`);
    return { created: 0, updated: 0, skipped: 0 };
  }
  
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  // Process each image file
  for (const imageFilePath of imageFiles) {
    try {
      // Get relative path from dataset root (for storedPath)
      const relativePath = path.relative(datasetPath, imageFilePath);
      
      // Check if Image document already exists
      const existingImage = await Image.findOne({
        datasetId: dataset._id,
        storedPath: relativePath
      });
      
      if (existingImage) {
        // Image document exists, check if we need to update it
        const needsUpdate = !existingImage.width || !existingImage.height || existingImage.width === 0 || existingImage.height === 0;
        
        if (needsUpdate) {
          // Extract dimensions
          try {
            const metadata = await sharp(imageFilePath).metadata();
            const fileStats = await fsPromises.stat(imageFilePath);
            
            // Check label file
            const hasLabels = await checkLabelFileExists(imageFilePath, datasetPath);
            
            existingImage.width = metadata.width || 0;
            existingImage.height = metadata.height || 0;
            existingImage.size = fileStats.size;
            existingImage.hasLabels = hasLabels;
            existingImage.folder = getFolderFromPath(imageFilePath, datasetPath);
            if (hasLabels && !existingImage.convertedAt) {
              existingImage.convertedAt = new Date();
            }
            
            await existingImage.save();
            updated++;
          } catch (dimError) {
            console.warn(`   ⚠️  Failed to extract dimensions for ${relativePath}:`, dimError.message);
            skipped++;
          }
        } else {
          skipped++;
        }
        continue;
      }
      
      // Create new Image document
      try {
        // Extract dimensions
        const metadata = await sharp(imageFilePath).metadata();
        const fileStats = await fsPromises.stat(imageFilePath);
        
        // Check if label file exists
        const hasLabels = await checkLabelFileExists(imageFilePath, datasetPath);
        
        // Get folder name
        const folder = getFolderFromPath(imageFilePath, datasetPath);
        
        // Get filename
        const filename = path.basename(imageFilePath);
        
        // Create Image document
        const imageDoc = {
          datasetId: dataset._id,
          filename: filename,
          storedPath: relativePath, // e.g., "images/train/image.jpg" or "images/good/image.jpg"
          folder: folder,
          size: fileStats.size,
          width: metadata.width || 0,
          height: metadata.height || 0,
          hasLabels: hasLabels,
          convertedAt: hasLabels ? new Date() : undefined
        };
        
        // Use upsert to avoid duplicates
        await Image.findOneAndUpdate(
          { datasetId: dataset._id, storedPath: relativePath },
          imageDoc,
          { upsert: true, new: true }
        );
        
        created++;
      } catch (dimError) {
        console.warn(`   ⚠️  Failed to process ${relativePath}:`, dimError.message);
        errors++;
      }
    } catch (error) {
      console.error(`   ❌ Error processing image ${imageFilePath}:`, error.message);
      errors++;
    }
  }
  
  // Create default categories if none exist
  const existingCategories = await Category.countDocuments({ datasetId: dataset._id });
  if (existingCategories === 0) {
    console.log(`   - Creating default categories...`);
    try {
      await Category.createDefaults(dataset._id, SYSTEM_USER_ID);
      console.log(`   - ✅ Created default categories`);
    } catch (catError) {
      console.error(`   ❌ Failed to create default categories:`, catError.message);
    }
  } else {
    console.log(`   - Categories already exist (${existingCategories}), skipping...`);
  }
  
  // Recalculate labeled/unlabeled counts
  const labeledCount = await Image.countDocuments({ datasetId: dataset._id, hasLabels: true });
  const unlabeledCount = await Image.countDocuments({ datasetId: dataset._id, hasLabels: false });
  
  // Update Dataset counts
  dataset.labeledImages = labeledCount;
  dataset.unlabeledImages = unlabeledCount;
  await dataset.save();
  
  console.log(`   - ✅ Migration complete: ${created} created, ${updated} updated, ${skipped} skipped, ${errors} errors`);
  console.log(`   - 📊 Counts: ${labeledCount} labeled, ${unlabeledCount} unlabeled`);
  
  return { created, updated, skipped, errors };
}

/**
 * Main migration function
 */
async function main() {
  console.log('🚀 Starting Annotation System Migration...\n');
  
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4 // FORCE IPv4 (critical on Windows)
    });
    console.log('✅ Connected to MongoDB\n');
    
    // Get all datasets
    const datasets = await Dataset.find({ deletedAt: null });
    console.log(`📋 Found ${datasets.length} datasets to migrate\n`);
    
    if (datasets.length === 0) {
      console.log('✅ No datasets to migrate. Exiting...');
      await mongoose.disconnect();
      return;
    }
    
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    // Migrate each dataset
    for (let i = 0; i < datasets.length; i++) {
      const dataset = datasets[i];
      console.log(`\n[${i + 1}/${datasets.length}] Processing dataset...`);
      
      try {
        const result = await migrateDataset(dataset);
        totalCreated += result.created;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
      } catch (error) {
        console.error(`❌ Failed to migrate dataset ${dataset._id}:`, error.message);
        totalErrors++;
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`   ✅ Created: ${totalCreated} Image documents`);
    console.log(`   🔄 Updated: ${totalUpdated} Image documents`);
    console.log(`   ⏭️  Skipped: ${totalSkipped} Image documents (already up-to-date)`);
    console.log(`   ❌ Errors: ${totalErrors}`);
    console.log(`   📦 Datasets processed: ${datasets.length}`);
    console.log('='.repeat(60));
    console.log('\n✅ Migration completed successfully!\n');
    
    await mongoose.disconnect();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
if (require.main === module) {
  main();
}

module.exports = { migrateDataset, main };

