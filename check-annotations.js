#!/usr/bin/env node
/**
 * Check Annotations Script
 * 
 * Usage: node check-annotations.js [company] [project] [version]
 * 
 * Example: node check-annotations.js annotation project v5
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Image = require('./models/Image');
const Annotation = require('./models/Annotation');
const Dataset = require('./models/Dataset');

async function checkAnnotations(companyName, projectName, version) {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Find dataset
    const query = {};
    if (companyName) query.company = companyName;
    if (projectName) query.project = projectName;
    if (version) query.version = version;

    console.log('📋 Searching for dataset with:', JSON.stringify(query, null, 2));
    const dataset = await Dataset.findOne(query);

    if (!dataset) {
      console.log('❌ Dataset not found with the given criteria.');
      console.log('\n📊 Available datasets:');
      const allDatasets = await Dataset.find({}).select('_id company project version createdAt').limit(20).lean();
      if (allDatasets.length === 0) {
        console.log('  No datasets found in database.');
      } else {
        allDatasets.forEach(d => {
          console.log(`  ID: ${d._id}`);
          console.log(`     Company: ${d.company}, Project: ${d.project}, Version: ${d.version}`);
          console.log(`     Created: ${d.createdAt}`);
          console.log('');
        });
      }
      await mongoose.disconnect();
      return;
    }

    console.log('✅ Dataset found:');
    console.log(`   ID: ${dataset._id}`);
    console.log(`   Company: ${dataset.company}`);
    console.log(`   Project: ${dataset.project}`);
    console.log(`   Version: ${dataset.version}`);
    console.log('');

    // Find all images in this dataset
    const images = await Image.find({ datasetId: dataset._id }).lean();
    console.log(`📸 Total images in dataset: ${images.length}`);

    // Find all annotations for this dataset
    const annotations = await Annotation.find({ 
      datasetId: dataset._id,
      deletedAt: null 
    }).populate('imageId', 'filename width height storedPath').lean();

    console.log(`📝 Total annotations: ${annotations.length}`);
    console.log('');

    if (annotations.length === 0) {
      console.log('⚠️  No annotations found for this dataset.');
      await mongoose.disconnect();
      return;
    }

    // Group annotations by image
    const annotationsByImage = {};
    annotations.forEach(ann => {
      const imageId = ann.imageId ? ann.imageId._id.toString() : ann.imageId.toString();
      if (!annotationsByImage[imageId]) {
        annotationsByImage[imageId] = {
          image: ann.imageId,
          annotations: []
        };
      }
      annotationsByImage[imageId].annotations.push(ann);
    });

    console.log('📊 Annotations by image:');
    console.log('═'.repeat(80));

    Object.entries(annotationsByImage).forEach(([imageId, data]) => {
      const image = data.image;
      const anns = data.annotations;
      
      console.log(`\n🖼️  Image ID: ${imageId}`);
      if (image && typeof image === 'object') {
        console.log(`   Filename: ${image.filename || 'N/A'}`);
        console.log(`   Dimensions: ${image.width || 'N/A'} x ${image.height || 'N/A'} pixels`);
        console.log(`   Stored Path: ${image.storedPath || 'N/A'}`);
      }
      console.log(`   Annotations: ${anns.length}`);

      anns.forEach((ann, i) => {
        console.log(`\n   📦 Annotation ${i + 1}:`);
        console.log(`      ID: ${ann._id}`);
        console.log(`      Category: ${ann.categoryName || ann.categoryId} (ID: ${ann.categoryId})`);
        console.log(`      Bbox (normalized): [${ann.bbox[0].toFixed(4)}, ${ann.bbox[1].toFixed(4)}, ${ann.bbox[2].toFixed(4)}, ${ann.bbox[3].toFixed(4)}]`);
        console.log(`      State: ${ann.state || 'N/A'}`);
        console.log(`      Created: ${ann.createdAt || 'N/A'}`);
        
        // Calculate pixel coordinates if image dimensions are available
        if (image && image.width && image.height) {
          const [normX, normY, normW, normH] = ann.bbox;
          const pixelX = Math.round(normX * image.width);
          const pixelY = Math.round(normY * image.height);
          const pixelW = Math.round(normW * image.width);
          const pixelH = Math.round(normH * image.height);
          console.log(`      Bbox (pixels): x=${pixelX}, y=${pixelY}, width=${pixelW}, height=${pixelH}`);
        }
      });
    });

    console.log('\n' + '═'.repeat(80));

    // Show summary
    const uniqueImages = Object.keys(annotationsByImage).length;
    console.log(`\n📈 Summary:`);
    console.log(`   Images with annotations: ${uniqueImages}`);
    console.log(`   Total annotations: ${annotations.length}`);
    console.log(`   Average annotations per image: ${(annotations.length / uniqueImages).toFixed(2)}`);

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
const companyName = args[0] || null;
const projectName = args[1] || null;
const version = args[2] || null;

if (args.length === 0) {
  console.log('Usage: node check-annotations.js [company] [project] [version]');
  console.log('');
  console.log('Examples:');
  console.log('  node check-annotations.js annotation project v5');
  console.log('  node check-annotations.js annotation');
  console.log('  node check-annotations.js');
  console.log('');
  console.log('If no arguments provided, will list all datasets.');
}

checkAnnotations(companyName, projectName, version);
