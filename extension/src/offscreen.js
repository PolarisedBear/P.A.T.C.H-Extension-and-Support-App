// offscreen.js

// This file runs in the Offscreen Document's context.
// Dynamic imports are allowed here.
// Use the local ESM build shipped in the extension so module resolution
// works within the offscreen document environment.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE_TEXT_OFFSCREEN') {
    handleAnalyzeText(request.text)
      .then(result => {
        sendResponse(result);
      })
      .catch(err => {
        console.error('[P.A.T.C.H] Offscreen Inference error:', err);
        sendResponse({ error: err.message || 'Offscreen Inference failed' });
      });
    return true; // Indicate that sendResponse will be called asynchronously
  }
});


import * as ort from 'onnxruntime-web';
import { encodeText } from './tokenizer.js'; // Assuming tokenizer.js is compatible or also adapted

const env = ort.env;

if (!ort.env || Object.keys(ort.env).length === 0) { 

  env.wasm = env.wasm || {};
  env.logLevel = 'verbose';
  env.debug = true;
  env.wasm.wasmPaths = {
    'ort-wasm-simd-threaded.wasm': chrome.runtime.getURL('onnx-wasm/ort-wasm-simd-threaded.wasm'),
    }
  env.wasm.numThreads = 1;
  env.wasm.simd = true;
}

let sessionPromise = null;

async function initSession() {
  if (sessionPromise) return sessionPromise;

  if (!ort || !ort.InferenceSession || !ort.InferenceSession.create) {
    throw new Error('ONNX Runtime not fully initialized. ort.InferenceSession.create is undefined');
  }

  ort.env.wasm.wasmPaths = {
    'ort-wasm-simd-threaded.wasm': chrome.runtime.getURL('onnx-wasm/ort-wasm-simd-threaded.wasm'),
  }

  const modelUrl = chrome.runtime.getURL('models/mental-health-bert-finetuned-onnx/model_optimized.onnx');
  sessionPromise = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
  });

  sessionPromise
    .then(() => console.log('[P.A.T.C.H] ONNX session ready (mental-health-bert) in offscreen document'))
    .catch(err => console.error('[P.A.T.C.H] ONNX session init failed in offscreen document:', err));

  return sessionPromise;
}

const LABELS = ['Anxiety', 'Depression', 'Normal', 'Suicidal'];

async function handleAnalyzeText(text) {
  const session = await initSession();
  const maxLen = 128;

  const { inputIds, attentionMask } = await encodeText(text, maxLen);

  const inputs = {
    input_ids: new ort.Tensor('int64', inputIds, [1, maxLen]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, maxLen]),
  };

  const outputMap = await session.run(inputs);
  const logitsTensor = outputMap.logits || Object.values(outputMap)[0];
  const logits = Array.from(logitsTensor.data);
  const probs = softmax(logits); // length 4

  const suicidalProb = probs[3];                 // Suicidal
  const distressProb = probs[0] + probs[1];      // Anxiety + Depression
  const normalProb = probs[2];                   // Normal

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

// init inference session
await initSession();

