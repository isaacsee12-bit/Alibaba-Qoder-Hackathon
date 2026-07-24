// Main-thread facade over the classifier worker.
// Lazy-loads the model on first use; 15s timeout falls back to mockCv.

import { mockClassify } from './mockCv.js';

const TIMEOUT_MS = 15000;

let worker = null;
let nextId = 1;
const pending = new Map();
let progressHandler = null;
let modelReady = false;

function getWorker() {
  if (worker) return worker;
  worker = new Worker('modules/classifier.worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      progressHandler?.({ stage: 'download', pct: msg.pct, file: msg.file });
      return;
    }
    if (msg.type === 'ready') {
      modelReady = true;
      progressHandler?.({ stage: 'ready', model: msg.model });
      return;
    }
    if (msg.type === 'model-fallback') {
      console.warn(`Model ${msg.model} unavailable, trying next:`, msg.error);
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.type === 'result') entry.resolve(msg);
    else entry.reject(new Error(msg.error || 'Classification failed'));
  };
  worker.onerror = (err) => {
    console.warn('Classifier worker crashed:', err.message || err);
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Worker error'));
    }
    pending.clear();
    worker = null;
    modelReady = false;
  };
  return worker;
}

/** Turn "chicken_curry" / "Granny Smith" style labels into a friendly name. */
function prettyLabel(label) {
  return label.split(',')[0].replaceAll('_', ' ').trim().toLowerCase();
}

/**
 * Classify a food image blob. Resolves with
 * {name, confidence, source: 'cv'|'mock', model?, alternatives?}.
 * Never rejects — falls back to the deterministic mock on any failure.
 * @param {Blob} blob downscaled image blob
 * @param {(p: {stage, pct?, file?, model?}) => void} [onProgress]
 */
export async function classifyImage(blob, onProgress) {
  progressHandler = onProgress || null;
  try {
    const w = getWorker();
    const id = nextId++;
    const resultMsg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Classifier timed out'));
      }, TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      w.postMessage({ id, type: 'classify', blob });
    });
    const top = resultMsg.results?.[0];
    if (!top) throw new Error('Empty result');
    return {
      name: prettyLabel(top.label),
      confidence: Math.round(top.score * 100) / 100,
      source: 'cv',
      model: resultMsg.model,
      alternatives: resultMsg.results.slice(1).map((r) => prettyLabel(r.label)),
    };
  } catch (err) {
    console.warn('Falling back to mock CV:', err.message);
    progressHandler?.({ stage: 'fallback' });
    return mockClassify(blob);
  } finally {
    progressHandler = null;
  }
}

/** Kick off model download in the background (e.g. when Scan tab opens). */
export function warmupClassifier() {
  if (modelReady) return;
  try { getWorker().postMessage({ type: 'warmup' }); } catch { /* ignore */ }
}
