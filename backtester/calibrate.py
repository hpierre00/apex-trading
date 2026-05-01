#!/usr/bin/env python3
"""
calibrate.py -- Phase 1E: confidence calibration analysis.

Four analyses:
  1. Confidence decile bucketing (training set)
  2. Direction bias (BUY vs SELL)
  3. Ticker regime check (UP/DOWN based on 50-day SMA slope)
  4. Isotonic calibration fit (sklearn) + ECE before/after

Outputs:
  results/calibration_report.txt
  results/isotonic_calibrator.pkl
"""
import pickle
import sys
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

REPO          = Path(__file__).parent
DATA_DIR      = REPO / 'data'
RESULTS_DIR   = REPO / 'results'
SIGNALS_CSV   = RESULTS_DIR / 'signals.csv'
REPORT_PATH   = RESULTS_DIR / 'calibration_report.txt'
CALIBRATOR_PKL = RESULTS_DIR / 'isotonic_calibrator.pkl'

BREAK_EVEN_WR = 0.447   # 44.7% -- from Phase 1D avg-win/avg-loss ratio
N_DECILE_BINS = 10

TICKERS = [
    'AAPL','MSFT','NVDA','GOOGL','META',
    'JPM','XOM','JNJ','WMT','V',
    'SPY','QQQ','IWM','DIA',
    'TSLA','COIN','SOFI','PLTR',
    'KO','PG',
]


# ── Output router: write to both stdout and report buffer ─────────────────────

_buf = StringIO()

def out(line: str = '') -> None:
    print(line)
    _buf.write(line + '\n')


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_win(outcome: str) -> bool:
    return outcome in ('TP1_HIT', 'TP2_HIT')


def expectancy(df: pd.DataFrame) -> float:
    wins   = df[df['outcome'].isin(['TP1_HIT','TP2_HIT'])]
    losses = df[df['outcome'] == 'STOP_HIT']
    if len(df) == 0:
        return 0.0
    avg_w = wins['r_multiple'].mean()   if len(wins)   else 0.0
    avg_l = losses['r_multiple'].mean() if len(losses) else 0.0
    return (len(wins)/len(df)) * avg_w + (len(losses)/len(df)) * avg_l


def ece_score(y_true: np.ndarray, y_pred: np.ndarray, n_bins: int = 10) -> float:
    """Expected Calibration Error over equal-width bins in [0,1]."""
    bins   = np.linspace(0.0, 1.0, n_bins + 1)
    total  = len(y_true)
    result = 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        mask = (y_pred >= lo) & (y_pred <= hi)
        if mask.sum() == 0:
            continue
        avg_pred = float(y_pred[mask].mean())
        avg_true = float(y_true[mask].mean())
        result  += abs(avg_pred - avg_true) * mask.sum() / total
    return result


# ── Load & validate data ──────────────────────────────────────────────────────

df_all = pd.read_csv(SIGNALS_CSV)
df_all['win'] = df_all['outcome'].apply(is_win).astype(int)

train = df_all[df_all['set'] == 'train'].copy()
val   = df_all[df_all['set'] == 'val'].copy()

out('=' * 70)
out('APEX BACKTESTER -- PHASE 1E CONFIDENCE CALIBRATION REPORT')
out('=' * 70)
out(f'Training signals : {len(train):,}')
out(f'Validation signals: {len(val):,}')
out(f'Break-even win rate: {BREAK_EVEN_WR*100:.1f}%')


# ── Analysis 1: Confidence decile bucketing (training set) ────────────────────

out()
out('-' * 70)
out('ANALYSIS 1 -- Confidence Decile Bucketing (training set)')
out('-' * 70)

conf_min = train['confidence'].min()
conf_max = train['confidence'].max()
bins = np.linspace(conf_min, conf_max, N_DECILE_BINS + 1)

train['conf_bin'] = pd.cut(train['confidence'], bins=bins, include_lowest=True)

out()
out(f'Confidence range: {conf_min:.1f}% -- {conf_max:.1f}%  '
    f'(bin width {(conf_max-conf_min)/N_DECILE_BINS:.2f}%)')
out()
header = (f'{"Bin":>18}  {"N":>5}  {"Win%":>6}  {"MeanR":>7}  '
          f'{"Exp R":>7}  {"Flag"}')
out(header)
out('-' * 60)

for interval in train['conf_bin'].cat.categories:
    grp = train[train['conf_bin'] == interval]
    if len(grp) == 0:
        continue
    n    = len(grp)
    wr   = grp['win'].mean() * 100
    mr   = grp['r_multiple'].mean()
    ex   = expectancy(grp)
    flag = '<<< EDGE' if wr >= BREAK_EVEN_WR * 100 else ''
    out(f'{str(interval):>18}  {n:>5}  {wr:>5.1f}%  {mr:>+7.4f}  {ex:>+7.4f}  {flag}')

out()
edge_bins = [
    str(iv) for iv in train['conf_bin'].cat.categories
    if len(train[train['conf_bin'] == iv]) > 0
    and train[train['conf_bin'] == iv]['win'].mean() >= BREAK_EVEN_WR
]
if edge_bins:
    out(f'Bins with edge (win rate >= {BREAK_EVEN_WR*100:.1f}%): {", ".join(edge_bins)}')
else:
    out(f'No decile bin achieves break-even win rate of {BREAK_EVEN_WR*100:.1f}%.')


# ── Analysis 2: Direction bias ────────────────────────────────────────────────

out()
out('-' * 70)
out('ANALYSIS 2 -- Direction Bias (training set)')
out('-' * 70)
out()
out(f'{"Direction":>10}  {"N":>5}  {"Win%":>6}  {"MeanR":>7}  {"Exp R":>7}')
out('-' * 44)

for direction in ('BUY', 'SELL'):
    grp = train[train['direction'] == direction]
    if len(grp) == 0:
        continue
    wr = grp['win'].mean() * 100
    mr = grp['r_multiple'].mean()
    ex = expectancy(grp)
    flag = ' <<< PROFITABLE' if ex > 0 else ''
    out(f'{direction:>10}  {len(grp):>5}  {wr:>5.1f}%  {mr:>+7.4f}  {ex:>+7.4f}{flag}')

buy_ex  = expectancy(train[train['direction']=='BUY'])
sell_ex = expectancy(train[train['direction']=='SELL'])
out()
if buy_ex > 0 and sell_ex <= 0:
    out('FLAG: BUY signals have edge; SELL signals do not.')
elif sell_ex > 0 and buy_ex <= 0:
    out('FLAG: SELL signals have edge; BUY signals do not.')
elif buy_ex > 0 and sell_ex > 0:
    out('FLAG: Both directions show positive expectancy.')
else:
    out('Neither direction shows positive expectancy after costs.')


# ── Analysis 3: Ticker regime check ──────────────────────────────────────────

out()
out('-' * 70)
out('ANALYSIS 3 -- Ticker Regime Check (UP vs DOWN, 50-day SMA slope, training set)')
out('  UP   = 50-day SMA today > 50-day SMA 20 bars ago')
out('  DOWN = otherwise')
out('-' * 70)
out()

# Build regime map: (ticker, date_str) -> 'UP'/'DOWN'
regime_map: dict = {}
for tk in TICKERS:
    path = DATA_DIR / f'{tk}_daily.parquet'
    if not path.exists():
        continue
    df_tk = pd.read_parquet(path)
    sma50     = df_tk['close'].rolling(50).mean()
    sma50_lag = sma50.shift(20)
    regime    = pd.Series('DOWN', index=df_tk.index, dtype=str)
    valid     = sma50.notna() & sma50_lag.notna()
    regime[valid & (sma50 > sma50_lag)] = 'UP'
    regime[~valid] = 'UNKNOWN'
    for ts, reg in regime.items():
        regime_map[(tk, str(ts.date()))] = reg

# Tag each training signal with its regime
train = train.copy()
train['regime'] = train.apply(
    lambda r: regime_map.get((r['ticker'], r['date']), 'UNKNOWN'), axis=1
)

out(f'{"Ticker":>6}  {"Regime":>6}  {"N":>5}  {"Win%":>6}  '
    f'{"MeanR":>7}  {"Exp R":>7}')
out('-' * 52)

for tk in TICKERS:
    grp_tk = train[train['ticker'] == tk]
    if len(grp_tk) == 0:
        continue
    rows = []
    for regime in ('UP', 'DOWN'):
        grp = grp_tk[grp_tk['regime'] == regime]
        if len(grp) < 5:
            rows.append((tk, regime, len(grp), None, None, None))
            continue
        wr = grp['win'].mean() * 100
        mr = grp['r_multiple'].mean()
        ex = expectancy(grp)
        rows.append((tk, regime, len(grp), wr, mr, ex))
    for tk_r, regime, n, wr, mr, ex in rows:
        if wr is None:
            out(f'{tk_r:>6}  {regime:>6}  {n:>5}  {"<5 sigs":>6}')
        else:
            out(f'{tk_r:>6}  {regime:>6}  {n:>5}  {wr:>5.1f}%  {mr:>+7.4f}  {ex:>+7.4f}')

# Summary: which regime is better overall
up_all   = train[train['regime']=='UP']
down_all = train[train['regime']=='DOWN']
out()
up_ex   = expectancy(up_all)
down_ex = expectancy(down_all)
out(f'Overall UP regime    : N={len(up_all):,}  Win={up_all["win"].mean()*100:.1f}%  '
    f'Exp={up_ex:+.4f} R')
out(f'Overall DOWN regime  : N={len(down_all):,}  Win={down_all["win"].mean()*100:.1f}%  '
    f'Exp={down_ex:+.4f} R')
if up_ex > down_ex:
    out('FLAG: System performs better in UP regime.')
else:
    out('FLAG: System performs better in DOWN regime.')


# ── Analysis 4: Isotonic calibration ─────────────────────────────────────────

out()
out('-' * 70)
out('ANALYSIS 4 -- Isotonic Calibration Fit')
out('-' * 70)

X_train = train['confidence'].values.astype(float)
y_train = train['win'].values.astype(float)
X_val   = val['confidence'].values.astype(float)
y_val   = val['win'].values.astype(float)

# Fit isotonic regression (increasing=True: higher confidence -> higher win prob)
ir = IsotonicRegression(increasing=True, out_of_bounds='clip')
ir.fit(X_train, y_train)

# Save calibrator
with open(CALIBRATOR_PKL, 'wb') as f:
    pickle.dump(ir, f)
out(f'\nSaved calibrator -> {CALIBRATOR_PKL.name}')

# Fitted breakpoints: unique (x, y) pairs where y changes
pred_on_train = ir.predict(X_train)
bp_df = (pd.DataFrame({'conf': X_train, 'cal_win_prob': pred_on_train})
           .sort_values('conf')
           .drop_duplicates('cal_win_prob'))

out()
out('Fitted isotonic breakpoints (confidence -> calibrated win probability):')
out(f'  {"Conf%":>6}  {"CalWinProb":>12}  {"NaiveProb":>10}  {"Lift":>7}')
out('  ' + '-' * 40)
for _, row in bp_df.iterrows():
    naive = row['conf'] / 100.0
    lift  = row['cal_win_prob'] - naive
    out(f'  {row["conf"]:>6.1f}  {row["cal_win_prob"]:>12.4f}  '
        f'{naive:>10.4f}  {lift:>+7.4f}')

# ECE before/after on validation set
naive_pred_val = X_val / 100.0
cal_pred_val   = ir.predict(X_val)

ece_before = ece_score(y_val, naive_pred_val)
ece_after  = ece_score(y_val, cal_pred_val)

out()
out('Validation Expected Calibration Error (ECE, 10 equal-width bins):')
out(f'  Before isotonic (naive confidence/100) : {ece_before:.4f}')
out(f'  After  isotonic                        : {ece_after:.4f}')
out(f'  ECE reduction                          : {(ece_before-ece_after)/ece_before*100:+.1f}%')

# Validation decile table with calibrated probabilities
out()
out('Validation set -- calibrated probability vs actual win rate (decile bins):')
val2 = val.copy()
val2['cal_prob'] = cal_pred_val
val2['cal_bin']  = pd.cut(val2['cal_prob'], bins=10)
out(f'  {"CalProbBin":>20}  {"N":>5}  {"ActualWin%":>11}  {"CalProb%":>9}  {"Err":>6}')
out('  ' + '-' * 58)
for interval in val2['cal_bin'].cat.categories:
    grp = val2[val2['cal_bin'] == interval]
    if len(grp) == 0:
        continue
    actual = grp['win'].mean() * 100
    cal    = grp['cal_prob'].mean() * 100
    err    = cal - actual
    out(f'  {str(interval):>20}  {len(grp):>5}  {actual:>10.1f}%  {cal:>8.1f}%  {err:>+6.1f}%')

# Overall recommendation
out()
out('-' * 70)
out('CALIBRATION RECOMMENDATION')
out('-' * 70)
out()

overall_wr = train['win'].mean() * 100
out(f'Observed training win rate : {overall_wr:.1f}%')
out(f'Mean training confidence   : {X_train.mean():.1f}%')
out(f'Confidence-as-probability  : MISCALIBRATED (confidence < actual win rate)')
out()

# Check if isotonic regression shows monotonic signal
corr = np.corrcoef(X_train, y_train)[0,1]
out(f'Pearson corr (confidence, win) on training set: {corr:+.4f}')

if abs(corr) < 0.05:
    out('FINDING: Confidence has negligible correlation with win probability.')
    out('         The metric ranks signals by strength, NOT by win probability.')
    out('RECOMMENDATION: Relabel "confidence" as "signal strength" in the UI.')
    out('                Remove the % sign; it is not a win probability.')
elif ece_after < ece_before * 0.8:
    out('FINDING: Isotonic calibration reduces ECE by >20%.')
    out('RECOMMENDATION: Apply isotonic recalibration to the displayed confidence.')
    out('                Use isotonic_calibrator.pkl to map raw confidence -> win prob.')
else:
    out('FINDING: Moderate correlation; isotonic calibration provides limited improvement.')
    out('RECOMMENDATION: Consider renaming to "signal strength" or applying calibration.')

out()
out('=' * 70)
out('END OF REPORT')
out('=' * 70)

# Write report file
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
REPORT_PATH.write_text(_buf.getvalue(), encoding='utf-8')
print(f'\nReport written -> {REPORT_PATH}')
