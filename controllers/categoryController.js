const mongoose = require('mongoose');
const Category = require('../models/Category');
const Annotation = require('../models/Annotation');
const Dataset = require('../models/Dataset');
const { validateColor, validateName } = require('../utils/categoryValidator');
const { sendError, sendValidationError, sendNotFoundError } = require('../utils/errors');

/**
 * Category Controller
 * 
 * Handles all category-related operations.
 * Authentication is intentionally skipped in this phase.
 */

// System user ID for createdBy (since auth is skipped)
const SYSTEM_USER_ID = new mongoose.Types.ObjectId('000000000000000000000000');

/**
 * GET /api/dataset/:datasetId/categories
 * 
 * Get categories for a dataset (ordered by order field)
 * Returns empty array if no categories exist (user must create categories explicitly)
 */
const getCategories = async (req, res) => {
  try {
    const { datasetId } = req.params;

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Get categories (ordered by order field)
    const categories = await Category.getOrderedCategories(datasetId);

    // Get annotation count for each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (cat) => {
        const annotationCount = await Annotation.countDocuments({
          categoryId: cat._id,
          deletedAt: null
        });

        return {
          id: cat._id,
          name: cat.name,
          color: cat.color,
          description: cat.description,
          createdAt: cat.createdAt,
          annotationCount
        };
      })
    );

    return res.status(200).json({
      categories: categoriesWithCounts
    });

  } catch (error) {
    console.error('Error getting categories:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * POST /api/dataset/:datasetId/categories
 * 
 * Create a new category
 */
const createCategory = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { name, color, description } = req.body;

    // Validate required fields
    if (!name || !color) {
      return sendValidationError(res, 'body', 'Missing required fields: name, color');
    }

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Validate name
    const nameValidation = validateName(name);
    if (!nameValidation.valid) {
      return sendValidationError(res, 'name', nameValidation.error);
    }

    // Validate color
    const colorValidation = validateColor(color);
    if (!colorValidation.valid) {
      return sendValidationError(res, 'color', colorValidation.error);
    }

    // Check name uniqueness within dataset
    const trimmedName = name.trim();
    const existingCategory = await Category.findOne({
      datasetId,
      name: trimmedName
    });

    if (existingCategory) {
      return sendError(res, 400, 'Validation Error', `Category name '${trimmedName}' already exists in this dataset`);
    }

    // Get next order value
    const maxOrder = await Category.findOne({ datasetId })
      .sort({ order: -1 })
      .select('order')
      .lean();

    const nextOrder = maxOrder ? maxOrder.order + 1 : 0;

    // Create category
    const category = new Category({
      datasetId,
      name: trimmedName,
      color,
      description: description || '',
      order: nextOrder,
      createdBy: SYSTEM_USER_ID
    });

    await category.save();

    return res.status(200).json({
      category: {
        id: category._id,
        name: category.name,
        color: category.color,
        description: category.description,
        createdAt: category.createdAt
      }
    });

  } catch (error) {
    console.error('Error creating category:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * PUT /api/dataset/:datasetId/categories/:categoryId
 * 
 * Update an existing category
 * CRITICAL: If name changes, update categoryName in ALL annotations
 */
const updateCategory = async (req, res) => {
  try {
    const { datasetId, categoryId } = req.params;
    const { name, color, description } = req.body;

    // Validate categoryId
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return sendNotFoundError(res, 'Category', categoryId);
    }

    // Check category exists and belongs to dataset
    const category = await Category.findOne({ _id: categoryId, datasetId });
    if (!category) {
      return sendNotFoundError(res, 'Category', categoryId);
    }

    // Update name if provided
    if (name !== undefined) {
      const nameValidation = validateName(name);
      if (!nameValidation.valid) {
        return sendValidationError(res, 'name', nameValidation.error);
      }

      const trimmedName = name.trim();

      // Check name uniqueness (if changed)
      if (trimmedName !== category.name) {
        const existingCategory = await Category.findOne({
          datasetId,
          name: trimmedName,
          _id: { $ne: categoryId }
        });

        if (existingCategory) {
          return sendError(res, 400, 'Validation Error', `Category name '${trimmedName}' already exists in this dataset`);
        }

        // CRITICAL: Update categoryName in ALL annotations with this categoryId
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          await Annotation.updateMany(
            { categoryId, deletedAt: null },
            { $set: { categoryName: trimmedName } },
            { session }
          );

          category.name = trimmedName;
          await category.save({ session });

          await session.commitTransaction();
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      }
    }

    // Update color if provided
    if (color !== undefined) {
      const colorValidation = validateColor(color);
      if (!colorValidation.valid) {
        return sendValidationError(res, 'color', colorValidation.error);
      }
      category.color = color;
    }

    // Update description if provided
    if (description !== undefined) {
      category.description = description;
    }

    // Save if not already saved in transaction
    if (name === undefined || name.trim() === category.name) {
      await category.save();
    }

    return res.status(200).json({
      category: {
        id: category._id,
        name: category.name,
        color: category.color,
        description: category.description,
        updatedAt: category.updatedAt
      },
      message: 'Category updated successfully'
    });

  } catch (error) {
    console.error('Error updating category:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * DELETE /api/dataset/:datasetId/categories/:categoryId
 * 
 * Delete a category
 * If reassignTo provided, reassign all annotations to new category
 * Otherwise, block delete if annotations exist
 */
const deleteCategory = async (req, res) => {
  try {
    const { datasetId, categoryId } = req.params;
    const { reassignTo } = req.query;

    // Validate categoryId
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return sendNotFoundError(res, 'Category', categoryId);
    }

    // Check category exists and belongs to dataset
    const category = await Category.findOne({ _id: categoryId, datasetId });
    if (!category) {
      return sendNotFoundError(res, 'Category', categoryId);
    }

    // Check if category has annotations
    const annotationCount = await Annotation.countDocuments({
      categoryId,
      deletedAt: null
    });

    if (annotationCount > 0) {
      if (reassignTo) {
        // Validate reassignTo category
        if (!mongoose.Types.ObjectId.isValid(reassignTo)) {
          return sendNotFoundError(res, 'Category', reassignTo);
        }

        const reassignCategory = await Category.findOne({ _id: reassignTo, datasetId });
        if (!reassignCategory) {
          return sendNotFoundError(res, 'Category', reassignTo);
        }

        // Reassign all annotations to new category
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          await Annotation.updateMany(
            { categoryId, deletedAt: null },
            {
              $set: {
                categoryId: reassignTo,
                categoryName: reassignCategory.name // Update denormalized category name
              }
            },
            { session }
          );

          await Category.deleteOne({ _id: categoryId }).session(session);

          await session.commitTransaction();

          return res.status(200).json({
            message: 'Category deleted successfully',
            reassignedCount: annotationCount
          });
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      } else {
        // Block delete if annotations exist and no reassignTo provided
        return sendError(res, 400, 'Validation Error', `Cannot delete category: ${annotationCount} annotation(s) use this category. Provide reassignTo parameter to reassign annotations.`);
      }
    } else {
      // No annotations, safe to delete
      await Category.deleteOne({ _id: categoryId });

      return res.status(200).json({
        message: 'Category deleted successfully',
        reassignedCount: 0
      });
    }

  } catch (error) {
    console.error('Error deleting category:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

/**
 * PUT /api/dataset/:datasetId/categories/reorder
 * 
 * Reorder categories by updating order field
 */
const reorderCategories = async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { categoryIds } = req.body;

    // Validate input
    if (!Array.isArray(categoryIds)) {
      return sendValidationError(res, 'categoryIds', 'categoryIds must be an array');
    }

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Check dataset exists
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return sendNotFoundError(res, 'Dataset', datasetId);
    }

    // Validate all category IDs exist and belong to dataset
    const categories = await Category.find({
      _id: { $in: categoryIds },
      datasetId
    });

    if (categories.length !== categoryIds.length) {
      return sendError(res, 400, 'Validation Error', 'Some category IDs not found or do not belong to dataset');
    }

    // Update order field using array index
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      for (let i = 0; i < categoryIds.length; i++) {
        await Category.updateOne(
          { _id: categoryIds[i], datasetId },
          { $set: { order: i } },
          { session }
        );
      }

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

    return res.status(200).json({
      message: 'Categories reordered successfully'
    });

  } catch (error) {
    console.error('Error reordering categories:', error);
    return sendError(res, 500, 'Internal Server Error', error.message);
  }
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories
};

