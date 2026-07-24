// Web Worker: runs Transformers.js image classification off the main thread.
// Primary model is a food-101 fine-tune with ONNX weights (verified on the HF
// transformers.js model list); falls back to generic ViT (ImageNet covers many foods).

const MODELS = [
  'onnx-community/swin-finetuned-food101-ONNX',
  'Xenova/vit-base-patch16-224',
];

let pipelinePromise = null;
let activeModel = null;

async function getPipeline() {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers');
    let lastErr;
    for (const model of MODELS) {
      try {
        const pipe = await pipeline('image-classification', model, {
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) {
              self.postMessage({
                type: 'progress',
                file: p.file,
                pct: Math.round((p.loaded / p.total) * 100),
                model,
              });
            }
          },
        });
        activeModel = model;
        self.postMessage({ type: 'ready', model });
        return pipe;
      } catch (err) {
        lastErr = err;
        self.postMessage({ type: 'model-fallback', model, error: String(err) });
      }
    }
    throw lastErr;
  })();
  pipelinePromise.catch(() => { pipelinePromise = null; });
  return pipelinePromise;
}

self.onmessage = async (e) => {
  const { id, type, blob } = e.data;
  if (type === 'warmup') {
    try { await getPipeline(); } catch { /* reported below on classify */ }
    return;
  }
  if (type !== 'classify') return;
  try {
    const pipe = await getPipeline();
    const url = URL.createObjectURL(blob);
    try {
      const results = await pipe(url, { top_k: 3 });
      self.postMessage({ id, type: 'result', results, model: activeModel });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err) });
  }
};
