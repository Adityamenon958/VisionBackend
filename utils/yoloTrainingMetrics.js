const fs = require('fs');
const path = require('path');

/** Hardcoded values the worker used to write when parse failed. */
const PLACEHOLDER_MAP50 = 0.72;
const PLACEHOLDER_PRECISION = 0.85;
const PLACEHOLDER_RECALL = 0.78;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function pickFinite(...values) {
  for (const value of values) {
    if (isFiniteNumber(value)) return value;
  }
  return undefined;
}

/**
 * True when stored metrics are missing, zero, or the old dummy 0.72/0.85/0.78 triple.
 */
function needsMetricsRepair(metrics) {
  if (!metrics || typeof metrics !== 'object') return true;
  const map50 = Number(metrics.mAP50);
  const precision = Number(metrics.precision);
  const recall = Number(metrics.recall);
  if (
    map50 === PLACEHOLDER_MAP50 &&
    precision === PLACEHOLDER_PRECISION &&
    recall === PLACEHOLDER_RECALL
  ) {
    return true;
  }
  return !isFiniteNumber(map50) || map50 <= 0;
}

/**
 * Parse Ultralytics val summary.
 * Detect:  all <images> <instances> P R mAP50 mAP50-95
 * Seg:     all <images> <instances> Box(P R mAP50 mAP50-95) Mask(P R mAP50 mAP50-95)
 *
 * Logs are trimmed before parse, so the line often starts with "all" (no leading spaces).
 * For YOLO_SEG the UI metrics are MASK P/R/mAP (what you train masks for).
 */
function parseYoloAllMetricsLine(logLine) {
  const text = String(logLine || '');
  const match = text.match(/\ball\s+(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) return null;

  const nums = String(match[3])
    .trim()
    .split(/\s+/)
    .map((token) => parseFloat(token))
    .filter((n) => Number.isFinite(n));

  if (nums.length >= 8) {
    return {
      images: parseInt(match[1], 10),
      instances: parseInt(match[2], 10),
      boxPrecision: nums[0],
      boxRecall: nums[1],
      boxMAP50: nums[2],
      boxMAP50_95: nums[3],
      precision: nums[4],
      recall: nums[5],
      mAP50: nums[6],
      mAP50_95: nums[7],
      source: 'segment',
    };
  }

  if (nums.length >= 4) {
    return {
      images: parseInt(match[1], 10),
      instances: parseInt(match[2], 10),
      precision: nums[0],
      recall: nums[1],
      mAP50: nums[2],
      mAP50_95: nums[3],
      source: 'detect',
    };
  }

  return null;
}

function resultsCsvPath(storagePath) {
  if (!storagePath) return null;
  return path.join(storagePath, 'runs', 'train', 'results.csv');
}

function colIndex(headers, name) {
  return headers.indexOf(name);
}

function cell(cols, headers, name) {
  const i = colIndex(headers, name);
  if (i < 0 || i >= cols.length) return NaN;
  return parseFloat(cols[i]);
}

/**
 * Read Ultralytics results.csv and pick the best val epoch.
 * Seg: maximize metrics/mAP50(M). Detect: metrics/mAP50(B) or metrics/mAP50.
 */
function readBestMetricsFromResultsCsv(csvPath) {
  if (!csvPath || !fs.existsSync(csvPath)) return null;

  let text;
  try {
    text = fs.readFileSync(csvPath, 'utf8');
  } catch {
    return null;
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map((h) => h.trim());
  const hasMask = colIndex(headers, 'metrics/mAP50(M)') >= 0;

  let best = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const score = hasMask
      ? cell(cols, headers, 'metrics/mAP50(M)')
      : pickFinite(
          cell(cols, headers, 'metrics/mAP50(B)'),
          cell(cols, headers, 'metrics/mAP50')
        );
    if (!isFiniteNumber(score)) continue;
    if (!best || score > best.score) {
      best = { score, cols };
    }
  }

  if (!best) return null;

  const { cols } = best;
  const epoch = cell(cols, headers, 'epoch');

  if (hasMask) {
    return {
      bestEpoch: isFiniteNumber(epoch) ? epoch : undefined,
      precision: cell(cols, headers, 'metrics/precision(M)'),
      recall: cell(cols, headers, 'metrics/recall(M)'),
      mAP50: cell(cols, headers, 'metrics/mAP50(M)'),
      mAP50_95: cell(cols, headers, 'metrics/mAP50-95(M)'),
      source: 'results.csv-mask',
    };
  }

  return {
    bestEpoch: isFiniteNumber(epoch) ? epoch : undefined,
    precision: pickFinite(
      cell(cols, headers, 'metrics/precision(B)'),
      cell(cols, headers, 'metrics/precision')
    ),
    recall: pickFinite(
      cell(cols, headers, 'metrics/recall(B)'),
      cell(cols, headers, 'metrics/recall')
    ),
    mAP50: pickFinite(
      cell(cols, headers, 'metrics/mAP50(B)'),
      cell(cols, headers, 'metrics/mAP50')
    ),
    mAP50_95: pickFinite(
      cell(cols, headers, 'metrics/mAP50-95(B)'),
      cell(cols, headers, 'metrics/mAP50-95')
    ),
    source: 'results.csv-box',
  };
}

/**
 * Merge live-parsed job metrics with results.csv. Never invent 0.72 placeholders.
 */
function buildFinalMetrics(jobMetrics = {}, progress = {}, csvMetrics = null) {
  return {
    bestEpoch: pickFinite(jobMetrics.bestEpoch, csvMetrics?.bestEpoch, progress.currentEpoch),
    bestLoss: pickFinite(jobMetrics.bestLoss, jobMetrics.currentLoss),
    precision: pickFinite(jobMetrics.precision, csvMetrics?.precision),
    recall: pickFinite(jobMetrics.recall, csvMetrics?.recall),
    mAP50: pickFinite(jobMetrics.mAP50, csvMetrics?.mAP50),
    mAP50_95: pickFinite(jobMetrics.mAP50_95, csvMetrics?.mAP50_95),
    perLabelStats: Array.isArray(jobMetrics.perLabelStats) ? jobMetrics.perLabelStats : [],
  };
}

function formatMetric(value, digits = 4) {
  return isFiniteNumber(value) ? value.toFixed(digits) : 'n/a';
}

function formatModelNameWithMap(modelType, modelVersion, mAP50) {
  const base = `${modelType || 'Model'} - ${modelVersion || 'unknown'}`;
  if (!isFiniteNumber(mAP50)) return base;
  return `${base} (mAP: ${(mAP50 * 100).toFixed(0)}%)`;
}

/**
 * If Mongo still has dummy/zero metrics, overlay results.csv (and optionally persist).
 */
function hydrateMetricsFromDisk(model) {
  const current = model?.metrics || {};
  if (!needsMetricsRepair(current)) return { metrics: current, repaired: false };
  const fromCsv = readBestMetricsFromResultsCsv(resultsCsvPath(model?.storagePath));
  if (!fromCsv || !isFiniteNumber(fromCsv.mAP50)) {
    return { metrics: current, repaired: false };
  }
  return {
    metrics: {
      ...current,
      precision: fromCsv.precision,
      recall: fromCsv.recall,
      mAP50: fromCsv.mAP50,
      mAP50_95: fromCsv.mAP50_95,
      bestEpoch: pickFinite(fromCsv.bestEpoch, current.bestEpoch),
    },
    repaired: true,
  };
}

/**
 * Overlay results.csv onto dummy/zero Mongo metrics and persist so the UI stays fixed.
 */
async function hydrateAndPersistModelMetrics(Model, model) {
  const { metrics, repaired } = hydrateMetricsFromDisk(model);
  if (repaired && model && model._id && Model) {
    try {
      await Model.updateOne(
        { _id: model._id },
        {
          $set: {
            metrics,
            'insights.bestmAP': metrics.mAP50,
            'insights.bestAccuracy': metrics.precision,
          },
        }
      );
    } catch (err) {
      console.warn('[metrics] Failed to persist repaired metrics:', err.message);
    }
  }
  return metrics;
}

module.exports = {
  isFiniteNumber,
  pickFinite,
  needsMetricsRepair,
  parseYoloAllMetricsLine,
  resultsCsvPath,
  readBestMetricsFromResultsCsv,
  buildFinalMetrics,
  formatMetric,
  formatModelNameWithMap,
  hydrateMetricsFromDisk,
  hydrateAndPersistModelMetrics,
};
