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
   * Get base storage path
   * @returns {string} Base path (e.g., /datasets)
   */
  getBasePath() {
    return this.basePath;
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
   * Build storage path for inference results
   * Format: /results/{company}/{project}/{modelId}/inference_{inferenceId}/
   * @param {string} company - Company identifier
   * @param {string} project - Project identifier
   * @param {string} modelId - Model identifier (from Model model)
   * @param {string} inferenceId - Inference job identifier
   * @returns {string} Full path to results folder
   */
  buildResultsPath(company, project, modelId, inferenceId) {
    const resultsBasePath = path.join(process.cwd(), 'results');
    return path.join(resultsBasePath, company, project, modelId, `inference_${inferenceId}`);
  }

  /**
   * Build path for annotated images subfolder within results
   * Format: {resultsPath}/annotated/
   * @param {string} resultsPath - Base results path (from buildResultsPath)
   * @returns {string} Full path to annotated images folder
   */
  buildAnnotatedImagesPath(resultsPath) {
    return path.join(resultsPath, 'annotated');
  }

  /**
   * Build path for metadata JSON file within results
   * Format: {resultsPath}/metadata.json
   * @param {string} resultsPath - Base results path (from buildResultsPath)
   * @returns {string} Full path to metadata JSON file
   */
  buildMetadataPath(resultsPath) {
    return path.join(resultsPath, 'metadata.json');
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

  /**
   * Rename a directory (folder rename - instant on same filesystem)
   * 
   * Used when renaming company/project - renames the folder instead of moving files
   * This is much faster than copying files (instant vs minutes for large datasets)
   * 
   * @param {string} srcDir - Source directory path (e.g., /datasets/company/oldProject/)
   * @param {string} destDir - Destination directory path (e.g., /datasets/company/newProject/)
   */
  async renameDirectory(srcDir, destDir) {
    if (this.mode === 'local') {
      // ✅ Check if source exists
      if (!(await this.exists(srcDir))) {
        throw new Error(`Source directory does not exist: ${srcDir}`);
      }

      // ✅ Ensure parent directory of destination exists
      const destParent = path.dirname(destDir);
      await this.ensureDir(destParent);

      try {
        // ✅ Use rename (instant on same filesystem - just changes folder name)
        // This is the key: fs.rename() on directories is instant, no file copying!
        await fs.rename(srcDir, destDir);
        console.log(`✅ Renamed directory: ${srcDir} → ${destDir}`);
      } catch (error) {
        // ⚠️ If rename fails (cross-device), fall back to copy + delete
        // This only happens if source and dest are on different drives
        if (error.code === 'EXDEV') {
          console.warn(`⚠️ Cross-device rename detected, using copy+delete fallback`);
          // Recursively copy directory
          await this._copyDirectoryRecursive(srcDir, destDir);
          // Delete source directory
          await this._removeDirectoryRecursive(srcDir);
        } else {
          throw error;
        }
      }

      // ✅ Clean up empty parent directories after rename
      await this._cleanupEmptyParents(srcDir);
    } else if (this.mode === 'azure') {
      // TODO: Rename directory in Azure Blob Storage (metadata-only operation)
      throw new Error('Azure storage not yet implemented');
    }
  }

  /**
   * Move an entire directory from source to destination
   * 
   * @deprecated Use renameDirectory() instead - it's faster (instant rename vs file copying)
   * Kept for backward compatibility
   * 
   * @param {string} srcDir - Source directory path
   * @param {string} destDir - Destination directory path
   */
  async moveDirectory(srcDir, destDir) {
    // ✅ Delegate to renameDirectory (same operation, better name)
    return this.renameDirectory(srcDir, destDir);
  }

  /**
   * Remove empty parent directories up to basePath
   * Used after moving directories to clean up empty folders
   * 
   * @param {string} dirPath - Path to start cleaning from (will clean parents)
   * @private
   */
  async _cleanupEmptyParents(dirPath) {
    try {
      let currentPath = path.dirname(dirPath);
      const basePathNormalized = path.normalize(this.basePath);

      // ✅ Walk up the directory tree, removing empty directories
      // Stop when we reach the basePath (don't delete datasets folder itself)
      while (currentPath !== basePathNormalized && currentPath.length > basePathNormalized.length) {
        try {
          // Check if directory is empty
          const entries = await fs.readdir(currentPath);
          
          if (entries.length === 0) {
            // Directory is empty, remove it
            await fs.rmdir(currentPath);
            console.log(`✅ Removed empty directory: ${currentPath}`);
            
            // Move up to parent directory
            currentPath = path.dirname(currentPath);
          } else {
            // Directory has contents, stop cleaning
            break;
          }
        } catch (error) {
          // If we can't read or remove, stop (might not exist or have permissions)
          if (error.code === 'ENOENT' || error.code === 'ENOTEMPTY') {
            break;
          }
          // For other errors, log and continue
          console.warn(`⚠️ Could not clean up ${currentPath}:`, error.message);
          break;
        }
      }
    } catch (error) {
      // Non-critical error, just log it
      console.warn(`⚠️ Error during cleanup of empty parents:`, error.message);
    }
  }

  /**
   * Helper: Recursively copy directory
   * @private
   */
  async _copyDirectoryRecursive(srcDir, destDir) {
    await this.ensureDir(destDir);
    const entries = await fs.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        await this._copyDirectoryRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Helper: Recursively remove directory
   * @private
   */
  async _removeDirectoryRecursive(dirPath) {
    // ✅ Use recursive option for rmdir (Node 12+)
    // This is simpler and handles nested directories automatically
    try {
      await fs.rmdir(dirPath, { recursive: true });
    } catch (error) {
      // Fallback: manual recursive deletion if rmdir fails
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await this._removeDirectoryRecursive(entryPath);
        } else {
          await fs.unlink(entryPath);
        }
      }

      await fs.rmdir(dirPath);
    }
  }
}

// ✅ Export singleton instance
module.exports = new StorageAdapter(process.env.STORAGE_MODE || 'local');
