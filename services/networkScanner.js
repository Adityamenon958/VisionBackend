const ping = require('ping');
const os = require('os');
const ip = require('ip');

/**
 * Network Scanner Service
 * 
 * Provides functionality to:
 * - Auto-detect local network range
 * - Scan network for active devices
 * - Ping hosts to check reachability
 */

/**
 * Calculate network range from IP address and netmask
 * @param {string} address - IP address (e.g., "192.168.1.100")
 * @param {string} netmask - Netmask (e.g., "255.255.255.0")
 * @returns {string} Network range in CIDR notation (e.g., "192.168.1.0/24")
 */
function calculateNetworkRange(address, netmask) {
  try {
    // Convert netmask to CIDR prefix length
    const netmaskParts = netmask.split('.').map(Number);
    let prefixLength = 0;
    
    for (let i = 0; i < 4; i++) {
      const octet = netmaskParts[i];
      // Count set bits in octet
      let bits = 0;
      for (let j = 0; j < 8; j++) {
        if (octet & (1 << (7 - j))) {
          bits++;
        }
      }
      prefixLength += bits;
    }
    
    // Calculate network address
    const addressParts = address.split('.').map(Number);
    const networkParts = addressParts.map((part, i) => {
      const maskPart = netmaskParts[i];
      return part & maskPart;
    });
    
    const networkAddress = networkParts.join('.');
    return `${networkAddress}/${prefixLength}`;
  } catch (error) {
    console.error('Error calculating network range:', error);
    // Default fallback
    return '192.168.1.0/24';
  }
}

/**
 * Auto-detect local network range
 * @returns {string} Network range in CIDR notation
 */
function detectLocalNetworkRange() {
  try {
    const interfaces = os.networkInterfaces();
    
    // Find first non-loopback IPv4 interface
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // Extract network range from IP and netmask
          if (iface.netmask) {
            return calculateNetworkRange(iface.address, iface.netmask);
          }
        }
      }
    }
    
    // Default fallback
    return '192.168.1.0/24';
  } catch (error) {
    console.error('Error detecting network range:', error);
    return '192.168.1.0/24';
  }
}

/**
 * Generate list of IP addresses from network range
 * @param {string} networkRange - Network range in CIDR notation (e.g., "192.168.1.0/24")
 * @returns {string[]} Array of IP addresses to scan
 */
function generateIPList(networkRange) {
  try {
    const [network, prefixLength] = networkRange.split('/');
    const prefix = parseInt(prefixLength, 10);
    
    if (isNaN(prefix) || prefix < 8 || prefix > 30) {
      throw new Error(`Invalid prefix length: ${prefixLength}`);
    }
    
    // Calculate number of hosts
    const hostBits = 32 - prefix;
    const numHosts = Math.pow(2, hostBits) - 2; // Exclude network and broadcast
    
    // Parse network address
    const networkParts = network.split('.').map(Number);
    const networkNum = (networkParts[0] << 24) + (networkParts[1] << 16) + 
                       (networkParts[2] << 8) + networkParts[3];
    
    const ipList = [];
    
    // Generate IP addresses (skip network and broadcast)
    for (let i = 1; i <= numHosts && i < 255; i++) {
      const ipNum = networkNum + i;
      const ipAddress = [
        (ipNum >>> 24) & 0xFF,
        (ipNum >>> 16) & 0xFF,
        (ipNum >>> 8) & 0xFF,
        ipNum & 0xFF
      ].join('.');
      
      ipList.push(ipAddress);
    }
    
    return ipList;
  } catch (error) {
    console.error('Error generating IP list:', error);
    return [];
  }
}

/**
 * Ping a single host to check if it's reachable
 * @param {string} ipAddress - IP address to ping
 * @param {number} timeout - Timeout in milliseconds (default: 1000)
 * @returns {Promise<boolean>} True if host is reachable
 */
async function pingHost(ipAddress, timeout = 1000) {
  try {
    const result = await ping.promise.probe(ipAddress, {
      timeout: Math.floor(timeout / 1000), // Convert to seconds
      min_reply: 1
    });
    
    return result.alive === true;
  } catch (error) {
    // Host not reachable
    return false;
  }
}

/**
 * Resolve device name (hostname) from IP address
 * @param {string} ipAddress - IP address
 * @returns {Promise<string>} Device name or IP address if resolution fails
 */
async function getDeviceName(ipAddress) {
  try {
    const dns = require('dns').promises;
    const hostname = await dns.reverse(ipAddress);
    return hostname[0] || ipAddress;
  } catch (error) {
    // Reverse DNS lookup failed, return IP address
    return ipAddress;
  }
}

/**
 * Scan network range for active devices
 * @param {string} networkRange - Network range in CIDR notation (e.g., "192.168.1.0/24")
 * @param {number} timeout - Total timeout in milliseconds (default: 5000)
 * @returns {Promise<string[]>} Array of reachable IP addresses
 */
async function scanNetworkRange(networkRange, timeout = 5000) {
  try {
    // Generate list of IPs to scan
    const ipList = generateIPList(networkRange);
    
    if (ipList.length === 0) {
      return [];
    }
    
    const activeIPs = [];
    const pingPromises = ipList.map(async (ipAddress) => {
      try {
        const isReachable = await pingHost(ipAddress, 1000); // 1 second per IP
        
        if (isReachable) {
          activeIPs.push(ipAddress);
        }
      } catch (error) {
        // IP not reachable, skip
      }
    });
    
    // Wait for all pings with overall timeout
    await Promise.race([
      Promise.all(pingPromises),
      new Promise((resolve) => setTimeout(resolve, timeout))
    ]);
    
    return activeIPs;
  } catch (error) {
    console.error('Error scanning network range:', error);
    return [];
  }
}

module.exports = {
  detectLocalNetworkRange,
  scanNetworkRange,
  pingHost,
  getDeviceName,
  generateIPList
};
