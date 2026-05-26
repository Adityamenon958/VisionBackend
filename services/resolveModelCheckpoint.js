const path = require('path');
const fs = require('fs');

/**
 * Resolve the on-disk weights file for inference / class-name extraction.
 * YOLO (Ultralytics) requires a `.pt` path; RF-DETR uses `.pth`.
 * Legacy models may register `best.pth` while real YOLO weights live as `best.pt`.
 *
 * @param {object} model - Model doc fields: modelType, bestCheckpointPath, storagePath
 * @returns {string|null}
 */
function resolveModelCheckpointPath(model) {
  if (!model) return null;

  if (model.modelType === 'RF_DETR') {
    const pth =
      model.bestCheckpointPath ||
      (model.storagePath ? path.join(model.storagePath, 'best.pth') : null);
    return pth && fs.existsSync(pth) ? pth : pth;
  }

  // YOLO / YOLO_SEG / other Ultralytics paths — never pass `.pth` to YOLO()
  const candidates = [];

  if (model.storagePath) {
    const root = path.resolve(model.storagePath);
    candidates.push(
      path.join(root, 'best.pt'),
      path.join(root, 'runs', 'train', 'weights', 'best.pt'),
    );
  }

  if (model.bestCheckpointPath) {
    if (/\.pt$/i.test(model.bestCheckpointPath)) {
      candidates.push(model.bestCheckpointPath);
    } else if (/\.pth$/i.test(model.bestCheckpointPath)) {
      candidates.push(model.bestCheckpointPath.replace(/\.pth$/i, '.pt'));
    } else {
      candidates.push(model.bestCheckpointPath);
    }
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

module.exports = { resolveModelCheckpointPath };
