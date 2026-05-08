const MINI_ANALYSIS_URL = 'https://tradolux.com/.netlify/functions/mini-analysis';

const DAILY_FREE_LIMIT = 3;

async function getDailyCount() {
  const today = new Date().toDateString();
  const stored = await chrome.storage.local.get(['analysisDate', 'analysisCount']);
  if (stored.analysisDate !== today) {
    await chrome.storage.local.set({ analysisDate: today, analysisCount: 0 });
    return 0;
  }
  return stored.analysisCount || 0;
}

async function incrementDailyCount() {
  const count = await getDailyCount();
  const today = new Date().toDateString();
  await chrome.storage.local.set({
    analysisDate: today,
    analysisCount: count + 1
  });
  return count + 1;
}

function showLimitReached(used) {
  document.getElementById('content').innerHTML = `
    <div style="padding:16px 14px;">
      <div style="color:#e8a020;font-size:11px;font-weight:700;margin-bottom:8px;letter-spacing:1px;">
        ⚡ ${used}/${DAILY_FREE_LIMIT} FREE ANALYSES USED
      </div>

      <div style="display:grid;gap:4px;margin-bottom:12px;position:relative;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0e1830;border-radius:3px;border-left:3px solid #2a9d6e;filter:blur(3px);">
          <span style="font-size:9px;color:#4a5470;letter-spacing:1px;">CHART INTELLIGENCE</span>
          <span style="font-size:10px;font-weight:700;color:#2a9d6e;">● BULLISH</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0e1830;border-radius:3px;border-left:3px solid #d94f4f;filter:blur(3px);">
          <span style="font-size:9px;color:#4a5470;letter-spacing:1px;">SENTIMENT</span>
          <span style="font-size:10px;font-weight:700;color:#d94f4f;">● BEARISH</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0e1830;border-radius:3px;border-left:3px solid #2a9d6e;filter:blur(3px);">
          <span style="font-size:9px;color:#4a5470;letter-spacing:1px;">FUNDAMENTAL</span>
          <span style="font-size:10px;font-weight:700;color:#2a9d6e;">● STRONG</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0e1830;border-radius:3px;border-left:3px solid #e8a020;filter:blur(3px);">
          <span style="font-size:9px;color:#4a5470;letter-spacing:1px;">RISK MANAGEMENT</span>
          <span style="font-size:10px;font-weight:700;color:#e8a020;">● CAUTION</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0e1830;border-radius:3px;border-left:3px solid #5a6678;filter:blur(3px);">
          <span style="font-size:9px;color:#4a5470;letter-spacing:1px;">MACRO</span>
          <span style="font-size:10px;font-weight:700;color:#5a6678;">● NEUTRAL</span>
        </div>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(7,13,31,0.7);border-radius:3px;">
          <div style="font-size:18px;margin-bottom:6px;">🔒</div>
          <div style="color:#e8f5f2;font-size:10px;font-weight:700;letter-spacing:0.5px;">DAILY LIMIT REACHED</div>
          <div style="color:#4a5470;font-size:9px;margin-top:3px;">Resets at midnight</div>
        </div>
      </div>

      <div style="background:#0e1830;border:1px solid #1a7a6e;border-radius:4px;padding:10px 12px;text-align:center;">
        <div style="color:#e8f5f2;font-size:10px;font-weight:700;margin-bottom:6px;">
          Unlock unlimited analysis
        </div>
        <div style="color:#4a5470;font-size:9px;margin-bottom:10px;line-height:1.5;">
          All 5 agents · Live signals · AI chat<br>
          Multi-timeframe charts · Smart alerts
        </div>
        <a href="https://tradolux.com/app" target="_blank"
           style="display:block;background:#1a7a6e;color:#e8f5f2;font-family:monospace;font-size:10px;font-weight:700;padding:8px 12px;border-radius:3px;text-decoration:none;letter-spacing:0.06em;">
          Start 14-day free trial →
        </a>
        <div style="color:#2a3550;font-size:9px;margin-top:6px;">No credit card required during trial</div>
      </div>
    </div>`;
  setStatus('#e8a020');
}

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

  const usedToday = await getDailyCount();
  if (usedToday >= DAILY_FREE_LIMIT) {
    showLimitReached(usedToday);
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
    await incrementDailyCount();
    const newCount = await getDailyCount();
    const remaining = DAILY_FREE_LIMIT - newCount;
    if (remaining <= 1) {
      setStatus(remaining === 0 ? '#e8a020' : '#d94f4f');
    }
  } catch (e) {
    showError(e.message || 'Analysis failed. Please try again.');
  } finally {
    document.getElementById('analyzeBtn').disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('analyzeBtn');
  const input = document.getElementById('tickerInput');

  const count = await getDailyCount();
  const usageEl = document.getElementById('usageText');
  if (usageEl) {
    const remaining = Math.max(0, DAILY_FREE_LIMIT - count);
    usageEl.textContent = remaining > 0
      ? `${remaining} free ${remaining === 1 ? 'analysis' : 'analyses'} remaining today`
      : 'Daily limit reached — upgrade for unlimited';
    usageEl.style.color = remaining === 0 ? '#e8a020' : '#2a3550';
  }

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
