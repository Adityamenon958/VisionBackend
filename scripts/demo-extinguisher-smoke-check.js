/* eslint-disable no-console */
const axios = require('axios');

const BASE_URL = process.env.DEMO_SMOKE_BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.DEMO_SMOKE_TOKEN || '';

async function run() {
  if (!TOKEN) {
    throw new Error('Missing DEMO_SMOKE_TOKEN environment variable');
  }

  const client = axios.create({
    baseURL: `${BASE_URL}/api/demo/extinguisher`,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  console.log('1) Starting demo session...');
  const startRes = await client.post('/session/start', { cameraId: 'smoke-handheld' });
  const sessionId = startRes.data && startRes.data.session && startRes.data.session.sessionId;
  if (!sessionId) {
    throw new Error('Failed to get sessionId');
  }
  console.log('   sessionId:', sessionId);

  console.log('2) Ingesting frame votes...');
  await client.post(`/session/${sessionId}/frame`, { ocrText: 'SPF-6KG', confidence: 0.98, frameId: 'f1' });
  await client.post(`/session/${sessionId}/frame`, { ocrText: 'SPF-6KG', confidence: 0.98, frameId: 'f2' });
  const ingestRes = await client.post(`/session/${sessionId}/frame`, { ocrText: 'SPF-6KG', confidence: 0.98, frameId: 'f3' });
  console.log('   accepted:', ingestRes.data.accepted, 'code:', ingestRes.data.code);

  console.log('3) Reading logs...');
  const readsRes = await client.get(`/session/${sessionId}/reads`);
  console.log('   count:', readsRes.data.count);
  if (!readsRes.data.count || readsRes.data.count < 1) {
    throw new Error('Smoke check failed: no accepted reads logged');
  }

  console.log('4) Stopping session...');
  await client.post(`/session/${sessionId}/stop`);

  console.log('Smoke check passed.');
}

run().catch((error) => {
  const payload = error.response && error.response.data ? error.response.data : error.message;
  console.error('Smoke check failed:', payload);
  process.exit(1);
});
