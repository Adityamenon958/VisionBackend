const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

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
 * List available SMB shares on a Windows host using `net view`.
 * 
 * @param {string} ipAddress - Target IP address
 * @returns {Promise<string[]>} Array of share names (e.g., ["models", "eg"])
 */
async function listWindowsShares(ipAddress) {
  // Only valid/available on Windows
  if (os.platform() !== 'win32') {
    return [];
  }

  try {
    // Example command: net view \\192.168.1.7
    const { stdout } = await execAsync(`net view \\\\${ipAddress}`, {
      timeout: 5000,
      windowsHide: true
    });

    const shares = [];
    const lines = stdout.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Skip empty lines, headers and separators
      if (!line || line.toLowerCase().startsWith('share name') || line.startsWith('---')) {
        continue;
      }

      // Extract first token as share name
      const match = line.match(/^(\S+)\s+/);
      if (!match) continue;

      const shareName = match[1];

      // Skip administrative/hidden shares like C$, ADMIN$, IPC$
      if (shareName.endsWith('$')) continue;

      shares.push(shareName);
    }

    return shares;
  } catch (error) {
    // If net view fails (e.g., SMB disabled or access denied), treat as no shares
    return [];
  }
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
 * Find any accessible Windows shares on a device.
 * 
 * Used for discovery / scanning flows where we only need to know
 * whether *any* shared folder is usable, not a specific name.
 * 
 * @param {string} ipAddress - Target IP address
 * @param {string} [preferredFolderName] - Optional preferred share name to try first
 * @returns {Promise<{accessible: boolean, shares: {name: string, path: string}[], error?: string}>}
 */
async function findAccessibleWindowsShares(ipAddress, preferredFolderName) {
  if (os.platform() !== 'win32') {
    return {
      accessible: false,
      shares: [],
      error: 'Windows share discovery is only supported on win32 platform'
    };
  }

  const testedShares = new Set();
  const accessibleShares = [];

  // 1) Try preferred folder name first (if provided)
  if (preferredFolderName) {
    const preferredPath = buildWindowsFolderPath(ipAddress, preferredFolderName);
    const result = await checkWindowsFolderAccess(preferredPath);
    testedShares.add(preferredFolderName);

    if (result.accessible) {
      accessibleShares.push({
        name: preferredFolderName,
        path: preferredPath
      });
    }
  }

  // 2) Enumerate all visible shares via `net view`
  const shares = await listWindowsShares(ipAddress);

  for (const shareName of shares) {
    if (testedShares.has(shareName)) continue;

    const sharePath = buildWindowsFolderPath(ipAddress, shareName);
    const result = await checkWindowsFolderAccess(sharePath);

    if (result.accessible) {
      accessibleShares.push({
        name: shareName,
        path: sharePath
      });
    }
  }

  if (accessibleShares.length === 0) {
    return {
      accessible: false,
      shares: [],
      error: 'No accessible SMB shares found on device'
    };
  }

  return {
    accessible: true,
    shares: accessibleShares
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
  buildWindowsFolderPath,
  listWindowsShares,
  findAccessibleWindowsShares
};
