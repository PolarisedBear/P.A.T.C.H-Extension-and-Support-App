// src/background.js

let creatingOffscreen = null;

const MAX_INSTAGRAM_IMAGE_REGIONS = 128;

function isInstagramSearchPage(url = '') {
  return /^https:\/\/(www\.)?instagram\.com\/explore\//i.test(url);
}

function normalizeText(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

async function ensureOffscreenDocument() {
  if ('getContexts' in chrome.runtime) {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    });

    if (existingContexts.length > 0) {
      console.log('[P.A.T.C.H] reusing existing Offscreen Document');
      return;
    }
  }

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'OCR and offline inference',
    });

    try {
      await creatingOffscreen;
      console.log('[P.A.T.C.H] offscreen document created');
    } finally {
      creatingOffscreen = null;
    }
  } else {
    await creatingOffscreen;
  }
}

async function getInstagramImageDataUrls(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [MAX_INSTAGRAM_IMAGE_REGIONS],
    func: (maxRegions) => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const seen = new Set();

      return Array.from(document.querySelectorAll('img'))
        .map((img) => {
          const rect = img.getBoundingClientRect();
          const anchor = img.closest('a[href]');
          const href = anchor?.getAttribute('href') || '';
          const src = img.currentSrc || img.src || '';

          const inViewport =
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < viewportHeight &&
            rect.left < viewportWidth;

          const largeEnough = rect.width >= 120 && rect.height >= 120;
          const looksLikePost = /\/p\//.test(href);

          if (!src || !inViewport || !largeEnough || !looksLikePost) return null;

          const key = `${src}`;
          if (seen.has(key)) return null;
          seen.add(key);

          // Convert image element to canvas and then to data URL
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          return canvas.toDataURL('image/png');
        })
        .filter(Boolean)
        .slice(0, maxRegions);
    },
  });

  return results?.[0]?.result || [];
}

chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreenDocument();
});

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreenDocument();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE_TEXT') {
    (async () => {
      await ensureOffscreenDocument();

      const originalText = normalizeText(request.text || '');

      return chrome.runtime.sendMessage({
        type: 'ANALYZE_TEXT_OFFSCREEN',
        text: originalText,
        originalText,
      });
    })()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message || 'Analyze text flow failed' }));

    return true;
  }

  if (request.type === 'ANALYZE_IMAGE') {
    (async () => {
      await ensureOffscreenDocument();

      // Accept image data URLs directly from content script (batched flow)
      let imageDataUrls = request.imageDataUrls;

      if (!imageDataUrls || !imageDataUrls.length) {
        // Fallback: extract images from the tab (legacy single-call flow)
        if (!isInstagramSearchPage(sender.tab.url || '')) {
          return { error: 'Not on Instagram search page' };
        }

        imageDataUrls = await getInstagramImageDataUrls(sender.tab.id);
      }

      if (!imageDataUrls.length) {
        return { error: 'No Instagram images found', results: [] };
      }

      return chrome.runtime.sendMessage({
        type: 'OCR_INSTAGRAM_IMAGES',
        imageDataUrls,
      });
    })()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message || 'Analyze Image flow failed', results: [] }));

    return true;
  }
});


