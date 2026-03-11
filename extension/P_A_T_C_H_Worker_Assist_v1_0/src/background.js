// src/background.js

// import ort from '../onnx-wasm/ort.wasm.min.js';
import { encodeText } from './tokenizer.js';

/*
if (!ort.env || Object.keys(ort.env).length === 0) { 
  ort.env = ort.env || {};
  ort.env.wasm = ort.env.wasm || {};
  ort.env.logLevel = 'verbose';
  ort.env.wasm.wasmPaths = {
    'ort-wasm-simd-threaded.wasm': chrome.runtime.getURL('onnx-wasm/ort-wasm-simd-threaded.wasm'),
    }
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
}
*/

let creatingOffscreen = null;
//let sessionPromise = null;
async function ensureOffscreenDocument() {

  if ('getContexts' in chrome.runtime) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    })

    if (existingContexts.length > 0) {
      console.log('[P.A.T.C.H] reusing existing offscreen document');
      return;
    } else { 
      const clients = await self.clients.matchAll();
      if (clients.some((client) => client.url.includes(chrome.runtime.id))) { 
        return;
      }
    }
  }

  if (!creatingOffscreen) { 
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'Maintain persistent data for offscreen inference',
    })

    await creatingOffscreen;
    creatingOffscreen = null;
    console.log('[P.A.T.C.H] offscreen document created');
  } else {
    await creatingOffscreen;
  }
  
}

chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument();
  console.log('[P.A.T.C.H] installed, offscreen document ensured');
})

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument();
  console.log('[P.A.T.C.H] startup, offscreen document ensured');
})
/*
async function initSession() {
  if (sessionPromise) return sessionPromise;

  if (!ort) {
    throw new Error('ONNX runtime (ort) is not available in the service worker');
  }

  const modelUrl = chrome.runtime.getURL('models/mental-health-bert-finetuned-onnx/model_optimized.onnx');
  sessionPromise = ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
  });

  sessionPromise
    .then(() => console.log('[P.A.T.C.H] ONNX session ready (mental-health-bert)'))
    .catch(err => console.error('[P.A.T.C.H] ONNX session init failed:', err));

  return sessionPromise;

}
  */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE_TEXT') {
    console.debug('[P.A.T.C.H] received ANALYZE_TEXT request', (request.text||'').slice(0,120));

    ensureOffscreenDocument().then(() => {
      chrome.runtime.sendMessage({
        type: 'ANALYZE_TEXT_OFFSCREEN',
        text: request.text
      }).then(response => {
        console.debug('[P.A.T.C.H] received ANALYZE_TEXT_OFFSCREEN response', response && response.riskLevel);
        sendResponse(response);
      }).catch(err => {
        console.error('[P.A.T.C.H] Message to offscreen failed', err);
        sendResponse({ error: err.message || 'Offscreen communication failed' });
      });
    }).catch(err => {
      console.error('[P.A.T.C.H] failed to setup offscreen document', err);
      sendResponse({ error: err.message || 'failed to setup offscreen document' });
    })

    return true;
    /*
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
    */
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
