// offscreen.js

// This file runs in the Offscreen Document's context.
// Dynamic imports are allowed here.
// Use the local ESM build shipped in the extension so module resolution
// works within the offscreen document environment.

import * as ort from 'onnxruntime-web';
import { encodeText } from './tokenizer.js';
import {createWorker} from 'tesseract.js';

let tesseractWorker = null;
let tesseractWorkerIdleTimer = null;
const OCR_LANGUAGE = 'eng';
const timeout = 20000;

ort.env.wasm = ort.env.wasm || {};
ort.env.wasm.logLevel = 'verbose';
ort.env.wasm.debug = true;
ort.env.wasm.wasmPaths = {
  'ort-wasm-simd-threaded.wasm': chrome.runtime.getURL('onnx-wasm/ort-wasm-simd-threaded.wasm'),
};
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

let sessionPromise = null;
let inferenceQueue = Promise.resolve();

function normalizeText(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function scheduleTesseractWorkerTermination() {
  if (tesseractWorkerIdleTimer) {
    clearTimeout(tesseractWorkerIdleTimer);
  }

  tesseractWorkerIdleTimer = setTimeout(async () => {
    if (!tesseractWorker) return;

    try {
      await tesseractWorker.terminate();
      console.log('[P.A.T.C.H] Tesseract worker terminated after inactivity');
    } catch (err) {
      console.error('[P.A.T.C.H] failed to terminate Tesseract worker:', err);
    } finally {
      tesseractWorker = null;
      tesseractWorkerIdleTimer = null;
    }
  }, timeout);
}

async function ensureTesseractWorker() {
  if (!tesseractWorker) {
    try {
      tesseractWorker = await createWorker(OCR_LANGUAGE, 1, {
        workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('tesseract/'),
        langPath: chrome.runtime.getURL('tesseract/lang/'),
        workerBlobURL: false,
        logger: (m) => console.debug('[P.A.T.C.H] Tesseract:', m.status, m.progress),
      });
      console.log('[P.A.T.C.H] Tesseract worker created in offscreen document');
    } catch (err) {
      console.error('[P.A.T.C.H] Failed to create Tesseract worker:', err);
      throw err;
    }
  }

  scheduleTesseractWorkerTermination();
  return tesseractWorker;
}

async function imageBlobFromDataURL(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function recognizeImageWithWorker(imageBlob) {
  const worker = await ensureTesseractWorker();
  const result = await worker.recognize(imageBlob);
  scheduleTesseractWorkerTermination();
  return normalizeText(result?.data?.text || '');
}

async function ocrInstagramImages(imageDataUrls = []) {
  const extractedTexts = [];

  for (const dataUrl of imageDataUrls) {
    try {
      const blob = await imageBlobFromDataURL(dataUrl);
      const text = await recognizeImageWithWorker(blob);
      if (text) extractedTexts.push(text);
    } catch (err) {
      console.warn('[P.A.T.C.H] OCR failed for image', err);
    }
  }

  return [...new Set(extractedTexts)].join('\n');
}

async function initSession() {
  if (sessionPromise) return sessionPromise;

  if (!ort || !ort.InferenceSession || !ort.InferenceSession.create) {
    throw new Error('ONNX Runtime not fully initialized. ort.InferenceSession.create is undefined');
  }

  ort.env.wasm.wasmPaths = {
    'ort-wasm-simd-threaded.wasm': chrome.runtime.getURL('onnx-wasm/ort-wasm-simd-threaded.wasm'),
  };

  const modelUrl = chrome.runtime.getURL('models/mental-health-bert-finetuned-onnx/model_optimized.onnx');
  sessionPromise = ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
  });

  sessionPromise
    .then(() => console.log('[P.A.T.C.H] ONNX session ready (mental-health-bert) in offscreen document'))
    .catch(err => {
      console.error('[P.A.T.C.H] ONNX session init failed in offscreen document:', err);
      sessionPromise = null;
    });

  return sessionPromise;
}

function resetSession(reason) {
  console.warn('[P.A.T.C.H] Resetting ONNX session:', reason);
  sessionPromise = null;
}

function queueInference(task) {
  const queuedTask = inferenceQueue.then(task, task);
  inferenceQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

function isRetryableSessionError(err) {
  const message = err?.message || '';
  return message.includes('Session mismatch') || message.includes('Session already started');
}

const LABELS = ['Anxiety', 'Depression', 'Normal', 'Suicidal'];

async function handleAnalyzeText(text) {
  return queueInference(async () => {
    const maxLen = 128;
    const { inputIds, attentionMask, tokenTypeIds } = await encodeText(text, maxLen);

    const inputs = {
      input_ids: new ort.Tensor('int64', inputIds, [1, maxLen]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, maxLen]),
      token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, maxLen])
    };

    let outputMap;

    try {
      const session = await initSession();
      console.log(`[P.A.T.C.H] Inference input: ${text}`);
      outputMap = await session.run(inputs);
      console.log(`[P.A.T.C.H] Inference output:`, outputMap);
    } catch (err) {
      if (!isRetryableSessionError(err)) {
        throw err;
      }

      console.warn('[P.A.T.C.H] Retrying inference after session state error:', err.message);
      resetSession(err.message);

      const session = await initSession();
      outputMap = await session.run(inputs);
    }

    const logitsTensor = outputMap.logits || Object.values(outputMap)[0];
    const logits = Array.from(logitsTensor.data);
    const probs = softmax(logits);

    const suicidalProb = probs[3];
    const distressProb = probs[0] + probs[1];
    const normalProb = probs[2];

    const riskLevel = toRiskLevel(suicidalProb, distressProb, normalProb);

    const topIdx = argMax(probs);
    const topLabel = LABELS[topIdx];

    return {
      riskLevel,
      suicidalProb,
      distressProb,
      normalProb,
      probs,
      logits,
      topLabel,
    };
  });
}

function softmax(arr) {
  const max = Math.max(...arr);
  const exps = arr.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

function argMax(arr) {
  return arr.reduce((bestIdx, x, i, a) => (x > a[bestIdx] ? i : bestIdx), 0);
}

function toRiskLevel(suicidalProb, distressProb, normalProb) {
  if (suicidalProb >= 0.6) return 'High';
  if (suicidalProb >= 0.35 || distressProb >= 0.6) return 'Medium';
  return 'Low';
}

// Single message listener for all offscreen message types
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE_TEXT_OFFSCREEN') {
    handleAnalyzeText(request.text)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[P.A.T.C.H] Offscreen Inference error:', err);
        sendResponse({ error: err.message || 'Offscreen Inference failed' });
      });
    return true;
  }

  if (request.type === 'OCR_INSTAGRAM_IMAGES') {
    (async () => {
      const ocrText = normalizeText(await ocrInstagramImages(request.imageDataUrls));

      if (!ocrText) {
        return { text: '', riskLevel: 'Low', probs: [0, 0, 1, 0], topLabel: 'Normal' };
      }

      const inferenceResult = await handleAnalyzeText(ocrText);
      return { text: ocrText, ...inferenceResult };
    })()
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[P.A.T.C.H] OCR Instagram Images error:', err);
        sendResponse({ error: err.message || 'OCR Instagram Images failed' });
      });
    return true;
  }
});

// Init inference session on startup
await initSession();

