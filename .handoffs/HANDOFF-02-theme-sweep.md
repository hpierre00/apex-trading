# Claude Code Handoff: Theme Hex Sweep (v5.15b)

## Context
v5.15a shipped theme infrastructure. `apex-platform.html` now has:
- `:root` with shared accent variables
- `[data-theme="dark"]`, `[data-theme="light"]`, `[data-theme="arctic"]` blocks
  with full CSS variable sets (`--bg`, `--panel`, `--border`, `--text`, etc.)
- `state.theme` with localStorage persistence (key `apex.theme`)
- `applyTheme(theme)` function, sets `data-theme` on `<html>`, re-renders chart
- Toolbar toggle (🌙 ☀️ ❄️) next to INDICATORS button, wired and hydrating on load

**Dark theme works perfectly** (it's the existing color set with no changes).
**Light and arctic toggle the `data-theme` attribute, but the page does not
fully re-skin** because ~200 hex literals throughout the CSS and inline styles
are still hardcoded. The toolbar buttons carry `title` warnings about this.

This session is the sweep to make light and arctic render correctly.

## Strategy

### Branch
    git checkout -b feature/theme-sweep

### Inventory first
    grep -cE '#[0-9a-fA-F]{6}' apex-platform.html
    grep -cE '#[0-9a-fA-F]{3,4}\b' apex-platform.html   # also short hex like #000

Expect ~200 total. Break into three passes:

### Pass 1: CSS rule sweep
Inside `<style>` blocks. `grep -nE '#[0-9a-fA-F]{6}' apex-platform.html |
grep -v 'data-theme'` (excludes the theme variant blocks themselves, which
are the source of truth and should stay hardcoded).

For each match, decide:
- **Theme-dependent surface (background, border, dim text):** replace with
  `var(--bg)`, `var(--panel)`, `var(--border)`, `var(--text-dim)`, etc.
  Pick the semantically closest variable.
- **Accent/brand color** (`--gold`, `--bull`, `--bear`, `--blue`, `--purple`):
  replace with the matching variable. These are already defined per-theme
  with appropriate contrast adjustments.
- **Indicator-specific color** (`#ff9800` SMA20 orange, `#9d4edd` SMA200 purple,
  `#26a69a` Bollinger teal, etc.): LEAVE AS-IS. These are chart-line colors
  meant to be readable on any background. Don't theme them.
- **Alpha-suffixed hex** (`#26a69a60`, `#f0b42990`): these don't map to CSS
  variables cleanly. Two options:
  1. Convert to `rgba()` using the base color: `rgba(38, 166, 154, 0.38)`.
  2. Add alpha variants to the theme palette: `--teal-faint: rgba(38, 166, 154, 0.38)`.
  Option 1 is simpler if the base color is theme-independent (most are
  indicator colors). Option 2 only if the faded color itself needs to theme.

After pass 1: dark should still look identical, light and arctic should cover
about 60-70% of the page correctly. Commit before moving on.

### Pass 2: Inline style sweep (JavaScript template literals)
    grep -nE 'style=".*#[0-9a-fA-F]{3,6}' apex-platform.html

Many `render*Tab()` functions build HTML via template literals with inline
`style="background:#0a0f18;..."` attributes. These need the same substitution
logic as Pass 1.

Tedious but mechanical. Biggest offenders are probably:
- `renderSignalsTab`
- `renderPerformanceTab`
- `renderOverviewTab`
- `runInstantAssessment` (loading spinner + result card)
- `showPriorAlerts` (archive view)
- `renderNewsTab`

After pass 2: page should look clean in all themes except the chart canvas.

### Pass 3: Canvas drawing sweep
This is the trickiest pass. `renderChart()` (and in v5.14 `renderChartForPane`
if multi-pane landed first) sets `ctx.fillStyle` and `ctx.strokeStyle` with
~30 hardcoded hex values: grid lines, axis labels, volume bars, candle wicks,
MA strokes, BB fills, VWAP, sub-panel chrome.

The pattern to use:

    function renderChart() {
      // Read theme colors once per render, not per draw call.
      // getComputedStyle is slow; caching avoids calling it ~30 times per frame.
      const cs = getComputedStyle(document.documentElement);
      const themeBg = cs.getPropertyValue('--chart-bg').trim() || '#05080d';
      const themeGrid = cs.getPropertyValue('--border').trim() || '#1a2332';
      const themeText = cs.getPropertyValue('--text').trim() || '#e4e9f2';
      const themeDim = cs.getPropertyValue('--text-dim').trim() || '#7a8699';
      // ... etc for every themed color used in the function

      ctx.fillStyle = themeBg;
      ctx.fillRect(0, 0, cw, ch);
      // ... use themeGrid, themeText, themeDim throughout
    }

Rules:
- **Do not** call `getComputedStyle` per ctx call. Cache at function top.
- **Leave candle fill colors** (`--bull`, `--bear`) as theme variables but
  ALSO cache them at the top for the same performance reason.
- **Do not theme indicator strokes** (SMA/EMA line colors). They should be
  readable on both light and dark. If contrast is bad on light, pick a
  mid-tone color that works on both, and apply it unconditionally.

The tricky edge cases:
- `ctx.fillStyle = 'rgba(10, 14, 20, 0.8)'` (semi-transparent overlays) →
  use `rgba()` with theme-appropriate RGB, OR use a CSS variable that
  includes the alpha channel (`--overlay: rgba(var(--panel-rgb), 0.8)`)
  if you want it to theme. Usually simpler to branch: light uses white 0.8,
  dark uses black 0.8.
- Drop shadows / glow effects with dark colors baked in. Recheck contrast
  on light theme; often you need to drop or invert shadows entirely.

### Testing loop
Keep all three themes open in three browser tabs during iteration. Switch
tabs to compare. Common regressions:
- **A dark border around a light card** (missed inline style)
- **White text on white background** (got `--text-dim` wrong for light theme)
- **Candle wicks invisible on light background** (wick color was `#333` hardcoded)
- **Indicator legend unreadable** (indicator label color was `--text` which is
  appropriate, but check contrast actually works on both themes)

### Expected commit sequence
1. CSS rule sweep (~1 hour)
2. Inline style sweep (~1 hour)
3. Canvas sweep (~1-2 hours, most error-prone)
4. Polish pass: screenshot all three themes, find missed spots, fix

### Remove the "partial" warnings
Once everything looks right, edit apex-platform.html and remove:
- `title="Theme — light/arctic pending hex sweep in v5.15b"` from `#themeGroup`
- `title="Light (Ivory) — partial"` from the ☀️ button
- `title="Arctic Blue — partial"` from the ❄️ button

Replace with neutral titles like "Light theme (Ivory)" and "Arctic theme".

### Watch for
The `selectSymbol` chat-reset divider I added in v5.14 uses:
`<div class="msg ai" style="opacity:0.6;font-size:10px;text-align:center;border:none;padding:8px 0">`
No hardcoded color there, should theme correctly automatically.

The v5.13 error boundary in `renderChart` catches errors and draws a red error
message on the canvas with `ctx.fillStyle = '#f6465d'`. `#f6465d` is the dark
theme bear color. Replace with `themeBear` (the cached `--bear` value) so the
error message adapts contrast on light themes.

## Files touched
Only `apex-platform.html`. No function changes.
