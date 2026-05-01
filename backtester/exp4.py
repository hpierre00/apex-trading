#!/usr/bin/env python3
"""
exp4.py -- Phase 2 Experiment 4: SELL regime gate.

Loads SELL signals from signals.csv. Applies two-condition regime gate:
  1. 50-day SMA falling (today's SMA50 < SMA50 20 bars ago)
  2. RSI(14) on signal bar >= 45 (stock was overbought before signal)

Saves gated signals to results/signals_sell_regimegated.csv.
Prints side-by-side vs original SELL signals.

Answers: does SELL signal edge exist with trend-confirmation filter?
If expectancy positive -> re-enable SELL in v5.24 with this gate.
If still negative     -> SELL stays suppressed.
"""
import csv
import math
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median, stdev

import numpy as np
import pandas as pd

REPO = Path(__file__).parent
DATA_DIR    = REPO / 'data'
RESULTS_DIR = REPO / 'results'
SIGNALS_CSV   = RESULTS_DIR / 'signals.csv'
GATED_CSV     = RESULTS_DIR / 'signals_sell_regimegated.csv'

TICKERS = [
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META',
    'JPM',  'XOM',  'JNJ',  'WMT',   'V',
    'SPY',  'QQQ',  'IWM',  'DIA',
    'TSLA', 'COIN', 'SOFI', 'PLTR',
    'KO',   'PG',
]

_FLOAT_COLS = {'confidence', 'entry_price', 'stop_price', 'tp1', 'tp2',
               'spread_cost_pct', 'slippage_pct', 'exit_price', 'r_multiple'}
_INT_COLS   = {'hold_bars'}

CSV_COLS = [
    'ticker', 'date', 'direction', 'confidence',
    'entry_price', 'stop_price', 'tp1', 'tp2',
    'spread_cost_pct', 'slippage_pct',
    'outcome', 'exit_price', 'r_multiple', 'hold_bars', 'set',
]


def load_records(path: Path) -> list:
    recs = []
    with open(path, newline='') as f:
        for row in csv.DictReader(f):
            for col in _FLOAT_COLS:
                if col in row:
                    row[col] = float(row[col])
            for col in _INT_COLS:
                if col in row:
                    row[col] = int(row[col])
            recs.append(row)
    return recs


def compute_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    delta = np.diff(closes)
    gain  = np.where(delta > 0, delta, 0.0)
    loss  = np.where(delta < 0, -delta, 0.0)
    avg_g = np.full(len(closes), np.nan)
    avg_l = np.full(len(closes), np.nan)
    if len(gain) < period:
        return avg_g
    avg_g[period] = gain[:period].mean()
    avg_l[period] = loss[:period].mean()
    for i in range(period + 1, len(closes)):
        avg_g[i] = (avg_g[i-1] * (period - 1) + gain[i-1]) / period
        avg_l[i] = (avg_l[i-1] * (period - 1) + loss[i-1]) / period
    rs  = np.where(avg_l == 0, np.inf, avg_g / avg_l)
    rsi = 100 - (100 / (1 + rs))
    rsi[:period] = np.nan
    return rsi


def build_regime_and_rsi_maps() -> tuple:
    """
    Returns:
      regime_map : (ticker, date_str) -> 'FALLING' | 'RISING' | 'UNKNOWN'
      rsi_map    : (ticker, date_str) -> float RSI(14) value
    """
    regime_map: dict = {}
    rsi_map:    dict = {}

    for tk in TICKERS:
        path = DATA_DIR / f'{tk}_daily.parquet'
        if not path.exists():
            continue
        df = pd.read_parquet(path)
        closes = df['close'].values.astype(float)
        dates  = [str(ts.date()) for ts in df.index]

        # Regime: SMA50 slope over 20 bars
        sma50     = df['close'].rolling(50).mean()
        sma50_lag = sma50.shift(20)
        for i, (ts, sma, lag) in enumerate(zip(df.index, sma50, sma50_lag)):
            d = str(ts.date())
            if np.isnan(sma) or np.isnan(lag):
                regime_map[(tk, d)] = 'UNKNOWN'
            elif sma < lag:
                regime_map[(tk, d)] = 'FALLING'
            else:
                regime_map[(tk, d)] = 'RISING'

        # RSI(14)
        rsi_vals = compute_rsi(closes, 14)
        for d, rv in zip(dates, rsi_vals):
            rsi_map[(tk, d)] = float(rv) if not np.isnan(rv) else float('nan')

    return regime_map, rsi_map


def _stats_block(recs: list, label: str) -> None:
    if not recs:
        print(f'\n{label}: no signals\n')
        return

    total  = len(recs)
    tp1    = [r for r in recs if r['outcome'] == 'TP1_HIT']
    tp2    = [r for r in recs if r['outcome'] == 'TP2_HIT']
    stops  = [r for r in recs if r['outcome'] == 'STOP_HIT']
    expiry = [r for r in recs if r['outcome'] == 'EXPIRED']
    wins   = tp1 + tp2

    wr    = len(wins)  / total * 100
    tp1r  = len(tp1)   / total * 100
    tp2r  = len(tp2)   / total * 100
    stopr = len(stops) / total * 100
    expr  = len(expiry)/ total * 100

    rs      = [r['r_multiple'] for r in recs]
    win_rs  = [r['r_multiple'] for r in wins]
    loss_rs = [r['r_multiple'] for r in stops]

    mean_r  = sum(rs) / len(rs)
    med_r   = median(rs)
    avg_win = sum(win_rs)  / len(win_rs)  if win_rs  else 0.0
    avg_los = sum(loss_rs) / len(loss_rs) if loss_rs else 0.0
    exp_r   = (len(wins)/total) * avg_win + (len(stops)/total) * avg_los

    date_r: dict = defaultdict(float)
    for r in recs:
        date_r[r['date']] += r['r_multiple']
    daily_rs = list(date_r.values())
    if len(daily_rs) > 1:
        std_r  = stdev(daily_rs)
        sharpe = (sum(daily_rs)/len(daily_rs)) / std_r * math.sqrt(252) if std_r > 1e-9 else 0.0
    else:
        sharpe = 0.0

    chron_r    = [r['r_multiple'] for r in sorted(recs, key=lambda x: x['date'])]
    max_consec = cur_consec = 0
    for v in chron_r:
        if v < 0:
            cur_consec += 1
            max_consec = max(max_consec, cur_consec)
        else:
            cur_consec = 0

    by_ticker = defaultdict(list)
    for r in recs:
        by_ticker[r['ticker']].append(r)

    W = 60
    print(f'\n{"="*W}')
    print(f'  {label}')
    print(f'{"="*W}')
    print(f'  Total signals : {total:,}')
    print(f'  Outcomes      : TP1 {tp1r:.1f}%  TP2 {tp2r:.1f}%  '
          f'STOP {stopr:.1f}%  EXPIRED {expr:.1f}%')
    print(f'  Win rate      : {wr:.1f}%  (TP1+TP2)')
    print(f'  Mean R        : {mean_r:+.4f}')
    print(f'  Median R      : {med_r:+.4f}')
    print(f'  Avg win R     : {avg_win:+.4f}')
    print(f'  Avg loss R    : {avg_los:+.4f}')
    print(f'  Expectancy    : {exp_r:+.4f} R')
    print(f'  Sharpe (ann.) : {sharpe:+.3f}')
    print(f'  Max consec L  : {max_consec}')
    print(f'  Avg hold bars : {sum(r["hold_bars"] for r in recs)/total:.1f}')
    print(f'\n  {"Ticker":<6}  {"N":>5}  {"Win%":>6}  {"MeanR":>7}  {"Exp R":>7}')
    print(f'  {"-"*38}')
    for tk in TICKERS:
        tr = by_ticker.get(tk, [])
        if not tr:
            continue
        tw   = [x for x in tr if x['outcome'] in ('TP1_HIT', 'TP2_HIT')]
        tl   = [x for x in tr if x['outcome'] == 'STOP_HIT']
        twr  = len(tw) / len(tr) * 100
        tmr  = sum(x['r_multiple'] for x in tr) / len(tr)
        taw  = sum(x['r_multiple'] for x in tw) / len(tw) if tw else 0.0
        tal  = sum(x['r_multiple'] for x in tl) / len(tl) if tl else 0.0
        texr = (len(tw)/len(tr))*taw + (len(tl)/len(tr))*tal
        print(f'  {tk:<6}  {len(tr):>5}  {twr:>5.1f}%  {tmr:>+7.4f}  {texr:>+7.4f}')
    print(f'{"="*W}')


def main() -> None:
    if not SIGNALS_CSV.exists():
        sys.exit(f'ERROR: {SIGNALS_CSV} not found. Run backtest.py first.')

    print('Loading signals.csv ...')
    all_recs = load_records(SIGNALS_CSV)
    sell_all = [r for r in all_recs if r['direction'] == 'SELL']
    print(f'  {len(all_recs):,} total signals, {len(sell_all):,} SELL signals')

    print('Building regime and RSI maps from daily parquet files ...')
    regime_map, rsi_map = build_regime_and_rsi_maps()

    # Apply two-condition gate
    gated   = []
    skipped = {'rising': 0, 'rsi_low': 0, 'both': 0, 'unknown': 0}

    for r in sell_all:
        tk, dt = r['ticker'], r['date']
        regime = regime_map.get((tk, dt), 'UNKNOWN')
        rsi    = rsi_map.get((tk, dt), float('nan'))

        cond_falling = (regime == 'FALLING')
        cond_rsi     = (not math.isnan(rsi) and rsi >= 45)

        if regime == 'UNKNOWN':
            skipped['unknown'] += 1
        elif not cond_falling and not cond_rsi:
            skipped['both'] += 1
        elif not cond_falling:
            skipped['rising'] += 1
        elif not cond_rsi:
            skipped['rsi_low'] += 1
        else:
            gated.append(r)

    print(f'\nGate results:')
    print(f'  Pass (SMA falling + RSI >= 45) : {len(gated):,}')
    print(f'  Fail - SMA not falling          : {skipped["rising"]:,}')
    print(f'  Fail - RSI < 45                 : {skipped["rsi_low"]:,}')
    print(f'  Fail - both conditions missed   : {skipped["both"]:,}')
    print(f'  Unknown regime                  : {skipped["unknown"]:,}')
    print(f'  Retention rate                  : {len(gated)/len(sell_all)*100:.1f}%')

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(GATED_CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLS)
        w.writeheader()
        w.writerows(gated)
    print(f'\nWrote {len(gated):,} records -> {GATED_CSV.name}')

    train_all   = [r for r in sell_all if r['set'] == 'train']
    val_all     = [r for r in sell_all if r['set'] == 'val']
    train_gated = [r for r in gated    if r['set'] == 'train']
    val_gated   = [r for r in gated    if r['set'] == 'val']

    print('\n\n>>> ORIGINAL SELL (all, no gate) <<<')
    _stats_block(train_all,   'SELL (original) -- TRAINING')
    _stats_block(val_all,     'SELL (original) -- VALIDATION')

    print('\n\n>>> SELL + REGIME GATE (SMA falling + RSI >= 45) <<<')
    _stats_block(train_gated, 'SELL + REGIME GATE -- TRAINING')
    _stats_block(val_gated,   'SELL + REGIME GATE -- VALIDATION')

    # Compact comparison
    def _row(label, recs):
        if not recs:
            return f'  {label:<38}  N=     0  WR=  n/a   Exp=    n/a'
        wins  = [r for r in recs if r['outcome'] in ('TP1_HIT', 'TP2_HIT')]
        stops = [r for r in recs if r['outcome'] == 'STOP_HIT']
        wr    = len(wins)  / len(recs) * 100
        aw    = sum(r['r_multiple'] for r in wins)  / len(wins)  if wins  else 0.0
        al    = sum(r['r_multiple'] for r in stops) / len(stops) if stops else 0.0
        exp_r = (len(wins)/len(recs))*aw + (len(stops)/len(recs))*al
        verdict = '<<< POSITIVE' if exp_r > 0 else ''
        return (f'  {label:<38}  N={len(recs):>5}  WR={wr:>5.1f}%  '
                f'Exp={exp_r:>+7.4f} R  {verdict}')

    W = 80
    print(f'\n\n{"="*W}')
    print('  EXP 4 SIDE-BY-SIDE: SELL original vs regime-gated')
    print(f'{"="*W}')
    print(f'  {"Filter":<38}  {"N":>5}  {"WR":>7}  {"Expectancy":>12}')
    print(f'  {"-"*74}')
    print('  -- TRAINING --')
    print(_row('SELL original', train_all))
    print(_row('SELL + regime gate', train_gated))
    print()
    print('  -- VALIDATION --')
    print(_row('SELL original', val_all))
    print(_row('SELL + regime gate', val_gated))
    print(f'{"="*W}')

    print('\nVERDICT:')
    val_exp = 0.0
    if val_gated:
        wins  = [r for r in val_gated if r['outcome'] in ('TP1_HIT', 'TP2_HIT')]
        stops = [r for r in val_gated if r['outcome'] == 'STOP_HIT']
        aw    = sum(r['r_multiple'] for r in wins)  / len(wins)  if wins  else 0.0
        al    = sum(r['r_multiple'] for r in stops) / len(stops) if stops else 0.0
        val_exp = (len(wins)/len(val_gated))*aw + (len(stops)/len(val_gated))*al
    if val_exp > 0:
        print(f'  Validation expectancy POSITIVE ({val_exp:+.4f} R).')
        print('  SELL signals with this gate show edge -- candidate for v5.24 re-enable.')
    else:
        print(f'  Validation expectancy NEGATIVE ({val_exp:+.4f} R).')
        print('  SELL stays suppressed. Gate insufficient -- deeper calibration needed.')


if __name__ == '__main__':
    main()
