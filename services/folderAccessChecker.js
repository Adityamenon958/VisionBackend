const fs = require('fs');
const os = require('os');

/**
 * Folder Access Checker Service
 * 
 * Provides functionality to:
 * - Check if network folder is accessible
 * - Verify read/write permissions
 * - Build folder paths for different platforms
 */

/**
 * Build folder path for Windows (UNC path)
 * @param {string} ipAddress - IP address
 * @param {string} folderName - Folder name (default: "models")
 * @returns {string} UNC path (e.g., "\\192.168.1.100\models")
 */
function buildWindowsFolderPath(ipAddress, folderName = 'models') {
  return `\\\\${ipAddress}\\${folderName}`;
}

/**
 * Build folder path based on platform
 * @param {string} ipAddress - IP address
 * @param {string} folderName - Folder name (default: "models")
 * @returns {string} Folder path
 */
function buildFolderPath(ipAddress, folderName = 'models') {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Windows: Use UNC path
    return buildWindowsFolderPath(ipAddress, folderName);
  } else {
    // Linux/Mac: Try common mount points
    // Note: May need SMB mount first
    return `/mnt/${ipAddress}/${folderName}`;
  }
}

/**
 * Check Windows folder access (UNC path)
 * @param {string} folderPath - UNC path (e.g., "\\192.168.1.100\models")
 * @returns {Promise<{accessible: boolean, path?: string, error?: string}>}
 */
async function checkWindowsFolderAccess(folderPath) {
  try {
    // Try to access folder with read and write permissions
    await fs.promises.access(folderPath, fs.constants.R_OK | fs.constants.W_OK);
    
    // Try to list directory (verify it's actually accessible)
    await fs.promises.readdir(folderPath);
    
    return {
      accessible: true,
      path: folderPath
    };
  } catch (error) {
    return {
      accessible: false,
      error: error.message,
      path: folderPath
    };
  }
}

/**
 * Check folder access for Linux/Mac
 * @param {string} ipAddress - IP address
 * @param {string} folderName - Folder name
 * @returns {Promise<{accessible: boolean, path?: string, error?: string}>}
 */
async function checkUnixFolderAccess(ipAddress, folderName) {
  // Try common mount points
  const possiblePaths = [
    `/mnt/${ipAddress}/${folderName}`,
    `/media/${ipAddress}/${folderName}`,
    `/smb/${ipAddress}/${folderName}`
  ];
  
  for (const folderPath of possiblePaths) {
    try {
      await fs.promises.access(folderPath, fs.constants.R_OK | fs.constants.W_OK);
      await fs.promises.readdir(folderPath);
      
      return {
        accessible: true,
        path: folderPath
      };
    } catch (error) {
      continue;
    }
  }
  
  return {
    accessible: false,
    error: 'Folder not accessible on any common mount point',
    paths: possiblePaths
  };
}

/**
 * Check if folder is accessible
 * @param {string} folderPath - Full folder path
 * @returns {Promise<{accessible: boolean, path?: string, error?: string}>}
 */
async function checkFolderAccess(folderPath) {
  const platform = os.platform();
  
  if (platform === 'win32') {
    // Windows: Use UNC path directly
    return await checkWindowsFolderAccess(folderPath);
  } else {
    // Linux/Mac: Extract IP and folder name from path
    // If path is already provided, try it directly first
    try {
      await fs.promises.access(folderPath, fs.constants.R_OK | fs.constants.W_OK);
      await fs.promises.readdir(folderPath);
      
      return {
        accessible: true,
        path: folderPath
      };
    } catch (error) {
      // Try common mount points
      // Extract IP from path if possible
      const match = folderPath.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match) {
        const ipAddress = match[1];
        const folderName = folderPath.split('/').pop() || 'models';
        return await checkUnixFolderAccess(ipAddress, folderName);
      }
      
      return {
        accessible: false,
        error: error.message,
        path: folderPath
      };
    }
  }
}

/**
 * Verify write access to folder
 * @param {string} folderPath - Folder path
 * @returns {Promise<boolean>} True if write access is available
 */
async function verifyWriteAccess(folderPath) {
  try {
    await fs.promises.access(folderPath, fs.constants.W_OK);
    
    // Try to create a test file (optional, more thorough check)
    // For now, just check access permissions
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  buildFolderPath,
  checkFolderAccess,
  verifyWriteAccess,
  buildWindowsFolderPath
};
