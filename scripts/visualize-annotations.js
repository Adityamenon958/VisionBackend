#!/usr/bin/env node
/**
 * Visualization Script: Draw annotations on images
 * 
 * Usage: node scripts/visualize-annotations.js <imagePath> <labelPath> [outputPath]
 * 
 * Example:
 *   node scripts/visualize-annotations.js datasets/gsn/annotation/v4/images/train/image.jpg datasets/gsn/annotation/v4/labels/train/image.txt output.jpg
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function visualizeAnnotations(imagePath, labelPath, outputPath = null) {
  try {
    // Check if files exist
    if (!fs.existsSync(imagePath)) {
      console.error(`❌ Image not found: ${imagePath}`);
      process.exit(1);
    }
    
    if (!fs.existsSync(labelPath)) {
      console.error(`❌ Label file not found: ${labelPath}`);
      process.exit(1);
    }

    // Read label file
    const labelContent = fs.readFileSync(labelPath, 'utf8').trim();
    const lines = labelContent.split('\n').filter(l => l.trim());
    
    if (lines.length === 0) {
      console.log('⚠️  No annotations found in label file');
      return;
    }

    // Get image metadata
    const metadata = await sharp(imagePath).metadata();
    const width = metadata.width;
    const height = metadata.height;

    console.log(`📸 Image: ${path.basename(imagePath)}`);
    console.log(`   Dimensions: ${width} x ${height} pixels`);
    console.log(`   Annotations: ${lines.length}`);
    console.log('');

    // Parse annotations and convert to pixel coordinates
    const annotations = [];
    lines.forEach((line, i) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length !== 5) {
        console.warn(`⚠️  Skipping invalid line ${i + 1}: ${line}`);
        return;
      }

      const [classId, cx, cy, w, h] = parts.map(Number);
      
      // Convert YOLO format (center_x, center_y, width, height) to pixel coordinates (x, y, width, height)
      const centerX = cx * width;
      const centerY = cy * height;
      const boxWidth = w * width;
      const boxHeight = h * height;
      
      const x = Math.round(centerX - boxWidth / 2);
      const y = Math.round(centerY - boxHeight / 2);
      const pixelWidth = Math.round(boxWidth);
      const pixelHeight = Math.round(boxHeight);

      annotations.push({
        classId,
        x,
        y,
        width: pixelWidth,
        height: pixelHeight,
        centerX: Math.round(centerX),
        centerY: Math.round(centerY),
        normalized: { cx, cy, w, h }
      });

      console.log(`Annotation ${i + 1}:`);
      console.log(`  Class ID: ${classId}`);
      console.log(`  Normalized: center=(${cx.toFixed(4)}, ${cy.toFixed(4)}), size=(${w.toFixed(4)}, ${h.toFixed(4)})`);
      console.log(`  Pixel coords: x=${x}, y=${y}, width=${pixelWidth}, height=${pixelHeight}`);
      console.log(`  Box area: ${pixelWidth * pixelHeight} pixels (${((pixelWidth * pixelHeight) / (width * height) * 100).toFixed(2)}% of image)`);
      console.log('');
    });

    // Draw annotations on image using SVG overlay
    const svgOverlays = annotations.map((ann, i) => {
      const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
      const color = colors[ann.classId % colors.length];
      
      return `
        <rect 
          x="${ann.x}" 
          y="${ann.y}" 
          width="${ann.width}" 
          height="${ann.height}" 
          fill="none" 
          stroke="${color}" 
          stroke-width="3"
          opacity="0.8"
        />
        <text 
          x="${ann.x + 5}" 
          y="${ann.y - 5}" 
          fill="${color}" 
          font-size="16" 
          font-weight="bold"
          stroke="white"
          stroke-width="0.5"
        >Class ${ann.classId}</text>
      `;
    }).join('');

    const svg = `
      <svg width="${width}" height="${height}">
        ${svgOverlays}
      </svg>
    `;

    // Composite image with annotations
    const output = outputPath || imagePath.replace(/\.(jpg|jpeg|png)$/i, '_annotated.jpg');
    
    await sharp(imagePath)
      .composite([{
        input: Buffer.from(svg),
        top: 0,
        left: 0
      }])
      .toFile(output);

    console.log(`✅ Annotated image saved: ${output}`);
    console.log(`   Open this file to see the bounding boxes drawn on the image`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node scripts/visualize-annotations.js <imagePath> <labelPath> [outputPath]');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/visualize-annotations.js datasets/gsn/annotation/v4/images/train/image.jpg datasets/gsn/annotation/v4/labels/train/image.txt');
    process.exit(1);
  }

  const [imagePath, labelPath, outputPath] = args;
  visualizeAnnotations(imagePath, labelPath, outputPath);
}

module.exports = { visualizeAnnotations };

