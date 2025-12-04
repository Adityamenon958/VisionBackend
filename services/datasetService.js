const Dataset = require('../models/Dataset');
const storageAdapter = require('./storageAdapter');
const path = require('path');

/**
 * Dataset Service - Helper functions for dataset operations
 * 
 * This service provides reusable functions for dataset-related operations
 * to keep controllers clean and logic testable.
 */

/**
 * Get dataset by ID
 * @param {string} datasetId - MongoDB ObjectId string
 * @returns {Promise<Object|null>} Dataset document or null if not found
 */
async function getDatasetById(datasetId) {
  if (!datasetId) {
    return null;
  }
  return await Dataset.findById(datasetId);
}

/**
 * Build folders summary from dataset files
 * Groups files by folder name and calculates statistics
 * @param {Object} dataset - Dataset document
 * @returns {Object} Folders object with structure: { folderName: { images, labels, sizeBytes } }
 */
function buildFoldersSummary(dataset) {
  const folders = {};
  
  for (const file of dataset.files) {
    const folderName = file.folder || 'dataset';
    
    if (!folders[folderName]) {
      folders[folderName] = {
        images: 0,
        labels: 0,
        sizeBytes: 0
      };
    }
    
    if (file.type === 'image') {
      folders[folderName].images++;
    } else if (file.type === 'label') {
      folders[folderName].labels++;
    }
    
    folders[folderName].sizeBytes += file.size || 0;
  }
  
  return folders;
}

/**
 * Filter and paginate dataset files
 * @param {Object} dataset - Dataset document
 * @param {Object} options - Filter and pagination options
 * @param {string} [options.folder] - Filter by folder name
 * @param {string} [options.type] - Filter by type ('image' or 'label')
 * @param {string} [options.sort] - Sort field ('name' or 'size')
 * @param {string} [options.order] - Sort order ('asc' or 'desc')
 * @param {number} [options.page] - Page number (default: 1)
 * @param {number} [options.limit] - Items per page (default: 50, max: 500)
 * @returns {Promise<Object>} { items: Array, total: number }
 */
async function filterAndPaginateFiles(dataset, options = {}) {
  const {
    folder,
    type,
    sort = 'name',
    order = 'asc',
    page = 1,
    limit = 50
  } = options;
  
  // Start with all files
  let filtered = [...dataset.files];
  
  // Apply folder filter
  if (folder) {
    filtered = filtered.filter(f => f.folder === folder);
  }
  
  // Apply type filter
  if (type && (type === 'image' || type === 'label')) {
    filtered = filtered.filter(f => f.type === type);
  }
  
  // Sort files
  filtered.sort((a, b) => {
    let aVal, bVal;
    
    if (sort === 'name') {
      aVal = a.originalName.toLowerCase();
      bVal = b.originalName.toLowerCase();
    } else if (sort === 'size') {
      aVal = a.size || 0;
      bVal = b.size || 0;
    } else {
      // Default to name
      aVal = a.originalName.toLowerCase();
      bVal = b.originalName.toLowerCase();
    }
    
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
  
  // Paginate
  const total = filtered.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const items = filtered.slice(startIndex, endIndex);
  
  return { items, total };
}

/**
 * Check if thumbnail exists for a file
 * @param {string} company - Company identifier
 * @param {string} project - Project identifier
 * @param {string} version - Version identifier
 * @param {string} storedName - Stored filename
 * @returns {Promise<boolean>} True if thumbnail exists
 */
async function checkThumbnailExists(company, project, version, storedName) {
  const thumbnailPath = storageAdapter.getThumbnailPath(company, project, version, storedName);
  return await storageAdapter.exists(thumbnailPath);
}

module.exports = {
  getDatasetById,
  buildFoldersSummary,
  filterAndPaginateFiles,
  checkThumbnailExists
};


