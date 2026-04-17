const { v4: uuidv4 } = require('uuid');

const activeSessions = new Map();

const DEFAULT_DUP_WINDOW_MS = 5000;
const DEFAULT_MAX_SESSION_AGE_MS = 1000 * 60 * 60;
// Demo-friendly default: accept on first valid detection.
// Duplicate suppression is still handled by cooldown window.
const DEFAULT_VOTE_WINDOW = 1;

function getSessionConfig() {
  const duplicateWindowMs = Number(process.env.DEMO_EXT_DUP_WINDOW_MS || DEFAULT_DUP_WINDOW_MS);
  const maxSessionAgeMs = Number(process.env.DEMO_EXT_MAX_SESSION_AGE_MS || DEFAULT_MAX_SESSION_AGE_MS);
  const voteWindow = Number(process.env.DEMO_EXT_VOTE_WINDOW || DEFAULT_VOTE_WINDOW);

  return {
    duplicateWindowMs: Number.isFinite(duplicateWindowMs) ? duplicateWindowMs : DEFAULT_DUP_WINDOW_MS,
    maxSessionAgeMs: Number.isFinite(maxSessionAgeMs) ? maxSessionAgeMs : DEFAULT_MAX_SESSION_AGE_MS,
    voteWindow: Number.isFinite(voteWindow) ? Math.max(1, voteWindow) : DEFAULT_VOTE_WINDOW
  };
}

function createSession({ cameraId, startedBy }) {
  const now = Date.now();
  const sessionId = `demo-ext-${uuidv4()}`;
  activeSessions.set(sessionId, {
    sessionId,
    cameraId: cameraId || 'handheld-side-camera',
    startedBy: startedBy || 'unknown',
    startedAt: now,
    endedAt: null,
    recentAcceptedByCode: new Map(),
    recentVotesByCode: new Map(),
    totalAccepted: 0,
    totalSuppressed: 0
  });
  return activeSessions.get(sessionId);
}

function getSession(sessionId) {
  return activeSessions.get(sessionId) || null;
}

function stopSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return null;
  }
  session.endedAt = Date.now();
  return session;
}

function cleanupExpiredSessions() {
  const { maxSessionAgeMs } = getSessionConfig();
  const now = Date.now();
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.startedAt > maxSessionAgeMs) {
      activeSessions.delete(sessionId);
    }
  }
}

function registerReadCandidate(sessionId, code) {
  cleanupExpiredSessions();
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { accepted: false, reason: 'Session not found', duplicateSuppressed: false };
  }

  const { duplicateWindowMs, voteWindow } = getSessionConfig();
  const now = Date.now();

  const voteEntry = session.recentVotesByCode.get(code) || [];
  voteEntry.push(now);
  const trimmedVotes = voteEntry.slice(-voteWindow);
  session.recentVotesByCode.set(code, trimmedVotes);

  // Small voting window helps stabilize handheld camera jitter.
  if (trimmedVotes.length < voteWindow) {
    return {
      accepted: false,
      reason: `Vote window not reached (${trimmedVotes.length}/${voteWindow})`,
      duplicateSuppressed: false
    };
  }

  const lastAcceptedAt = session.recentAcceptedByCode.get(code);
  if (lastAcceptedAt && (now - lastAcceptedAt) < duplicateWindowMs) {
    session.totalSuppressed += 1;
    return {
      accepted: false,
      reason: 'Duplicate suppressed by cooldown window',
      duplicateSuppressed: true
    };
  }

  session.recentAcceptedByCode.set(code, now);
  session.totalAccepted += 1;
  return {
    accepted: true,
    reason: null,
    duplicateSuppressed: false
  };
}

module.exports = {
  createSession,
  getSession,
  stopSession,
  registerReadCandidate
};
