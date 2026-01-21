const Dataset = require('../models/Dataset');
const Model = require('../models/Model');
const TrainingJob = require('../models/TrainingJob');
const InferenceJob = require('../models/InferenceJob');
const AuditLog = require('../models/AuditLog');
const { buildWorkspaceFilter, validateWorkspaceAccess, canAccessAllWorkspaces } = require('../utils/workspaceScoping');

/**
 * Dashboard Controller
 *
 * These endpoints are read-only and aggregate existing data
 * for the dashboard views. They do NOT modify any resources
 * and therefore do not change existing behaviour.
 */

/**
 * GET /api/dashboard/overview
 *
 * Query params:
 * - company (required)
 * - project (optional) – when provided, filter by project
 */
const getDashboardOverview = async (req, res) => {
  try {
    const { company, project } = req.query;

    if (!company) {
      return res.status(400).json({
        error: 'Missing required query parameter: company'
      });
    }

    const projectFilter = project ? { company, project } : { company };

    // Projects: distinct project names from datasets & models
    const datasetProjects = await Dataset.distinct('project', { company });
    const modelProjects = await Model.distinct('project', { company });
    const allProjects = Array.from(new Set([...datasetProjects, ...modelProjects]));

    // Datasets
    const totalDatasets = await Dataset.countDocuments(projectFilter);

    // Models
    const totalModels = await Model.countDocuments(projectFilter);

    // Training jobs by status
    const trainingAgg = await TrainingJob.aggregate([
      { $match: projectFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const trainingSummary = trainingAgg.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const trainingJobsCount = trainingAgg.reduce((sum, item) => sum + (item.count || 0), 0);

    // Inference jobs by status
    const inferenceAgg = await InferenceJob.aggregate([
      { $match: projectFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const inferenceSummary = inferenceAgg.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const inferenceRunsCount = inferenceAgg.reduce((sum, item) => sum + (item.count || 0), 0);

    // Last prediction (recent completed inference job for this scope)
    const lastInference = await InferenceJob.findOne({
      ...projectFilter,
      status: 'completed'
    })
      .sort({ completedAt: -1, createdAt: -1 })
      .select('inferenceId status createdAt completedAt company project')
      .lean();

    return res.status(200).json({
      company,
      project: project || null,
      summary: {
        // Legacy fields (to avoid breaking any existing usage)
        activeProjects: allProjects.length,
        totalDatasets,
        totalModels,
        // New fields expected by dashboard frontend
        projectsCount: allProjects.length,
        datasetsCount: totalDatasets,
        modelsCount: totalModels,
        trainingJobsCount,
        inferenceRunsCount
      },
      trainingJobsByStatus: trainingSummary,
      inferenceJobsByStatus: inferenceSummary,
      lastPrediction: lastInference
        ? {
          inferenceId: lastInference.inferenceId,
          status: lastInference.status,
          createdAt: lastInference.createdAt,
          completedAt: lastInference.completedAt,
          company: lastInference.company,
          project: lastInference.project
        }
        : null
    });
  } catch (error) {
    console.error('Error in getDashboardOverview:', error);
    return res.status(500).json({
      error: 'Failed to load dashboard overview',
      message: error.message
    });
  }
};

/**
 * GET /api/dashboard/activity
 *
 * Query params:
 * - company (required)
 * - project (optional)
 * - limit (optional, default 20)
 *
 * Returns recent activity based on AuditLog entries. If there are
 * no audit logs yet, this will simply return an empty list.
 */
const getDashboardActivity = async (req, res) => {
  try {
    const { company, project, limit = 20 } = req.query;

    if (!company) {
      return res.status(400).json({
        error: 'Missing required query parameter: company'
      });
    }

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this workspace'
        });
      }
    }

    const query = { company };
    if (project) {
      query.project = project;
    }

    const logs = await AuditLog.find(query)
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .lean();

    const activities = logs.map((log) => ({
      logId: log.logId,
      company: log.company,
      project: log.project,
      userId: log.userId,
      action: log.action,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      details: log.details || {},
      timestamp: log.timestamp
    }));

    return res.status(200).json({
      company,
      project: project || null,
      activities,
      total: activities.length
    });
  } catch (error) {
    console.error('Error in getDashboardActivity:', error);
    return res.status(500).json({
      error: 'Failed to load dashboard activity',
      message: error.message
    });
  }
};

/**
 * GET /api/dashboard/projects
 *
 * Query params:
 * - company (required)
 *
 * Returns a list of projects with basic counts. This is a read-only
 * aggregation over existing collections.
 */
const getDashboardProjects = async (req, res) => {
  try {
    const { company } = req.query;

    if (!company) {
      return res.status(400).json({
        error: 'Missing required query parameter: company'
      });
    }

    // ✅ Validate workspace access (for non-platform-admin users)
    if (!canAccessAllWorkspaces(req.user)) {
      const accessValidation = validateWorkspaceAccess(req.user, company);
      if (!accessValidation.allowed) {
        return res.status(403).json({
          error: 'Permission denied',
          message: accessValidation.error || 'You do not have access to this workspace'
        });
      }
    }

    // Distinct projects from datasets, models, and training jobs
    const datasetProjects = await Dataset.distinct('project', { company });
    const modelProjects = await Model.distinct('project', { company });
    const trainingProjects = await TrainingJob.distinct('project', { company });

    const projects = Array.from(
      new Set([...datasetProjects, ...modelProjects, ...trainingProjects])
    );

    // For each project, compute simple counts
    const projectSummaries = await Promise.all(
      projects.map(async (projectName) => {
        const filter = { company, project: projectName };

        const [datasetsCount, modelsCount, trainingCount, inferenceCount] = await Promise.all([
          Dataset.countDocuments(filter),
          Model.countDocuments(filter),
          TrainingJob.countDocuments(filter),
          InferenceJob.countDocuments(filter)
        ]);

        // Last activity timestamp from training or inference jobs
        const lastTraining = await TrainingJob.findOne(filter)
          .sort({ updatedAt: -1 })
          .select('updatedAt')
          .lean();
        const lastInference = await InferenceJob.findOne(filter)
          .sort({ updatedAt: -1 })
          .select('updatedAt')
          .lean();

        const lastActivity = [lastTraining?.updatedAt, lastInference?.updatedAt]
          .filter(Boolean)
          .sort((a, b) => b - a)[0] || null;

        return {
          company,
          project: projectName,
          datasetsCount,
          modelsCount,
          trainingJobsCount: trainingCount,
          inferenceJobsCount: inferenceCount,
          lastActivity
        };
      })
    );

    return res.status(200).json({
      company,
      projects: projectSummaries,
      total: projectSummaries.length
    });
  } catch (error) {
    console.error('Error in getDashboardProjects:', error);
    return res.status(500).json({
      error: 'Failed to load dashboard projects',
      message: error.message
    });
  }
};

module.exports = {
  getDashboardOverview,
  getDashboardActivity,
  getDashboardProjects
};

