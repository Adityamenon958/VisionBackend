const fs = require('fs');
const path = require('path');

/**
 * Model Deployer Service
 * 
 * Provides functionality to:
 * - Copy model checkpoint files to network folder
 * - Copy model metadata/config files
 * - Verify files were copied successfully
 * - Return deployment status
 */

/**
 * Deploy model files to target folder
 * @param {Object} model - Model document from MongoDB
 * @param {string} targetFolder - Target folder path (network folder)
 * @param {string} format - Model format to deploy ('pt' or 'onnx', default: 'pt')
 * @returns {Promise<{filesCopied: string[], totalSize: number, startedAt: Date, completedAt: Date}>}
 */
async function deployModel(model, targetFolder, format = 'pt') {
  const filesCopied = [];
  let totalSize = 0;
  const startedAt = new Date();
  
  // 1. Ensure target folder exists (if it's a local path)
  // Note: For network paths, we can't create them, so we just verify access
  try {
    // Try to create directory (will fail silently if it's a network path that already exists)
    await fs.promises.mkdir(targetFolder, { recursive: true });
  } catch (error) {
    // Directory might already exist or be a network path - that's okay
    // We'll verify access in the next step
  }
  
  // 2. Verify target folder is accessible
  try {
    await fs.promises.access(targetFolder, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw new Error(`Cannot access target folder: ${error.message}`);
  }
  
  // 3. Determine source file path based on format
  let sourceFilePath;
  let targetFileName;
  
  if (format === 'pt') {
    // PyTorch format - use bestCheckpointPath
    if (!model.bestCheckpointPath) {
      throw new Error('Model checkpoint path not found in model document');
    }
    sourceFilePath = model.bestCheckpointPath;
    targetFileName = path.basename(model.bestCheckpointPath);
  } else if (format === 'onnx') {
    // ONNX format - use best.onnx in storagePath
    if (!model.storagePath) {
      throw new Error('Model storage path not found in model document');
    }
    sourceFilePath = path.join(model.storagePath, 'best.onnx');
    // Generate filename with model version
    const modelVersion = model.modelVersion || 'latest';
    targetFileName = `model_${modelVersion}.onnx`;
  } else {
    throw new Error(`Invalid format: ${format}. Must be 'pt' or 'onnx'`);
  }
  
  // 4. Verify source file exists
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`Model file not found: ${sourceFilePath}`);
  }
  
  const targetModelPath = path.join(targetFolder, targetFileName);
  
  console.log(`📦 Copying model file (${format.toUpperCase()}): ${sourceFilePath} -> ${targetModelPath}`);
  
  // Copy the file
  await fs.promises.copyFile(sourceFilePath, targetModelPath);
  
  // Verify copy by comparing file sizes
  const sourceStats = await fs.promises.stat(sourceFilePath);
  const targetStats = await fs.promises.stat(targetModelPath);
  
  if (sourceStats.size !== targetStats.size) {
    // Clean up partial copy
    try {
      await fs.promises.unlink(targetModelPath);
    } catch (error) {
      // Ignore cleanup errors
    }
    throw new Error(`File size mismatch after copy. Source: ${sourceStats.size}, Target: ${targetStats.size}`);
  }
  
  filesCopied.push(targetFileName);
  totalSize += targetStats.size;
  
  console.log(`✅ Copied model file: ${targetFileName} (${(targetStats.size / (1024 * 1024)).toFixed(2)} MB)`);
  
  // 4. Copy model metadata/config if available
  if (model.storagePath && fs.existsSync(model.storagePath)) {
    const configPath = path.join(model.storagePath, 'model_config.json');
    
    if (fs.existsSync(configPath)) {
      const configFileName = path.basename(configPath);
      const targetConfigPath = path.join(targetFolder, configFileName);
      
      console.log(`📦 Copying config file: ${configPath} -> ${targetConfigPath}`);
      
      await fs.promises.copyFile(configPath, targetConfigPath);
      
      // Verify config file copy
      const configSourceStats = await fs.promises.stat(configPath);
      const configTargetStats = await fs.promises.stat(targetConfigPath);
      
      if (configSourceStats.size !== configTargetStats.size) {
        // Clean up partial copy
        try {
          await fs.promises.unlink(targetConfigPath);
        } catch (error) {
          // Ignore cleanup errors
        }
        throw new Error(`Config file size mismatch after copy`);
      }
      
      filesCopied.push(configFileName);
      totalSize += configTargetStats.size;
      
      console.log(`✅ Copied config file: ${configFileName}`);
    }
  }
  
  const completedAt = new Date();
  
  return {
    filesCopied,
    totalSize,
    startedAt,
    completedAt
  };
}

/**
 * Verify deployment by checking if files exist in target folder
 * @param {string} targetFolder - Target folder path
 * @param {string[]} expectedFiles - Array of expected file names
 * @returns {Promise<{verified: boolean, missingFiles: string[]}>}
 */
async function verifyDeployment(targetFolder, expectedFiles) {
  const missingFiles = [];
  
  for (const fileName of expectedFiles) {
    const filePath = path.join(targetFolder, fileName);
    
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch (error) {
      missingFiles.push(fileName);
    }
  }
  
  return {
    verified: missingFiles.length === 0,
    missingFiles
  };
}

module.exports = {
  deployModel,
  verifyDeployment
};
