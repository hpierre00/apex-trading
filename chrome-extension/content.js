// Detects stock ticker from the current page
(function() {
  function extractTicker() {
    const url = window.location.href;

    // Yahoo Finance: /quote/AAPL
    let m = url.match(/\/quote\/([A-Z]{1,5})(?:[\/\?]|$)/);
    if (m) return m[1];

    // TradingView: /symbols/NASDAQ-AAPL
    m = url.match(/\/symbols\/[A-Z]+-([A-Z]{1,5})(?:[\/\?]|$)/);
    if (m) return m[1];

    // MarketWatch: /investing/stock/aapl
    m = url.match(/\/investing\/stock\/([a-z]{1,5})(?:[\/\?]|$)/i);
    if (m) return m[1].toUpperCase();

    // Seeking Alpha: /symbol/AAPL
    m = url.match(/\/symbol\/([A-Z]{1,5})(?:[\/\?#]|$)/);
    if (m) return m[1];

    // CNBC: /quotes/AAPL
    m = url.match(/\/quotes?\/([A-Z]{1,5})(?:[\/\?]|$)/);
    if (m) return m[1];

    // Bloomberg: /quote/AAPL:US
    m = url.match(/\/quote\/([A-Z]{1,5}):/);
    if (m) return m[1];

    // Meta tag og:title often has ticker
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const titleMatch = ogTitle.match(/\(([A-Z]{1,5})\)/);
    if (titleMatch) return titleMatch[1];

    // Page title
    const title = document.title;
    const titleTicker = title.match(/\(([A-Z]{1,5})\)/);
    if (titleTicker) return titleTicker[1];

    return null;
  }

  const ticker = extractTicker();
  if (ticker) {
    chrome.storage.local.set({ lastTicker: ticker, lastUrl: window.location.href });
    chrome.runtime.sendMessage({ type: 'STORE_TICKER', ticker });
  }
})();
