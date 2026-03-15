document.getElementById('save-btn').onclick = () => {
  const config = {
    outreachMessageTemplate: document.getElementById('outreach-message-template').value,
    ocrEndpoint: document.getElementById('ocr-endpoint').value,
    apiKey: document.getElementById('api-key').value
  };
  chrome.storage.local.set({ config }, () => {
    alert('Settings saved!');
  });
};

chrome.storage.local.get('config', (data) => {
  if (data.config) {
    document.getElementById('outreach-message-template').value = data.config.outreachMessageTemplate || '';
    document.getElementById('ocr-endpoint').value = data.config.ocrEndpoint || '';
    document.getElementById('api-key').value = data.config.apiKey || '';
  }
});