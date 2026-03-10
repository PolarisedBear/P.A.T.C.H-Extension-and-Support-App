// src/background.js

import * as ort from '../onnx-wasm/ort.wasm.min.js';
import { encodeText } from './tokenizer.js';

let sessionPromise = null;

async function initSession() {
  if (sessionPromise) return sessionPromise;

  ort.env.wasm.wasmPaths = {
    // Provide both common filenames in case the build produced a different name
    'ort-wasm-simd-threaded.wasm': chrome.runtime.getURL('onnx-wasm/ort-wasm-simd-threaded.wasm'),
    'ort-wasm-simd-threaded.wasm.wasm': chrome.runtime.getURL('onnx-wasm/ort-wasm-simd-threaded.wasm.wasm')
  };

  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;

  const modelUrl = chrome.runtime.getURL('models/mental-health-bert-finetuned-onnx/model_optimized.onnx');
  sessionPromise = ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
  });

  sessionPromise
    .then(() => console.log('[P.A.T.C.H] ONNX session ready (mental-health-bert)'))
    .catch(err => console.error('[P.A.T.C.H] ONNX session init failed:', err));

  return sessionPromise;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE_TEXT') {
    console.debug('[P.A.T.C.H] received ANALYZE_TEXT request', (request.text||'').slice(0,120));
    handleAnalyzeText(request.text)
      .then(result => {
        console.debug('[P.A.T.C.H] sending analysis response', result && result.riskLevel);
        sendResponse(result);
      })
      .catch(err => {
        console.error('[P.A.T.C.H] Inference error:', err);
        try { sendResponse({ error: err.message || 'Inference failed' }); } catch (e) { console.error('[P.A.T.C.H] sendResponse failed', e); }
      });
    return true;
  }
});

/**
 * Labels for ourafla/mental-health-bert-finetuned:
 *   0: Anxiety
 *   1: Depression
 *   2: Normal
 *   3: Suicidal
 */
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

  // For debugging / UI, get top label
  const topIdx = argMax(probs);
  const topLabel = LABELS[topIdx];

  return {
    riskLevel,            // 'Low' | 'Medium' | 'High'
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

/**
 * Map suicidalProb + distressProb + normalProb into a triage level.
 * Tune thresholds after you see real outputs.
 */
function toRiskLevel(suicidalProb, distressProb, normalProb) {
  // Highest band: strong suicidal signal
  if (suicidalProb >= 0.6) return 'High';

  // Medium band: noticeable suicidal OR strong overall distress (A/D)
  if (suicidalProb >= 0.35 || distressProb >= 0.6) return 'Medium';

  // Everything else → Low
  return 'Low';
}

initSession();