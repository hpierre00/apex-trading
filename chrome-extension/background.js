// Background service worker — handles messages from content/popup scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_TICKER') {
    sendResponse({ ticker: msg.ticker });
  }
  if (msg.type === 'STORE_TICKER') {
    chrome.storage.local.set({ lastTicker: msg.ticker });
  }
  return true;
});
