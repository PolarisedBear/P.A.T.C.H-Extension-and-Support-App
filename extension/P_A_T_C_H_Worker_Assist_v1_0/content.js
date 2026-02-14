function injectUI() {
  if (document.getElementById('patch-scan-btn')) return;

  const scanBtn = document.createElement('button');
  scanBtn.id = 'patch-scan-btn';
  scanBtn.innerText = '🔍 Scan Page';
  scanBtn.className = 'patch-primary-btn';
  document.body.appendChild(scanBtn);

  scanBtn.onclick = () => {
    const posts = document.querySelectorAll('a[href*="/p/"]');
    posts.forEach(post => {
      const parent = post.closest('div');
      if (parent && !parent.querySelector('.patch-badge')) {
        const badge = document.createElement('div');
        badge.className = 'patch-badge';
        badge.innerText = 'Analyzing...';
        parent.style.position = 'relative';
        parent.appendChild(badge);
        
        // Mock scan for demonstration - in reality, we'd batch these
        setTimeout(() => {
           badge.innerText = '🟢 Likely OK';
           badge.style.background = '#22C55E';
        }, 1000);
      }
    });
  };

  // Observe for single post view
  const observer = new MutationObserver(() => {
    const actionSection = document.querySelector('section._aamu'); // Instagram buttons area
    if (actionSection && !document.getElementById('patch-analyze-post')) {
      const btn = document.createElement('button');
      btn.id = 'patch-analyze-post';
      btn.innerText = '💙 Analyze';
      btn.className = 'patch-inline-btn';
      btn.onclick = () => showDrawer();
      actionSection.appendChild(btn);
    }

    const storyContainer = document.querySelector('header._ac3p');
    if (storyContainer && !document.getElementById('patch-story-btn')) {
      const sBtn = document.createElement('button');
      sBtn.id = 'patch-story-btn';
      sBtn.innerText = '💙 Check';
      sBtn.className = 'patch-story-btn';
      sBtn.onclick = () => analyzeStory();
      storyContainer.appendChild(sBtn);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
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
  const caption = document.querySelector('h1')?.innerText || 'No caption found';
  
  chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text: caption, url: window.location.href }, (response) => {
    const body = document.getElementById('patch-drawer-body');
    if (response.error) {
      body.innerHTML = `<p class="error">${response.error}</p>`;
    } else {
      const d = response.data;
      const riskColor = d.riskLevel === 'High' ? '#EF4444' : (d.riskLevel === 'Medium' ? '#F59E0B' : '#22C55E');
      body.innerHTML = `
        <div class="risk-banner" style="background:${riskColor}">${d.riskLevel} Risk</div>
        <h4>Why flagged:</h4>
        <ul>${d.topPhrases.map(p => `<li>${p}</li>`).join('')}</ul>
        <p>${d.explanation}</p>
        <div class="actions">
          <button class="patch-primary-btn" id="patch-copy-tpl">Copy Outreach Template</button>
          <button class="patch-secondary-btn">Save to Case</button>
        </div>
      `;
      document.getElementById('patch-copy-tpl').onclick = () => {
        navigator.clipboard.writeText("Hi, I noticed your post and wanted to check in...");
        alert('Template copied!');
      };
    }
  });
}

function analyzeStory() {
  chrome.runtime.sendMessage({ type: 'ANALYZE_STORY', url: window.location.href }, (response) => {
    if (response.error) alert(response.error);
    else showDrawer(response.data);
  });
}

injectUI();