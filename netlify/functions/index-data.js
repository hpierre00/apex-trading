// netlify/functions/index-proxy.js
// Public endpoint — no auth required.
// Fetches ETF snapshots from Alpaca (IEX feed) and labels them as index proxies.
// Finnhub free tier dropped support for ^GSPC/^DJI/^IXIC index symbols.

const ALPACA_KEY_ID     = process.env.ALPACA_KEY_ID;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;

const ETF_MAP = {
  SP500:   { symbol: 'SPY',  label: 'S&P 500',    note: 'via SPY'  },
  DOW:     { symbol: 'DIA',  label: 'DOW JONES',  note: 'via DIA'  },
  NASDAQ:  { symbol: 'QQQ',  label: 'NASDAQ 100', note: 'via QQQ'  },
  RUSSELL: { symbol: 'IWM',  label: 'RUSSELL 2K', note: 'via IWM'  },
  VIX:     { symbol: 'VIXY', label: 'VIX',        note: 'via VIXY' },
};

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const params = event.queryStringParameters || {};
  if (params.test === '1') {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        alpaca_key_present:    !!ALPACA_KEY_ID,
        alpaca_key_prefix:     ALPACA_KEY_ID     ? ALPACA_KEY_ID.substring(0, 4)     : 'none',
        alpaca_secret_present: !!ALPACA_SECRET_KEY,
        alpaca_secret_prefix:  ALPACA_SECRET_KEY ? ALPACA_SECRET_KEY.substring(0, 4) : 'none',
      }),
    };
  }

  if (!ALPACA_KEY_ID) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ALPACA_KEY_ID not set' }),
    };
  }

  const symbols = Object.values(ETF_MAP).map(e => e.symbol).join(',');
  try {
    const r = await fetch(
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbols}&feed=iex`,
      {
        headers: {
          'APCA-API-KEY-ID':     ALPACA_KEY_ID,
          'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY,
        },
      }
    );
    if (!r.ok) {
      const t = await r.text();
      return {
        statusCode: r.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: t }),
      };
    }
    const snaps = await r.json();

    const out = {};
    Object.entries(ETF_MAP).forEach(([key, { symbol, label, note }]) => {
      const snap = snaps[symbol];
      if (!snap) return;
      if (symbol === 'IWM') console.log('[index-data] IWM values:', JSON.stringify({
        latestTrade_p:  snap.latestTrade?.p,
        latestQuote_ap: snap.latestQuote?.ap,
        latestQuote_bp: snap.latestQuote?.bp,
        minuteBar_c:    snap.minuteBar?.c,
        dailyBar_c:     snap.dailyBar?.c,
        prevDailyBar_c: snap.prevDailyBar?.c,
      }));
      if (symbol === 'VIXY') {
        const vixSnap = snap;
        console.log('[index-data] VIXY values:', JSON.stringify({
          latestTrade_p: vixSnap.latestTrade?.p,
          minuteBar_c:   vixSnap.minuteBar?.c,
          dailyBar_c:    vixSnap.dailyBar?.c,
          prevDailyBar_c: vixSnap.prevDailyBar?.c,
        }));
      }
      const price     = snap.latestTrade?.p
        || snap.latestQuote?.ap
        || snap.latestQuote?.bp
        || snap.minuteBar?.c
        || snap.dailyBar?.c
        || snap.prevDailyBar?.c
        || 0;
      const prevClose = snap.prevDailyBar?.c
        || snap.dailyBar?.o
        || price;
      const change    = price - prevClose;
      const changePct = prevClose ? (change / prevClose) * 100 : 0;
      out[key] = { price, change, changePct, label, note };
    });

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
      body: JSON.stringify(out),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
