const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

/**
 * ONNX Converter Service
 * 
 * Provides functionality to:
 * - Convert PyTorch (.pt) models to ONNX (.onnx) format
 * - Check if ONNX file exists
 * - Get or create ONNX file for a model
 */

/**
 * Convert PyTorch model to ONNX format
 * @param {string} ptModelPath - Path to .pt model file
 * @param {string} outputPath - Path where .onnx file should be saved
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function convertToOnnx(ptModelPath, outputPath) {
  try {
    // 1. Validate input file exists
    if (!fs.existsSync(ptModelPath)) {
      return {
        success: false,
        error: `PyTorch model file not found: ${ptModelPath}`
      };
    }

    // 2. Check if output already exists (cached)
    if (fs.existsSync(outputPath)) {
      console.log(`✅ ONNX file already exists: ${outputPath}`);
      return {
        success: true,
        path: outputPath
      };
    }

    // 3. Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 4. Get Python script path
    const pythonScriptPath = path.join(__dirname, '../scripts/convert-to-onnx.py');
    
    if (!fs.existsSync(pythonScriptPath)) {
      return {
        success: false,
        error: `ONNX conversion script not found: ${pythonScriptPath}`
      };
    }

    console.log(`🔄 Converting model to ONNX: ${ptModelPath} -> ${outputPath}`);

    // 5. Call Python script to convert
    const command = `python "${pythonScriptPath}" --input "${ptModelPath}" --output "${outputPath}"`;
    
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      timeout: 300000 // 5 minute timeout for conversion
    });

    // Log output
    if (stdout) {
      console.log(stdout);
    }
    if (stderr && !stderr.includes('ERROR')) {
      // Some warnings are normal, only log if it's not an error
      console.warn(stderr);
    }

    // 6. Verify ONNX file was created
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`✅ ONNX conversion successful! File size: ${fileSizeMB} MB`);
      
      return {
        success: true,
        path: outputPath
      };
    } else {
      return {
        success: false,
        error: 'ONNX file was not created after conversion'
      };
    }

  } catch (error) {
    console.error('Error converting to ONNX:', error);
    return {
      success: false,
      error: error.message || 'Unknown error during ONNX conversion'
    };
  }
}

/**
 * Get or create ONNX file for a model
 * @param {Object} model - Model document from MongoDB
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function getOrCreateOnnx(model) {
  try {
    // 1. Determine ONNX file path
    const onnxPath = path.join(model.storagePath, 'best.onnx');

    // 2. Check if ONNX already exists
    if (fs.existsSync(onnxPath)) {
      return {
        success: true,
        path: onnxPath
      };
    }

    // 3. Get PyTorch model path
    const ptModelPath = model.bestCheckpointPath || path.join(model.storagePath, 'best.pt');

    if (!fs.existsSync(ptModelPath)) {
      return {
        success: false,
        error: `PyTorch model file not found: ${ptModelPath}`
      };
    }

    // 4. Convert to ONNX
    return await convertToOnnx(ptModelPath, onnxPath);

  } catch (error) {
    console.error('Error getting or creating ONNX:', error);
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Check if ONNX file exists for a model
 * @param {Object} model - Model document from MongoDB
 * @returns {boolean} True if ONNX file exists
 */
function onnxExists(model) {
  try {
    const onnxPath = path.join(model.storagePath, 'best.onnx');
    return fs.existsSync(onnxPath);
  } catch (error) {
    return false;
  }
}

module.exports = {
  convertToOnnx,
  getOrCreateOnnx,
  onnxExists
};
