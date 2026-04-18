// Netlify Function: Alpaca REST data proxy
// Keeps ALPACA_KEY_ID and ALPACA_SECRET_KEY server-side.
// Browser POSTs { path, params } and gets back Alpaca's response.

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const KEY = process.env.ALPACA_KEY_ID;
  const SECRET = process.env.ALPACA_SECRET_KEY;
  if (!KEY || !SECRET) {
    return {
      statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Alpaca keys not set in Netlify env vars' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: 'Invalid JSON' }; }

  const path = body.path || '';
  const params = body.params || {};

  // Whitelist: only data.alpaca.markets endpoints, only GET-style reads.
  if (!path.startsWith('/v2/') && !path.startsWith('/v1beta')) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid path' }) };
  }

  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const url = `https://data.alpaca.markets${path}${qs}`;

  try {
    const r = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': KEY,
        'APCA-API-SECRET-KEY': SECRET,
        'Accept': 'application/json',
      },
    });
    const text = await r.text();
    return {
      statusCode: r.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream fetch failed', detail: String(err) }),
    };
  }
};
