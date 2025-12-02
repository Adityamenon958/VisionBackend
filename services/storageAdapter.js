const fs = require('fs').promises;
const path = require('path');
const { existsSync, mkdirSync } = require('fs');

/**
 * Storage Adapter - Abstracts file storage operations
 * 
 * This adapter allows switching between:
 * - Local filesystem (current implementation)
 * - Azure Blob Storage (stub for future)
 * - AWS S3 (can be added later)
 * 
 * Why use an adapter? It keeps storage logic separate from business logic,
 * making it easy to switch storage backends without changing other code.
 */

class StorageAdapter {
  constructor(mode = 'local') {
    this.mode = mode;
    this.basePath = path.join(process.cwd(), 'datasets');
    
    // ✅ Ensure base directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Ensure a directory exists (create if it doesn't)
   * @param {string} dirPath - Full directory path
   */
  async ensureDir(dirPath) {
    if (this.mode === 'local') {
      // ✅ Recursive: true creates all parent directories if needed
      await fs.mkdir(dirPath, { recursive: true });
    } else if (this.mode === 'azure') {
      // TODO: Implement Azure Blob container creation
      // await azureBlobService.createContainerIfNotExists(containerName);
      throw new Error('Azure storage not yet implemented');
    }
  }

  /**
   * Check if a file or directory exists
   * @param {string} filePath - Path to check
   * @returns {boolean}
   */
  async exists(filePath) {
    if (this.mode === 'local') {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    } else if (this.mode === 'azure') {
      // TODO: Check if blob exists in Azure
      // return await azureBlobService.blobExists(containerName, blobName);
      throw new Error('Azure storage not yet implemented');
    }
  }

  /**
   * Save a file from temporary location to final destination
   * 
   * ⚠️ CAUTION: This moves files across directories. On some systems (especially
   * when temp and destination are on different drives), fs.rename might fail.
   * We handle this by falling back to copy + delete.
   * 
   * @param {string} srcTempPath - Source file path (temporary upload location)
   * @param {string} destPath - Destination file path (final storage location)
   */
  async saveFile(srcTempPath, destPath) {
    if (this.mode === 'local') {
      // ✅ Ensure destination directory exists
      const destDir = path.dirname(destPath);
      await this.ensureDir(destDir);

      try {
        // ✅ Try rename first (fast, atomic on same filesystem)
        await fs.rename(srcTempPath, destPath);
      } catch (error) {
        // ⚠️ If rename fails (cross-device), use copy + delete
        if (error.code === 'EXDEV') {
          // Copy file
          await fs.copyFile(srcTempPath, destPath);
          // Delete temp file
          await fs.unlink(srcTempPath);
        } else {
          throw error;
        }
      }
    } else if (this.mode === 'azure') {
      // TODO: Upload to Azure Blob Storage
      // const containerName = this.extractContainerName(destPath);
      // const blobName = this.extractBlobName(destPath);
      // await azureBlobService.uploadFile(srcTempPath, containerName, blobName);
      // await fs.unlink(srcTempPath); // Clean up temp file
      throw new Error('Azure storage not yet implemented');
    }
  }

  /**
   * Move a file from source to destination
   * 
   * This is a wrapper around saveFile but with a clearer name for moving
   * files within the storage system (not from temp uploads).
   * 
   * ⚠️ CAUTION: Handles cross-device moves by falling back to copy + delete.
   * 
   * @param {string} srcPath - Source file path
   * @param {string} destPath - Destination file path
   */
  async moveFile(srcPath, destPath) {
    if (this.mode === 'local') {
      // ✅ Ensure destination directory exists
      const destDir = path.dirname(destPath);
      await this.ensureDir(destDir);

      try {
        // ✅ Try rename first (fast, atomic on same filesystem)
        await fs.rename(srcPath, destPath);
      } catch (error) {
        // ⚠️ If rename fails (cross-device), use copy + delete
        if (error.code === 'EXDEV') {
          // Copy file
          await fs.copyFile(srcPath, destPath);
          // Delete source file
          await fs.unlink(srcPath);
        } else {
          throw error;
        }
      }
    } else if (this.mode === 'azure') {
      // TODO: Move blob in Azure Blob Storage
      // const srcContainer = this.extractContainerName(srcPath);
      // const srcBlob = this.extractBlobName(srcPath);
      // const destContainer = this.extractContainerName(destPath);
      // const destBlob = this.extractBlobName(destPath);
      // await azureBlobService.moveBlob(srcContainer, srcBlob, destContainer, destBlob);
      throw new Error('Azure storage not yet implemented');
    }
  }

  /**
   * Build storage path for a dataset
   * Format: /datasets/{company}/{project}/{version}/
   */
  buildDatasetPath(company, project, version) {
    return path.join(this.basePath, company, project, version);
  }

  /**
   * Build path for images folder
   */
  buildImagesPath(company, project, version) {
    return path.join(this.buildDatasetPath(company, project, version), 'images');
  }

  /**
   * Build path for labels folder
   */
  buildLabelsPath(company, project, version) {
    return path.join(this.buildDatasetPath(company, project, version), 'labels');
  }

  /**
   * Build path for thumbnails folder
   */
  buildThumbnailsPath(company, project, version) {
    return path.join(this.buildDatasetPath(company, project, version), 'thumbnails');
  }

  /**
   * Get full path to a thumbnail file
   * @param {string} company - Company identifier
   * @param {string} project - Project identifier
   * @param {string} version - Version identifier
   * @param {string} storedName - Stored filename (without thumb_ prefix)
   * @returns {string} Full path to thumbnail file
   */
  getThumbnailPath(company, project, version, storedName) {
    const thumbnailsPath = this.buildThumbnailsPath(company, project, version);
    return path.join(thumbnailsPath, `thumb_${storedName}`);
  }

  /**
   * Copy a file from source to destination (preserves original)
   * 
   * This is used when we need to keep the original file intact
   * (e.g., preserving folder structure for dashboard while copying to train/val)
   * 
   * @param {string} srcPath - Source file path
   * @param {string} destPath - Destination file path
   */
  async copyFile(srcPath, destPath) {
    if (this.mode === 'local') {
      // ✅ Ensure destination directory exists
      const destDir = path.dirname(destPath);
      await this.ensureDir(destDir);

      // ✅ Copy file (does not delete source)
      await fs.copyFile(srcPath, destPath);
    } else if (this.mode === 'azure') {
      // TODO: Copy blob in Azure Blob Storage
      // const srcContainer = this.extractContainerName(srcPath);
      // const srcBlob = this.extractBlobName(srcPath);
      // const destContainer = this.extractContainerName(destPath);
      // const destBlob = this.extractBlobName(destPath);
      // await azureBlobService.copyBlob(srcContainer, srcBlob, destContainer, destBlob);
      throw new Error('Azure storage not yet implemented');
    }
  }
}

// ✅ Export singleton instance
module.exports = new StorageAdapter(process.env.STORAGE_MODE || 'local');
