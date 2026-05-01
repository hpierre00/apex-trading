"""
Generate 60 adversarial test fixtures for the port-validation harness.
Writes backtester/tests/fixtures.json.

Groups:
  A (20): confidence threshold boundary — 10 below, 10 above
  B (10): agent weight normalization edges
  C (10): strong single-agent dissent
  D (10): ATR edge cases (flat candles, gapped candles, min-length)
  E (05): dedup suppression cases
  F (05): misc edge (all-neutral, max-score, mixed signs)
"""
import json
import math
import os
import random

OUT = os.path.join(os.path.dirname(__file__), 'tests', 'fixtures.json')

AGENTS = ['chart', 'sentiment', 'fundamental', 'risk', 'macro']
DEFAULT_WEIGHTS = {'chart': 0.25, 'sentiment': 0.15, 'fundamental': 0.20, 'risk': 0.20, 'macro': 0.20}


# ---------------------------------------------------------------------------
# Candle helpers
# ---------------------------------------------------------------------------

def make_candles(n=25, seed=42, base=100.0, vol=0.01):
    """Synthetic random-walk OHLCV bars, deterministic."""
    rng = random.Random(seed)
    candles, price = [], base
    for i in range(n):
        o = price
        move = rng.gauss(0, vol * price)
        c = max(0.01, o + move)
        h = max(o, c) * (1 + rng.uniform(0.0001, vol))
        l = min(o, c) * (1 - rng.uniform(0.0001, vol))
        candles.append({'t': i * 86400, 'o': round(o, 4), 'h': round(h, 4),
                        'l': round(l, 4), 'c': round(c, 4), 'v': 1_000_000})
        price = c
    return candles


def flat_candles(n=25, price=100.0):
    """All bars with h=l=o=c → ATR = 0."""
    return [{'t': i * 86400, 'o': price, 'h': price, 'l': price, 'c': price, 'v': 500_000}
            for i in range(n)]


def gapped_candles(n=25, seed=7, base=100.0, gap_pct=0.05):
    """Candles with opening gaps to stress true-range calculation."""
    rng = random.Random(seed)
    candles, price = [], base
    for i in range(n):
        gap = rng.choice([-1, 1]) * rng.uniform(0, gap_pct) * price
        o = max(0.01, price + gap)
        c = max(0.01, o * (1 + rng.gauss(0, 0.008)))
        h = max(o, c) * (1 + rng.uniform(0.001, 0.008))
        l = min(o, c) * (1 - rng.uniform(0.001, 0.008))
        candles.append({'t': i * 86400, 'o': round(o, 4), 'h': round(h, 4),
                        'l': round(l, 4), 'c': round(c, 4), 'v': 2_000_000})
        price = c
    return candles


# ---------------------------------------------------------------------------
# Verdict helpers
# ---------------------------------------------------------------------------

def uniform_verdicts(score):
    """All 5 agents at the same score → total = score (weights sum to 1)."""
    return {a: {'score': score} for a in AGENTS}


def mixed_verdicts(scores: dict):
    """scores = {agent_id: value}; missing agents default to 0."""
    return {a: {'score': scores.get(a, 0.0)} for a in AGENTS}


# ---------------------------------------------------------------------------
# Fixture builder
# ---------------------------------------------------------------------------

fixtures = []
_id = 0

def fix(group, desc, candles, verdicts, weights=None, last_signal=None, candle_idx=None, note=''):
    global _id
    _id += 1
    fixtures.append({
        'id': f'fix_{_id:03d}',
        'group': group,
        'desc': desc,
        'note': note,
        'candles': candles,
        'verdicts': verdicts,
        'weights': weights,
        'last_signal': last_signal,
        'candle_idx': candle_idx,
    })


BASE_CANDLES = make_candles(25, seed=1)

# ---------------------------------------------------------------------------
# Group A: Confidence threshold boundary (20 cases)
# With default weights summing to 1.0, total = uniform_score * 1.0
# ---------------------------------------------------------------------------

# Below threshold (should produce null)
for score, label in [
    (0.0,    'zero_score'),
    (0.05,   'very_weak_bull'),
    (0.10,   'weak_bull'),
    (0.15,   'moderate_bull'),
    (0.1799, 'just_below_bull'),
    (-0.05,  'very_weak_bear'),
    (-0.10,  'weak_bear'),
    (-0.15,  'moderate_bear'),
    (-0.1799,'just_below_bear'),
    (0.12,   'mixed_near_threshold'),
]:
    fix('A_below', f'threshold_below_{label}',
        make_candles(25, seed=10), uniform_verdicts(score),
        note=f'uniform score {score}, expected confidence {abs(score)*100:.1f}% < 18 → null')

# Above threshold (should produce signal)
for score, label in [
    (0.1801, 'just_above_bull'),
    (0.20,   'weak_bull'),
    (0.30,   'moderate_bull'),
    (0.50,   'strong_bull'),
    (0.80,   'very_strong_bull'),
    (1.00,   'max_bull'),
    (-0.1801,'just_above_bear'),
    (-0.50,  'strong_bear'),
    (-0.80,  'very_strong_bear'),
    (-1.00,  'max_bear'),
]:
    fix('A_above', f'threshold_above_{label}',
        make_candles(25, seed=20), uniform_verdicts(score),
        note=f'uniform score {score}, expected confidence {abs(score)*100:.1f}% ≥ 18 → signal')

# ---------------------------------------------------------------------------
# Group B: Weight normalization edges (10 cases)
# ---------------------------------------------------------------------------

# B1: Default weights (sum=1.0), strong signal
fix('B_weights', 'default_weights_sum1',
    make_candles(25, seed=30), uniform_verdicts(0.5),
    weights=DEFAULT_WEIGHTS,
    note='Explicit default weights, sum=1.0; total = 0.5')

# B2: Sentiment zeroed, NOT renormalized (sum=0.85) → confidence drops
fix('B_weights', 'sentiment_zero_not_renorm',
    make_candles(25, seed=30), uniform_verdicts(0.5),
    weights={'chart': 0.25, 'sentiment': 0.0, 'fundamental': 0.20, 'risk': 0.20, 'macro': 0.20},
    note='Sentiment=0, others unchanged, sum=0.85; total = 0.5*0.85 = 0.425')

# B3: Sentiment zeroed AND renormalized (sum=1.0) — backtester default
w85 = 0.85
fix('B_weights', 'sentiment_zero_renorm',
    make_candles(25, seed=30), uniform_verdicts(0.5),
    weights={'chart': 0.25/w85, 'sentiment': 0.0, 'fundamental': 0.20/w85,
             'risk': 0.20/w85, 'macro': 0.20/w85},
    note='Sentiment=0, rest renormalized to sum=1.0; total = 0.5')

# B4: All weight on CHART only
fix('B_weights', 'all_weight_chart',
    make_candles(25, seed=30),
    mixed_verdicts({'chart': 1.0, 'sentiment': 0.5, 'fundamental': 0.5, 'risk': 0.5, 'macro': 0.5}),
    weights={'chart': 1.0, 'sentiment': 0.0, 'fundamental': 0.0, 'risk': 0.0, 'macro': 0.0},
    note='Only CHART matters; total = 1.0')

# B5: All weight on RISK only, RISK is bearish
fix('B_weights', 'all_weight_risk_bear',
    make_candles(25, seed=30),
    mixed_verdicts({'chart': 0.8, 'sentiment': 0.8, 'fundamental': 0.8, 'risk': -0.8, 'macro': 0.8}),
    weights={'chart': 0.0, 'sentiment': 0.0, 'fundamental': 0.0, 'risk': 1.0, 'macro': 0.0},
    note='Only RISK matters; RISK=-0.8, total=-0.8 → SELL')

# B6: Equal weights (0.2 each, sum=1.0)
fix('B_weights', 'equal_weights',
    make_candles(25, seed=31),
    mixed_verdicts({'chart': 0.6, 'sentiment': -0.6, 'fundamental': 0.6, 'risk': -0.6, 'macro': 0.6}),
    weights={'chart': 0.2, 'sentiment': 0.2, 'fundamental': 0.2, 'risk': 0.2, 'macro': 0.2},
    note='Equal weights; total = (0.6-0.6+0.6-0.6+0.6)*0.2 = 0.6*0.2 = 0.12 → below threshold')

# B7: Overweight MACRO (bearish macro kills bullish signal)
fix('B_weights', 'overweight_macro_headwind',
    make_candles(25, seed=32),
    mixed_verdicts({'chart': 0.8, 'sentiment': 0.8, 'fundamental': 0.8, 'risk': 0.8, 'macro': -1.0}),
    weights={'chart': 0.15, 'sentiment': 0.10, 'fundamental': 0.15, 'risk': 0.10, 'macro': 0.50},
    note='Heavy MACRO weight; total = 0.8*0.50 - 1.0*0.50 = -0.10+0.40-0.50 → compute carefully')

# B8: Weights don't sum to 1 (edge; JS doesn't enforce normalization)
fix('B_weights', 'weights_sum_gt1',
    make_candles(25, seed=33), uniform_verdicts(0.3),
    weights={'chart': 0.5, 'sentiment': 0.3, 'fundamental': 0.4, 'risk': 0.4, 'macro': 0.4},
    note='Weights sum to 2.0; total = 0.3*2.0 = 0.6 → confidence=60%')

# B9: Near-zero weights for most agents, one dominates
fix('B_weights', 'near_zero_weights',
    make_candles(25, seed=34),
    mixed_verdicts({'chart': 1.0, 'sentiment': -1.0, 'fundamental': -1.0, 'risk': -1.0, 'macro': -1.0}),
    weights={'chart': 0.97, 'sentiment': 0.01, 'fundamental': 0.01, 'risk': 0.005, 'macro': 0.005},
    note='CHART dominates at 0.97; total ≈ 0.97 - 0.03 = 0.94')

# B10: Null weights (use AGENTS defaults)
fix('B_weights', 'null_weights_defaults',
    make_candles(25, seed=35), uniform_verdicts(0.5),
    weights=None,
    note='weights=None → use AGENT defaults; same as B1')

# ---------------------------------------------------------------------------
# Group C: Strong single-agent dissent (10 cases)
# ---------------------------------------------------------------------------

# C1: CHART (0.25) alone bearish, others strongly bullish → net BUY (0.75 > 0.25)
fix('C_dissent', 'chart_bear_others_bull',
    make_candles(25, seed=40),
    mixed_verdicts({'chart': -1.0, 'sentiment': 1.0, 'fundamental': 1.0, 'risk': 1.0, 'macro': 1.0}),
    note='chart=-1.0*0.25=-0.25, others=+0.75; total=+0.50 → BUY despite chart signal')

# C2: CHART (0.25) alone bullish, others strongly bearish → net SELL
fix('C_dissent', 'chart_bull_others_bear',
    make_candles(25, seed=40),
    mixed_verdicts({'chart': 1.0, 'sentiment': -1.0, 'fundamental': -1.0, 'risk': -1.0, 'macro': -1.0}),
    note='chart=+0.25, others=-0.75; total=-0.50 → SELL')

# C3: MACRO (0.20) alone bearish, others bullish → net BUY
fix('C_dissent', 'macro_bear_others_bull',
    make_candles(25, seed=41),
    mixed_verdicts({'chart': 1.0, 'sentiment': 1.0, 'fundamental': 1.0, 'risk': 1.0, 'macro': -1.0}),
    note='macro=-0.20, others=+0.80; total=+0.60 → BUY')

# C4: RISK (0.20) alone bearish, others bullish → net BUY
fix('C_dissent', 'risk_bear_others_bull',
    make_candles(25, seed=41),
    mixed_verdicts({'chart': 1.0, 'sentiment': 1.0, 'fundamental': 1.0, 'risk': -1.0, 'macro': 1.0}),
    note='risk=-0.20, others=+0.80; total=+0.60 → BUY')

# C5: SENTIMENT (0.15) alone bullish, others strongly bearish → SELL
fix('C_dissent', 'sentiment_bull_others_bear',
    make_candles(25, seed=42),
    mixed_verdicts({'chart': -0.8, 'sentiment': 1.0, 'fundamental': -0.8, 'risk': -0.8, 'macro': -0.8}),
    note='sentiment positive but lightweight; net is SELL')

# C6: CHART very bearish (-1.0), others mildly bullish (0.2) → close call
fix('C_dissent', 'chart_strong_bear_others_mild_bull',
    make_candles(25, seed=43),
    mixed_verdicts({'chart': -1.0, 'sentiment': 0.2, 'fundamental': 0.2, 'risk': 0.2, 'macro': 0.2}),
    note='total = -0.25 + 0.2*0.75 = -0.25+0.15 = -0.10 → confidence=10% → null')

# C7: 4 agents mildly bullish (0.25), RISK strongly bearish (-1.0) → net close
fix('C_dissent', 'risk_extreme_bear_others_mild',
    make_candles(25, seed=44),
    mixed_verdicts({'chart': 0.25, 'sentiment': 0.25, 'fundamental': 0.25, 'risk': -1.0, 'macro': 0.25}),
    note='total = 0.25*0.80 + (-1.0*0.20) = 0.20-0.20 = 0.00 → null')

# C8: FUNDAMENTAL strongly bullish (1.0), rest mildly bearish (-0.2)
fix('C_dissent', 'fundamental_bull_others_mild_bear',
    make_candles(25, seed=45),
    mixed_verdicts({'chart': -0.2, 'sentiment': -0.2, 'fundamental': 1.0, 'risk': -0.2, 'macro': -0.2}),
    note='total = 1.0*0.20 + (-0.2*0.80) = 0.20-0.16 = 0.04 → confidence=4% → null')

# C9: All agents max score, degenerate case
fix('C_dissent', 'all_max_bull',
    make_candles(25, seed=46), uniform_verdicts(1.0),
    note='All at +1.0; total=1.0; confidence=100%')

# C10: All agents max bearish
fix('C_dissent', 'all_max_bear',
    make_candles(25, seed=46), uniform_verdicts(-1.0),
    note='All at -1.0; total=-1.0; confidence=100%')

# ---------------------------------------------------------------------------
# Group D: ATR edge cases (10 cases)
# ---------------------------------------------------------------------------

# D1: Flat candles → ATR=0 → null
fix('D_atr', 'flat_candles_atr_zero',
    flat_candles(25, 100.0), uniform_verdicts(0.8),
    note='h=l=o=c; TR=0; ATR=0 → null')

# D2: Very low volatility (tight bars)
fix('D_atr', 'low_vol_tight_bars',
    make_candles(25, seed=50, base=100.0, vol=0.001), uniform_verdicts(0.5),
    note='Vol=0.1%; ATR very small; check stop/tp calculation precision')

# D3: High volatility (wide bars)
fix('D_atr', 'high_vol_wide_bars',
    make_candles(25, seed=51, base=100.0, vol=0.05), uniform_verdicts(0.5),
    note='Vol=5%; ATR large; stops far from entry')

# D4: Gapped candles (overnight gaps dominate true range)
fix('D_atr', 'gapped_candles',
    gapped_candles(25, seed=52), uniform_verdicts(0.5),
    note='Opening gaps → true range much larger than h-l')

# D5: Exactly 20 candles (minimum allowed)
fix('D_atr', 'exactly_20_candles',
    make_candles(20, seed=53), uniform_verdicts(0.5),
    note='len(candles)==20; minimum allowed; ATR uses last 15')

# D6: Exactly 19 candles → null (< 20 check)
fix('D_atr', 'only_19_candles_null',
    make_candles(19, seed=54), uniform_verdicts(0.8),
    note='len(candles)==19 < 20 → null regardless of score')

# D7: 15 candles exactly (ATR period+1 boundary)
fix('D_atr', 'only_15_candles_null',
    make_candles(15, seed=55), uniform_verdicts(0.8),
    note='15 candles → null (< 20 check fires first)')

# D8: Very high base price (like NVDA at 900)
fix('D_atr', 'high_base_price',
    make_candles(25, seed=56, base=900.0, vol=0.015), uniform_verdicts(0.5),
    note='High price stock; verify stop/tp at correct absolute levels')

# D9: Very low base price (penny stock, $2)
fix('D_atr', 'penny_stock_price',
    make_candles(25, seed=57, base=2.0, vol=0.03), uniform_verdicts(0.5),
    note='Low price; ATR in cents; precision matters')

# D10: Mixed long and flat candles
candles_mixed = make_candles(20, seed=58) + flat_candles(5, price=make_candles(20, seed=58)[-1]['c'])
fix('D_atr', 'mixed_long_then_flat',
    candles_mixed, uniform_verdicts(0.5),
    note='Normal candles then 5 flat; ATR window straddles the transition')

# ---------------------------------------------------------------------------
# Group E: Dedup suppression (5 cases)
# ---------------------------------------------------------------------------

base_candles_e = make_candles(25, seed=60)
base_entry = base_candles_e[-1]['c']

# E1: lastSignal 3 bars ago → suppressed (barsSince < 5)
fix('E_dedup', 'dedup_3_bars_ago_suppressed',
    base_candles_e, uniform_verdicts(0.5),
    last_signal={'entry': base_entry, 'candleIdx': len(base_candles_e) - 3},
    candle_idx=len(base_candles_e),
    note='barsSince=3 < 5 → null')

# E2: lastSignal exactly 5 bars ago → NOT suppressed (condition is < 5)
fix('E_dedup', 'dedup_5_bars_ago_not_suppressed',
    base_candles_e, uniform_verdicts(0.5),
    last_signal={'entry': base_entry + 999.0, 'candleIdx': len(base_candles_e) - 5},
    candle_idx=len(base_candles_e),
    note='barsSince=5 (not < 5); priceDrift huge → NOT suppressed')

# E3: lastSignal 10 bars ago but price within 0.3*ATR → suppressed
# ATR ≈ 1% of 100 = 1.0; 0.3*ATR ≈ 0.3; so entry diff < 0.3 → suppressed
fix('E_dedup', 'dedup_price_too_close',
    base_candles_e, uniform_verdicts(0.5),
    last_signal={'entry': base_entry + 0.05, 'candleIdx': len(base_candles_e) - 10},
    candle_idx=len(base_candles_e),
    note='barsSince=10≥5 but |entry-prev_entry|=0.05 < 0.3*ATR → null')

# E4: lastSignal 10 bars ago, price drifted enough → NOT suppressed
fix('E_dedup', 'dedup_price_far_enough',
    base_candles_e, uniform_verdicts(0.5),
    last_signal={'entry': base_entry + 5.0, 'candleIdx': len(base_candles_e) - 10},
    candle_idx=len(base_candles_e),
    note='barsSince=10≥5 AND |drift|=5.0 ≫ 0.3*ATR → NOT suppressed → signal')

# E5: No lastSignal → never suppressed
fix('E_dedup', 'no_dedup_state',
    base_candles_e, uniform_verdicts(0.5),
    last_signal=None,
    note='lastSignal=None → dedup skipped → signal fires')

# ---------------------------------------------------------------------------
# Group F: Misc edge (5 cases)
# ---------------------------------------------------------------------------

# F1: All agents at zero → total=0, confidence=0 → null
fix('F_misc', 'all_agents_zero',
    make_candles(25, seed=70), uniform_verdicts(0.0),
    note='All scores 0; confidence=0; null')

# F2: Fractional scores summing exactly to 0.18 threshold
# 0.18 / 1.0 = 0.18 per agent uniform → confidence exactly 18.0%
fix('F_misc', 'confidence_exactly_18',
    make_candles(25, seed=71), uniform_verdicts(0.18),
    note='confidence=18.0 which is NOT < 18 → signal fires (boundary inclusive)')

# F3: Confidence exactly 17.9999 → null
fix('F_misc', 'confidence_just_under_18',
    make_candles(25, seed=71), uniform_verdicts(0.17999),
    note='confidence=17.999% < 18 → null')

# F4: Max possible signal (all +1.0, high vol candles, no dedup)
fix('F_misc', 'max_signal_all_systems_go',
    make_candles(30, seed=72, vol=0.02), uniform_verdicts(1.0),
    note='Strongest possible BUY signal; all agents max, moderate vol')

# F5: Mixed candle types (first 20 standard, last 5 with ATR-widening gaps)
candles_f5 = make_candles(20, seed=73) + gapped_candles(5, seed=74, base=make_candles(20, seed=73)[-1]['c'])
fix('F_misc', 'mixed_candle_types',
    candles_f5, uniform_verdicts(0.4),
    note='Gap candles in ATR window → larger ATR than h-l suggests')

# ---------------------------------------------------------------------------

assert len(fixtures) == 60, f'Expected 60 fixtures, got {len(fixtures)}'

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(fixtures, f, indent=2)

print(f'Generated {len(fixtures)} fixtures -> {OUT}')
for group in ['A_below', 'A_above', 'B_weights', 'C_dissent', 'D_atr', 'E_dedup', 'F_misc']:
    count = sum(1 for x in fixtures if x['group'] == group)
    print(f'  {group}: {count}')
