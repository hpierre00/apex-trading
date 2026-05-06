// Netlify Function v2 — public market snapshot proxy (no auth required).
// Used by market-preview.html (pre-login marketing page).
// Fetches Alpaca IEX snapshots for a comma-delimited list of symbols.

export const config = { path: '/api/market-snapshot' };

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });

  const ALPACA_KEY    = process.env.ALPACA_KEY_ID;
  const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY;

  if (!ALPACA_KEY || !ALPACA_SECRET) {
    return new Response(JSON.stringify({ error: 'Alpaca keys not configured' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);

  // Health check — returns immediately without hitting Alpaca
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ status: 'ok', time: Date.now() }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const symbols = url.searchParams.get('symbols') || 'AAPL,TSLA,NVDA,AMD,MSFT';

  try {
    const resp = await fetch(
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols)}&feed=iex`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        },
      }
    );
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[market-snapshot] Alpaca error:', resp.status, errText);
      return new Response(JSON.stringify({ error: 'Alpaca error', status: resp.status }), {
        status: resp.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const text = await resp.text();
    return new Response(text, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream fetch failed', detail: String(err) }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
};
