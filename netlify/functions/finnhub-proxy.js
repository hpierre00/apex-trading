/**
 * finnhub-proxy.js
 * Proxies requests to Finnhub API keeping the API key server-side.
 * Used by the sentiment and fundamental agents in apex-platform.html.
 *
 * POST body: { path: string, params: Record<string, string> }
 *   path   — e.g. '/company-news', '/stock/metric', '/stock/recommendation'
 *   params — e.g. { symbol: 'AAPL', from: '2024-01-01', to: '2024-01-07' }
 */

const ALLOWED_PATHS = new Set([
  '/company-news',
  '/stock/metric',
  '/stock/recommendation',
  '/quote',
  '/news-sentiment',
  '/stock/peers',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { path, params = {} } = body;

  if (!path || !ALLOWED_PATHS.has(path)) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Unsupported path: ${path}`,
        allowed: [...ALLOWED_PATHS],
      }),
    };
  }

  // Sanitize params — only allow string values, no prototype pollution
  const safeParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof k === 'string' && typeof v === 'string') safeParams[k] = v;
  }

  const qs = new URLSearchParams({ ...safeParams, token: apiKey });
  const url = `https://finnhub.io/api/v1${path}?${qs.toString()}`;

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'tradolux-netlify-proxy/1.0' },
    });
    const data = await upstream.json();

    return {
      statusCode: upstream.status,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        // 5-min client cache — news and metrics don't change by the second
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Finnhub upstream error', details: err.message }),
    };
  }
}
