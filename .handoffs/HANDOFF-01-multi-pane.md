# Claude Code Handoff: Multi-Pane Chart Layouts (v5.14 deferred)

## Context
Currently `apex-platform.html` is a single-chart application. One canvas (`#chart`),
one active symbol (`state.symbol`), one `chartState` object, one `renderChart()`.

The original v5.14 handoff proposed a full multi-pane refactor (1x1 / 1x2 / 2x2
grid of independent charts). It was deferred out of the web session because it's
a real refactor, not a patch: it touches mouse handlers attached to a single
canvas at module scope, a 300+ line `renderChart` that reads globals, the WS tick
router, and every toolbar control. Visual iteration is required, which the web
tool doesn't support well.

This is exactly the work Claude Code is built for.

## Current baseline (as of commit a2dd67b)
- `state.panes` does not exist. `state.activePane` does not exist.
- `renderChart()` reads from global `chartState`, `canvas`, `ctx`, `cw`, `ch`
  (lines 895-897 of apex-platform.html) and global `state.symbol`.
- Mouse handlers are attached once at module load to the single canvas element
  (drag pan, wheel zoom, dblclick reset, crosshair, price-axis drag).
- `state.candles[sym]` already keys by symbol, so the cache layer is multi-symbol
  ready. The rendering layer is not.
- `runAgents()`, `runInstantAssessment()`, `buildChartContext()`, `checkAlerts()`,
  `simTick()` all assume `state.symbol` is "the symbol I should act on."

## Recommended approach

### Branch before touching
    git checkout -b feature/multi-pane

### Commit structure (do NOT do this as one monolith commit)

**Commit 1: Pane data model, no UI.**
Add `state.panes` (array of one pane), `state.activePane = 0`, `createPane()`
factory, `initLayout()` that only supports `1x1`. At this stage, `state.panes[0]`
mirrors globals. `state.symbol` and `state.panes[0].symbol` stay in sync via a
sync function. `renderChart` unchanged. Goal: nothing visible changes, but the
data model is ready. Verify with: single-chart behavior is 100% identical.

**Commit 2: Refactor `renderChart` to `renderChartForPane(pane, candles)`.**
Extract the entire function body into one that takes a pane object. Keep
`renderChart()` as a shim that calls `renderChartForPane(state.panes[state.activePane], candles)`.
Critical substitutions inside the body:
- `chartState.X` → `pane.chartState.X`
- `state.candles[state.symbol]` → `candles` (function parameter)
- `state.symbol` in renderChart body → `pane.symbol`
- `state.alerts.filter(a => a.sym === state.symbol)` → `... === pane.symbol`
- Module-level `ctx, cw, ch` → local vars read from `pane.canvas`
- `indOn(id)` currently reads global chartState. Make it accept an optional
  second param: `indOn(id, cs)`. Pass `pane.chartState` everywhere inside
  `renderChartForPane`.

Goal: still looks identical in 1x1. Verify all indicators, alerts, last-price
line, volume panel, sub-panel, crosshair, zoom/pan, price-axis scaling.

**Commit 3: Toolbar layout toggle + DOM pane grid.**
Add the `#layoutGroup` button trio (▣ / ⬛⬛ / ⊞), `initLayout()` expanded to
handle `1x2` and `2x2` with a CSS grid, pane wrappers with per-pane headers
(symbol input + TF label + close button), canvas elements created dynamically.
At this point: 1x2 and 2x2 render charts but mouse handlers still target the
original canvas (broken for the new panes). That's fine for this commit, ship
the skeleton first.

**Commit 4: Mouse handler routing.**
The spec suggests mousemove-sets-activePane, but the cleaner approach is to
attach handlers to each pane wrapper at creation time in `initLayout`, closing
over that pane's index. Each handler then references `state.panes[paneIndex]`.
Do this for: mousedown (start drag), mousemove (crosshair + drag update),
mouseup (end drag), wheel (zoom), dblclick (reset view). The module-level
handlers on the original `#chart` canvas should be removed, or never set up
in the first place, depending on how you rewire.

**Commit 5: WS tick router + per-pane render throttle.**
Inside the WS `m.T === 't'` handler, iterate `state.panes`, re-render any
pane matching `m.S`. Add `scheduleRenderPane(index)` using `requestAnimationFrame`
and a per-index throttle Set. Subscribe WS to the union of all pane symbols on
layout change.

**Commit 6: Toolbar controls affect active pane.**
Period buttons, INDICATORS modal, assess button, alert-create modal, chat
trigger: each routes to `state.panes[state.activePane]` instead of globals.
Clicking a pane sets `state.activePane` and updates the toolbar to reflect
that pane's period/indicators.

**Commit 7: ResizeObserver + DPR handling.**
Canvas width/height need DPR scaling (see existing `resizeCanvas` at line 899
for the pattern, `cw * dpr`, `setTransform(dpr, 0, 0, dpr, 0, 0)`). The spec's
`canvas.width = wrapper.clientWidth` omits this and will produce blurry
charts. Reuse the existing DPR pattern per pane. Wire `ResizeObserver` on
`#chartArea` so window resize re-sizes and re-renders all panes.

### Testing loop per commit
Keep a local dev server running (or open the file directly in a browser).
After each commit, walk the test checklist. Do NOT proceed to the next commit
if 1x1 behavior regresses. Single-pane parity is the bar.

### Common pitfalls to avoid
1. **Module-level `canvas`, `ctx`, `cw`, `ch` are used by `resizeCanvas()` at
   line 899 via closure.** Don't delete them, don't shadow them inside the
   new per-pane code. The error boundary in v5.13 renderChart depends on
   `ctx && cw && ch` being reachable in its catch block; the refactor needs
   to keep that catch block functional for the active pane.
2. **The v5.12 auto-scroll logic** (`!chartState.userHasPanned && isMarketHours()`)
   lives in the WS bar handler (`m.T === 'b'`). When you route by pane, each
   pane has its own `userHasPanned`. Each pane's auto-scroll must consult its
   own flag.
3. **Alpaca WS subscribe is per-connection, not per-channel.** Subscribing
   multiple times for the same symbol is a no-op; unsubscribing removes all
   listeners. If a symbol is shown in pane A and pane B, and pane A closes,
   do NOT unsubscribe, pane B still needs it. Track a refcount
   (`state.wsSubCount[sym]`) or just unsubscribe nothing and let duplicate
   subs pile up harmlessly.
4. **The `dpr` scaling constant is set once at module load.** If the user
   drags the window between monitors with different DPRs, canvases won't
   rescale. This is a pre-existing bug in single-pane mode too, don't fix it
   as part of this refactor, but note it.
5. **Signal generation (`runAgents`) runs on a 20s interval AND on symbol
   switch.** In multi-pane, it should still only run against the active pane.
   Running it against all 4 panes would triple the Claude API budget.

## Files touched
Only `apex-platform.html`. No function changes expected.

## When done
Merge to main, push, smoke test in production (Netlify auto-deploys). Ship
notes should highlight: layouts persist across sessions via localStorage,
each pane has independent symbol/TF/indicators, INSTANT ASSESSMENT targets
the active (gold-bordered) pane.
