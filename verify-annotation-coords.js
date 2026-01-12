#!/usr/bin/env node
/**
 * Verify Annotation Coordinates
 * 
 * Check if annotation coordinates are correct for a specific image
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Image = require('./models/Image');
const Annotation = require('./models/Annotation');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

async function verifyCoords() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb');
    console.log('✅ Connected to MongoDB\n');

    // Get a specific image from v4 dataset
    const datasetId = '695f855688569c392a40c0d6';
    const image = await Image.findOne({ 
      datasetId,
      filename: { $regex: '01_missing_hole_06' }
    }).lean();

    if (!image) {
      console.log('Image not found');
      await mongoose.disconnect();
      return;
    }

    console.log('📸 Image:', image.filename);
    console.log('   Stored Path:', image.storedPath);
    console.log('   DB Dimensions:', image.width, 'x', image.height);

    // Check actual file dimensions
    const datasetPath = path.join('datasets', 'gsn', 'annotation', 'v4');
    const imagePath = path.join(datasetPath, image.storedPath);
    
    if (fs.existsSync(imagePath)) {
      const metadata = await sharp(imagePath).metadata();
      console.log('   File Dimensions:', metadata.width, 'x', metadata.height);
      console.log('   Match:', metadata.width === image.width && metadata.height === image.height);
    } else {
      console.log('   ❌ File not found at:', imagePath);
    }

    // Get annotations
    const annotations = await Annotation.find({
      imageId: image._id,
      deletedAt: null
    }).lean();

    console.log(`\n📝 Annotations: ${annotations.length}\n`);

    annotations.forEach((ann, i) => {
      const [normX, normY, normW, normH] = ann.bbox;
      
      // Convert to pixels
      const pixelX = Math.round(normX * image.width);
      const pixelY = Math.round(normY * image.height);
      const pixelW = Math.round(normW * image.width);
      const pixelH = Math.round(normH * image.height);

      console.log(`Annotation ${i + 1}:`);
      console.log(`  Normalized: [${normX.toFixed(6)}, ${normY.toFixed(6)}, ${normW.toFixed(6)}, ${normH.toFixed(6)}]`);
      console.log(`  Pixels: x=${pixelX}, y=${pixelY}, width=${pixelW}, height=${pixelH}`);
      console.log(`  Right edge: ${pixelX + pixelW} (image width: ${image.width})`);
      console.log(`  Bottom edge: ${pixelY + pixelH} (image height: ${image.height})`);
      console.log(`  Within bounds: ${pixelX + pixelW <= image.width && pixelY + pixelH <= image.height}`);
      console.log('');
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verifyCoords();
