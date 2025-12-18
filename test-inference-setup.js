// Quick test to verify inference setup
console.log('🧪 Testing Inference Component Setup...\n');

// Test 1: Queue exports
try {
  const queues = require('./queue/index.js');
  console.log('✅ Test 1: Queue module loaded');
  console.log('   Exports:', Object.keys(queues).join(', '));
  console.log('   Inference queue exists:', !!queues.inferenceQueue);
} catch (e) {
  console.error('❌ Test 1 FAILED:', e.message);
  process.exit(1);
}

// Test 2: InferenceJob model
try {
  const InferenceJob = require('./models/InferenceJob');
  console.log('✅ Test 2: InferenceJob model loaded');
  console.log('   Model name:', InferenceJob.modelName);
} catch (e) {
  console.error('❌ Test 2 FAILED:', e.message);
  process.exit(1);
}

// Test 3: Storage adapter methods
try {
  const storage = require('./services/storageAdapter.js');
  const testPath = storage.buildResultsPath('test', 'project', 'model123', 'inf456');
  console.log('✅ Test 3: Storage adapter methods work');
  console.log('   buildResultsPath:', testPath);
  console.log('   buildAnnotatedImagesPath:', storage.buildAnnotatedImagesPath(testPath));
  console.log('   buildMetadataPath:', storage.buildMetadataPath(testPath));
} catch (e) {
  console.error('❌ Test 3 FAILED:', e.message);
  process.exit(1);
}

// Test 4: Controller functions exist
try {
  const controller = require('./controllers/inferenceController.js');
  const functions = Object.keys(controller);
  console.log('✅ Test 4: Inference controller loaded');
  console.log('   Functions:', functions.join(', '));
} catch (e) {
  console.error('❌ Test 4 FAILED:', e.message);
  process.exit(1);
}

// Test 5: Routes file exists
try {
  const routes = require('./routes/inference.js');
  console.log('✅ Test 5: Inference routes loaded');
} catch (e) {
  console.error('❌ Test 5 FAILED:', e.message);
  process.exit(1);
}

// Test 6: Python script exists
const fs = require('fs');
const path = require('path');
const pythonScript = path.join(__dirname, 'inference-scripts', 'run_inference.py');
if (fs.existsSync(pythonScript)) {
  console.log('✅ Test 6: Python inference script exists');
  console.log('   Path:', pythonScript);
} else {
  console.error('❌ Test 6 FAILED: Python script not found at', pythonScript);
  process.exit(1);
}

console.log('\n✅ All tests passed! Inference component setup is correct.');
console.log('\n📝 Next steps:');
console.log('   1. Start inference worker: npm run start:inference-worker');
console.log('   2. Test API endpoints with a real inference job');





