const axios = require('axios');
const DemoExtinguisherRead = require('../models/DemoExtinguisherRead');
const { extractCodeFromFrame } = require('../services/demoExtinguisherOcrService');
const {
  createSession,
  getSession,
  stopSession,
  registerReadCandidate
} = require('../services/demoExtinguisherSessionService');

const IP_CAMERA_TIMEOUT_MS = 4000;

function normalizeIpCameraBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('Missing baseUrl');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch (error) {
    throw new Error('Invalid baseUrl format');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }

  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
  parsedUrl.search = '';
  parsedUrl.hash = '';

  return parsedUrl.toString().replace(/\/+$/, '');
}

async function getIpCameraSnapshot(req, res) {
  try {
    const { baseUrl } = req.body || {};
    const normalizedBaseUrl = normalizeIpCameraBaseUrl(baseUrl);
    const snapshotUrl = `${normalizedBaseUrl}/shot.jpg`;

    const response = await axios.get(snapshotUrl, {
      responseType: 'arraybuffer',
      timeout: IP_CAMERA_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 300
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const imageBase64 = `data:${contentType};base64,${Buffer.from(response.data).toString('base64')}`;

    return res.status(200).json({
      imageBase64,
      snapshotUrl,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    if (error.message === 'Missing baseUrl' || error.message === 'Invalid baseUrl format' || error.message === 'baseUrl must use http or https') {
      return res.status(400).json({
        error: 'Invalid IP camera baseUrl',
        message: error.message
      });
    }

    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: 'IP camera request timed out',
        message: `Unable to fetch snapshot within ${IP_CAMERA_TIMEOUT_MS}ms`
      });
    }

    if (error.response) {
      return res.status(502).json({
        error: 'IP camera returned an invalid response',
        message: `Snapshot request failed with status ${error.response.status}`
      });
    }

    return res.status(502).json({
      error: 'Unable to reach IP camera',
      message: error.message || 'Unknown upstream error'
    });
  }
}

async function startDemoSession(req, res) {
  try {
    const { cameraId } = req.body || {};
    const startedBy = req.user && req.user.email ? req.user.email : 'unknown';
    const session = createSession({ cameraId, startedBy });

    return res.status(201).json({
      message: 'Demo extinguisher session started',
      session: {
        sessionId: session.sessionId,
        cameraId: session.cameraId,
        startedBy: session.startedBy,
        startedAt: new Date(session.startedAt).toISOString()
      }
    });
  } catch (error) {
    console.error('startDemoSession error:', error);
    return res.status(500).json({ error: 'Failed to start demo session' });
  }
}

async function ingestDemoFrame(req, res) {
  try {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired', sessionId });
    }

    const { imageBase64, ocrText, confidence, confidenceThreshold, extractFields, frameId, snapshotPath } = req.body || {};
    const ocrResult = await extractCodeFromFrame({
      imageBase64,
      ocrText,
      confidence,
      confidenceThreshold,
      extractFields
    });
    if (!ocrResult.accepted) {
      return res.status(200).json({
        accepted: false,
        reason: ocrResult.reason,
        code: ocrResult.code,
        confidence: ocrResult.confidence,
        sourceType: ocrResult.sourceType || null,
        parsedCandidate: ocrResult.parsedCandidate || '',
        parseReason: ocrResult.parseReason || null,
        ocrRawText: ocrResult.ocrRawText || '',
        minConfidenceUsed: ocrResult.minConfidenceUsed,
        requestedFields: ocrResult.requestedFields || [],
        requestedFieldConfigs: ocrResult.requestedFieldConfigs || [],
        extractedFields: ocrResult.extractedFields || {},
        missingFields: ocrResult.missingFields || [],
        optionalMissingFields: ocrResult.optionalMissingFields || [],
        allRequestedFound: ocrResult.allRequestedFound !== false,
        fieldParseDebug: ocrResult.fieldParseDebug || {}
      });
    }

    const hasStrictRequestedFields = Array.isArray(ocrResult.requestedFields) && ocrResult.requestedFields.length > 0;
    if (hasStrictRequestedFields && !ocrResult.allRequestedFound) {
      return res.status(200).json({
        accepted: false,
        reason: 'Not all requested parameters were found',
        code: ocrResult.code,
        confidence: ocrResult.confidence,
        sourceType: ocrResult.sourceType,
        parsedCandidate: ocrResult.parsedCandidate || '',
        parseReason: ocrResult.parseReason || null,
        minConfidenceUsed: ocrResult.minConfidenceUsed,
        requestedFields: ocrResult.requestedFields || [],
        requestedFieldConfigs: ocrResult.requestedFieldConfigs || [],
        extractedFields: ocrResult.extractedFields || {},
        missingFields: ocrResult.missingFields || [],
        optionalMissingFields: ocrResult.optionalMissingFields || [],
        allRequestedFound: false,
        fieldParseDebug: ocrResult.fieldParseDebug || {},
        ocrRawText: ocrResult.ocrRawText || ''
      });
    }

    const codeToLog = (ocrResult.extractedFields && ocrResult.extractedFields['MODEL NO'])
      ? ocrResult.extractedFields['MODEL NO']
      : ocrResult.code;

    const dedupResult = registerReadCandidate(sessionId, codeToLog);
    if (!dedupResult.accepted) {
      if (dedupResult.duplicateSuppressed) {
        await DemoExtinguisherRead.create({
          sessionId,
          code: codeToLog,
          confidence: ocrResult.confidence,
          sourceType: ocrResult.sourceType,
          duplicateSuppressed: true,
          capturedAt: new Date(),
          meta: {
            frameId,
            snapshotPath,
            ocrRawText: ocrResult.ocrRawText,
            notes: dedupResult.reason,
            extractedFields: ocrResult.extractedFields || {},
            requestedFields: ocrResult.requestedFields || [],
            requestedFieldConfigs: ocrResult.requestedFieldConfigs || []
          }
        });
      }

      return res.status(200).json({
        accepted: false,
        reason: dedupResult.reason,
        code: codeToLog,
        confidence: ocrResult.confidence,
        duplicateSuppressed: dedupResult.duplicateSuppressed,
        sourceType: ocrResult.sourceType,
        parsedCandidate: ocrResult.parsedCandidate || '',
        parseReason: ocrResult.parseReason || null,
        minConfidenceUsed: ocrResult.minConfidenceUsed,
        requestedFields: ocrResult.requestedFields || [],
        requestedFieldConfigs: ocrResult.requestedFieldConfigs || [],
        extractedFields: ocrResult.extractedFields || {},
        missingFields: ocrResult.missingFields || [],
        optionalMissingFields: ocrResult.optionalMissingFields || [],
        allRequestedFound: ocrResult.allRequestedFound !== false,
        fieldParseDebug: ocrResult.fieldParseDebug || {}
      });
    }

    const readEntry = await DemoExtinguisherRead.create({
      sessionId,
      code: codeToLog,
      confidence: ocrResult.confidence,
      sourceType: ocrResult.sourceType,
      duplicateSuppressed: false,
      capturedAt: new Date(),
      meta: {
        frameId,
        snapshotPath,
        ocrRawText: ocrResult.ocrRawText,
        extractedFields: ocrResult.extractedFields || {},
        requestedFields: ocrResult.requestedFields || [],
        requestedFieldConfigs: ocrResult.requestedFieldConfigs || []
      }
    });

    return res.status(201).json({
      accepted: true,
      readId: readEntry._id,
      code: readEntry.code,
      confidence: readEntry.confidence,
      capturedAt: readEntry.capturedAt,
      sourceType: readEntry.sourceType,
      minConfidenceUsed: ocrResult.minConfidenceUsed,
      requestedFields: ocrResult.requestedFields || [],
      requestedFieldConfigs: ocrResult.requestedFieldConfigs || [],
      extractedFields: ocrResult.extractedFields || {},
      missingFields: ocrResult.missingFields || [],
      optionalMissingFields: ocrResult.optionalMissingFields || [],
      allRequestedFound: ocrResult.allRequestedFound !== false,
      fieldParseDebug: ocrResult.fieldParseDebug || {}
    });
  } catch (error) {
    console.error('ingestDemoFrame error:', error);
    const message = error && error.message ? error.message : 'Failed to ingest demo frame';
    return res.status(500).json({
      error: 'Failed to ingest demo frame',
      message
    });
  }
}

async function listSessionReads(req, res) {
  try {
    const { sessionId } = req.params;
    const includeSuppressed = String(req.query.includeSuppressed || 'false') === 'true';

    const query = { sessionId };
    if (!includeSuppressed) {
      query.duplicateSuppressed = false;
    }

    const reads = await DemoExtinguisherRead
      .find(query)
      .sort({ capturedAt: -1 })
      .limit(1000)
      .lean();

    return res.status(200).json({
      sessionId,
      count: reads.length,
      reads
    });
  } catch (error) {
    console.error('listSessionReads error:', error);
    return res.status(500).json({ error: 'Failed to fetch demo reads' });
  }
}

async function stopDemoSession(req, res) {
  try {
    const { sessionId } = req.params;
    const session = stopSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found', sessionId });
    }

    return res.status(200).json({
      message: 'Demo session stopped',
      sessionId,
      endedAt: new Date(session.endedAt).toISOString(),
      stats: {
        totalAccepted: session.totalAccepted,
        totalSuppressed: session.totalSuppressed
      }
    });
  } catch (error) {
    console.error('stopDemoSession error:', error);
    return res.status(500).json({ error: 'Failed to stop demo session' });
  }
}

async function clearSessionReads(req, res) {
  try {
    const { sessionId } = req.params;
    const result = await DemoExtinguisherRead.deleteMany({ sessionId });
    return res.status(200).json({
      message: 'Demo session reads cleared',
      sessionId,
      deletedCount: result.deletedCount || 0
    });
  } catch (error) {
    console.error('clearSessionReads error:', error);
    return res.status(500).json({ error: 'Failed to clear demo reads' });
  }
}

module.exports = {
  startDemoSession,
  getIpCameraSnapshot,
  ingestDemoFrame,
  listSessionReads,
  stopDemoSession,
  clearSessionReads
};
