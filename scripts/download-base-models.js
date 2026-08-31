/**
 * Download Base YOLO Models Script
 *
 * Downloads YOLOv8s, YOLOv5s, and YOLOv8 segmentation weights into models/base/
 * so training can start without waiting on network downloads.
 *
 * Run: npm run download-models
 *   or: node scripts/download-base-models.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_MODELS_DIR = path.join(__dirname, '../models/base');

// ✅ Base models used by training (small variants — balanced speed/accuracy)
const YOLO_MODELS = [
  {
    name: 'yolov8s.pt',
    url: 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8s.pt',
    description: 'YOLOv8 Small - Ultralytics, balanced speed/accuracy',
  },
  {
    name: 'yolov5s.pt',
    url: 'https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5s.pt',
    description: 'YOLOv5 Small - Ultralytics YOLOv5 release',
  },
  {
    name: 'yolov8n-seg.pt',
    url: 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n-seg.pt',
    description: 'YOLOv8 Nano Segmentation - for YOLO_SEG training',
  },
  {
    name: 'yolov8s-seg.pt',
    url: 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8s-seg.pt',
    description: 'YOLOv8 Small Segmentation - for YOLO_SEG training',
  },
];

/**
 * Download a file from URL (follows redirects)
 */
function downloadFile(url, destPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) {
      reject(new Error('Too many redirects'));
      return;
    }

    const client = url.startsWith('http://') ? http : https;
    const file = fs.createWriteStream(destPath);

    client
      .get(url, (response) => {
        if (
          response.statusCode === 301 ||
          response.statusCode === 302 ||
          response.statusCode === 307 ||
          response.statusCode === 308
        ) {
          file.close();
          fs.unlink(destPath, () => {});
          const nextUrl = response.headers.location;
          if (!nextUrl) {
            reject(new Error(`Redirect without location (${response.statusCode})`));
            return;
          }
          return downloadFile(nextUrl, destPath, redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          reject(
            new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`)
          );
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
            process.stdout.write(`\r   ⬇️  Downloading: ${percent}%`);
          } else {
            const mb = (downloadedSize / (1024 * 1024)).toFixed(1);
            process.stdout.write(`\r   ⬇️  Downloading: ${mb} MB`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(' ✅');
          resolve();
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

function fileExists(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size > 0;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🚀 Downloading Base YOLO Models (v8s + v5s + v8 seg)...\n');
  console.log(`📁 Storage directory: ${BASE_MODELS_DIR}\n`);

  if (!fs.existsSync(BASE_MODELS_DIR)) {
    fs.mkdirSync(BASE_MODELS_DIR, { recursive: true });
    console.log(`✅ Created directory: ${BASE_MODELS_DIR}\n`);
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const model of YOLO_MODELS) {
    const filePath = path.join(BASE_MODELS_DIR, model.name);

    console.log(`📦 ${model.name} - ${model.description}`);

    if (fileExists(filePath)) {
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   ⏭️  Already exists (${sizeMB} MB), skipping...\n`);
      skipped++;
      continue;
    }

    try {
      await downloadFile(model.url, filePath);
      const stats = fs.statSync(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`   ✅ Downloaded (${sizeMB} MB)\n`);
      downloaded++;
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
      failed++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   ✅ Downloaded: ${downloaded}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  if (failed > 0) console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📁 Location: ${BASE_MODELS_DIR}\n`);

  if (failed > 0) {
    console.log('⚠️  Some models failed. Check your network and try again.\n');
    process.exit(1);
  }

  if (downloaded > 0) {
    console.log('✅ Base models ready! Training will use local detect + YOLO_SEG weights.\n');
  } else {
    console.log('✅ All models already downloaded.\n');
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
