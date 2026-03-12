function injectUI() {
  if (document.getElementById('patch-scan-btn')) return;

  const scanBtn = document.createElement('button');
  scanBtn.id = 'patch-scan-btn';
  scanBtn.innerText = '🔍 Scan Page';
  scanBtn.className = 'patch-primary-btn';
  document.body.appendChild(scanBtn);

  // Batch-scan posts with limited concurrency to avoid spamming the background worker
  scanBtn.onclick = async () => {
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

        let caption = '';
        try {
          caption = parent.querySelector('h1, h2, p, span')?.innerText || '';
          if (!caption) caption = post.getAttribute('aria-label') || post.innerText || '';
        } catch (e) { caption = ''; }

        items.push({ badge, caption, url: post.href });
      }
    });

    if (!items.length) return;

    const sendAnalyze = (text, url, timeout = 15000) => new Promise((resolve) => {
      let handled = false;
      try {
        chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text, url }, (response) => {
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
      // safety timeout
      setTimeout(() => {
        if (!handled) {
          console.warn('[P.A.T.C.H] analysis request timed out');
          resolve({ error: 'timeout' });
        }
      }, timeout);
    });

    const updateBadge = (badge, response) => {
      if (!response) {
        badge.innerText = 'Error'; badge.style.background = '#EF4444'; return;
      }
      if (response.error) { badge.innerText = 'Likely OK'; badge.title = response.error; badge.style.background = '#22C55E'; return; }
      const d = response;
      const level = d.riskLevel || 'Low';
      if (level === 'High') { badge.innerText = '🔴 High'; badge.style.background = '#EF4444'; }
      else if (level === 'Medium') { badge.innerText = '🟠 Medium'; badge.style.background = '#F59E0B'; }
      else { badge.innerText = '🟢 Low'; badge.style.background = '#22C55E'; }
      badge.title = d.topLabel ? `Top: ${d.topLabel}` : '';
    };

    const chunkSize = 5; // number of concurrent requests
    const delayBetweenChunks = 250; // ms

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (it) => {
        let res = await sendAnalyze(it.caption, it.url);
        if (res && res.error) {
          console.warn('[P.A.T.C.H] first attempt failed, retrying...', res.error);
          // small backoff then retry once with longer timeout
          await new Promise(r => setTimeout(r, 300));
          res = await sendAnalyze(it.caption, it.url, 20000);
        }
        updateBadge(it.badge, res);
      }));
      // small pause between chunks
      if (i + chunkSize < items.length) await new Promise(r => setTimeout(r, delayBetweenChunks));
    }
  };

  // Resilient selector helpers — try multiple fallbacks instead of brittle classnames
  function findActionSection() {
    // Prefer the currently-open article (single post view)
    const article = document.querySelector('article');
    const areas = [];
    if (article) areas.push(...article.querySelectorAll('section, div[role="toolbar"], div[role="group"], div'));
    areas.push(...document.querySelectorAll('section, header, div[role="toolbar"], div[role="group"]'));

    for (const el of areas) {
      if (!(el instanceof Element)) continue;
      if (el.id && el.id.startsWith('patch-')) continue;

      // Prefer elements that contain known action buttons (Like / Comment / Share)
      try {
        if (el.querySelector('button[aria-label*="Like"], button[aria-label*="Comment"], button[aria-label*="Share"], button[aria-label*="Send"]')) return el;
      } catch (e) {}

      // fallback: elements that contain buttons or SVG icons
      if (el.querySelector('button, svg')) return el;
    }
    return null;
  }

  function findStoryContainer() {
    // Heuristic: prefer an open dialog (story viewer) that contains an image and nav buttons
    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog) {
      if (dialog.querySelector('img') && dialog.querySelector('button, svg')) return dialog;
      // sometimes story viewer nests in article or divs inside the dialog
      const inner = dialog.querySelector('header, section, div');
      if (inner && inner.querySelector('img')) return inner;
    }

    // fallback: find header/banner-like elements with images + controls
    const candidates = Array.from(document.querySelectorAll('header, div[role="banner"], div'));
    for (const c of candidates) {
      if (!(c instanceof Element)) continue;
      if (c.querySelector('img') && c.querySelector('button, svg')) return c;
      if (c.querySelector('button')) return c;
    }
    return null;
  }

  // debounce/throttle helper so we don't query on every micro-mutation
  let debounceTimer = null;
  function ensureInlineButtons() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      const actionSection = findActionSection();
      if (actionSection && !document.getElementById('patch-analyze-post')) {
        const btn = document.createElement('button');
        btn.id = 'patch-analyze-post';
        btn.innerText = '💙  Analyze Post Content';
        btn.className = 'patch-inline-btn';
        btn.onclick = () => showDrawer();
        actionSection.appendChild(btn);
      }

      const storyContainer = findStoryContainer();
      if (storyContainer && !document.getElementById('patch-story-btn')) {
        const sBtn = document.createElement('button');
        sBtn.id = 'patch-story-btn';
        sBtn.innerText = '💙 Check Story Content';
        sBtn.className = 'patch-story-btn';
        sBtn.onclick = () => analyzeStory();
        storyContainer.appendChild(sBtn);
      }
    }, 150);
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

  const render = (d) => {
    const body = document.getElementById('patch-drawer-body');
    if (!d) {
      body.innerHTML = `<p class="error">No analysis available</p>`;
      return;
    }
    const riskColor = d.riskLevel === 'High' ? '#EF4444' : (d.riskLevel === 'Medium' ? '#F59E0B' : '#22C55E');
    body.innerHTML = `
      <div class="risk-banner" style="background:${riskColor}">${d.riskLevel} Risk</div>
      <h4>Top label: ${d.topLabel || 'Unknown'}</h4>
      <ul>
        <li>Suicidal: ${((d.suicidalProb||0)*100).toFixed(1)}%</li>
        <li>Distress (Anxiety+Depression): ${((d.distressProb||0)*100).toFixed(1)}%</li>
        <li>Normal: ${((d.normalProb||0)*100).toFixed(1)}%</li>
      </ul>
      <div class="actions">
        <button class="patch-primary-btn" id="patch-copy-tpl">Copy Outreach Template</button>
        <button class="patch-secondary-btn">Save to Case</button>
      </div>
    `;
    document.getElementById('patch-copy-tpl').onclick = () => {
      navigator.clipboard.writeText("Hi, I noticed your post and wanted to check in...");
      alert('Template copied!');
    };
  };

  // If data provided (from caller), render it; otherwise request analysis for current caption
  if (data && data.riskLevel) {
    render(data);
    return;
  }

  const caption = document.querySelector('h1')?.innerText || document.querySelector('article p')?.innerText || '';
  chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text: caption, url: window.location.href }, (response) => {
    if (!response) return render(null);
    if (response.error) return render({ error: response.error });
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

injectUI();