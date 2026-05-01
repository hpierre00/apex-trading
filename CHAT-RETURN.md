# Return to Chat: APEX-20260423-001 Backtester Phase 1

**Type:** completion
**Date:** 2026-05-01
**Task ID:** APEX-20260423-001

---

## What Was Built

| File | Description |
|---|---|
| `backtester/signal_engine.js` | JS signal engine extracted from apex-platform.html (reference) |
| `backtester/signal_engine.py` | Python port — validated 60/60 test cases, tolerance 0.001 |
| `backtester/generate_fixtures.py` | 60-case adversarial fixture generator (port-validation gate) |
| `backtester/validate.py` | Port-validation harness — hard gate before proceeding |
| `backtester/fetch_data.py` | yfinance data fetcher — 20 tickers, daily + 1h, Parquet cache |
| `backtester/backtest.py` | Full replay engine — execution costs, gap handling, 20-bar expiry |
| `backtester/calibrate.py` | 4-analysis calibration suite: deciles, direction, regime, isotonic |
| `backtester/ADR.md` | Architecture Decision Record — full findings and Phase 2 roadmap |
| `backtester/requirements.txt` | yfinance, pyarrow, pandas, scikit-learn, numpy |
| `.gitignore` | Excludes backtester/data/ and .venv |

**Data cached (gitignored):** 94,512 bars across 20 tickers (25,101 daily + 69,411 1h)

---

## Answer to the Core Question

**Does the 4-agent APEX signal engine have historical edge on daily bars after
realistic execution costs?**

**No.** Overall expectancy is −0.090 R (training) and −0.029 R (validation).

**But the picture is not uniform:**

- **BUY signals are near break-even:** +0.005 R expectancy (training), 42.6% win rate.
- **SELL signals are the structural problem:** −0.187 R expectancy, 34.9% win rate.
  The entire aggregate loss is attributable to SELL signals.
- **Regime matters:** System is meaningfully better in uptrending markets (UP-regime
  expectancy −0.032 R vs DOWN-regime −0.169 R). NVDA, META, TSLA show positive UP-regime
  expectancy (+0.100 to +0.200 R).
- **TP2 never hits:** 0.6% hit rate. The 4R target is too ambitious for daily-bar
  signals with 6.8-bar average holds.
- **Confidence is not a probability:** Pearson r = −0.058 between confidence and win
  outcome. The isotonic fit is flat. Rename to "Signal Strength" in the UI.

---

## Phase 2 Experiments (priority order)

1. **BUY-only filter** — one-line change to `backtest.py`, run immediately.
   Expected to approximately break even or show small positive expectancy.
2. **BUY + UP-regime gate** — filter to BUY signals when 50-day SMA is rising.
   Start with NVDA, META, TSLA. Regime logic already in `calibrate.py`.
3. **TP2 recalibration** — reduce from 4R to 2R, measure hit-rate and expectancy impact.
4. **Sentiment proxy** — VIX term structure or put/call ratio as free sentiment proxy.
5. **Confidence threshold lift** — test 30% floor vs 18%; likely hurts given inverse
   correlation, but worth confirming.

---

## Next Claude Code Task

Await user decision on Phase 2 scope.

Fastest entry point: open `backtest.py`, find the line that appends to `recs`, add
`if action == 'SELL': continue` before the entry execution block. Re-run
`backtest.py` then `calibrate.py`. Report new expectancy and win rate.

Full Phase 2 design is in `backtester/ADR.md` under "Recommended Experiments."
