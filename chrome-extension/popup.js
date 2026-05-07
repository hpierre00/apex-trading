const MINI_ANALYSIS_URL = 'https://tradolux.com/.netlify/functions/mini-analysis';

function setStatus(color) {
  const dot = document.getElementById('statusDot');
  if (dot) dot.style.background = color;
}

function showLoading() {
  document.getElementById('content').innerHTML = `
    <div class="loading">
      <div>Analyzing<span class="loading-dot"></span><span class="loading-dot"></span><span class="loading-dot"></span></div>
      <div style="margin-top:6px;color:#1a3a30;font-size:10px;">5 AI agents running</div>
    </div>`;
}

function showError(msg) {
  document.getElementById('content').innerHTML = `<div class="error">⚠ ${msg}</div>`;
  setStatus('#d94f4f');
}

function verdictClass(v) {
  if (!v) return 'neutral';
  const u = v.toUpperCase();
  if (u.includes('BULL') || u.includes('STRONG') || u.includes('POSITIVE')) return 'bullish';
  if (u.includes('BEAR') || u.includes('WEAK') || u.includes('NEGATIVE')) return 'bearish';
  if (u.includes('CAUTION') || u.includes('WARN') || u.includes('HEADWIND')) return 'caution';
  return 'neutral';
}

function renderResults(ticker, data) {
  const agents = data.agents || [];
  const summary = data.summary || '';

  const agentRows = agents.map(a => {
    const vc = verdictClass(a.verdict);
    return `<div class="agent-row ${vc}">
      <span class="agent-name">${a.name.toUpperCase()}</span>
      <span class="agent-verdict verdict-${vc}">● ${a.verdict}</span>
    </div>`;
  }).join('');

  document.getElementById('content').innerHTML = `
    <div class="agents">${agentRows}</div>
    ${summary ? `<div class="summary">${summary}</div>` : ''}`;
  setStatus('#1a7a6e');
}

async function analyze(ticker) {
  if (!ticker) return;
  ticker = ticker.trim().toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(ticker)) {
    showError('Invalid ticker symbol.');
    return;
  }

  document.getElementById('tickerInput').value = ticker;
  document.getElementById('analyzeBtn').disabled = true;
  showLoading();
  setStatus('#e8a020');

  try {
    const res = await fetch(MINI_ANALYSIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker })
    });

    if (!res.ok) throw new Error('Service error ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderResults(ticker, data);
  } catch (e) {
    showError(e.message || 'Analysis failed. Please try again.');
  } finally {
    document.getElementById('analyzeBtn').disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('analyzeBtn');
  const input = document.getElementById('tickerInput');

  // Load ticker detected from current page
  const stored = await chrome.storage.local.get(['lastTicker']);
  if (stored.lastTicker) {
    input.value = stored.lastTicker;
    analyze(stored.lastTicker);
  }

  btn.addEventListener('click', () => analyze(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') analyze(input.value);
  });
});
