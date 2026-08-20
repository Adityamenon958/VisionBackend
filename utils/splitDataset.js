/**
 * Central split utility for the dataset pipeline.
 *
 * Provides deterministic, seeded train/val/test splitting. Used by preprocessing,
 * post-annotation, and augmentation. No filename-based ordering; same seed + input
 * always yields the same split.
 *
 * ❗ IMPORTANT: train / val / test are always DISJOINT (no image in more than one set).
 * Older versions put test as an overlapping sample of train, which created duplicate
 * Image DB rows (e.g. 30 uploads → 33 annotate images).
 */

/** Default split configuration when not provided by DB/config */
const DEFAULT_SPLIT_CONFIG = {
  split_seed: 42,
  split_ratio_train: 0.8,
  split_ratio_val: 0.2,
  test_sample_ratio: 0.1,
};

/**
 * Create a seeded pseudo-random number generator (Mulberry32).
 * Same seed always produces the same sequence.
 * @param {number} seed - Integer seed
 * @returns {function(): number} Function that returns a value in [0, 1)
 */
function createSeededRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle array in place using Fisher-Yates with a seeded RNG.
 * Deterministic for same seed and same input order.
 * @param {Array<T>} array - Array to shuffle (shallow copy is used; original unchanged)
 * @param {number} seed - Integer seed
 * @returns {Array<T>} New array with elements shuffled
 */
function seededShuffle(array, seed) {
  const out = array.slice();
  const rng = createSeededRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Normalize and merge split config with defaults.
 * Missing or invalid values fall back to defaults.
 * @param {Object} [config] - Optional config (e.g. from Dataset or null)
 * @returns {Object} Config with split_seed, split_ratio_train, split_ratio_val, test_sample_ratio
 */
function getSplitConfig(config) {
  const c = config || {};
  return {
    split_seed: typeof c.split_seed === 'number' && Number.isInteger(c.split_seed)
      ? c.split_seed
      : DEFAULT_SPLIT_CONFIG.split_seed,
    split_ratio_train: typeof c.split_ratio_train === 'number' && c.split_ratio_train >= 0 && c.split_ratio_train <= 1
      ? c.split_ratio_train
      : DEFAULT_SPLIT_CONFIG.split_ratio_train,
    split_ratio_val: typeof c.split_ratio_val === 'number' && c.split_ratio_val >= 0 && c.split_ratio_val <= 1
      ? c.split_ratio_val
      : DEFAULT_SPLIT_CONFIG.split_ratio_val,
    test_sample_ratio: typeof c.test_sample_ratio === 'number' && c.test_sample_ratio >= 0 && c.test_sample_ratio <= 1
      ? c.test_sample_ratio
      : DEFAULT_SPLIT_CONFIG.test_sample_ratio,
  };
}

/**
 * Split an image list into disjoint train, val, and test sets using seeded shuffle.
 *
 * When train + val + test ratios sum to more than 1 (default 0.8+0.2+0.1), ratios are
 * normalized so every image appears in exactly one split.
 *
 * @param {Array<Object>} imageList - List of items (e.g. { storedName, storedPath, ... })
 * @param {Object} [config] - Optional split config from Dataset
 * @returns {{ train: Array, val: Array, test: Array }}
 */
function splitDataset(imageList, config) {
  const cfg = getSplitConfig(config);

  if (!Array.isArray(imageList) || imageList.length === 0) {
    return { train: [], val: [], test: [] };
  }

  const shuffled = seededShuffle(imageList, cfg.split_seed);
  const n = shuffled.length;

  let trainRatio = cfg.split_ratio_train;
  let valRatio = cfg.split_ratio_val;
  let testRatio = cfg.test_sample_ratio;

  // ✅ Keep partitions disjoint when defaults sum to > 1
  const sum = trainRatio + valRatio + testRatio;
  if (sum > 1 && sum > 0) {
    trainRatio /= sum;
    valRatio /= sum;
    testRatio /= sum;
  }

  let trainEnd = Math.floor(n * trainRatio);
  let valEnd = trainEnd + Math.floor(n * valRatio);

  // Guarantee every image is assigned (rounding leftovers go to test, then val, then train)
  if (valEnd > n) valEnd = n;
  if (trainEnd > valEnd) trainEnd = valEnd;

  const train = shuffled.slice(0, trainEnd);
  const val = shuffled.slice(trainEnd, valEnd);
  const test = shuffled.slice(valEnd);

  return { train, val, test };
}

module.exports = {
  DEFAULT_SPLIT_CONFIG,
  getSplitConfig,
  splitDataset,
  createSeededRng,
  seededShuffle,
};
