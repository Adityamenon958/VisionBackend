const Bull = require('bull');
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Create Redis client with Bull-safe options.
 */
function createRedisClient() {
  return new Redis(redisUrl, {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  });
}

// Bull queue with fresh Redis clients for each role
const preprocessingQueue = new Bull('preprocess-dataset', {
  createClient: (type) => {
    return createRedisClient(); // Bull requires a new client for client/subscriber/bclient
  }
});

// Training queue for model training jobs
const trainingQueue = new Bull('train-model', {
  createClient: (type) => {
    return createRedisClient();
  }
});

// Separate monitor redis instance (not used by Bull)
const monitorRedis = new Redis(redisUrl);

monitorRedis.on('connect', () => {
  console.log('✅ Redis (monitor) connected');
});

monitorRedis.on('error', (err) => {
  console.error('❌ Redis (monitor) connection error:', err);
});

// Preprocessing queue event logs
preprocessingQueue.on('completed', (job) => {
  console.log(`✅ Preprocessing job ${job.id} completed`);
});

preprocessingQueue.on('failed', (job, err) => {
  console.error(`❌ Preprocessing job ${job.id} failed:`, err?.message || err);
});

preprocessingQueue.on('stalled', (job) => {
  console.warn(`⚠️ Preprocessing job ${job.id} stalled`);
});

// Training queue event logs
trainingQueue.on('completed', (job) => {
  console.log(`✅ Training job ${job.id} completed`);
});

trainingQueue.on('failed', (job, err) => {
  console.error(`❌ Training job ${job.id} failed:`, err?.message || err);
});

trainingQueue.on('stalled', (job) => {
  console.warn(`⚠️ Training job ${job.id} stalled`);
});

module.exports = {
  preprocessingQueue,
  trainingQueue
};
