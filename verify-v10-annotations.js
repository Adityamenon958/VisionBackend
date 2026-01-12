const mongoose = require('mongoose');
require('dotenv').config();
const Image = require('./models/Image');
const Annotation = require('./models/Annotation');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/visiondb');
  const datasetId = '6960f8ea328ba0b2dbd02c98';
  const allImages = await Image.find({ datasetId }).lean();
  const allAnnotations = await Annotation.find({ datasetId, deletedAt: null }).lean();
  const annotatedImageIds = new Set(allAnnotations.map(a => a.imageId.toString()));
  const imagesByFolder = {};
  const annotatedByFolder = {};
  
  allImages.forEach(img => {
    imagesByFolder[img.folder] = (imagesByFolder[img.folder] || 0) + 1;
    if (annotatedImageIds.has(img._id.toString())) {
      annotatedByFolder[img.folder] = (annotatedByFolder[img.folder] || 0) + 1;
    }
  });
  
  console.log('Final Status for v10 Dataset:\n');
  console.log('Total images:', allImages.length);
  console.log('Total annotations:', allAnnotations.length);
  console.log('Images with annotations:', annotatedImageIds.size);
  console.log('\nBy folder:');
  Object.keys(imagesByFolder).sort().forEach(folder => {
    const total = imagesByFolder[folder];
    const annotated = annotatedByFolder[folder] || 0;
    const missing = total - annotated;
    const status = missing > 0 ? ` (${missing} missing)` : ' [ALL ANNOTATED]';
    console.log(`  ${folder}: ${annotated}/${total} annotated${status}`);
  });
  
  const imagesWithoutAnnotations = allImages.filter(img => !annotatedImageIds.has(img._id.toString()));
  if (imagesWithoutAnnotations.length > 0) {
    console.log('\nImages still without annotations (' + imagesWithoutAnnotations.length + '):');
    imagesWithoutAnnotations.forEach(img => {
      console.log(`    - ${img.folder}/${img.filename.split('_').slice(-1)[0]}`);
    });
    console.log('\nNote: These images have no duplicates in other folders and were never annotated.');
    console.log('They need to be manually annotated through the annotation interface.');
  } else {
    console.log('\nALL images have annotations!');
  }
  
  await mongoose.disconnect();
})();
