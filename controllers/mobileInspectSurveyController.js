const fs = require('fs');
const InferenceJob = require('../models/InferenceJob');
const { validateWorkspaceAccess, canAccessAllWorkspaces } = require('../utils/workspaceScoping');

function readCorrosionFromJob(job) {
  if (job.results?.corrosionStats && typeof job.results.corrosionStats.meanCorrosionPercent === 'number') {
    return job.results.corrosionStats;
  }
  const metadataPath = job.results?.metadataPath;
  if (!metadataPath || !fs.existsSync(metadataPath)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return metadata.corrosionStats || null;
  } catch {
    return null;
  }
}

function mean(values) {
  const nums = values.filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!nums.length) return null;
  return round4(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function mergeClassRows(rowsList) {
  const bucket = {};
  for (const rows of rowsList) {
    for (const row of rows || []) {
      const name = row.class || row.className;
      if (!name) continue;
      const item = bucket[name] || { class: name, percentSum: 0, n: 0, count: 0 };
      const pct = row.meanPercent ?? row.percent;
      if (typeof pct === 'number') {
        item.percentSum += pct;
        item.n += 1;
      }
      item.count += Number(row.count) || 0;
      bucket[name] = item;
    }
  }
  return Object.values(bucket)
    .map((v) => ({
      class: v.class,
      meanPercent: v.n ? round4(v.percentSum / v.n) : 0,
      count: v.count,
    }))
    .sort((a, b) => b.meanPercent - a.meanPercent);
}

function inspectFilter(company, project, extra = {}) {
  return {
    company,
    project,
    sourceType: 'custom_folder',
    excludeFromHistory: { $ne: true },
    surveyName: { $nin: [null, ''] },
    regionName: { $nin: [null, ''] },
    ...extra,
  };
}

function hydrateJob(job) {
  const corrosion = job.status === 'completed' ? readCorrosionFromJob(job) : null;
  return {
    inferenceId: job.inferenceId,
    status: job.status,
    regionName: job.regionName,
    surveyName: job.surveyName,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    imageCount: corrosion?.imageCount ?? job.progress?.totalImages ?? 0,
    meanCorrosionPercent:
      typeof corrosion?.meanCorrosionPercent === 'number' ? corrosion.meanCorrosionPercent : null,
    byClass: corrosion?.byClass || [],
  };
}

function buildSurveyFromJobs(surveyName, jobs) {
  const hydrated = jobs.map(hydrateJob);
  const byPart = {};
  for (const visit of hydrated) {
    const key = visit.regionName;
    if (!byPart[key]) byPart[key] = [];
    byPart[key].push(visit);
  }

  const parts = Object.keys(byPart)
    .sort((a, b) => a.localeCompare(b))
    .map((regionName) => {
      const visits = byPart[regionName].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const latestCompleted = visits.find((v) => v.status === 'completed' && v.meanCorrosionPercent != null);
      return {
        regionName,
        visitCount: visits.length,
        latest: visits[0],
        latestCompleted: latestCompleted || null,
        meanCorrosionPercent: latestCompleted ? latestCompleted.meanCorrosionPercent : null,
        imageCount: latestCompleted ? latestCompleted.imageCount : 0,
        byClass: latestCompleted?.byClass || [],
        visits,
      };
    });

  const partPercents = parts
    .map((p) => p.meanCorrosionPercent)
    .filter((n) => typeof n === 'number');
  const completedParts = parts.filter((p) => p.latestCompleted);

  return {
    surveyName,
    partCount: parts.length,
    completedPartCount: completedParts.length,
    visitCount: hydrated.length,
    overallMeanCorrosionPercent: mean(partPercents),
    byClass: mergeClassRows(completedParts.map((p) => p.byClass)),
    updatedAt: hydrated[0]?.createdAt || null,
    parts,
  };
}

async function scopedCompanyProject(req, res) {
  const company = String(req.query.company || req.user?.company || '').trim();
  const project = String(req.query.project || '').trim();
  if (!company || !project) {
    res.status(400).json({
      error: 'Missing required query parameters',
      required: ['company', 'project'],
    });
    return null;
  }
  if (!canAccessAllWorkspaces(req.user)) {
    const access = validateWorkspaceAccess(req.user, company);
    if (!access.allowed) {
      res.status(403).json({
        error: 'Permission denied',
        message: access.error || 'You do not have access to this workspace',
      });
      return null;
    }
  }
  return { company, project };
}

/**
 * GET /api/mobile-inspect/surveys?company=&project=
 */
const listMobileInspectSurveys = async (req, res) => {
  try {
    const scope = await scopedCompanyProject(req, res);
    if (!scope) return;
    const { company, project } = scope;

    const jobs = await InferenceJob.find(inspectFilter(company, project))
      .sort({ createdAt: -1 })
      .lean();

    const byName = {};
    for (const job of jobs) {
      const name = job.surveyName;
      if (!byName[name]) byName[name] = [];
      byName[name].push(job);
    }

    const surveys = Object.keys(byName)
      .map((surveyName) => {
        const detail = buildSurveyFromJobs(surveyName, byName[surveyName]);
        return {
          surveyName: detail.surveyName,
          partCount: detail.partCount,
          completedPartCount: detail.completedPartCount,
          visitCount: detail.visitCount,
          overallMeanCorrosionPercent: detail.overallMeanCorrosionPercent,
          updatedAt: detail.updatedAt,
        };
      })
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    return res.status(200).json({ surveys, company, project });
  } catch (error) {
    console.error('[mobile-inspect] list surveys error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * GET /api/mobile-inspect/survey?company=&project=&surveyName=
 */
const getMobileInspectSurvey = async (req, res) => {
  try {
    const scope = await scopedCompanyProject(req, res);
    if (!scope) return;
    const { company, project } = scope;
    const surveyName = String(req.query.surveyName || '').trim();
    if (!surveyName) {
      return res.status(400).json({
        error: 'Missing required query parameter: surveyName',
      });
    }

    const jobs = await InferenceJob.find(inspectFilter(company, project, { surveyName }))
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      survey: buildSurveyFromJobs(surveyName, jobs),
      company,
      project,
    });
  } catch (error) {
    console.error('[mobile-inspect] get survey error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

module.exports = {
  listMobileInspectSurveys,
  getMobileInspectSurvey,
};
