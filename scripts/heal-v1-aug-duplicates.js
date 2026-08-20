/**
 * One-off heal: remove overlapping train/test (and train/val) image copies
 * for Testing/Testing/V1_aug, then sync Image docs + Dataset.totalImages to unique count.
 *
 * Usage: node scripts/heal-v1-aug-duplicates.js
 */
require('dotenv').config();
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const Dataset = require('../models/Dataset');
const Image = require('../models/Image');

const COMPANY = 'Testing';
const PROJECT = 'Testing';
const VERSION = 'V1_aug';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff']);

async function listImages(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function removeFile(filePath) {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI missing in .env');
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const dataset = await Dataset.findOne({
    company: COMPANY,
    project: PROJECT,
    version: VERSION,
    deletedAt: null,
  });

  if (!dataset) {
    throw new Error(`Dataset not found: ${COMPANY}/${PROJECT}/${VERSION}`);
  }

  const root = dataset.storagePath
    || path.join(process.cwd(), 'datasets', COMPANY, PROJECT, VERSION);
  console.log('Dataset:', dataset._id.toString(), 'root:', root);
  console.log('Before:', {
    totalImages: dataset.totalImages,
    trainCount: dataset.trainCount,
    valCount: dataset.valCount,
    testCount: dataset.testCount,
  });

  const imagesTrain = path.join(root, 'images', 'train');
  const imagesVal = path.join(root, 'images', 'val');
  const imagesTest = path.join(root, 'images', 'test');
  const labelsTrain = path.join(root, 'labels', 'train');
  const labelsVal = path.join(root, 'labels', 'val');
  const labelsTest = path.join(root, 'labels', 'test');

  const trainNames = new Set((await listImages(imagesTrain)).map((n) => n.toLowerCase()));
  const valNames = await listImages(imagesVal);
  const testNames = await listImages(imagesTest);

  let removed = { val: 0, test: 0 };
  const removedStoredPaths = [];

  // Prefer train > val > test: drop val/test copies that already exist in a higher-priority split
  for (const name of valNames) {
    const key = name.toLowerCase();
    if (!trainNames.has(key)) continue;
    const stem = path.parse(name).name;
    if (await removeFile(path.join(imagesVal, name))) removed.val += 1;
    await removeFile(path.join(labelsVal, `${stem}.txt`));
    removedStoredPaths.push(`images/val/${name}`);
  }

  const valKeep = new Set(
    (await listImages(imagesVal)).map((n) => n.toLowerCase()),
  );

  for (const name of testNames) {
    const key = name.toLowerCase();
    if (!trainNames.has(key) && !valKeep.has(key)) continue;
    const stem = path.parse(name).name;
    if (await removeFile(path.join(imagesTest, name))) removed.test += 1;
    await removeFile(path.join(labelsTest, `${stem}.txt`));
    removedStoredPaths.push(`images/test/${name}`);
  }

  console.log('Removed overlapping copies:', removed);

  // Recount unique images on disk
  const finalTrain = await listImages(imagesTrain);
  const finalVal = await listImages(imagesVal);
  const finalTest = await listImages(imagesTest);
  const trainCount = finalTrain.length;
  const valCount = finalVal.length;
  const testCount = finalTest.length;
  const totalImages = trainCount + valCount + testCount;

  const uniqueCheck = new Set(
    [...finalTrain, ...finalVal, ...finalTest].map((n) => n.toLowerCase()),
  );
  if (uniqueCheck.size !== totalImages) {
    console.warn('WARNING: still have duplicate names after heal', {
      totalImages,
      unique: uniqueCheck.size,
    });
  }

  // Delete Image docs for removed paths + any leftover duplicate filenames
  if (removedStoredPaths.length > 0) {
    const delPaths = await Image.deleteMany({
      datasetId: dataset._id,
      storedPath: { $in: removedStoredPaths },
    });
    console.log('Deleted Image docs by storedPath:', delPaths.deletedCount);
  }

  // Deduplicate Image rows by filename (keep train > val > test)
  const allImages = await Image.find({ datasetId: dataset._id }).lean();
  const folderPriority = { train: 0, val: 1, test: 2 };
  const byFilename = new Map();
  const toDeleteIds = [];
  for (const img of allImages) {
    const key = String(img.filename || path.basename(img.storedPath || '')).toLowerCase();
    const existing = byFilename.get(key);
    if (!existing) {
      byFilename.set(key, img);
      continue;
    }
    const score = (i) => 100 - (folderPriority[i.folder] ?? 50);
    if (score(img) > score(existing)) {
      toDeleteIds.push(existing._id);
      byFilename.set(key, img);
    } else {
      toDeleteIds.push(img._id);
    }
  }
  if (toDeleteIds.length > 0) {
    const r = await Image.deleteMany({ _id: { $in: toDeleteIds } });
    console.log('Deleted duplicate Image docs by filename:', r.deletedCount);
  }

  // Rebuild files manifest (images + labels) without overlaps
  const filesManifest = [];
  for (const [split, names, imgDir, lblDir] of [
    ['train', finalTrain, imagesTrain, labelsTrain],
    ['val', finalVal, imagesVal, labelsVal],
    ['test', finalTest, imagesTest, labelsTest],
  ]) {
    for (const name of names) {
      const imgPath = path.join(imgDir, name);
      let size = 0;
      try {
        size = (await fsp.stat(imgPath)).size;
      } catch {}
      filesManifest.push({
        storedName: name,
        originalName: name,
        type: 'image',
        size,
        folder: split,
        storedPath: `images/${split}/${name}`,
      });
      const stem = path.parse(name).name;
      const lblName = `${stem}.txt`;
      const lblPath = path.join(lblDir, lblName);
      if (fs.existsSync(lblPath)) {
        let lblSize = 0;
        try {
          lblSize = (await fsp.stat(lblPath)).size;
        } catch {}
        filesManifest.push({
          storedName: lblName,
          originalName: lblName,
          type: 'label',
          size: lblSize,
          folder: split,
          storedPath: `labels/${split}/${lblName}`,
        });
      }
    }
  }

  dataset.totalImages = totalImages;
  dataset.trainCount = trainCount;
  dataset.valCount = valCount;
  dataset.testCount = testCount;
  dataset.labeledImages = totalImages;
  dataset.unlabeledImages = 0;
  dataset.unlabeledImagesCount = 0;
  dataset.files = filesManifest;
  await dataset.save();

  const imageDocCount = await Image.countDocuments({ datasetId: dataset._id });
  console.log('After:', {
    totalImages,
    trainCount,
    valCount,
    testCount,
    imageDocCount,
    uniqueFilenames: uniqueCheck.size,
  });

  await mongoose.disconnect();
  console.log('Done. Refresh Simulation — V1_aug should show', totalImages, 'images.');
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
