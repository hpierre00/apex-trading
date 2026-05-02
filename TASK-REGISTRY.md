# APEX Task Registry

| Task ID | Title | Status | Completed | Outcome |
|---|---|---|---|---|
| APEX-20260423-001 | Backtester Phase 1 — Evidence Base | **COMPLETE** | 2026-05-01 | No aggregate edge. BUY marginally positive (+0.005 R). SELL structurally negative (−0.187 R). See `backtester/ADR.md`. Phase 2 experiments defined. |
| APEX-20260423-002 | Backtester Phase 2 — Filter experiments | **COMPLETE** | 2026-05-01 | BUY-only validated: +0.097 R val, Sharpe +1.49. SELL suppression is the production change. |
| APEX-20260501-001 | v5.22 timeframe-aware signal calibration | **COMPLETE** | 2026-05-01 | Per-TF thresholds, dedup windows, fund/macro downweighted intraday, BUY-only filter applied |
| APEX-20260501-002 | v5.23 smart signal engine | **COMPLETE** | 2026-05-01 | 9 detectors live: power inflow, distribution, volume climax, VWAP, BB squeeze, ORB, failed breakdown, RSI div, prior day levels |
| APEX-20260501-003 | exp4 SELL regime gate experiment | **COMPLETE** | 2026-05-01 | Gate halves SELL loss (-0.187 to -0.094R train) but stays negative on holdout. SELL suppression confirmed. |
| APEX-20260501-004 | Multi-pane chart layout | **COMPLETE** | 2026-05-01 | 1x1, 1x2, 2x2 grid. Per-pane symbol, TF, chartState, mouse handlers, WS routing. 7 commits. |
| APEX-20260501-005 | HANDOFF-03 pane-aware assessment | **COMPLETE** | 2026-05-02 | Per-pane ⚡ buttons, assessment + chat route to active pane, tooltip redesigned |
| APEX-20260502-001 | HANDOFF-02 theme sweep | **COMPLETE** | 2026-05-02 | CSS + JS + canvas ctx sweep. 124 hex targets audited, 31 replaced. Light and arctic themes fully functional. |

---

## APEX-20260423-001 — Backtester Phase 1

**Status:** COMPLETE  
**Completed:** 2026-05-01  
**Branch:** main

### Deliverables
- Port-validation harness (60/60 JS↔Python match)
- Data fetcher (20 tickers, daily + 1h, 94,512 bars)
- Backtest engine (3,125 signals, full execution realism)
- Calibration suite (decile analysis, direction bias, regime check, isotonic fit)
- ADR with Phase 2 experiment roadmap

### Key Numbers
- Training expectancy: −0.090 R | Validation: −0.029 R
- BUY expectancy: +0.005 R | SELL expectancy: −0.187 R
- UP-regime win rate: 41.4% | DOWN-regime: 35.4%
- Confidence ↔ win correlation: −0.058 (no predictive content)

### Phase 2 Entry Point
Re-run with SELL signals suppressed. If BUY-only holds positive on validation set,
proceed to BUY + UP-regime gate on NVDA/META/TSLA.

---

## Queued Tasks (resumed after Phase 1)

| Task ID | Title | Source handoff |
|---|---|---|
| HANDOFF-01 | Multi-pane chart layout | `.handoffs/HANDOFF-01-multi-pane.md` |
| HANDOFF-02 | Theme sweep | `.handoffs/HANDOFF-02-theme-sweep.md` |
| HANDOFF-03 | Pane-aware assessment | `.handoffs/HANDOFF-03-pane-aware-assessment.md` |
