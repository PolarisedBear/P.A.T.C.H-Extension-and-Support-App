// src/background.js

let creatingOffscreen = null;

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
    
  }
});

