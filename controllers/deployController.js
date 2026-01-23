const Model = require('../models/Model');
const fs = require('fs');
const path = require('path');
const os = require('os');
const networkScanner = require('../services/networkScanner');
const folderAccessChecker = require('../services/folderAccessChecker');
const modelDeployer = require('../services/modelDeployer');
const onnxConverter = require('../services/onnxConverter');

/**
 * Deploy Controller - Handles model deployment operations
 * 
 * This controller provides endpoints for:
 * - Scanning network for devices with folder access
 * - Checking folder access for specific IP addresses
 * - Deploying model files to network devices
 */

/**
 * GET /api/models/:modelId/deploy/scan-devices
 * 
 * Scan network for devices and check folder access
 * 
 * Query params:
 * - networkRange (optional): Network range to scan (e.g., "192.168.1.0/24")
 * - timeout (optional): Scan timeout in seconds (default: 5)
 * - folderName (optional): Folder name to check (default: "models")
 */
const scanNetworkDevices = async (req, res) => {
  try {
    const { modelId } = req.params;
    const { networkRange, timeout = 5, folderName = 'models' } = req.query;

    // 1. Validate model exists
    const model = await Model.findOne({ modelId });
    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId
      });
    }

    // 2. Determine network range
    const rangeToScan = networkRange || networkScanner.detectLocalNetworkRange();
    const timeoutMs = parseInt(timeout, 10) * 1000 || 5000;

    // 3. Scan network for active devices
    console.log(`🔍 Scanning network: ${rangeToScan} (timeout: ${timeoutMs}ms)`);
    const activeIPs = await networkScanner.scanNetworkRange(rangeToScan, timeoutMs);

    console.log(`✅ Found ${activeIPs.length} active devices`);

    // 4. Check folder access for each IP
    const devices = [];
    
    for (const ip of activeIPs) {
      try {
        let hasFolderAccess = false;
        let folderPath;
        let accessError;
        let availableShares;

        if (os.platform() === 'win32') {
          // Windows: discover any accessible SMB shares, not just a hard-coded name
          const shareResult = await folderAccessChecker.findAccessibleWindowsShares(ip, folderName);
          hasFolderAccess = shareResult.accessible;
          accessError = shareResult.error;

          if (shareResult.accessible && shareResult.shares.length > 0) {
            // Use the first accessible share as the primary folder path
            folderPath = shareResult.shares[0].path;
            availableShares = shareResult.shares;
          }
        } else {
          // Non-Windows: fall back to existing behaviour (specific folderName)
          folderPath = folderAccessChecker.buildFolderPath(ip, folderName);
          const access = await folderAccessChecker.checkFolderAccess(folderPath);
          hasFolderAccess = access.accessible;
          accessError = access.error;
        }
        
        // Try to get device name (optional, may fail)
        let deviceName = ip;
        try {
          deviceName = await networkScanner.getDeviceName(ip);
        } catch (error) {
          // Use IP if hostname resolution fails
        }
        
        devices.push({
          ipAddress: ip,
          deviceName: deviceName,
          hasFolderAccess: hasFolderAccess,
          folderPath: hasFolderAccess ? folderPath : undefined,
          status: hasFolderAccess ? 'available' : 'unavailable',
          error: accessError,
          // Optional extra metadata: list of accessible shares (Windows only)
          availableShares,
          lastChecked: new Date().toISOString()
        });
      } catch (error) {
        // Error checking this device, add it with error status
        devices.push({
          ipAddress: ip,
          hasFolderAccess: false,
          status: 'unavailable',
          error: error.message,
          lastChecked: new Date().toISOString()
        });
      }
    }

    // 5. Return results
    return res.status(200).json({
      devices,
      total: devices.length,
      available: devices.filter(d => d.hasFolderAccess).length,
      scannedRange: rangeToScan
    });

  } catch (error) {
    console.error('Error scanning network:', error);
    return res.status(500).json({
      error: 'Network scan failed',
      message: 'Unable to scan network. Please try searching by IP address.',
      details: error.message
    });
  }
};

/**
 * GET /api/models/:modelId/deploy/check-device
 * 
 * Check folder access for a specific IP address
 * 
 * Query params:
 * - ipAddress (required): IP address to check
 * - folderName (optional): Folder name to check (default: "models")
 */
const checkDeviceByIp = async (req, res) => {
  try {
    const { modelId } = req.params;
    const { ipAddress, folderName = 'models' } = req.query;

    // 1. Validate inputs
    if (!ipAddress) {
      return res.status(400).json({
        error: 'Missing required parameter',
        required: ['ipAddress']
      });
    }

    // 2. Validate IP format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ipAddress)) {
      return res.status(400).json({
        error: 'Invalid IP address',
        message: 'Please provide a valid IP address (e.g., 192.168.1.100)'
      });
    }

    // 3. Validate model exists
    const model = await Model.findOne({ modelId });
    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId
      });
    }

    // 4. Check if device is reachable
    console.log(`🔍 Checking device: ${ipAddress}`);
    const isReachable = await networkScanner.pingHost(ipAddress, 2000);
    
    if (!isReachable) {
      return res.status(200).json({
        ipAddress,
        hasFolderAccess: false,
        status: 'unavailable',
        error: 'Device not reachable',
        message: 'Cannot reach device at this IP address. Please check network connectivity.',
        lastChecked: new Date().toISOString()
      });
    }

    // 5. Check folder access
    let hasFolderAccess = false;
    let folderPath;
    let accessError;
    let availableShares;

    if (os.platform() === 'win32') {
      // Windows: discover any accessible SMB shares, not just a hard-coded name
      const shareResult = await folderAccessChecker.findAccessibleWindowsShares(ipAddress, folderName);
      hasFolderAccess = shareResult.accessible;
      accessError = shareResult.error;

      if (shareResult.accessible && shareResult.shares.length > 0) {
        folderPath = shareResult.shares[0].path;
        availableShares = shareResult.shares;
      }
    } else {
      // Non-Windows: fall back to existing behaviour (specific folderName)
      folderPath = folderAccessChecker.buildFolderPath(ipAddress, folderName);
      const access = await folderAccessChecker.checkFolderAccess(folderPath);
      hasFolderAccess = access.accessible;
      accessError = access.error;
    }

    // Try to get device name (optional)
    let deviceName = ipAddress;
    try {
      deviceName = await networkScanner.getDeviceName(ipAddress);
    } catch (error) {
      // Use IP if hostname resolution fails
    }

    // 6. Return result
    return res.status(200).json({
      ipAddress,
      deviceName: deviceName,
      hasFolderAccess,
      folderPath: hasFolderAccess ? folderPath : undefined,
      status: hasFolderAccess ? 'available' : 'unavailable',
      error: accessError,
      availableShares,
      message: hasFolderAccess
        ? 'Folder access available'
        : 'Cannot access folder. Please check network connectivity and folder permissions.',
      lastChecked: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error checking device:', error);
    return res.status(500).json({
      error: 'Device check failed',
      message: error.message
    });
  }
};

/**
 * POST /api/models/:modelId/deploy
 * 
 * Deploy model files to network device folder
 * 
 * Request body:
 * - ipAddress (required): IP address of target device
 * - folderPath (required): Full folder path (e.g., "\\192.168.1.100\models")
 * - deviceName (optional): Device name for logging
 * - format (optional): Model format to deploy ('pt' or 'onnx', default: 'pt')
 */
const deployModelToDevice = async (req, res) => {
  try {
    const { modelId } = req.params;
    const { ipAddress, folderPath, deviceName, format = 'pt' } = req.body;

    // 1. Validate inputs
    if (!ipAddress || !folderPath) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['ipAddress', 'folderPath']
      });
    }

    // 2. Validate format
    if (format !== 'pt' && format !== 'onnx') {
      return res.status(400).json({
        error: 'Invalid format',
        message: 'Format must be "pt" or "onnx"',
        provided: format
      });
    }

    // 3. Validate model exists
    const model = await Model.findOne({ modelId });
    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId
      });
    }

    // 4. Handle format-specific file validation and conversion
    if (format === 'pt') {
      // PyTorch format - validate .pt file exists
      if (!model.bestCheckpointPath || !fs.existsSync(model.bestCheckpointPath)) {
        return res.status(404).json({
          error: 'Model file not found',
          modelId,
          path: model.bestCheckpointPath,
          format: 'pt'
        });
      }
    } else if (format === 'onnx') {
      // ONNX format - get or create ONNX file
      console.log(`🔄 Checking ONNX file for model ${modelId}...`);
      const onnxResult = await onnxConverter.getOrCreateOnnx(model);
      
      if (!onnxResult.success) {
        return res.status(500).json({
          error: 'ONNX conversion failed',
          message: onnxResult.error || 'Failed to convert model to ONNX format',
          modelId,
          format: 'onnx'
        });
      }
      
      console.log(`✅ ONNX file ready: ${onnxResult.path}`);
    }

    console.log(`🚀 Deploying model ${modelId} (${format.toUpperCase()}) to ${ipAddress} (${folderPath})`);

    // 5. Verify folder access before deployment
    const access = await folderAccessChecker.checkFolderAccess(folderPath);
    
    if (!access.accessible) {
      return res.status(400).json({
        error: 'Folder access denied',
        message: 'Cannot access folder on device. Please check network connectivity and folder permissions.',
        details: access.error
      });
    }

    // 6. Deploy model with specified format
    const deploymentResult = await modelDeployer.deployModel(model, folderPath, format);

    // 7. Generate deployment ID
    const deploymentId = `deploy_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    console.log(`✅ Model deployed successfully (${format.toUpperCase()}): ${deploymentId}`);

    // 8. Return success
    return res.status(200).json({
      deploymentId,
      modelId: model.modelId,
      ipAddress,
      folderPath,
      deviceName: deviceName || ipAddress,
      format: format,
      status: 'completed',
      message: `Model deployed successfully (${format.toUpperCase()})`,
      filesCopied: deploymentResult.filesCopied,
      totalSize: deploymentResult.totalSize,
      startedAt: deploymentResult.startedAt.toISOString(),
      completedAt: deploymentResult.completedAt.toISOString()
    });

  } catch (error) {
    console.error('Error deploying model:', error);
    return res.status(500).json({
      error: 'Deployment failed',
      message: error.message
    });
  }
};

module.exports = {
  scanNetworkDevices,
  checkDeviceByIp,
  deployModelToDevice
};
