const RATE_LIMIT_HOUR = 20;
const MIN_INTERVAL_MS = 10000;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE_TEXT' || request.type === 'ANALYZE_STORY') {
    handleAnalysis(request, sendResponse);
    return true;
  }
});

async function handleAnalysis(request, sendResponse) {
  const storage = await chrome.storage.local.get(['config', 'stats', 'queue']);
  const config = storage.config || {};
  const stats = storage.stats || { hourlyCount: 0, lastResetHour: new Date().getHours(), lastScanTime: 0 };
  
  const now = Date.now();
  const currentHour = new Date().getHours();

  // Rate limit checks
  if (currentHour !== stats.lastResetHour) {
    stats.hourlyCount = 0;
    stats.lastResetHour = currentHour;
  }

  if (now - stats.lastScanTime < MIN_INTERVAL_MS) {
    sendResponse({ error: 'Please wait 10 seconds between scans.' });
    return;
  }

  if (stats.hourlyCount >= RATE_LIMIT_HOUR) {
    sendResponse({ error: 'Hourly scan limit (20) reached.' });
    return;
  }

  try {
    let result;
    if (request.type === 'ANALYZE_STORY') {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg' });
      result = await callApi(config.ocrEndpoint, { image: dataUrl, type: 'story' }, config.apiKey);
    } else {
      result = await callApi(config.apiEndpoint, { text: request.text, type: 'post' }, config.apiKey);
    }

    stats.hourlyCount++;
    stats.lastScanTime = now;
    await chrome.storage.local.set({ stats });

    if (result.riskLevel !== 'Low') {
      const queue = storage.queue || [];
      queue.unshift({ ...result, url: request.url, timestamp: now });
      await chrome.storage.local.set({ queue: queue.slice(0, 50) });
    }

    sendResponse({ data: result });
  } catch (err) {
    sendResponse({ error: 'API Error: ' + err.message });
  }
}

async function callApi(endpoint, body, key) {
  if (!endpoint) throw new Error('API Endpoint not configured in settings.');
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  return resp.json();
}