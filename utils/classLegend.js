/**
 * Overlay color index = YOLO class id (same as run_inference.py CLASS_MASK_COLORS_BGR).
 * Stamp classId onto byClass rows using the model's ordered classNames.
 */
function classNamesFromMetadata(metadata) {
  const raw = metadata?.classNames || metadata?.corrosionStats?.classNames;
  if (!Array.isArray(raw)) return [];
  return raw.map((n) => String(n)).filter(Boolean);
}

function stampClassIds(rows, classNames) {
  if (!Array.isArray(rows)) return [];
  const lower = (classNames || []).map((n) => String(n).toLowerCase());
  return rows.map((row) => {
    const next = { ...row };
    if (typeof next.classId === 'number' && Number.isFinite(next.classId)) return next;
    const name = String(next.class || next.className || '').toLowerCase();
    const i = lower.indexOf(name);
    if (i >= 0) next.classId = i;
    return next;
  });
}

module.exports = {
  classNamesFromMetadata,
  stampClassIds,
};
