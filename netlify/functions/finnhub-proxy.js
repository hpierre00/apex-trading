// Netlify Function: Finnhub data proxy.
// Keeps FINNHUB_API_KEY server-side, exposes whitelisted endpoints to the browser.

const crypto = require('crypto');

function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  if (sig !== s) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const secret = process.env.SUPABASE_JWT_SECRET;
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!secret || !token || !verifyJWT(token, secret)) {
    return { statusCode: 401, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: { ...cors, 'Content-Type': 'application/json' }, body: 'Method Not Allowed' };

  const KEY = process.env.FINNHUB_API_KEY;
  if (!KEY) {
    return {
      statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FINNHUB_API_KEY not set' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: 'Invalid JSON' }; }

  const path = body.path || '';
  const params = body.params || {};

  // Whitelist allowed paths to limit blast radius if the function is abused.
  const allowed = [
    '/stock/profile2',
    '/stock/metric',
    '/stock/recommendation',
    '/stock/earnings',
    '/calendar/earnings',
    '/quote',
    '/company-news',
    '/news',
    '/news-sentiment',
    '/stock/insider-sentiment',
    '/stock/social-sentiment',
  ];
  if (!allowed.includes(path)) {
    return {
      statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Path not allowed: ' + path }),
    };
  }

  const qs = new URLSearchParams({ ...params, token: KEY }).toString();
  const url = `https://finnhub.io/api/v1${path}?${qs}`;

  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
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
