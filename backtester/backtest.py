#!/usr/bin/env python3
"""
backtest.py — Phase 1D: replay daily bars through the APEX signal engine.

Sentiment weight = 0.0; remaining 4 agents renormalized to sum to 1.
Entry = next bar's open (no look-ahead). Spread + momentum slippage applied.
Expiry = 20 bars. Last 252 bars = validation holdout.
"""
import csv
import math
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median, stdev

import pandas as pd

REPO = Path(__file__).parent
sys.path.insert(0, str(REPO))
from signal_engine import generate_signal, AGENTS

# ── Config ────────────────────────────────────────────────────────────────────

TICKERS = [
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META',
    'JPM',  'XOM',  'JNJ',  'WMT',   'V',
    'SPY',  'QQQ',  'IWM',  'DIA',
    'TSLA', 'COIN', 'SOFI', 'PLTR',
    'KO',   'PG',
]

_ETF      = {'SPY', 'QQQ', 'IWM', 'DIA'}
_LARGECAP = {'AAPL','MSFT','NVDA','GOOGL','META','JPM','XOM','JNJ','WMT','V','KO','PG'}
_HIGHBETA = {'TSLA','COIN','SOFI','PLTR'}

def spread_for(ticker: str) -> float:
    if ticker in _ETF:      return 0.0001   # 0.01%
    if ticker in _LARGECAP: return 0.0003   # 0.03%
    if ticker in _HIGHBETA: return 0.0010   # 0.10%
    return 0.0005

MOMENTUM_SLIP = 0.0005   # extra 0.05% on momentum entries

# Sentiment zeroed; remaining 4 agents renormalized so sum = 1
_BASE = 0.25 + 0.20 + 0.20 + 0.20   # = 0.85
BACKTEST_WEIGHTS = {
    'chart':       0.25 / _BASE,
    'sentiment':   0.0,
    'fundamental': 0.20 / _BASE,
    'risk':        0.20 / _BASE,
    'macro':       0.20 / _BASE,
}

LOOKBACK     = 50     # chart + risk agent window for 1d TF
TFNORM       = 8.0    # chart normalizer for 1d TF
EXPIRY_BARS  = 20
VAL_BARS     = 252    # last N trading days → validation set

DATA_DIR    = REPO / 'data'
RESULTS_DIR = REPO / 'results'
OUT_CSV     = RESULTS_DIR / 'signals.csv'

CSV_COLS = [
    'ticker','date','direction','confidence',
    'entry_price','stop_price','tp1','tp2',
    'spread_cost_pct','slippage_pct',
    'outcome','exit_price','r_multiple','hold_bars','set',
]

# ── Agent scoring (price-action only) ────────────────────────────────────────

def _chart_score(candles: list) -> float:
    s = candles[-LOOKBACK:]
    pct = (s[-1]['c'] - s[0]['c']) / s[0]['c'] * 100
    return max(-1.0, min(1.0, pct / TFNORM))

def _risk_score(candles: list) -> float:
    s = candles[-LOOKBACK:]
    vol = math.sqrt(sum(((c['h'] - c['l']) / c['c'])**2 for c in s) / len(s))
    return max(-1.0, min(1.0, -vol * 10))

def _verdicts(candles: list) -> dict:
    return {
        'chart':       {'score': _chart_score(candles)},
        'sentiment':   {'score': 0.0},
        'fundamental': {'score': 0.0},
        'risk':        {'score': _risk_score(candles)},
        'macro':       {'score': 0.0},
    }

def _is_momentum(candles: list, action: str) -> bool:
    """True when 3-bar price momentum aligns with signal direction."""
    if len(candles) < 4:
        return False
    up = candles[-1]['c'] > candles[-4]['c']
    return (action == 'BUY' and up) or (action == 'SELL' and not up)

# ── Exit resolution ───────────────────────────────────────────────────────────

def _resolve(bars: list, start: int, action: str,
             stop: float, tp1: float, tp2: float) -> tuple:
    """
    Walk bars[start..start+EXPIRY_BARS-1] looking for stop/TP hits.
    Returns (outcome, exit_price, hold_bars).
    Gap past stop → fill at bar open.  Gap past TP → fill at TP price.
    """
    n = len(bars)
    for k in range(EXPIRY_BARS):
        idx = start + k
        if idx >= n:
            return 'EXPIRED', bars[n - 1]['c'], max(k, 1)
        b = bars[idx]

        # ── Open-gap checks ───────────────────────────────────────────────
        if action == 'BUY':
            if b['o'] <= stop:               return 'STOP_HIT', b['o'],  k + 1
            if b['o'] >= tp2:                return 'TP2_HIT',  tp2,     k + 1
            if b['o'] >= tp1:                return 'TP1_HIT',  tp1,     k + 1
        else:
            if b['o'] >= stop:               return 'STOP_HIT', b['o'],  k + 1
            if b['o'] <= tp2:                return 'TP2_HIT',  tp2,     k + 1
            if b['o'] <= tp1:                return 'TP1_HIT',  tp1,     k + 1

        # ── Intraday check (stop first = worst-case) ──────────────────────
        if action == 'BUY':
            if b['l'] <= stop:               return 'STOP_HIT', stop,    k + 1
            if b['h'] >= tp2:                return 'TP2_HIT',  tp2,     k + 1
            if b['h'] >= tp1:                return 'TP1_HIT',  tp1,     k + 1
        else:
            if b['h'] >= stop:               return 'STOP_HIT', stop,    k + 1
            if b['l'] <= tp2:                return 'TP2_HIT',  tp2,     k + 1
            if b['l'] <= tp1:                return 'TP1_HIT',  tp1,     k + 1

    exp_idx = min(start + EXPIRY_BARS - 1, n - 1)
    return 'EXPIRED', bars[exp_idx]['c'], EXPIRY_BARS

# ── Per-ticker replay ─────────────────────────────────────────────────────────

def replay_ticker(ticker: str, val_cutoff: str) -> list:
    path = DATA_DIR / f'{ticker}_daily.parquet'
    if not path.exists():
        print(f'  SKIP {ticker}: parquet not found')
        return []

    df = pd.read_parquet(path)
    if len(df) < LOOKBACK + 2:
        print(f'  SKIP {ticker}: only {len(df)} bars')
        return []

    bars = [
        {'date': str(ts.date()), 't': int(ts.timestamp()),
         'o': float(row.open),  'h': float(row.high),
         'l': float(row.low),   'c': float(row.close), 'v': float(row.volume)}
        for ts, row in df.iterrows()
    ]

    sp    = spread_for(ticker)
    last  = {'BUY': None, 'SELL': None}   # dedup state per direction
    recs  = []

    for i in range(LOOKBACK, len(bars) - 1):
        candles  = bars[:i + 1]
        verdicts = _verdicts(candles)

        # Quick total check to know which dedup bucket to use before calling engine
        total = sum(
            (verdicts[a['id']]['score']) * BACKTEST_WEIGHTS[a['id']]
            for a in AGENTS
        )
        if abs(total) * 100 < 18:
            continue
        action = 'BUY' if total > 0 else 'SELL'

        sig = generate_signal(
            candles, verdicts, BACKTEST_WEIGHTS,
            last_signal=last[action],
            candle_idx=i + 1,
        )
        if sig is None:
            continue

        # Update dedup
        last[action] = {'entry': sig['entry'], 'candleIdx': i + 1}

        # ── Execution ─────────────────────────────────────────────────────
        raw_open  = bars[i + 1]['o']
        slp       = MOMENTUM_SLIP if _is_momentum(candles, action) else 0.0
        cost      = sp + slp
        entry_px  = raw_open * (1 + cost) if action == 'BUY' else raw_open * (1 - cost)

        stop_px, tp1_px, tp2_px = sig['stop'], sig['tp1'], sig['tp2']

        outcome, exit_px, hold = _resolve(bars, i + 1, action, stop_px, tp1_px, tp2_px)

        risk = abs(entry_px - stop_px)
        direction = 1 if action == 'BUY' else -1
        r_mult = (exit_px - entry_px) * direction / risk if risk > 1e-9 else 0.0

        tag = 'val' if bars[i]['date'] >= val_cutoff else 'train'

        recs.append({
            'ticker':          ticker,
            'date':            bars[i]['date'],
            'direction':       action,
            'confidence':      sig['confidence'],
            'entry_price':     round(entry_px, 4),
            'stop_price':      round(stop_px, 4),
            'tp1':             round(tp1_px, 4),
            'tp2':             round(tp2_px, 4),
            'spread_cost_pct': round(sp * 100, 4),
            'slippage_pct':    round(slp * 100, 4),
            'outcome':         outcome,
            'exit_price':      round(exit_px, 4),
            'r_multiple':      round(r_mult, 4),
            'hold_bars':       hold,
            'set':             tag,
        })

    return recs

# ── Summary statistics ────────────────────────────────────────────────────────

def _stats_block(recs: list, label: str) -> None:
    if not recs:
        print(f'\n{label}: no signals\n')
        return

    total   = len(recs)
    n_buy   = sum(1 for r in recs if r['direction'] == 'BUY')
    n_sell  = total - n_buy

    tp1     = [r for r in recs if r['outcome'] == 'TP1_HIT']
    tp2     = [r for r in recs if r['outcome'] == 'TP2_HIT']
    stops   = [r for r in recs if r['outcome'] == 'STOP_HIT']
    expiry  = [r for r in recs if r['outcome'] == 'EXPIRED']
    wins    = tp1 + tp2

    wr      = len(wins)  / total * 100
    tp1r    = len(tp1)   / total * 100
    tp2r    = len(tp2)   / total * 100
    stopr   = len(stops) / total * 100
    expr    = len(expiry)/ total * 100

    rs      = [r['r_multiple'] for r in recs]
    win_rs  = [r['r_multiple'] for r in wins]
    loss_rs = [r['r_multiple'] for r in stops]

    mean_r  = sum(rs) / len(rs)
    med_r   = median(rs)
    avg_win = sum(win_rs)  / len(win_rs)  if win_rs  else 0.0
    avg_los = sum(loss_rs) / len(loss_rs) if loss_rs else 0.0
    exp_r   = (len(wins)/total) * avg_win + (len(stops)/total) * avg_los

    # Sharpe: assign each signal R to its signal date; fill other days with 0
    date_r: dict = defaultdict(float)
    for r in recs:
        date_r[r['date']] += r['r_multiple']

    all_dates = sorted(date_r.keys())
    daily_rs  = list(date_r.values())
    if len(daily_rs) > 1:
        std_r  = stdev(daily_rs)
        sharpe = (sum(daily_rs) / len(daily_rs)) / std_r * math.sqrt(252) if std_r > 1e-9 else 0.0
    else:
        sharpe = 0.0

    # Max consecutive losses (trade sequence, chronological)
    chron_r    = [r['r_multiple'] for r in sorted(recs, key=lambda x: x['date'])]
    max_consec = cur_consec = 0
    for v in chron_r:
        if v < 0:
            cur_consec += 1
            max_consec = max(max_consec, cur_consec)
        else:
            cur_consec = 0

    # Per-ticker
    by_ticker = defaultdict(list)
    for r in recs:
        by_ticker[r['ticker']].append(r)

    W = 60
    print(f'\n{"="*W}')
    print(f'  {label}')
    print(f'{"="*W}')
    print(f'  Total signals : {total:,}  (BUY {n_buy:,} / SELL {n_sell:,})')
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
    print(f'\n  {"Ticker":<6}  {"Sigs":>5}  {"Buy":>4}  {"Sell":>4}  '
          f'{"Win%":>6}  {"MeanR":>7}  {"Exp R":>7}')
    print(f'  {"-"*52}')
    for tk in TICKERS:
        tr = by_ticker.get(tk, [])
        if not tr:
            continue
        tw   = [x for x in tr if x['outcome'] in ('TP1_HIT','TP2_HIT')]
        tl   = [x for x in tr if x['outcome'] == 'STOP_HIT']
        twr  = len(tw)/len(tr)*100
        tmr  = sum(x['r_multiple'] for x in tr)/len(tr)
        taw  = sum(x['r_multiple'] for x in tw)/len(tw) if tw else 0.0
        tal  = sum(x['r_multiple'] for x in tl)/len(tl) if tl else 0.0
        texr = (len(tw)/len(tr))*taw + (len(tl)/len(tr))*tal
        tbu  = sum(1 for x in tr if x['direction']=='BUY')
        tse  = len(tr)-tbu
        print(f'  {tk:<6}  {len(tr):>5}  {tbu:>4}  {tse:>4}  '
              f'{twr:>5.1f}%  {tmr:>+7.4f}  {texr:>+7.4f}')
    print(f'{"="*W}')

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    # Determine validation cutoff: last 252 bars of SPY (reference ticker)
    spy_path = DATA_DIR / 'SPY_daily.parquet'
    spy_df   = pd.read_parquet(spy_path)
    val_cutoff = str(spy_df.index[-(VAL_BARS)].date())
    print(f'Val cutoff: {val_cutoff}  (last {VAL_BARS} SPY trading days)')

    all_recs = []
    for tk in TICKERS:
        print(f'  {tk} ...', end='', flush=True)
        recs = replay_ticker(tk, val_cutoff)
        all_recs.extend(recs)
        print(f' {len(recs)} signals')

    # Write CSV
    with open(OUT_CSV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLS)
        w.writeheader()
        w.writerows(all_recs)
    print(f'\nWrote {len(all_recs):,} records -> {OUT_CSV}')

    train = [r for r in all_recs if r['set'] == 'train']
    val   = [r for r in all_recs if r['set'] == 'val']

    _stats_block(train, f'TRAINING SET  (signals before {val_cutoff})')
    _stats_block(val,   f'VALIDATION SET  (signals from {val_cutoff})')

if __name__ == '__main__':
    main()
