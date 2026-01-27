const Model = require('../models/Model');
const TrainingJob = require('../models/TrainingJob');
const InferenceJob = require('../models/InferenceJob');
const { buildWorkspaceFilter, validateWorkspaceAccess, canAccessAllWorkspaces } = require('../utils/workspaceScoping');

/**
 * Analytics Controller
 *
 * Read-only endpoints that aggregate existing training and
 * inference data for analytics views. They do not modify
 * any existing resources.
 */

/**
 * GET /api/analytics/training/:modelId
 *
 * Returns training metrics and basic chart data for a model.
 * This leverages the existing Model schema (metrics + chartDataPath).
 */
const getTrainingAnalytics = async (req, res) => {
  try {
    const { modelId } = req.params;

    if (!modelId) {
      return res.status(400).json({
        error: 'Missing required parameter: modelId'
      });
    }

    const model = await Model.findOne({ modelId }).lean();

    if (!model) {
      return res.status(404).json({
        error: 'Model not found',
        modelId
      });
    }

    // Basic metrics are already stored on the model
    const metrics = model.metrics || {};

    // Chart data is optionally stored as JSON files in chartDataPath
    let chartData = {
      lossCurve: [],
      precisionCurve: [],
      mAPCurve: []
    };

    if (model.chartDataPath) {
      const fs = require('fs');
      const path = require('path');

      try {
        const lossCurvePath = path.join(model.chartDataPath, 'loss_curve.json');
        const precisionCurvePath = path.join(model.chartDataPath, 'precision_curve.json');
        const mapCurvePath = path.join(model.chartDataPath, 'map_curve.json');

        const lossCurve = fs.existsSync(lossCurvePath)
          ? JSON.parse(fs.readFileSync(lossCurvePath, 'utf8'))
          : [];
        const precisionCurve = fs.existsSync(precisionCurvePath)
          ? JSON.parse(fs.readFileSync(precisionCurvePath, 'utf8'))
          : [];
        const mapCurve = fs.existsSync(mapCurvePath)
          ? JSON.parse(fs.readFileSync(mapCurvePath, 'utf8'))
          : [];

        chartData = {
          lossCurve,
          precisionCurve,
          mAPCurve: mapCurve
        };
      } catch (error) {
        console.warn(`Failed to load chart data for model ${modelId}:`, error.message);
      }
    }

    return res.status(200).json({
      modelId: model.modelId,
      company: model.company,
      project: model.project,
      metrics,
      chartData
    });
  } catch (error) {
    console.error('Error in getTrainingAnalytics:', error);
    return res.status(500).json({
      error: 'Failed to load training analytics',
      message: error.message
    });
  }
};

/**
 * GET /api/analytics/training/status
 *
 * Returns a summary of training jobs grouped by status.
 *
 * Query params:
 * - company (optional)
 * - project (optional)
 */
const getTrainingStatusSummary = async (req, res) => {
  try {
    const { company, project } = req.query;

    // ✅ Build workspace filter
    const workspaceFilter = buildWorkspaceFilter(req.user, company, project);
    const match = { ...workspaceFilter };
    if (project) match.project = project;

    // ✅ If user is not platform admin and no company provided, deny access
    if (!canAccessAllWorkspaces(req.user) && !company) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'Company parameter is required'
      });
    }

    const agg = await TrainingJob.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const summary = agg.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    return res.status(200).json({
      company: company || null,
      project: project || null,
      summary
    });
  } catch (error) {
    console.error('Error in getTrainingStatusSummary:', error);
    return res.status(500).json({
      error: 'Failed to load training status summary',
      message: error.message
    });
  }
};

/**
 * GET /api/analytics/inference/runs
 *
 * Returns recent inference runs for analytics.
 *
 * Query params:
 * - company (optional)
 * - project (optional)
 * - limit (optional, default 50)
 */
const getInferenceRuns = async (req, res) => {
  try {
    const { company, project, limit = 50 } = req.query;

    // ✅ Build workspace filter
    const workspaceFilter = buildWorkspaceFilter(req.user, company, project);
    const query = { ...workspaceFilter };
    if (project) query.project = project;

    // ✅ If user is not platform admin and no company provided, deny access
    if (!canAccessAllWorkspaces(req.user) && !company) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'Company parameter is required'
      });
    }

    const runs = await InferenceJob.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .select(
        'inferenceId company project status createdAt completedAt sourceType results.totalDetections results.averageConfidence'
      )
      .lean();

    return res.status(200).json({
      company: company || null,
      project: project || null,
      runs,
      total: runs.length
    });
  } catch (error) {
    console.error('Error in getInferenceRuns:', error);
    return res.status(500).json({
      error: 'Failed to load inference runs',
      message: error.message
    });
  }
};

/**
 * GET /api/analytics/inference/pass-fail
 *
 * Simple pass/fail statistics based on inference job results.
 *
 * Query params:
 * - company (optional)
 * - project (optional)
 * - modelId (optional, modelId string not ObjectId)
 */
const getInferencePassFail = async (req, res) => {
  try {
    const { company, project, modelId } = req.query;

    const query = { status: 'completed' };
    if (company) query.company = company;
    if (project) query.project = project;

    // If a modelId string is provided, resolve to ObjectId(s)
    if (modelId) {
      const modelDoc = await Model.findOne({ modelId }).select('_id').lean();
      if (!modelDoc) {
        return res.status(404).json({
          error: 'Model not found',
          modelId
        });
      }
      query.modelId = modelDoc._id;
    }

    const jobs = await InferenceJob.find(query)
      .select('results.defectCount results.goodCount results.totalDetections')
      .lean();

    let passed = 0;
    let failed = 0;

    jobs.forEach((job) => {
      const defectCount = job.results?.defectCount || 0;
      const totalDetections = job.results?.totalDetections || 0;

      // Simple heuristic: pass if there are no defect images / detections
      if (defectCount === 0 && totalDetections === 0) {
        passed += 1;
      } else {
        failed += 1;
      }
    });

    const total = passed + failed;
    const passRate = total > 0 ? passed / total : 0;

    return res.status(200).json({
      company: company || null,
      project: project || null,
      modelId: modelId || null,
      summary: {
        total,
        passed,
        failed,
        passRate
      }
    });
  } catch (error) {
    console.error('Error in getInferencePassFail:', error);
    return res.status(500).json({
      error: 'Failed to load inference pass/fail statistics',
      message: error.message
    });
  }
};

/**
 * GET /api/analytics/accuracy/trends
 *
 * Returns accuracy trends over time based on Model metrics.
 *
 * Query params:
 * - company (optional)
 * - project (optional)
 */
const getAccuracyTrends = async (req, res) => {
  try {
    const { company, project } = req.query;

    // ✅ Build workspace filter
    const workspaceFilter = buildWorkspaceFilter(req.user, company, project);
    const query = { ...workspaceFilter };
    if (project) query.project = project;

    // ✅ If user is not platform admin and no company provided, deny access
    if (!canAccessAllWorkspaces(req.user) && !company) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'Company parameter is required'
      });
    }

    const models = await Model.find(query)
      .sort({ createdAt: 1 })
      .select('modelId modelVersion company project metrics createdAt')
      .lean();

    const trends = models.map((model) => ({
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      company: model.company,
      project: model.project,
      timestamp: model.createdAt,
      metrics: {
        mAP50: model.metrics?.mAP50 || null,
        mAP50_95: model.metrics?.mAP50_95 || null,
        precision: model.metrics?.precision || null,
        recall: model.metrics?.recall || null
      }
    }));

    return res.status(200).json({
      company: company || null,
      project: project || null,
      trends
    });
  } catch (error) {
    console.error('Error in getAccuracyTrends:', error);
    return res.status(500).json({
      error: 'Failed to load accuracy trends',
      message: error.message
    });
  }
};

module.exports = {
  getTrainingAnalytics,
  getTrainingStatusSummary,
  getInferenceRuns,
  getInferencePassFail,
  getAccuracyTrends
};

