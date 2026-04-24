# APEX Deferred Work

Three work items deferred from web-based Claude sessions to Claude Code local
development. Do them in order; dependencies noted.

## Execution order

1. **HANDOFF-01-multi-pane.md** — Multi-pane chart layouts (1x1/1x2/2x2).
   Standalone, no dependencies. Largest of the three. Budget: half a day.

2. **HANDOFF-02-theme-sweep.md** — Light/Arctic theme hex sweep.
   Standalone, no dependencies. Can be done before OR after multi-pane.
   Budget: 2-3 hours.

3. **HANDOFF-03-pane-aware-assessment.md** — Pane-aware INSTANT ASSESSMENT,
   chat context, alerts. **Depends on HANDOFF-01.** Budget: 1 hour.

If HANDOFF-02 is done first, HANDOFF-01 still needs some care: when you
refactor renderChart → renderChartForPane, the cached `getComputedStyle` reads
for theme colors need to move with the function. Not hard, just aware.

## Why these were deferred

All three need visual iteration loops (switch state, see result, adjust) that
web-based sessions can't support. Claude Code has the right feedback loop:
local filesystem, live browser, quick restart, stateful workspace.

## Commit discipline

For each handoff, work on a feature branch:

    git checkout -b feature/multi-pane        # or feature/theme-sweep, etc.

Commit incrementally per the sub-steps in each handoff. Do NOT squash into
one commit; bisectable history matters if a theme or pane mode breaks.

Merge to main only after the entire test checklist in the handoff passes.

## Session log of what already shipped

See `git log --oneline` on main. Summary:
- v5.10 (52eef5e): baseline
- v5.11 (f09b93d): notification system, agent rebalance
- v5.12 (addee9e): auto-scroll, signal tuning, instant assessment, VWAP bands
- v5.13 (266c856): error boundary, unlimited WS reconnect, AI chat context
- v5.14 (37947be): trigger regex, chat DOM reset, WS auth breaker, market-hours unification
- v5.15a (5d5118c): alert date filtering + theme infrastructure
- v5.16 (a2dd67b): alert triggering fix for unwatched symbols

Next versions: v5.15b (theme sweep), v5.17 (pane-aware assessment, requires multi-pane).
Multi-pane itself is unnumbered so far; call it v5.18 when it lands, or pick
a new major like v6.0 if you want the multi-chart feature to signal a bigger
change to users.
