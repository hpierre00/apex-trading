// Netlify Function: hft-shield
// Computes HFT Shield score from Polygon.io order book snapshot.
// No auth required — read-only public market data.
// GET /.netlify/functions/hft-shield?symbol=AAPL&spreadQuality=TIGHT

// Module-level cache — persists across warm Lambda invocations
const snapshotCache = new Map();

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  const symbol = (event.queryStringParameters?.symbol || '').toUpperCase();
  if (!symbol) {
    return {
      statusCode: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'symbol query param required' }),
    };
  }

  const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
  if (!POLYGON_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'POLYGON_API_KEY not set' }),
    };
  }

  const spreadQualityParam = (event.queryStringParameters?.spreadQuality || 'NORMAL').toUpperCase();

  // ── Step 1: Fetch Polygon snapshot ──────────────────────────────────────────
  let bids = [];
  let asks = [];
  let usedFallback = false;

  try {
    const polyRes = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${POLYGON_API_KEY}`
    );
    if (!polyRes.ok) throw new Error(`Polygon returned ${polyRes.status}`);
    const polyData = await polyRes.json();
    const ticker = polyData.ticker || polyData;

    // Try Level 2 order book if available (Developer+ tier)
    const orderBook = ticker.orderBook || ticker.book;
    if (orderBook?.bids?.length && orderBook?.asks?.length) {
      bids = orderBook.bids;
      asks = orderBook.asks;
    } else {
      // Fallback: synthetic 5-level book from lastQuote
      const q = ticker.lastQuote || {};
      const t = ticker.lastTrade || {};
      const midPrice = ((q.P || 0) + (q.p || 0)) / 2 || t.p || 100;
      const spread = Math.max((q.P || 0) - (q.p || 0), 0.01);
      bids = Array.from({ length: 5 }, (_, i) => ({
        price: parseFloat((midPrice - spread * (i + 1)).toFixed(2)),
        size: Math.round(200 / (i + 1)),
      }));
      asks = Array.from({ length: 5 }, (_, i) => ({
        price: parseFloat((midPrice + spread * (i + 1)).toFixed(2)),
        size: Math.round(200 / (i + 1)),
      }));
      usedFallback = true;
    }
  } catch (err) {
    console.warn('[hft-shield] Polygon fetch failed, using synthetic book:', err.message);
    // Fully synthetic fallback
    bids = Array.from({ length: 5 }, (_, i) => ({ price: 100 - i * 0.01, size: 100 }));
    asks = Array.from({ length: 5 }, (_, i) => ({ price: 100 + i * 0.01, size: 100 }));
    usedFallback = true;
  }

  // ── Step 2: Book imbalance ───────────────────────────────────────────────────
  const getSize = o => o.size || o.s || 0;
  const bidVol = bids.slice(0, 5).reduce((a, b) => a + getSize(b), 0);
  const askVol = asks.slice(0, 5).reduce((a, b) => a + getSize(b), 0);
  const imbalanceRatio = (bidVol + askVol) > 0 ? bidVol / (bidVol + askVol) : 0.5;
  const imbalanceSignal =
    imbalanceRatio > 0.65 ? 'BUY_PRESSURE' :
    imbalanceRatio < 0.35 ? 'SELL_PRESSURE' : 'BALANCED';

  // ── Step 3: Spoofing risk from snapshot diff ─────────────────────────────────
  const getPrice = o => o.price || o.p || 0;
  let spoofingRisk = 0;
  let cancelRate = 0;
  const prevSnapshot = snapshotCache.get(symbol);
  snapshotCache.set(symbol, { bids, asks, timestamp: Date.now() });

  if (prevSnapshot && (Date.now() - prevSnapshot.timestamp) < 10000) {
    const prevAll = [...prevSnapshot.bids, ...prevSnapshot.asks];
    const currAll = [...bids, ...asks];
    const prevLarge = prevAll.filter(o => getSize(o) > 10000);
    const disappeared = prevLarge.filter(prev =>
      !currAll.some(curr =>
        Math.abs(getPrice(curr) - getPrice(prev)) < 0.001 && getSize(curr) > 1000
      )
    );
    spoofingRisk = disappeared.length / Math.max(1, prevLarge.length);
    cancelRate = parseFloat((spoofingRisk * 0.8).toFixed(3));
  }

  const spoofingLabel =
    spoofingRisk > 0.7 ? 'SPOOFING_DETECTED' :
    spoofingRisk > 0.4 ? 'ELEVATED' : 'CLEAN';

  // ── Step 4: Composite HFT Shield score ──────────────────────────────────────
  const spreadScore = spreadQualityParam === 'TIGHT' ? 35 : spreadQualityParam === 'NORMAL' ? 17 : 0;
  const imbalanceScore = Math.round(Math.abs(imbalanceRatio - 0.5) / 0.5 * 30);
  const spoofingScore = Math.round((1 - Math.min(1, spoofingRisk)) * 35);
  const shieldScore = Math.min(100, imbalanceScore + spoofingScore + spreadScore);

  const recommendation = shieldScore >= 60 ? 'EXECUTE' : shieldScore >= 40 ? 'WAIT' : 'AVOID';
  const routeVia = shieldScore >= 50 ? 'NBBO' : 'IEX';

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      imbalanceRatio: parseFloat(imbalanceRatio.toFixed(3)),
      imbalanceSignal,
      spoofingRisk: parseFloat(spoofingRisk.toFixed(3)),
      spoofingLabel,
      cancelRate,
      shieldScore,
      recommendation,
      routeVia,
      usedFallback,
      timestamp: new Date().toISOString(),
    }),
  };
};
