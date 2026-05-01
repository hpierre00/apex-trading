# APEX Task Registry

| Task ID | Title | Status | Outcome |
|---|---|---|---|
| APEX-20260423-001 | Backtester Phase 1 — Evidence Base | **COMPLETE** | No aggregate edge. BUY marginally positive (+0.005 R). SELL structurally negative (−0.187 R). See `backtester/ADR.md`. Phase 2 experiments defined. |

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
