/**
 * Download Base YOLO Models Script
 * 
 * This script downloads commonly used YOLO pretrained models
 * and stores them locally in models/base/ directory.
 * 
 * Run: node scripts/download-base-models.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_MODELS_DIR = path.join(__dirname, '../models/base');

// Common YOLO models to download
const YOLO_MODELS = [
  {
    name: 'yolov11s.pt',
    url: 'https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov11s.pt',
    description: 'YOLOv11 Small - Latest version, balanced speed/accuracy'
  }
];

/**
 * Download a file from URL
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        return downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
        process.stdout.write(`\rDownloading: ${percent}%`);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(` ✅`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {}); // Delete file on error
      reject(err);
    });
  });
}

/**
 * Check if file exists and get its size
 */
function fileExists(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Downloading Base YOLO Models...\n');
  console.log(`📁 Storage directory: ${BASE_MODELS_DIR}\n`);

  // Ensure directory exists
  if (!fs.existsSync(BASE_MODELS_DIR)) {
    fs.mkdirSync(BASE_MODELS_DIR, { recursive: true });
    console.log(`✅ Created directory: ${BASE_MODELS_DIR}\n`);
  }

  let downloaded = 0;
  let skipped = 0;

  for (const model of YOLO_MODELS) {
    const filePath = path.join(BASE_MODELS_DIR, model.name);
    
    console.log(`📦 ${model.name} - ${model.description}`);
    
    // Check if already downloaded
    if (fileExists(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   ⏭️  Already exists (${sizeMB} MB), skipping...\n`);
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`   ⬇️  Downloading... `);
      await downloadFile(model.url, filePath);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   ✅ Downloaded (${sizeMB} MB)\n`);
      downloaded++;
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   ✅ Downloaded: ${downloaded}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   📁 Location: ${BASE_MODELS_DIR}\n`);

  if (downloaded > 0) {
    console.log('✅ Base models ready! Training will use local models (faster).\n');
  } else {
    console.log('✅ All models already downloaded.\n');
  }
}

// Run the script
main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

