# Claude Code Handoff: Phase 1 — Evidence Base (HANDOFF-04)

## Priority

This supersedes HANDOFF-01, 02, 03 in the queue. Do this BEFORE multi-pane,
theme sweep, or pane-aware assessment. Reasoning: those handoffs polish the
UI of a signal system whose edge has not been measured. This handoff builds
the measurement.

## Context

APEX (github.com/hpierre00/apex-trading, single file apex-platform.html)
generates signals via a 5-agent weighted scoring system. The system tracks
forward outcomes (signalHistory persisted to localStorage) but has never
been backtested against historical data across multiple market regimes.

Key problem: every parameter decision in APEX — agent weights, confidence
threshold 0.18, ATR-multiple stops (1.5R) and targets (2R/4R), 30-signal
weight-learning gate, sentiment agent inclusion — is currently justified
by intuition, not data. Forward outcomes since v5.10 are path-dependent
on whatever symbols/timeframes were viewed during a brief period in one
market regime.

Before any further feature work, build the ability to measure what actually
has edge and what doesn't.

## Scope

Three deliverables, in order:

### Deliverable 1: Historical backtester
### Deliverable 2: Confidence calibration test
### Deliverable 3: Sentiment agent zero-out experiment

Deliverables 2 and 3 reuse Deliverable 1's outputs. Do them as a sequence,
not parallel.

---

## DELIVERABLE 1: Backtester

### Requirements

**Input:** Historical OHLCV bar data for a diverse set of tickers across
multiple timeframes, spanning 5+ years to cover multiple regimes (2020
COVID crash, 2021 euphoria, 2022 bear market, 2023-2025 mixed).

**Process:** Replay bars sequentially through `generateSignal`, tracking:
- Every signal the system would have generated
- Entry price (per current logic: bar close at fire time)
- Subsequent price action until stop, TP1, TP2, or 50-bar expiry
- Realistic execution costs applied (see below)

**Output:** Per-signal records and aggregate statistics.

### Data sourcing

**Don't use Alpaca's REST API for the full 5-year backtest.** Rate limits
and pagination will make it painful. Options:

1. **Polygon.io** historical bars endpoint. Free tier allows ~5 years of
   daily data; paid tier ($29/mo) unlocks minute-level history. Worth it
   for this.
2. **Alpaca historical bars** in chunked fetches (works but slow; you'll
   hit rate limits around the 1-minute-across-5-years-of-20-tickers mark).
3. **yfinance** via a small Python helper script. Free, no auth, works for
   daily data. Less reliable for minute-level going back multiple years.

Recommend option 1 with the $29/month tier for one month. Pull once, cache
to local Parquet files, then iterate the backtester against the cache for
free thereafter.

### Ticker universe for initial backtest

Pick 20 tickers across sectors and volatility profiles. Suggested starter:

```
Large-cap tech:  AAPL, MSFT, NVDA, GOOGL, META
Large-cap other: JPM, XOM, JNJ, WMT, V
Index ETFs:      SPY, QQQ, IWM, DIA
High-beta:       TSLA, COIN, SOFI, PLTR
Defensive:       KO, PG
```

Don't add the full S&P 500; 20 is enough to see regime behavior without
the backtest taking hours per iteration.

### Execution realism

This is the part that separates useful backtests from fantasy. Apply:

**Spread cost:** assume 0.01% spread on large-cap (SPY, AAPL tier), 0.05%
on small/mid-cap, 0.10% on high-beta/low-liquidity. Deduct from entry
price (you pay the ask) and from exit price (you receive the bid).

**Slippage:** on breakout entries specifically (momentum signals), assume
additional 0.05% adverse slippage representing the fact that you're buying
into strength. On pullback or mean-revert entries, less slippage.

**Fill assumptions:** assume 100% fills at the modeled price. This is
optimistic but acceptable for a first-pass backtest. Real missed fills on
fast-moving stocks would degrade numbers further; flag this as a known
limitation.

**No overnight gaps tracked separately.** If a signal is open and the
next bar opens past the stop, the fill is at next-bar-open, not the stop
price. This reflects reality (you can't stop-limit through a gap).

### Backtester architecture

Recommend building this in Python, not JavaScript. Reasons:

- pandas for data handling is dramatically better than anything in JS
- pyarrow/parquet for local caching is fast
- matplotlib/seaborn for output plots
- You're not going to ship the backtester; it's an analysis tool

Suggested structure:

```
backtester/
  fetch_data.py       # pull from Polygon, cache to parquet
  replay.py           # iterate bars, call signal_engine
  signal_engine.py    # Python port of generateSignal + agents
  execution.py        # spread/slippage application
  metrics.py          # win rate, expectancy, Sharpe, max DD
  analyze.py          # slice by regime, timeframe, agent, plot results
  main.py             # CLI driver
```

The Python port of generateSignal is the hard part. Must match the JS
version exactly or results are meaningless. Two approaches:

1. **Port by hand**, then validate against a fixed set of input bars that
   you also run through the JS version in a Node harness; outputs must
   match to N decimal places.
2. **Extract the signal logic from apex-platform.html into a pure JS
   module**, call it from Python via `node -e` or a tiny Express endpoint.
   Slower but removes the port-correctness risk.

Approach 2 is safer. Approach 1 is faster once validated. Pick based on
how much you trust your port-testing discipline.

### Metrics to output

Per signal:
- Symbol, timeframe, entry time, entry price, action, confidence
- Agent scores at fire time
- Exit time, exit price, exit reason (TP1/TP2/STOP/EXPIRED)
- R-multiple outcome
- Regime at fire time (see regime detection below)
- Whether execution costs flipped the outcome

Aggregate:
- Overall: win rate, loss rate, expiry rate, expectancy in R, Sharpe
  (assuming 1R risk per trade), max drawdown, profit factor
- Per timeframe (1m/5m/15m/1h/4h/1d)
- Per regime (trending, ranging, high-vol, low-vol)
- Per agent (which agents contribute signal to winners vs losers)
- Per symbol
- Per month / per year (to see regime effects)

### Regime detection (embedded in backtester)

For each bar where a signal fires, classify the regime using:

- **Trending:** ADX(14) > 25 AND slope of SMA50 non-flat over last 20 bars
- **Ranging:** ADX(14) < 20 AND price oscillating within 2-ATR channel
- **High volatility:** ATR(14) > 1.5x its 252-bar median
- **Low volatility:** ATR(14) < 0.7x its 252-bar median

These are starting heuristics; the backtester's output will tell you if
the thresholds need adjustment.

### Success criteria for Deliverable 1

You know you're done when:

- Backtester runs end-to-end on 20 tickers, 1d timeframe, 5 years
- Output includes a CSV of every signal with outcome + regime + execution-cost-applied P/L
- A summary Markdown or HTML report shows: overall stats, breakdown by
  regime, breakdown by timeframe (if you ran multi-TF)
- You can answer: "What is APEX's historical win rate on SPY 1d?"
  "Does it outperform a buy-and-hold baseline after costs?" "In which
  regimes does it perform best/worst?"

Expected runtime: 1-2 weeks of Claude Code sessions for an experienced
developer. Longer if you need to learn pandas/backtesting idioms.

---

## DELIVERABLE 2: Confidence calibration test

### Purpose

APEX displays a "confidence" percentage (composite score × 100). Users
(including you) interpret this as a win probability. It almost certainly
isn't — it's a monotonic ranking, not a probability. This test reveals
whether the two happen to align or diverge.

### Method

Using backtester output (Deliverable 1):

1. Filter to closed (non-expired) signals. You need outcomes.
2. Bin by confidence: deciles (0-10%, 10-20%, ... 90-100%) or quintiles
   if sample size is thin.
3. For each bin, compute actual win rate (wins / (wins + losses)).
4. Plot: X-axis confidence bin midpoint, Y-axis actual win rate.

### Interpretation

**If calibrated well:** the plot is a roughly monotonic increasing line,
and the 50% confidence bin has roughly 50% actual win rate. This would
mean "confidence" really is a probability.

**If not calibrated (expected outcome):** the plot is flat, noisy, or
monotonic but with a steep or shallow slope that doesn't match identity.
Example: 20% confidence → 48% win rate, 80% confidence → 54% win rate.
Confidence is a ranking, not a probability.

### Remediation if not calibrated

Option A: **Isotonic regression.** Fit a monotonic function from raw
confidence to observed win rate using the backtester data. Display the
calibrated value. This is the standard approach in ML classifier
calibration (scikit-learn has it built in).

Option B: **Rename the UI label.** If the backtester shows confidence has
no relationship to win probability, stop calling it confidence. Call it
"signal strength" or "composite score" and remove the % sign. This is an
honesty fix when calibration isn't salvageable.

Option C: **Refit the signal engine.** If confidence is completely
uninformative, the agent weighting is broken; this is a much bigger fix
that belongs in a later phase.

### Success criteria

You know you're done when:

- Calibration plot exists, is saved as an artifact, committed to the repo
- Decision documented: calibrate / relabel / deeper fix needed
- If calibrate: isotonic regression parameters saved, production UI shows
  calibrated %

Expected effort: 4-8 hours once Deliverable 1 is done.

---

## DELIVERABLE 3: Sentiment agent zero-out experiment

### Purpose

Test whether the sentiment agent is adding value or adding noise. Current
weight is 0.15 of total signal. Sentiment is a Finnhub-headline keyword
classifier, which is known to struggle with nuance (earnings-beat-but-
guidance-down, sarcasm, missing context).

### Method

Run the backtester twice against the same historical data and ticker set:

**Run A:** Current weights — CHART 0.25, SENTIMENT 0.15, FUNDAMENTAL 0.20,
RISK 0.20, MACRO 0.20.

**Run B:** Sentiment zeroed — CHART 0.25, SENTIMENT 0.00, FUNDAMENTAL 0.20,
RISK 0.20, MACRO 0.20, normalized to sum to 1 (redistribute the 0.15
proportionally or drop it and renormalize the rest — try both).

Compare:
- Total signals generated
- Win rate
- Expectancy in R
- Max drawdown
- Per-regime breakdown (sentiment might hurt in some regimes, help in
  others; this is the real question)

### Interpretation

**If Run B (no sentiment) is worse:** sentiment has signal. Keep the agent
but consider whether 0.15 is the right weight. Backtest a few weight
variants.

**If Run B is same or better:** sentiment agent is noise. Two options:
1. Remove entirely, normalize remaining weights
2. Keep but reduce to 0.05 (minimal display, not decision-impacting)

**Expected result:** Run B wins or ties. This is consistent with the
general finding that naive sentiment classifiers on financial headlines
underperform random inputs once you account for multiple comparisons.
But measure before deciding; that's the point.

### Follow-up if sentiment is kept

If you decide sentiment has value and want to improve rather than remove,
the upgrade path is:

1. Replace Finnhub's classifier with a fine-tuned FinBERT model (HuggingFace)
2. Use GPT-4o-mini or Claude Haiku as a classifier with prompt "rate this
   headline's 24-hour impact on stock price, -1 to +1"
3. Use structured earnings call sentiment (specific models exist for this)

These are each multi-week efforts. Don't pursue unless the zero-out test
shows sentiment is worth the investment.

### Success criteria

You know you're done when:

- Two backtester runs complete with identical inputs except sentiment weight
- Comparison table exists: metric × run A × run B × delta
- Decision documented: keep / reduce / remove / replace

Expected effort: 2-4 hours once Deliverable 1 is done (mostly running
backtester + summarizing output).

---

## Constraints and principles

**Don't overfit to the backtest.** Hold out the last 12 months of data as
a validation set. Tune parameters on the first 4 years, report on the
held-out year separately. If the held-out year looks wildly different
from the training period, any parameter choices made on training data are
overfit and need to be re-examined.

**Don't optimize for Sharpe alone.** A system with Sharpe 1.2 and a 15%
max DD is better than one with Sharpe 1.6 and a 45% max DD for a personal
trader who has to psychologically survive the drawdown. Include max DD
prominently in output.

**Report costs honestly.** Include pre-cost and post-cost numbers side by
side. If edge disappears after spread + slippage, that's the real answer.

**Don't commit the data cache to git.** Parquet files will be large;
add `backtester/data/` to .gitignore. Do commit the fetch scripts and
the analysis code.

**Flag data quality issues.** If Polygon returns suspicious bars (zero
volume, prices 100x normal), filter them out and log what was filtered.
Don't silently use garbage.

## What not to build in this handoff

Resist scope creep. Specifically:

- **Don't build the regime-adaptive signal engine yet.** That's Phase 2.
  For now, regime is a classification applied to the backtest output, not
  a feedback into signal generation.
- **Don't build the options integration.** Separate concern.
- **Don't redesign the agent architecture.** Backtest the current one
  first; redesign is meaningful only with evidence of what's broken.
- **Don't port to React / rewrite the frontend.** The backtester is a
  separate tool, not a refactor of apex-platform.html.

## Deliverable format

At the end of this handoff, merge to main (or a long-lived branch if
you prefer) a `backtester/` directory with:

- Python scripts per the architecture above
- A `README.md` describing how to run the backtester
- A `results/` folder with the initial backtest output (CSV + summary
  markdown + calibration plot + sentiment comparison table)
- An `ADR.md` (architecture decision record) summarizing what the three
  deliverables revealed and what the next phase should prioritize

The ADR is the important artifact. It's what you'll use to decide whether
Phase 2 starts with entry-logic redesign, regime adaptation, or something
else entirely.

## After Phase 1

Once the ADR is written, reassess. Likely Phase 2 topics based on backtest
findings:

- Entry logic redesign (pullback / limit vs market close) — will probably
  show meaningful improvement
- Regime-adaptive thresholds — only meaningful if Phase 1 shows strong
  regime-dependent variance
- Trailing ATR stops + scaled exits — will need backtest validation
- Multi-timeframe confirmation filter — easy to test

HANDOFF-01/02/03 (multi-pane, theme, pane-aware) resume their place in the
queue after Phase 2, since they don't affect signal quality.

## Files

Deliverable 1 creates a new `backtester/` directory. It does NOT modify
apex-platform.html.

Deliverable 2 may write a new `backtester/calibration/` artifact and,
if calibrated, will eventually modify apex-platform.html to display
calibrated confidence (but that production change is Phase 2).

Deliverable 3 is pure analysis; no production code changes.
