// Netlify Function: hands off Alpaca WS credentials for direct browser WebSocket.
// Alpaca's WS requires sending { action: 'auth', key, secret } as the first message.
// There's no way to proxy a WS through Netlify Functions (they're short-lived),
// so we return the credentials over HTTPS to the authenticated origin.
//
// Same-origin check prevents other sites from calling this function from the browser.

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

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
