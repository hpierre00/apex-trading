/**
 * fred-proxy.js
 * Proxies requests to the St. Louis FRED API keeping the API key server-side.
 * Used by the macro agent in apex-platform.html.
 *
 * POST body: { series_id: string, limit?: number }
 *   series_id — e.g. 'DGS10', 'DGS2', 'T10Y2Y', 'DFF'
 *   limit     — number of most-recent observations to return (default 30, max 100)
 *
 * Returns FRED observation format: { observations: [{ date, value }] }
 * Observations are sorted newest-first to match fredValues() in apex-platform.html.
 */

const ALLOWED_SERIES = new Set([
  // Treasury yields
  'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
  // Yield curve spreads
  'T10Y2Y', 'T10Y3M', 'T5YIFR',
  // Policy rate
  'DFF', 'FEDFUNDS',
  // Macro indicators
  'CPIAUCSL', 'CPILFESL', 'UNRATE', 'GDP', 'INDPRO', 'PAYEMS', 'HOUST', 'RSAFS',
  // Credit / volatility
  'BAMLH0A0HYM2', 'DCOILWTICO', 'VIXCLS',
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

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FRED_API_KEY not configured' }),
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

  const { series_id, limit = 30 } = body;
  const seriesUpper = (series_id || '').toUpperCase().trim();

  if (!seriesUpper || !ALLOWED_SERIES.has(seriesUpper)) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Unsupported series: ${series_id}`,
        allowed: [...ALLOWED_SERIES],
      }),
    };
  }

  const clampedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 30), 100);

  const url = new URL('https://api.stlouisfed.org/fred/series/observations');
  url.searchParams.set('series_id', seriesUpper);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('limit', String(clampedLimit));
  url.searchParams.set('sort_order', 'desc'); // newest-first — required by fredValues()

  try {
    const upstream = await fetch(url.toString(), {
      headers: { 'User-Agent': 'tradolux-netlify-proxy/1.0' },
    });
    const data = await upstream.json();

    // Surface FRED API-level errors clearly
    if (data.error_code) {
      return {
        statusCode: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: data.error_message || 'FRED API error',
          code: data.error_code,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        // FRED series update daily — 1-hour cache is safe
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FRED upstream error', details: err.message }),
    };
  }
}
