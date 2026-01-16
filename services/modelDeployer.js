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
 * @returns {Promise<{filesCopied: string[], totalSize: number, startedAt: Date, completedAt: Date}>}
 */
async function deployModel(model, targetFolder) {
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
  
  // 3. Copy model checkpoint file
  if (!model.bestCheckpointPath) {
    throw new Error('Model checkpoint path not found in model document');
  }
  
  if (!fs.existsSync(model.bestCheckpointPath)) {
    throw new Error(`Model file not found: ${model.bestCheckpointPath}`);
  }
  
  const modelFileName = path.basename(model.bestCheckpointPath);
  const targetModelPath = path.join(targetFolder, modelFileName);
  
  console.log(`📦 Copying model file: ${model.bestCheckpointPath} -> ${targetModelPath}`);
  
  // Copy the file
  await fs.promises.copyFile(model.bestCheckpointPath, targetModelPath);
  
  // Verify copy by comparing file sizes
  const sourceStats = await fs.promises.stat(model.bestCheckpointPath);
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
  
  filesCopied.push(modelFileName);
  totalSize += targetStats.size;
  
  console.log(`✅ Copied model file: ${modelFileName} (${(targetStats.size / (1024 * 1024)).toFixed(2)} MB)`);
  
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
