// Netlify Function: hands off Alpaca WS credentials for direct browser WebSocket.
// Alpaca's WS requires sending { action: 'auth', key, secret } as the first message.
// There's no way to proxy a WS through Netlify Functions (they're short-lived),
// so we return the credentials over HTTPS to the authenticated origin.
//
// Same-origin check prevents other sites from calling this function from the browser.

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const host = event.headers.host || event.headers.Host || '';

  // Accept only requests from our own Netlify domain (or localhost for dev).
  const okOrigin = origin.includes(host) || origin.includes('localhost') || origin.includes('127.0.0.1');

  const cors = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  if (!okOrigin) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Origin not allowed' }) };
  }

  const KEY = process.env.ALPACA_KEY_ID;
  const SECRET = process.env.ALPACA_SECRET_KEY;
  const FEED = process.env.ALPACA_FEED || 'iex';
  if (!KEY || !SECRET) {
    return {
      statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Alpaca keys not set' }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ key: KEY, secret: SECRET, feed: FEED }),
  };
};
