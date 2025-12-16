const mongoose = require('mongoose');
require('dotenv').config();

async function checkTraining() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const TrainingJob = require('./models/TrainingJob');
    const job = await TrainingJob.findOne().sort({ createdAt: -1 }).lean();
    
    if (!job) {
      console.log('No training jobs found');
      await mongoose.disconnect();
      return;
    }
    
    console.log('\n=== TRAINING STATUS ===');
    console.log('Job ID:', job.jobId);
    console.log('Status:', job.status.toUpperCase());
    console.log('Model:', job.modelType, job.modelSize || '');
    console.log('\n--- Progress ---');
    console.log('Epoch:', job.progress.currentEpoch + '/' + job.progress.totalEpochs);
    console.log('Progress:', job.progress.progressPercent + '%');
    
    console.log('\n--- Current Metrics ---');
    if (job.metrics.currentLoss) {
      console.log('Loss:', job.metrics.currentLoss.toFixed(4));
    }
    if (job.metrics.mAP50 !== undefined && job.metrics.mAP50 !== null) {
      console.log('mAP50:', job.metrics.mAP50.toFixed(4));
    }
    if (job.metrics.precision !== undefined && job.metrics.precision !== null) {
      console.log('Precision:', job.metrics.precision.toFixed(4));
    }
    if (job.metrics.recall !== undefined && job.metrics.recall !== null) {
      console.log('Recall:', job.metrics.recall.toFixed(4));
    }
    
    if (job.metrics.bestLoss) {
      console.log('\n--- Best So Far ---');
      console.log('Best Loss:', job.metrics.bestLoss.toFixed(4), '(Epoch', job.metrics.bestEpoch + ')');
    }
    
    if (job.startedAt) {
      const elapsed = Math.floor((Date.now() - new Date(job.startedAt)) / 1000 / 60);
      console.log('\nTime elapsed:', elapsed, 'minutes');
    }
    
    if (job.logs && job.logs.length > 0) {
      const recentLogs = job.logs.slice(-2);
      console.log('\n--- Recent Logs ---');
      recentLogs.forEach(line => {
        const clean = line.replace(/\x1B\[[0-9;]*[mK]/g, '').trim();
        if (clean && clean.length < 150) console.log(clean);
      });
    }
    
    console.log('\n' + '='.repeat(50));
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkTraining();
