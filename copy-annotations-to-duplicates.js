#!/usr/bin/env node
/**
 * Copy Annotations to Duplicate Images
 * 
 * This script finds images with annotations and copies those annotations
 * to duplicate images (same filename) in other folders within the same dataset.
 * 
 * Usage: node copy-annotations-to-duplicates.js <datasetId>
 */

const mongoose = require('mongoose');
require('dotenv').config();
const Annotation = require('./models/Annotation');
const Image = require('./models/Image');

async function copyAnnotationsToDuplicates(datasetId) {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    console.log(`📋 Processing dataset: ${datasetId}\n`);

    // Get all images in the dataset
    const allImages = await Image.find({ datasetId }).lean();
    console.log(`📸 Total images in dataset: ${allImages.length}\n`);

    // Group images by filename
    const imagesByFilename = {};
    allImages.forEach(img => {
      if (!imagesByFilename[img.filename]) {
        imagesByFilename[img.filename] = [];
      }
      imagesByFilename[img.filename].push(img);
    });

    // Find images with annotations
    const annotations = await Annotation.find({ datasetId, deletedAt: null }).lean();
    const imagesWithAnnotations = new Set(annotations.map(a => a.imageId.toString()));
    
    console.log(`📝 Total annotations in dataset: ${annotations.length}`);
    console.log(`📦 Images with annotations: ${imagesWithAnnotations.size}\n`);

    let totalCopied = 0;
    let totalAnnotationsCopied = 0;
    let imagesUpdated = 0;

    // Process each filename that has multiple copies
    for (const [filename, imageCopies] of Object.entries(imagesByFilename)) {
      if (imageCopies.length <= 1) {
        continue; // Skip if only one copy exists
      }

      // Find which copies have annotations
      const annotatedCopies = imageCopies.filter(img => 
        imagesWithAnnotations.has(img._id.toString())
      );
      const unannotatedCopies = imageCopies.filter(img => 
        !imagesWithAnnotations.has(img._id.toString())
      );

      // If some copies have annotations and some don't, copy annotations
      if (annotatedCopies.length > 0 && unannotatedCopies.length > 0) {
        // Get all annotations from annotated copies
        const annotationsToCopy = annotations.filter(ann =>
          annotatedCopies.some(ac => ac._id.toString() === ann.imageId.toString())
        );

        // Group annotations by source image for better tracking
        const annotationsBySource = {};
        annotatedCopies.forEach(ac => {
          annotationsBySource[ac._id.toString()] = annotations.filter(a =>
            a.imageId.toString() === ac._id.toString()
          );
        });

        // Copy annotations to each unannotated copy
        for (const targetImage of unannotatedCopies) {
          let copiedForThisImage = 0;
          
          // Copy annotations from each annotated source
          for (const sourceImage of annotatedCopies) {
            const sourceAnnotations = annotationsBySource[sourceImage._id.toString()];
            
            for (const sourceAnn of sourceAnnotations) {
              // Check if annotation already exists (shouldn't, but check anyway)
              const existing = await Annotation.findOne({
                imageId: targetImage._id,
                bbox: sourceAnn.bbox,
                categoryId: sourceAnn.categoryId,
                deletedAt: null
              });

              if (!existing) {
                // Create new annotation for target image
                const newAnnotation = new Annotation({
                  datasetId: sourceAnn.datasetId,
                  imageId: targetImage._id,
                  categoryId: sourceAnn.categoryId,
                  categoryName: sourceAnn.categoryName,
                  bbox: sourceAnn.bbox, // Copy bbox coordinates
                  state: sourceAnn.state,
                  createdBy: sourceAnn.createdBy, // Preserve original creator
                  // Note: We preserve timestamps from source, but MongoDB will add createdAt
                });

                await newAnnotation.save();
                copiedForThisImage++;
                totalAnnotationsCopied++;
              }
            }
          }

          if (copiedForThisImage > 0) {
            totalCopied++;
            console.log(`  ✓ Copied ${copiedForThisImage} annotation(s) to ${targetImage.folder}/${filename}`);
            
            // Update hasLabels flag if needed (though this is for YOLO labels, not annotations)
            // We'll leave hasLabels as-is since it refers to .txt files, not database annotations
          }
        }
      }
    }

    // Verify all images now have annotations
    const allAnnotations = await Annotation.find({ datasetId, deletedAt: null }).lean();
    const allAnnotatedImageIds = new Set(allAnnotations.map(a => a.imageId.toString()));
    const imagesStillWithoutAnnotations = allImages.filter(img =>
      !allAnnotatedImageIds.has(img._id.toString())
    );

    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`  Images with annotations before: ${imagesWithAnnotations.size}`);
    console.log(`  Images processed: ${totalCopied}`);
    console.log(`  Annotations copied: ${totalAnnotationsCopied}`);
    console.log(`  Images still without annotations: ${imagesStillWithoutAnnotations.length}`);
    
    if (imagesStillWithoutAnnotations.length > 0) {
      console.log('\n⚠️  Images still without annotations:');
      imagesStillWithoutAnnotations.forEach(img => {
        console.log(`    - ${img.folder}/${img.filename} (Image ID: ${img._id.toString().substring(0, 24)}...)`);
      });
    } else {
      console.log('\n✅ All images in the dataset now have annotations!');
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
  console.log('Usage: node copy-annotations-to-duplicates.js <datasetId>');
  console.log('');
  console.log('Example:');
  console.log('  node copy-annotations-to-duplicates.js 6960f8ea328ba0b2dbd02c98');
  process.exit(1);
}

const datasetId = args[0];
copyAnnotationsToDuplicates(datasetId);
