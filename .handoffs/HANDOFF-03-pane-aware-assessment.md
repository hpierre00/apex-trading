# Claude Code Handoff: Pane-Aware Instant Assessment + Chat (v5.17)

## Context and dependency order
This work was the "Fix 2" half of the v5.16 handoff. It was deferred because it
depends on multi-pane existing. **Do this AFTER HANDOFF-01 (multi-pane) lands
on main.** If multi-pane isn't shipped yet, don't do this handoff.

## What this fixes
Today `runInstantAssessment()`, `buildChartContext()`, `sendChat()`, and the
chat assess-trigger all read from `state.symbol` and `state.timeframe`. Once
multi-pane ships, a user can have AAPL in pane 0 and TSLA in pane 1 with
different timeframes. If they click pane 1 (making it active) and hit ⚡, they
expect an assessment of TSLA on that pane's timeframe. Without this handoff,
they might still get AAPL (the global `state.symbol`).

## The fix

### Verify multi-pane baseline
    grep -c "state.panes\|state.activePane" apex-platform.html

If this returns 0, stop. Do HANDOFF-01 first.

### Refactor `runInstantAssessment` to accept a pane index

Current signature: `async function runInstantAssessment()`. New:

    async function runInstantAssessment(paneIndex) {
      const targetIdx = paneIndex ?? state.activePane ?? 0;
      const pane = state.panes?.[targetIdx];
      const sym = pane?.symbol || state.symbol;
      const tf = pane?.timeframe || state.timeframe;
      const candles = state.candles[sym];
      if (!candles || candles.length < 20) {
        toast(`No chart data for ${sym}`, 'bear');
        return;
      }
      // ... rest of function: replace every state.symbol with sym,
      //     every state.timeframe with tf ...
      // The loading card and result header should show sym and tf:
      const chatMessages = document.getElementById('chatMessages');
      chatMessages.innerHTML += `<div id="..."><div>⚡ INSTANT ASSESSMENT — ${sym} ${tf}</div>...</div>`;
    }

### Refactor `buildChartContext` to accept a pane index

Same pattern:

    function buildChartContext(paneIndex) {
      const targetIdx = paneIndex ?? state.activePane ?? 0;
      const pane = state.panes?.[targetIdx];
      const sym = pane?.symbol || state.symbol;
      const tf = pane?.timeframe || state.timeframe;
      const range = pane?.range || state.range;
      // ... rest uses sym/tf/range instead of state.symbol/state.timeframe/state.range
    }

Then inside `runInstantAssessment`, pass the pane index through:

    system: `You are APEX AI ... \n${buildChartContext(targetIdx)}`

### Update callers

1. **Global ⚡ button** (bottom of chat panel):

       document.getElementById('assessBtn').addEventListener('click', () => {
         runInstantAssessment(state.activePane);
       });

2. **Chat trigger** in `sendChat()`. Find the `assessTrigger` regex match block
   (v5.14 tightened this to `/\b(assess|...|read)\b/i`). Update the call:

       if (assessTrigger.test(q)) {
         runInstantAssessment(state.activePane);
         input.value = '';
         return;
       }

3. **Chat context prefix** in the system prompt. The `sendChat` fetch payload
   currently builds: `system: '... ${buildChartContext()}'`. Update to pass
   the active pane index:

       system: `... \n${buildChartContext(state.activePane)}`

### Add per-pane ⚡ buttons in pane headers

In `initLayout()`, each pane wrapper's header already has symbol input and
TF label (from HANDOFF-01). Add a small assess button:

    <button class="pane-assess-btn" data-pane="${i}"
      style="background:var(--gold);color:var(--bg);border:none;cursor:pointer;
             font-family:monospace;font-size:9px;font-weight:700;padding:2px 6px;
             border-radius:2px;margin-left:4px"
      title="Instant Assessment for ${pane.symbol}">⚡</button>

Wire after DOM creation:

    chartArea.querySelectorAll('.pane-assess-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();  // don't let the wrapper click handler trigger
        const idx = parseInt(btn.dataset.pane);
        setActivePane(idx);
        runInstantAssessment(idx);
      });
    });

### Also make `runAgents` and `checkAlerts` pane-aware if HANDOFF-01 didn't

If HANDOFF-01 already routed signal generation and alerts through the active
pane, skip this. Otherwise:

**runAgents:** at the top, `const pane = state.panes?.[state.activePane];
const sym = pane?.symbol || state.symbol; const candles = state.candles[sym]`.
At the end, before `generateSignal`, re-check: `if ((pane?.symbol || state.symbol)
!== sym) return;` to bail if the user switched panes during the async run.

**Alert modal pre-fill:** when the alert modal opens, default the symbol field
to the active pane's symbol, not the global:

    document.getElementById('alertSym').value =
      state.panes?.[state.activePane]?.symbol || state.symbol;

## Test checklist

In 1x1:
- [ ] Global ⚡ button still works, assesses the single pane
- [ ] Chat "assess" still fires INSTANT ASSESSMENT

In 1x2:
- [ ] Click left pane (gold border), press global ⚡ → left pane's symbol
- [ ] Click right pane (gold border), press global ⚡ → right pane's symbol
- [ ] Per-pane ⚡ in left header assesses left regardless of which is active
- [ ] Per-pane ⚡ in right header assesses right regardless of which is active
- [ ] Chat input "read the tape" uses active pane's symbol and timeframe
- [ ] Assessment card header reads the correct symbol + TF

In 2x2:
- [ ] All four panes get their own ⚡ button
- [ ] Alert modal pre-fills with whichever pane is active
- [ ] Signal generation still only runs against active pane (not 4x)

## Files touched
Only `apex-platform.html`.

## Commit message suggestion
    APEX v5.17: pane-aware instant assessment + chat context + alert prefill

    - runInstantAssessment(paneIndex) and buildChartContext(paneIndex) now
      accept an optional pane index and fall back to state.activePane
      (then state.symbol as final fallback in single-pane mode).
    - Per-pane ⚡ button added to each pane header in multi-pane layouts.
    - Global ⚡ button and chat assess-trigger now pass state.activePane.
    - Alert modal pre-fills with active pane's symbol.
    - runAgents bails if pane's symbol changes mid-run (prevents stale
      signals on rapid pane switches).
