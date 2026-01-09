#!/usr/bin/env node
/**
 * Visualize Annotations from Database
 * 
 * Usage: node visualize-annotations-from-db.js <datasetId> [imageId]
 * 
 * Example: node visualize-annotations-from-db.js 695f997d846ced6fbd3667e1
 */

const mongoose = require('mongoose');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const Image = require('./models/Image');
const Annotation = require('./models/Annotation');
const Dataset = require('./models/Dataset');
const Category = require('./models/Category');

async function visualizeAnnotationsFromDB(datasetId, imageId = null) {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Get dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      console.error(`❌ Dataset not found: ${datasetId}`);
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log(`📋 Dataset: ${dataset.company}/${dataset.project}/${dataset.version}\n`);

    // Get images
    let images;
    if (imageId) {
      const image = await Image.findById(imageId);
      if (!image || image.datasetId.toString() !== datasetId) {
        console.error(`❌ Image not found in this dataset: ${imageId}`);
        await mongoose.disconnect();
        process.exit(1);
      }
      images = [image];
    } else {
      images = await Image.find({ datasetId }).lean();
    }

    if (images.length === 0) {
      console.log('⚠️  No images found in this dataset.');
      await mongoose.disconnect();
      return;
    }

    // Process each image
    for (const image of images) {
      // Get annotations for this image
      const annotations = await Annotation.find({
        imageId: image._id,
        deletedAt: null
      }).lean();

      if (annotations.length === 0) {
        console.log(`\n⚠️  Image ${image.filename} has no annotations. Skipping...`);
        continue;
      }

      console.log(`\n📸 Processing: ${image.filename}`);
      console.log(`   Dimensions: ${image.width} x ${image.height} pixels`);
      console.log(`   Annotations: ${annotations.length}`);

      // Build image path
      const datasetPath = path.join('datasets', dataset.company, dataset.project, dataset.version);
      const imagePath = path.join(datasetPath, image.storedPath);

      if (!fs.existsSync(imagePath)) {
        console.error(`❌ Image file not found: ${imagePath}`);
        continue;
      }

      // Parse annotations and convert to pixel coordinates
      const boxes = [];
      annotations.forEach((ann, i) => {
        const [normX, normY, normW, normH] = ann.bbox;
        
        // Convert normalized [x, y, width, height] to pixel coordinates
        const pixelX = Math.round(normX * image.width);
        const pixelY = Math.round(normY * image.height);
        const pixelW = Math.round(normW * image.width);
        const pixelH = Math.round(normH * image.height);

        boxes.push({
          x: pixelX,
          y: pixelY,
          width: pixelW,
          height: pixelH,
          category: ann.categoryName || 'Unknown',
          color: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'][i % 6]
        });

        console.log(`   📦 Box ${i + 1}: ${ann.categoryName || 'Unknown'}`);
        console.log(`      Normalized: [${normX.toFixed(4)}, ${normY.toFixed(4)}, ${normW.toFixed(4)}, ${normH.toFixed(4)}]`);
        console.log(`      Pixels: x=${pixelX}, y=${pixelY}, w=${pixelW}, h=${pixelH}`);
      });

      // Draw annotations on image using SVG overlay
      const svgOverlays = boxes.map((box, i) => {
        return `
        <rect 
          x="${box.x}" 
          y="${box.y}" 
          width="${box.width}" 
          height="${box.height}" 
          fill="none" 
          stroke="${box.color}" 
          stroke-width="3"
          opacity="0.8"
        />
        <text 
          x="${box.x + 5}" 
          y="${box.y - 5}" 
          fill="${box.color}" 
          font-size="20" 
          font-weight="bold"
          stroke="white"
          stroke-width="1"
        >${box.category}</text>
      `;
      }).join('');

      const svg = `
        <svg width="${image.width}" height="${image.height}">
          ${svgOverlays}
        </svg>
      `;

      // Create output path
      const outputDir = path.join('results', 'annotated_images');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputFilename = path.basename(image.filename, path.extname(image.filename)) + '_annotated.jpg';
      const outputPath = path.join(outputDir, outputFilename);

      // Composite image with annotations
      await sharp(imagePath)
        .composite([{
          input: Buffer.from(svg),
          top: 0,
          left: 0
        }])
        .toFile(outputPath);

      console.log(`   ✅ Saved annotated image: ${outputPath}`);
      console.log(`      Open this file to see the bounding boxes`);
    }

    await mongoose.disconnect();
    console.log('\n✅ Done!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('Usage: node visualize-annotations-from-db.js <datasetId> [imageId]');
  console.log('');
  console.log('Examples:');
  console.log('  node visualize-annotations-from-db.js 695f997d846ced6fbd3667e1');
  console.log('  node visualize-annotations-from-db.js 695f997d846ced6fbd3667e1 695f9981e0084bfc52f2b4aa');
  process.exit(1);
}

const datasetId = args[0];
const imageId = args[1] || null;

visualizeAnnotationsFromDB(datasetId, imageId);
