document.getElementById('save-btn').onclick = () => {
  const config = {
    apiEndpoint: document.getElementById('api-endpoint').value,
    ocrEndpoint: document.getElementById('ocr-endpoint').value,
    apiKey: document.getElementById('api-key').value
  };
  chrome.storage.local.set({ config }, () => {
    alert('Settings saved!');
  });
};

chrome.storage.local.get('config', (data) => {
  if (data.config) {
    document.getElementById('api-endpoint').value = data.config.apiEndpoint || '';
    document.getElementById('ocr-endpoint').value = data.config.ocrEndpoint || '';
    document.getElementById('api-key').value = data.config.apiKey || '';
  }
});