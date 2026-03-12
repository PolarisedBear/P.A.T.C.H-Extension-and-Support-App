const fs = require('fs');
const path = require('path');

// Paths
const SRC = path.join(__dirname, '..', 'src', 'background.js');
const TMP = path.join(__dirname, 'bg_test_module.js');

// Read source
let src = fs.readFileSync(SRC, 'utf8');

// Remove chrome.runtime.onMessage listener block (not needed for test)
src = src.replace(/chrome\.runtime\.onMessage\.addListener\([\s\S]*?\}\);\n/, '');

// Replace ES module imports with CommonJS requires to our mocks
src = src.replace("import * as ort from 'onnxruntime-web';", "const ort = require('./mocks/ort-mock');");
src = src.replace("import { encodeText } from './tokenizer.js';", "const { encodeText } = require('./mocks/tokenizer-mock');");

// Expose handleAnalyzeText as module export for testing
src += '\nmodule.exports = { handleAnalyzeText };\n';

// Write temporary test module
fs.writeFileSync(TMP, src, 'utf8');

// Prepare test environment (mock chrome)
global.chrome = { runtime: { getURL: (p) => p, onMessage: { addListener: () => {} } } };

// Require the transformed module
const mod = require(TMP);

async function run() {
  try {
    const text = 'I am feeling really down and hopeless';
    const result = await mod.handleAnalyzeText(text);
    console.log('Test input:', text);
    console.log('Inference result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Test failed:', err);
    process.exitCode = 2;
  } finally {
    // cleanup temporary file
    try { fs.unlinkSync(TMP); } catch (e) {}
  }
}

run();
