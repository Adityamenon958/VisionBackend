const Bull = require('bull');
const Redis = require('ioredis');

/**
 * Lazy-initialized queues (VERY IMPORTANT)
 * This prevents Redis/Bull from starting before MongoDB
 */
let queues = null;

/**
 * Detect Azure Redis
 * Azure uses HOST + PASSWORD + TLS
 */
function isAzureRedis() {
  return (
    !!process.env.REDIS_HOST &&
    !!process.env.REDIS_PASSWORD
  );
}

/**
 * Build Redis config safely
 */
function getRedisConfig() {
  if (isAzureRedis()) {
    return {
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT || 6380),
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      tls: {}, // REQUIRED for Azure Redis
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    };
  }

  // Local Redis
  return {
    host: '127.0.0.1',
    port: 6379,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  };
}

/**
 * Bull-safe Redis client factory
 * Bull REQUIRES a fresh client per role
 */
function createRedisClient() {
  return new Redis(getRedisConfig());
}

/**
 * Initialize queues ONLY when called
 */
function initQueues() {
  if (queues) return queues; // prevent double init

  console.log('⏳ Initializing Bull queues...');

  const preprocessingQueue = new Bull('preprocess-dataset', {
    createClient: createRedisClient,
  });

  const trainingQueue = new Bull('train-model', {
    createClient: createRedisClient,
  });

  const inferenceQueue = new Bull('inference', {
    createClient: createRedisClient,
  });

  /* ===========================
     Queue Event Logs
  =========================== */

  preprocessingQueue.on('completed', (job) =>
    console.log(`✅ Preprocessing job ${job.id} completed`)
  );

  preprocessingQueue.on('failed', (job, err) =>
    console.error(`❌ Preprocessing job ${job?.id} failed:`, err?.message)
  );

  trainingQueue.on('completed', (job) =>
    console.log(`✅ Training job ${job.id} completed`)
  );

  trainingQueue.on('failed', (job, err) =>
    console.error(`❌ Training job ${job?.id} failed:`, err?.message)
  );

  inferenceQueue.on('completed', (job) =>
    console.log(`✅ Inference job ${job.id} completed`)
  );

  inferenceQueue.on('failed', (job, err) =>
    console.error(`❌ Inference job ${job?.id} failed:`, err?.message)
  );

  queues = {
    preprocessingQueue,
    trainingQueue,
    inferenceQueue,
  };

  console.log('✅ Bull queues initialized');
  return queues;
}

/**
 * Helper function to get queues (auto-initializes if needed)
 * This ensures queues are initialized before use
 */
function getQueues() {
  if (!queues) {
    initQueues();
  }
  return queues;
}

module.exports = {
  initQueues,
  // ✅ Export queues as getters (lazy initialization)
  // This allows controllers to import queues directly
  get trainingQueue() {
    return getQueues().trainingQueue;
  },
  get preprocessingQueue() {
    return getQueues().preprocessingQueue;
  },
  get inferenceQueue() {
    return getQueues().inferenceQueue;
  }
};
