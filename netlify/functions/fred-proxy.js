// Netlify Function: FRED (Federal Reserve Economic Data) proxy.
// FRED requires a free API key for JSON responses; we ship one or the user provides via env var.
// Exposes whitelisted series IDs only.

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const KEY = process.env.FRED_API_KEY;
  if (!KEY) {
    return {
      statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FRED_API_KEY not set. Get one free at https://fred.stlouisfed.org/docs/api/api_key.html and add to Netlify env vars.' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: 'Invalid JSON' }; }

  // Whitelist FRED series IDs we'll expose. These are the macro indicators
  // the Macro agent uses, plus a few commonly referenced ones for AI chat context.
  const allowedSeries = new Set([
    'DGS10',     // 10-Year Treasury yield
    'DGS2',      // 2-Year Treasury yield
    'T10Y2Y',    // 10Y-2Y spread (recession indicator)
    'DFF',       // Federal Funds effective rate
    'UNRATE',    // Unemployment rate
    'CPIAUCSL',  // CPI (inflation)
    'CPILFESL',  // Core CPI
    'VIXCLS',    // VIX index
    'DTWEXBGS',  // Trade-weighted dollar index
    'DCOILWTICO', // WTI crude oil
    'GOLDPMGBD228NLBM', // Gold PM London fix
  ]);

  const seriesId = body.series_id || '';
  if (!allowedSeries.has(seriesId)) {
    return {
      statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Series not whitelisted: ' + seriesId }),
    };
  }

  // Default to last 30 observations if the caller doesn't ask for more
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: KEY,
    file_type: 'json',
    sort_order: 'desc',
    limit: body.limit || 30,
  });

  const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;

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
