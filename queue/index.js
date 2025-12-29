const Bull = require('bull');
const Redis = require('ioredis');

/**
 * Redis URL
 * - Local: redis://127.0.0.1:6379
 * - Azure: rediss://:<PRIMARY_KEY>@<HOSTNAME>:6380
 */
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const isAzureRedis = redisUrl.startsWith('rediss://');

/**
 * Create Redis client (Bull-safe + Azure-safe)
 */
function createRedisClient() {
  return new Redis(redisUrl, {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,

    ...(isAzureRedis && {
      tls: {
        rejectUnauthorized: true,
      },
    }),
  });
}

/* ===========================
   Bull Queues
=========================== */

const preprocessingQueue = new Bull('preprocess-dataset', {
  createClient: () => createRedisClient(),
});

const trainingQueue = new Bull('train-model', {
  createClient: () => createRedisClient(),
});

const inferenceQueue = new Bull('inference', {
  createClient: () => createRedisClient(),
});

/* ===========================
   Optional Redis Monitor
   (Safe for Azure & Local)
=========================== */

const monitorRedis = createRedisClient();

monitorRedis.on('connect', () => {
  console.log('✅ Redis (monitor) connected');
});

monitorRedis.on('error', (err) => {
  console.error('❌ Redis (monitor) connection error:', err.message);
});

/* ===========================
   Queue Event Logs
=========================== */

// Preprocessing
preprocessingQueue.on('completed', (job) => {
  console.log(`✅ Preprocessing job ${job.id} completed`);
});

preprocessingQueue.on('failed', (job, err) => {
  console.error(`❌ Preprocessing job ${job?.id} failed:`, err?.message);
});

preprocessingQueue.on('stalled', (job) => {
  console.warn(`⚠️ Preprocessing job ${job?.id} stalled`);
});

// Training
trainingQueue.on('completed', (job) => {
  console.log(`✅ Training job ${job.id} completed`);
});

trainingQueue.on('failed', (job, err) => {
  console.error(`❌ Training job ${job?.id} failed:`, err?.message);
});

trainingQueue.on('stalled', (job) => {
  console.warn(`⚠️ Training job ${job?.id} stalled`);
});

// Inference
inferenceQueue.on('completed', (job) => {
  console.log(`✅ Inference job ${job.id} completed`);
});

inferenceQueue.on('failed', (job, err) => {
  console.error(`❌ Inference job ${job?.id} failed:`, err?.message);
});

inferenceQueue.on('stalled', (job) => {
  console.warn(`⚠️ Inference job ${job?.id} stalled`);
});

/* ===========================
   Exports
=========================== */

module.exports = {
  preprocessingQueue,
  trainingQueue,
  inferenceQueue,
};
