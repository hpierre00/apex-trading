// Pure signal engine extracted from apex-platform.html
// No DOM, no state, no localStorage. All state is explicit parameters.

'use strict';

const AGENTS = [
  { id: 'chart',       weight: 0.25 },
  { id: 'sentiment',   weight: 0.15 },
  { id: 'fundamental', weight: 0.20 },
  { id: 'risk',        weight: 0.20 },
  { id: 'macro',       weight: 0.20 },
];

function computeATR(candles, period = 14) {
  const slice = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1], c = slice[i];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
    sum += tr;
  }
  return sum / period;
}

// verdicts: { chart: {score}, sentiment: {score}, fundamental: {score}, risk: {score}, macro: {score} }
// weights:  { chart: 0.25, ... } | null → use AGENTS defaults
// lastSignal: { entry, candleIdx } | null → dedup check
// candleIdx: explicit current bar index for dedup; defaults to candles.length
function generateSignal(candles, verdicts, weights = null, lastSignal = null, candleIdx = null) {
  const weightFor = (id) => (weights != null && weights[id] != null) ? weights[id] : AGENTS.find(a => a.id === id).weight;

  const total = AGENTS.reduce((s, a) => s + ((verdicts[a.id] && verdicts[a.id].score != null ? verdicts[a.id].score : 0)) * weightFor(a.id), 0);
  const confidence = Math.abs(total) * 100;
  if (confidence < 18) return null;
  if (!candles || candles.length < 20) return null;

  const last = candles[candles.length - 1];
  const atr = computeATR(candles, 14);
  if (!isFinite(atr) || atr <= 0) return null;

  const action = total > 0 ? 'BUY' : 'SELL';
  const entry = last.c;
  const stop  = action === 'BUY' ? entry - atr * 1.5 : entry + atr * 1.5;
  const tp1   = action === 'BUY' ? entry + atr * 2   : entry - atr * 2;
  const tp2   = action === 'BUY' ? entry + atr * 4   : entry - atr * 4;

  if (lastSignal) {
    const idx       = candleIdx != null ? candleIdx : candles.length;
    const barsSince = idx - lastSignal.candleIdx;
    const priceDrift = Math.abs(entry - lastSignal.entry);
    if (barsSince < 5 || priceDrift < atr * 0.3) return null;
  }

  return {
    action,
    entry,
    stop,
    tp1,
    tp2,
    atr,
    confidence: parseFloat(confidence.toFixed(1)),
    rr: parseFloat((Math.abs(tp1 - entry) / Math.abs(entry - stop)).toFixed(2)),
    total,
  };
}

module.exports = { AGENTS, computeATR, generateSignal };
