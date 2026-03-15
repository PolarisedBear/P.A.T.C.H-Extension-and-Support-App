function normalizeAnalysisResponse(response) {
  if (!response || typeof response !== 'object') return null;

  const normalized = {
    ...response,
    error: response.error || null,
    topLabel: response.topLabel || response.top_label || response.label || '',
    suicidalProb: Number(response.suicidalProb ?? response.suicidal_prob ?? 0),
    distressProb: Number(response.distressProb ?? response.distress_prob ?? 0),
    normalProb: Number(response.normalProb ?? response.normal_prob ?? 0),
    riskLevel: response.riskLevel || response.risk_level || response.level || ''
  };

  const risk = String(normalized.riskLevel).trim().toLowerCase();
  const label = String(normalized.topLabel).trim().toLowerCase();

  if (risk.includes('high')) {
    normalized.riskLevel = 'High';
    return normalized;
  }

  if (risk.includes('medium') || risk.includes('moderate')) {
    normalized.riskLevel = 'Medium';
    return normalized;
  }

  if (risk.includes('low')) {
    normalized.riskLevel = 'Low';
    return normalized;
  }

  if (/(suicidal|self-harm|self harm)/i.test(label)) {
    normalized.riskLevel = 'High';
    return normalized;
  }

  if (/(distress|anxiety|depression|depress)/i.test(label)) {
    normalized.riskLevel = 'Medium';
    return normalized;
  }

  const scores = [
    { key: 'suicidalProb', value: normalized.suicidalProb, risk: 'High', label: 'suicidal' },
    { key: 'distressProb', value: normalized.distressProb, risk: 'Medium', label: 'distress' },
    { key: 'normalProb', value: normalized.normalProb, risk: 'Low', label: 'normal' }
  ].sort((a, b) => b.value - a.value);

  const top = scores[0];

  if (top && Number.isFinite(top.value) && top.value > 0) {
    normalized.riskLevel = top.risk;
    if (!normalized.topLabel) normalized.topLabel = top.label;
    return normalized;
  }

  normalized.riskLevel = '';
  return normalized;
}

function isInstagramSearchPage(url = '') {
  // Match the real Instagram explore page
  if (/^https:\/\/(www\.)?instagram\.com\/explore\//i.test(url)) return true;
  // Match local test/sandbox pages that declare themselves as explore pages
  if (document.body && document.body.dataset.patchPageType === 'explore') return true;
  return false;
}


function extractImageDataUrl(container) {
  const anchor = container.querySelector('a[href*="/p/"]');
  const img = anchor ? anchor.querySelector('img') : null;
  const target = img || container.querySelector('img');
  if (!target) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.naturalWidth || target.width;
    canvas.height = target.naturalHeight || target.height;
    if (!canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(target, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('[P.A.T.C.H] Failed to extract image data URL:', e);
    return null;
  }
}

function updateOCRBadge(badge, result) {
  const d = normalizeAnalysisResponse(result);

  if (!d || !d.riskLevel) {
    badge.innerText = '⚪ Unknown';
    badge.title = 'Missing risk level';
    badge.style.background = '#6B7280';
    return;
  }

  if (d.riskLevel === 'High') {
    badge.innerText = '🔴 High';
    badge.style.background = '#EF4444';
  } else if (d.riskLevel === 'Medium') {
    badge.innerText = '🟠 Medium';
    badge.style.background = '#F59E0B';
  } else {
    badge.innerText = '🟢 Low';
    badge.style.background = '#22C55E';
  }

  badge.title = [
    d.text ? `OCR: "${d.text.slice(0, 80)}${d.text.length > 80 ? '...' : ''}"` : '',
    d.topLabel ? `Top: ${d.topLabel}` : '',
    `Suicidal: ${(d.suicidalProb * 100).toFixed(1)}%`,
    `Distress: ${(d.distressProb * 100).toFixed(1)}%`,
    `Normal: ${(d.normalProb * 100).toFixed(1)}%`
  ].filter(Boolean).join('\n');
}

function sendAnalyzeImageBatch(imageDataUrls, timeout = 30000) {
  return new Promise((resolve) => {
    let handled = false;
    try {
      chrome.runtime.sendMessage({ type: 'ANALYZE_IMAGE', imageDataUrls }, (response) => {
        handled = true;
        if (chrome.runtime.lastError) {
          console.error('[P.A.T.C.H] ANALYZE_IMAGE error:', chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (e) {
      console.error('[P.A.T.C.H] ANALYZE_IMAGE thrown:', e);
      resolve({ error: e.message });
    }
    setTimeout(() => {
      if (!handled) {
        console.warn('[P.A.T.C.H] ANALYZE_IMAGE batch timed out');
        resolve({ error: 'timeout' });
      }
    }, timeout);
  });
}

function injectUI() {
  if (document.getElementById('patch-scan-btn')) return;

  const scanBtn = document.createElement('button');
  scanBtn.id = 'patch-scan-btn';
  scanBtn.innerText = '🔍 Scan Page';
  scanBtn.className = 'patch-primary-btn';
  document.body.appendChild(scanBtn);

  // Batch-scan posts with limited concurrency to avoid spamming the background worker
  scanBtn.onclick = async () => {
    if (isInstagramSearchPage(window.location.href)) {
      // Instagram search page: use image OCR analysis
      const posts = Array.from(document.querySelectorAll('a[href*="/p/"]'));
      const postData = [];

      posts.forEach(post => {
        const parent = post.closest('article') || post.closest('div');
        if (parent && !parent.querySelector('.patch-badge')) {
          const badge = document.createElement('div');
          badge.className = 'patch-badge';
          badge.innerText = 'Analyzing...';
          parent.style.position = parent.style.position || 'relative';
          parent.appendChild(badge);

          const imageDataUrl = extractImageDataUrl(parent);
          postData.push({ badge, imageDataUrl });
        }
      });

      if (!postData.length) return;

      // Process in batches so all posts get inference, not just the first response
      const OCR_BATCH_SIZE = 10;
      const DELAY_BETWEEN_BATCHES = 300;

      for (let i = 0; i < postData.length; i += OCR_BATCH_SIZE) {
        const batch = postData.slice(i, i + OCR_BATCH_SIZE);
        const imageDataUrls = batch.map(p => p.imageDataUrl).filter(Boolean);

        if (!imageDataUrls.length) {
          batch.forEach(p => {
            p.badge.innerText = '⚪ No image';
            p.badge.style.background = '#6B7280';
          });
          continue;
        }

        const response = await sendAnalyzeImageBatch(imageDataUrls);

        if (response?.error || !response?.results) {
          console.warn('[P.A.T.C.H] ANALYZE_IMAGE batch failed:', response?.error);
          batch.forEach(p => {
            p.badge.innerText = '⚪ Error';
            p.badge.title = response?.error || 'Unknown error';
            p.badge.style.background = '#6B7280';
          });
        } else {
          // Map results back: only posts with valid images sent data
          let resultIdx = 0;
          batch.forEach(p => {
            if (!p.imageDataUrl) {
              p.badge.innerText = '⚪ No image';
              p.badge.style.background = '#6B7280';
              return;
            }
            if (resultIdx < response.results.length) {
              updateOCRBadge(p.badge, response.results[resultIdx]);
            } else {
              p.badge.innerText = '⚪ Error';
              p.badge.title = 'No result returned for this image';
              p.badge.style.background = '#6B7280';
            }
            resultIdx++;
          });
        }

        // Pause between batches to avoid overwhelming the worker
        if (i + OCR_BATCH_SIZE < postData.length) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
        }
      }

      return;
    }

    // Non-Instagram: existing text analysis flow
    const posts = Array.from(document.querySelectorAll('a[href*="/p/"]'));
    const items = [];

    posts.forEach(post => {
      const parent = post.closest('article') || post.closest('div');
      if (parent && !parent.querySelector('.patch-badge')) {
        const badge = document.createElement('div');
        badge.className = 'patch-badge';
        badge.innerText = 'Analyzing...';
        parent.style.position = parent.style.position || 'relative';
        parent.appendChild(badge);

        const caption = extractPostText(parent);

        items.push({ badge, caption, url: post.href });
      }
    });

    if (!items.length) return;

    const sendAnalyze = (text, url, timeout = 15000) => new Promise((resolve) => {
      let handled = false;
      try {
        const request = isInstagramSearchPage(window.location.href)
          ? { type: 'ANALYZE_IMAGE' }
          : { type: 'ANALYZE_TEXT', text, url };

        chrome.runtime.sendMessage(request, (response) => {
          handled = true;
          if (chrome.runtime.lastError) {
            console.error('[P.A.T.C.H] sendMessage error:', chrome.runtime.lastError.message);
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          console.debug('[P.A.T.C.H] analysis response received', response);
          resolve(response);
        });
      } catch (e) {
        console.error('[P.A.T.C.H] sendMessage thrown:', e);
        resolve({ error: e.message });
      }

      setTimeout(() => {
        if (!handled) {
          console.warn('[P.A.T.C.H] analysis request timed out');
          resolve({ error: 'timeout' });
        }
      }, timeout);
    });

    const updateBadge = (badge, response) => {
      if (response?.error) {
        badge.innerText = '⚪ Error';
        badge.title = response.error;
        badge.style.background = '#6B7280';
        return;
      }

      const d = normalizeAnalysisResponse(response);

      if (!d || !d.riskLevel) {
        console.warn('[P.A.T.C.H] malformed analysis response:', response);
        badge.innerText = '⚪ Unknown';
        badge.title = 'Missing risk level in analysis response';
        badge.style.background = '#6B7280';
        return;
      }

      if (d.riskLevel === 'High') {
        badge.innerText = '🔴 High';
        badge.style.background = '#EF4444';
      } else if (d.riskLevel === 'Medium') {
        badge.innerText = '🟠 Medium';
        badge.style.background = '#F59E0B';
      } else {
        badge.innerText = '🟢 Low';
        badge.style.background = '#22C55E';
      }

      badge.title = [
        d.topLabel ? `Top: ${d.topLabel}` : '',
        `Suicidal: ${(d.suicidalProb * 100).toFixed(1)}%`,
        `Distress: ${(d.distressProb * 100).toFixed(1)}%`,
        `Normal: ${(d.normalProb * 100).toFixed(1)}%`
      ].filter(Boolean).join('\n');
    };

    const chunkSize = 10;
    const delayBetweenChunks = 250;

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (it) => {
        let res = await sendAnalyze(it.caption, it.url);
        if (res && res.error) {
          console.warn('[P.A.T.C.H] first attempt failed, retrying...', res.error);
          await new Promise(r => setTimeout(r, 300));
          res = await sendAnalyze(it.caption, it.url, 20000);
        }
        updateBadge(it.badge, res);
      }));
      if (i + chunkSize < items.length) await new Promise(r => setTimeout(r, delayBetweenChunks));
    }
  };

  function analyzeArticle(article, url = window.location.href) { 
    const text = extractPostText(article);

    if (!text) { 
      showDrawer({ error: 'No caption text found for this post' });
      return;
    }

    chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text, url }, (response) => {
      showDrawer(response);
    });

  }

  function findActionSectionForArticle(article) {
    if (!article) return null;
    const selectors = [
      'div[role="toolbar"]',
      'div[role="group"]',
      'section',
      'footer'
    ];

    for (const selector of selectors) { 
      const el = article.querySelector(selector);
      if (el) return el;
    }

    return article;
  }


  // debounce/throttle helper so we don't query on every micro-mutation
  let debounceTimer = null;
  function ensureInlineButtons() {
    const articles = Array.from(document.querySelectorAll('article'));

    articles.forEach((article, index) => { 
      if (!(article instanceof HTMLElement)) return;
      //scope to one button per article
      if (article.querySelector('.patch-inline-btn')) return;

      const target = findActionSectionForArticle(article);
      if (!target) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'patch-inline-btn patch-secondary-btn';
      btn.innerText = 'Analyze Post Content';
      btn.style.marginTop = '8px';
      btn.style.display = 'block';
      const permalink = article.querySelector('a[href*="/p/"]')?.href ||
        `${window.location.href}#post-${index + 1}`;
      
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        analyzeArticle(article, permalink);
      }
      
      target.appendChild(btn);
    })

  }

  // Observe for DOM changes but only act when nodes are added/removed
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if ((m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length)) {
        ensureInlineButtons();
        break;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // run once immediately in case the elements already exist
  ensureInlineButtons();
}

function showDrawer(data = null) {
  let drawer = document.getElementById('patch-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'patch-drawer';
    drawer.innerHTML = `
      <div class="patch-drawer-content">
        <div class="patch-drawer-header">Risk Assessment <span id="patch-close">✕</span></div>
        <div id="patch-drawer-body">
          <div class="patch-loading">Analyzing post content...</div>
        </div>
      </div>
    `;
    document.body.appendChild(drawer);
    document.getElementById('patch-close').onclick = () => drawer.classList.remove('open');
  }

  drawer.classList.add('open');

  const render = (raw) => {
    const body = document.getElementById('patch-drawer-body');
    const d = normalizeAnalysisResponse(raw);

    if (!d) {
      body.innerHTML = `<p class="error">No analysis available</p>`;
      return;
    }

    if (d.error) {
      body.innerHTML = `<p class="error">Analysis failed: ${d.error}</p>`;
      return;
    }

    if (!d.riskLevel) {
      body.innerHTML = `<p class="error">Analysis response missing risk level</p>`;
      return;
    }

    const riskColor = d.riskLevel === 'High'
      ? '#EF4444'
      : d.riskLevel === 'Medium'
        ? '#F59E0B'
        : '#22C55E';

    body.innerHTML = `
      <div class="risk-banner" style="background:${riskColor}">${d.riskLevel} Risk</div>
      <h4>Top label: ${d.topLabel || 'Unknown'}</h4>
      <ul>
        <li>Suicidal: ${(d.suicidalProb * 100).toFixed(1)}%</li>
        <li>Distress (Anxiety+Depression): ${(d.distressProb * 100).toFixed(1)}%</li>
        <li>Normal: ${(d.normalProb * 100).toFixed(1)}%</li>
      </ul>
      <div class="actions">
        <button class="patch-outreach-btn" id="patch-copy-tpl">Copy Outreach Template</button>
      </div>
    `;

    document.getElementById('patch-copy-tpl').onclick = () => {
      const defaultTemplate = "Hi! I am a youth outreach worker and I came across a post that made me concerned about your wellbeing. If you want to talk, I'm here to listen.";
      chrome.storage.local.get('config', (data) => {
        const template = data?.config?.outreachMessageTemplate || defaultTemplate;
        navigator.clipboard.writeText(template);
        alert('Template copied!');
      });
    };
  };

  if (data) {
    render(data);
    return;
  }

  const caption = document.querySelector('h1')?.innerText || document.querySelector('article p')?.innerText || '';
  chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text: caption, url: window.location.href }, (response) => {
    render(response);
  });
}

function analyzeStory() {
  // Attempt to extract visible text from the story viewer/dialog
  const dialog = document.querySelector('div[role="dialog"]');
  let text = '';
  if (dialog) {
    text = dialog.querySelector('p, span, h1, h2')?.innerText || dialog.querySelector('img')?.alt || '';
  }
  // fallback to page caption
  if (!text) text = document.querySelector('h1')?.innerText || '';

  chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text, url: window.location.href }, (response) => {
    if (response && response.error) alert(response.error);
    else showDrawer(response);
  });
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isNoiseText(text) {
  const t = cleanText(text).toLowerCase();
  if (!t) return true;

  if (t.length < 8) return true;

  // common instagram/ui noise
  if (
    /^(follow|following|message|reply|share|comment|like|likes|view replies|view all comments|see translation|suggested for you)$/i.test(t)
  ) return true;

  // timestamps / dates
  if (
    /^(\d+\s*(s|m|h|d|w) ago)$/i.test(t) ||
    /^(today|yesterday)$/i.test(t) ||
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) ||
    /^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(t)
  ) return true;

  // likely username-only / location-only fragments
  if (t.split(' ').length === 1 && t.length < 20) return true;

  return false;
}

function getNodeTextScore(text) {
  const t = cleanText(text);
  let score = 0;

  score += Math.min(t.length, 280);
  if (t.split(' ').length >= 5) score += 40;
  if (/[.!?,]/.test(t)) score += 20;
  if (/\b(i|me|my|feel|feeling|life|tired|sad|alone|anxious|depressed|hurt|help)\b/i.test(t)) score += 60;

  return score;
}

function extractPostText(container) {
  if (!container) return '';

  const article = container.closest('article') || container;
  const nodes = Array.from(article.querySelectorAll('h1, h2, p, span, li'));

  const candidates = nodes
    .filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (!node.innerText) return false;
      if (node.closest('#patch-drawer, #patch-scan-btn, .patch-badge, [id^="patch-"]')) return false;
      if (node.closest('button, time, svg, nav, header')) return false;
      if (node.closest('a[href*="/p/"]')) return false;

      const text = cleanText(node.innerText);
      if (isNoiseText(text)) return false;

      return true;
    })
    .map((node) => cleanText(node.innerText))
    .filter(Boolean);

  const unique = [...new Set(candidates)];

  if (!unique.length) return '';

  unique.sort((a, b) => getNodeTextScore(b) - getNodeTextScore(a));

  // use the strongest caption-like node, plus one or two supporting comment/caption lines
  return unique.slice(0, 3).join('\n');
}

injectUI();