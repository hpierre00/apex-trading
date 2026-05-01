"""
Python port of the APEX signal engine (apex-platform.html).
All logic mirrors the JS exactly — same arithmetic, same rounding.
"""
import math

AGENTS = [
    {'id': 'chart',       'weight': 0.25},
    {'id': 'sentiment',   'weight': 0.15},
    {'id': 'fundamental', 'weight': 0.20},
    {'id': 'risk',        'weight': 0.20},
    {'id': 'macro',       'weight': 0.20},
]

# Default weights for the 4-agent backtester run (sentiment zeroed, renormalized)
BACKTEST_WEIGHTS = {
    'chart':       0.25 / 0.85,
    'sentiment':   0.0,
    'fundamental': 0.20 / 0.85,
    'risk':        0.20 / 0.85,
    'macro':       0.20 / 0.85,
}


def compute_atr(candles: list[dict], period: int = 14) -> float:
    """Simple average ATR over `period` bars. Mirrors JS computeATR exactly."""
    slice_ = candles[-(period + 1):]
    total = 0.0
    for i in range(1, len(slice_)):
        prev = slice_[i - 1]
        c = slice_[i]
        tr = max(c['h'] - c['l'], abs(c['h'] - prev['c']), abs(c['l'] - prev['c']))
        total += tr
    return total / period


def _js_to_fixed_1(value: float) -> float:
    """Replicate JS parseFloat(x.toFixed(1)): round to 1 decimal, ties round up."""
    # JS toFixed uses 'round half away from zero'; Python round() uses banker's rounding.
    # Avoid divergence by nudging by epsilon before rounding.
    return round(value + 1e-12, 1)


def _js_to_fixed_2(value: float) -> float:
    """Replicate JS parseFloat(x.toFixed(2)): round to 2 decimal places, ties round up."""
    return round(value + 1e-12, 2)


def generate_signal(
    candles: list[dict],
    verdicts: dict,
    weights: dict | None = None,
    last_signal: dict | None = None,
    candle_idx: int | None = None,
) -> dict | None:
    """
    Mirrors JS generateSignal(verdicts) with explicit state parameters.

    candles:     list of {t, o, h, l, c, v} dicts, chronological
    verdicts:    {agent_id: {score: float}} — scores in [-1, +1]
    weights:     {agent_id: float} | None → use AGENTS defaults
    last_signal: {entry: float, candleIdx: int} | None → dedup state
    candle_idx:  current bar index for dedup; defaults to len(candles)
    """
    def weight_for(id_: str) -> float:
        if weights is not None and weights.get(id_) is not None:
            return weights[id_]
        return next(a['weight'] for a in AGENTS if a['id'] == id_)

    total = sum(
        (verdicts.get(a['id'], {}).get('score') or 0) * weight_for(a['id'])
        for a in AGENTS
    )
    confidence = abs(total) * 100
    if confidence < 18:
        return None
    if not candles or len(candles) < 20:
        return None

    last = candles[-1]
    atr = compute_atr(candles, 14)
    if not math.isfinite(atr) or atr <= 0:
        return None

    action = 'BUY' if total > 0 else 'SELL'
    entry = last['c']
    stop  = (entry - atr * 1.5) if action == 'BUY' else (entry + atr * 1.5)
    tp1   = (entry + atr * 2)   if action == 'BUY' else (entry - atr * 2)
    tp2   = (entry + atr * 4)   if action == 'BUY' else (entry - atr * 4)

    if last_signal is not None:
        idx = candle_idx if candle_idx is not None else len(candles)
        bars_since  = idx - last_signal['candleIdx']
        price_drift = abs(entry - last_signal['entry'])
        if bars_since < 5 or price_drift < atr * 0.3:
            return None

    return {
        'action':     action,
        'entry':      entry,
        'stop':       stop,
        'tp1':        tp1,
        'tp2':        tp2,
        'atr':        atr,
        'confidence': _js_to_fixed_1(confidence),
        'rr':         _js_to_fixed_2(abs(tp1 - entry) / abs(entry - stop)),
        'total':      total,
    }
