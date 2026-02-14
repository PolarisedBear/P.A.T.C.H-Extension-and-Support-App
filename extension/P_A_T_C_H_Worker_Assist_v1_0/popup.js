function updateUI() {
  chrome.storage.local.get(['stats', 'queue'], (data) => {
    const stats = data.stats || { hourlyCount: 0 };
    document.getElementById('stat-line').innerText = `Session: ${stats.hourlyCount}/20 scans used`;

    const list = document.getElementById('queue-list');
    const queue = data.queue || [];
    if (queue.length === 0) {
      list.innerHTML = 'No flagged posts yet.';
    } else {
      list.innerHTML = queue.map(item => `
        <div class="item">
          <span class="badge" style="background:${item.riskLevel === 'High' ? '#EF4444' : '#F59E0B'}">${item.riskLevel}</span>
          <strong>Post ${new Date(item.timestamp).toLocaleTimeString()}</strong><br/>
          <a href="${item.url}" target="_blank" class="btn-link">Open Post</a>
        </div>
      `).join('');
    }
  });
}

document.getElementById('settings-btn').onclick = () => chrome.runtime.openOptionsPage();
updateUI();