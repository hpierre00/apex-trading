# ADR: APEX Signal Engine — Backtester Phase 1 Findings

## Status: Final
## Date: 2026-05-01

---

### Context

APEX is a single-file trading terminal (`apex-platform.html`) that generates signals
via a 5-agent weighted scoring system. The five agents are CHART (weight 0.25),
SENTIMENT (0.15), FUNDAMENTAL (0.20), RISK (0.20), and MACRO (0.20). Signals fire
when the weighted composite score exceeds a confidence threshold of 18%. Entry levels,
stops (1.5× ATR), and targets (TP1 2× ATR, TP2 4× ATR) are all ATR-based.

Before this work, every parameter in APEX — agent weights, confidence threshold,
ATR multiples, the 30-signal weight-learning gate — was justified by intuition, not
data. This backtester was built to answer one question:

> **Does the 4-agent APEX signal engine have historical edge on daily bars after
> realistic execution costs?**

**Scope of Phase 1:**
- **Agents replayed:** CHART and RISK (computable from OHLCV). SENTIMENT zeroed to
  weight 0.0 (no historical news archive). FUNDAMENTAL and MACRO set to score 0.0
  (no point-in-time historical data); their weights remain and are renormalized with
  SENTIMENT so the 4 active agents sum to 1.0.
- **Data:** yfinance daily OHLCV, 20 tickers, 5-year window (2021-05-03 to 2026-05-01),
  94,512 total bars cached to Parquet.
- **Tickers:** AAPL, MSFT, NVDA, GOOGL, META, JPM, XOM, JNJ, WMT, V, SPY, QQQ, IWM,
  DIA, TSLA, COIN, SOFI, PLTR, KO, PG.
- **Execution costs:** Spread by liquidity tier (0.01% ETFs, 0.03% large-cap, 0.10%
  high-beta). Momentum slippage 0.05% when signal direction matches 3-bar price
  momentum. Gap fills at open, not stop price.
- **Hold-out:** Last 252 trading days (2025-05-01 onward) held out as validation.

---

### Results Summary

| Metric | Training (before 2025-05-01) | Validation (from 2025-05-01) |
|---|---|---|
| Signals | 2,489 | 636 |
| BUY / SELL split | 1,263 / 1,226 | 383 / 253 |
| Win rate (TP1+TP2) | 38.8% | 40.9% |
| TP1 hit rate | 38.2% | 40.1% |
| TP2 hit rate | 0.6% | 0.8% |
| Stop hit rate | 56.9% | 53.5% |
| Expiry rate | 4.3% | 5.7% |
| Mean R-multiple | −0.0821 | −0.0251 |
| Avg win R | +1.2825 | +1.3187 |
| Avg loss R | −1.0338 | −1.0630 |
| **Expectancy** | **−0.090 R** | **−0.029 R** |
| Sharpe (annualized) | −1.495 | −0.434 |
| Max consecutive losses | 28 | 13 |
| Avg hold (bars) | 6.8 | 6.8 |
| Break-even win rate | 44.7% | 44.7% |

**BUY vs SELL breakdown (training):**

| Direction | Signals | Win% | Expectancy |
|---|---|---|---|
| BUY | 1,263 | 42.6% | +0.005 R |
| SELL | 1,226 | 34.9% | −0.187 R |

---

### Key Findings

**1. No aggregate edge after realistic costs.**
Overall expectancy is −0.090 R on the training set and −0.029 R on the held-out
validation set. The system generates consistent signal geometry (stop and target levels
work mechanically) but the win rate of 38.8% is insufficient to overcome the cost
structure. Break-even requires 44.7% win rate at the observed average win/loss ratio.

**2. Direction asymmetry: BUY signals are near break-even; SELL signals are the
structural problem.**
BUY signals produce +0.005 R expectancy (training), essentially break-even before
considering signal selection improvements. SELL signals produce −0.187 R. The entire
aggregate loss is attributable to SELL signals. This is consistent with the 4-year
window being predominantly an upward-trending market where short signals are
structurally disadvantaged. A BUY-only filter is the single highest-leverage
experiment available.

**3. Regime sensitivity: system performs materially better in uptrending markets.**
Classifying each bar as UP (50-day SMA rising over last 20 bars) or DOWN otherwise:

- UP regime: 1,374 signals, 41.4% win rate, −0.032 R expectancy
- DOWN regime: 1,063 signals, 35.4% win rate, −0.169 R expectancy

Top UP-regime performers by expectancy: NVDA (+0.200 R), META (+0.176 R),
TSLA (+0.100 R). Anomalies with better DOWN-regime performance: IWM and PLTR
(likely mean-reversion character in these instruments). The combination of
BUY-only + UP-regime gate applied to the strongest UP-regime tickers is the most
promising Phase 2 hypothesis.

**4. TP2 is essentially unreachable. The 4R target is miscalibrated.**
TP2 hit rate is 0.6% (training) and 0.8% (validation). With an average hold of
6.8 bars, the system exits via TP1 or stop well before the 4R level is approached.
The TP2 level inflates the theoretical R-ratio but contributes negligible real P&L.
Reducing TP2 from 4R to 2R (partial profit model) or removing it and measuring
impact on expectancy is a straightforward Phase 2 test.

**5. Confidence score has no win-probability content.**
Pearson correlation between confidence and realized win outcome is −0.058 (training).
The isotonic regression fit collapses to a near-flat plateau (≈39% calibrated win
probability for virtually all confidence levels from 18% to 53%). ECE drops 87.5%
after isotonic calibration, but this improvement reflects moving from the naive
"28% confidence = 28% win probability" assumption to "all signals have approximately
39% win probability" — not meaningful predictive calibration.

The confidence score measures signal *strength* (how aligned the agents are), not
win *probability*. Displaying it as a percentage to users implies a probabilistic
interpretation that the data does not support. The label should be renamed to
"Signal Strength" and the percentage sign removed from the UI.

---

### Recommended Experiments (Phase 2 Candidates)

**1. BUY-only filter.**
Re-run `backtest.py` with SELL signals suppressed (single-line change). Expected
outcome: approximately break-even or small positive expectancy, based on training
BUY expectancy of +0.005 R. This is the minimum viable experiment and can be run
in under one minute against cached data.

**2. BUY + UP-regime gate.**
Filter further to BUY signals only when the 50-day SMA is rising. Start with
NVDA, META, TSLA — the three tickers showing strongest UP-regime performance
(+0.100 to +0.200 R expectancy). If this subset is profitable, expand to the
full 20-ticker universe. Regime classification logic already exists in
`calibrate.py` and can be ported to `backtest.py` as a filter.

**3. TP2 recalibration: 4R → 2R.**
Replace TP2 with a second partial-exit at 2R (identical to TP1). This converts
the signal structure from "hold until 4R or expire" to a scaled-exit model.
Measure: change in TP2 hit rate, change in average win R, change in expectancy.
Hypothesis: more exits near TP1, fewer long holds to expiry, modest improvement
in expectancy.

**4. Sentiment proxy reintegration.**
The sentiment agent was zeroed out because no historical news archive was available.
Free alternatives to explore: (a) VIX term structure as a fear/greed proxy,
(b) daily put/call ratio from CBOE, (c) AAII sentiment survey (weekly). Any of
these could be pulled historically from free sources and ingested as a
pre-computed score. Hypothesis: a macro-sentiment proxy has more signal content
than a keyword classifier on 7-day news headlines.

**5. Confidence threshold lift: test 30% floor vs current 18%.**
Given the slightly inverse correlation (higher confidence → marginally lower win
rate in some deciles), raising the threshold from 18% to 30% would filter out
~65% of training signals. This is as likely to hurt as help. Test before deploying.
If it does hurt, the evidence is clear: the threshold is already set at the right
level or slightly high, and the confidence metric should be abandoned as a filter.

---

### Decision

The 4-agent APEX system as currently configured does not have demonstrable edge on
daily bars after realistic execution costs. The system is structurally sound
(consistent −1R stop geometry, working ATR sizing) but directionally miscalibrated
on SELL signals. Recommend Phase 2 focused on BUY-only + regime filter before any
monetization or production deployment decision.

The fastest next step is a one-line change to `backtest.py` (suppress SELL signals)
followed by re-running the full calibration suite. If BUY-only expectancy holds
positive on the validation set, proceed to regime gating. If it does not, the
problem is more fundamental (signal engine architecture) and requires a deeper
redesign before further parameter tuning.

---

### Phase 2 Results (Experiments 1–3)

| Filter | Train Exp | Val Exp | Val Sharpe | Verdict |
|---|---|---|---|---|
| Original (all signals) | −0.090 R | −0.029 R | −0.434 | Baseline |
| BUY-only | +0.005 R | +0.097 R | +1.49 | **Ship this** |
| BUY-only + UP-regime | −0.005 R | +0.072 R | — | Marginal, not worth signal reduction |
| BUY-only, TP2=2×ATR | −0.007 R | +0.085 R | — | Worse than original TP2, don't change |

**Phase 2 Decision:** Suppress SELL signals in production. Keep 4×ATR TP2.
Do not add UP-regime gate. BUY-only is the deployable filter.

Scripts: `phase2.py` (Experiments 1–2), `exp3.py` (Experiment 3).
Results: `results/signals_buyonly.csv`, `results/signals_buyonly_upregime.csv`,
`results/signals_buyonly_tp2_2r.csv`.

---

### What Was NOT Tested

- **1h timeframe.** 1h bars are cached (69,411 bars) but not replayed. The 1h
  signal engine uses different lookback and normalization parameters; a 1h backtest
  is a distinct experiment.
- **Sentiment agent with real data.** The Finnhub headline classifier was designed
  for live operation. Historical backtesting would require a paid news archive or a
  proxy as described in Phase 2 Experiment 4.
- **Options signals.** Any options-related logic in the APEX codebase was not ported
  or tested.
- **Live execution vs simulated fills.** 100% fill assumption at modeled price is
  optimistic. Real missed fills, especially on fast-moving names (TSLA, COIN), would
  degrade numbers further.
- **Learned weight rebalancing.** The `rebalanceAgentWeights` function (fires after
  30+ resolved signals) was not replayed. The backtest uses static renormalized weights
  throughout.
