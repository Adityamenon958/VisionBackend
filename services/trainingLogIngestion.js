/**
 * Training stdout/stderr log normalization (YOLO, RF-DETR, PyTorch Lightning, etc.).
 * Splits on \n and \r, strips ANSI/control codes, caps line length before Mongo storage.
 */

const MAX_LOG_LENGTH = 2000;
const TRUNCATED_SUFFIX = '... [truncated]';

/** CSI + OSC + other common terminal control sequences */
const ANSI_ESCAPE_PATTERN =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][AB012]/g;

/** Split on newlines and carriage returns (tqdm/progress-bar redraws) */
const LINE_TERMINATOR_PATTERN = /[\r\n]+/;

/**
 * Strip ANSI escapes, carriage returns, and stray control bytes.
 * @param {string} raw
 * @returns {string}
 */
function stripTerminalControlSequences(raw) {
  return String(raw)
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r/g, '')
    .replace(/\x1b/g, '')
    .replace(/\uFFFD/g, '');
}

/**
 * Normalize a single log fragment for storage and metric parsing.
 * @param {string} raw
 * @returns {string|null} null if empty after normalization
 */
function normalizeTrainingLogLine(raw) {
  let line = stripTerminalControlSequences(raw).trim();
  if (!line) {
    return null;
  }

  if (line.length > MAX_LOG_LENGTH) {
    const keep = MAX_LOG_LENGTH - TRUNCATED_SUFFIX.length;
    line = line.slice(0, Math.max(0, keep)) + TRUNCATED_SUFFIX;
  }

  return line;
}

/**
 * @typedef {{ buffer: string }} StreamBufferState
 */

/**
 * Append chunk, emit normalized lines for each complete \n or \r terminated segment.
 * @param {StreamBufferState} state
 * @param {string} chunk
 * @param {(line: string) => void} onLine
 */
function ingestTrainingStreamChunk(state, chunk, onLine) {
  state.buffer += String(chunk);
  const parts = state.buffer.split(LINE_TERMINATOR_PATTERN);
  state.buffer = parts.pop() ?? '';

  for (const part of parts) {
    const line = normalizeTrainingLogLine(part);
    if (line) {
      onLine(line);
    }
  }
}

/**
 * Flush trailing buffer when the Python process exits.
 * @param {StreamBufferState} state
 * @param {(line: string) => void} onLine
 */
function flushTrainingStreamBuffer(state, onLine) {
  if (!state.buffer) {
    return;
  }
  const line = normalizeTrainingLogLine(state.buffer);
  state.buffer = '';
  if (line) {
    onLine(line);
  }
}

/**
 * Append normalized line to in-memory log array with max line count cap.
 * @param {string[]} logs
 * @param {string} rawOrNormalized
 * @param {{ value: number }} persistedLogIndexRef
 * @param {number} maxStoredLines
 * @param {{ alreadyNormalized?: boolean }} [options]
 */
function appendTrainingLog(
  logs,
  rawOrNormalized,
  persistedLogIndexRef,
  maxStoredLines,
  options = {}
) {
  const line = options.alreadyNormalized
    ? rawOrNormalized
    : normalizeTrainingLogLine(rawOrNormalized);
  if (!line) {
    return;
  }

  logs.push(line);
  while (logs.length > maxStoredLines) {
    logs.shift();
    if (persistedLogIndexRef.value > 0) {
      persistedLogIndexRef.value -= 1;
    }
  }
}

/**
 * Append text that may contain multiple lines (worker-formatted messages).
 */
function appendTrainingLogText(logs, text, persistedLogIndexRef, maxStoredLines) {
  const parts = String(text).split(LINE_TERMINATOR_PATTERN);
  for (const part of parts) {
    appendTrainingLog(logs, part, persistedLogIndexRef, maxStoredLines);
  }
}

module.exports = {
  MAX_LOG_LENGTH,
  TRUNCATED_SUFFIX,
  stripTerminalControlSequences,
  normalizeTrainingLogLine,
  ingestTrainingStreamChunk,
  flushTrainingStreamBuffer,
  appendTrainingLog,
  appendTrainingLogText,
  LINE_TERMINATOR_PATTERN
};
