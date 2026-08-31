const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const PYTHON_BIN =
  process.env.SAM_PYTHON_BIN ||
  process.env.AUG_PYTHON_BIN ||
  process.env.PYTHON ||
  'python';

const SCRIPT_PATH = path.join(__dirname, '..', 'inference-scripts', 'sam_click_worker.py');
const START_TIMEOUT_MS = Number(process.env.SAM_START_TIMEOUT_MS || 180000);
const REQUEST_TIMEOUT_MS = Number(process.env.SAM_CLICK_TIMEOUT_MS || 180000);

let child = null;
let ready = false;
let starting = null;
const pending = new Map();

function failAllPending(error) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}

function handleLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('{')) return;

  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (payload.event === 'ready') {
    ready = true;
    return;
  }

  if (payload.event === 'error' && !payload.id) {
    const err = new Error(payload.error || 'SAM worker failed to start');
    failAllPending(err);
    return;
  }

  const id = payload.id;
  if (!id || !pending.has(id)) return;

  const entry = pending.get(id);
  pending.delete(id);
  clearTimeout(entry.timer);

  if (payload.ok) {
    entry.resolve({
      polygon: payload.polygon,
      pointCount: payload.pointCount,
    });
    return;
  }
  entry.reject(new Error(payload.error || 'Click-to-mask failed'));
}

function attachChild(proc) {
  child = proc;
  ready = false;

  const rlOut = readline.createInterface({ input: proc.stdout });
  rlOut.on('line', handleLine);

  proc.stderr.on('data', (buf) => {
    const text = buf.toString();
    if (text.trim()) {
      console.log('[sam-click]', text.trimEnd());
    }
  });

  const onExit = (code, signal) => {
    const err = new Error(
      `SAM click-to-mask worker exited (code=${code}, signal=${signal || 'none'}). ` +
        'Check that Python has ultralytics, opencv-python, and torch installed.'
    );
    ready = false;
    child = null;
    failAllPending(err);
  };

  proc.on('exit', onExit);
  proc.on('error', (err) => {
    ready = false;
    child = null;
    failAllPending(err);
  });
}

function startWorker() {
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    try {
      const proc = spawn(PYTHON_BIN, ['-u', SCRIPT_PATH], {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      attachChild(proc);
    } catch (err) {
      starting = null;
      reject(err);
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (ready) {
        clearInterval(timer);
        starting = null;
        resolve();
        return;
      }
      if (!child) {
        clearInterval(timer);
        starting = null;
        reject(new Error('SAM click-to-mask worker failed to start'));
        return;
      }
      if (Date.now() - startedAt > START_TIMEOUT_MS) {
        clearInterval(timer);
        starting = null;
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            'SAM model is still loading (first use downloads weights). Wait a minute and try again.'
          )
        );
      }
    }, 200);
  });

  return starting;
}

async function ensureWorker() {
  if (child && ready && !child.killed) return;
  await startWorker();
}

/**
 * Segment one click on a local image file.
 * @param {{ imagePath: string, x: number, y: number }} opts
 * @returns {Promise<{ polygon: number[][], pointCount: number }>}
 */
async function segmentAtClick({ imagePath, x, y }) {
  await ensureWorker();
  if (!child || !child.stdin || !ready) {
    throw new Error('SAM click-to-mask worker is not ready');
  }

  const id = crypto.randomUUID();
  const payload = JSON.stringify({ id, image: imagePath, x, y }) + '\n';

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          'Click-to-mask timed out. The first click can take longer while the SAM model loads.'
        )
      );
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });

    const ok = child.stdin.write(payload, 'utf8');
    if (!ok) {
      child.stdin.once('drain', () => {});
    }
  });
}

module.exports = {
  segmentAtClick,
};
