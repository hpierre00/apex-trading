// Netlify Function: macro-data
// Fetches macro indicators from FRED, CoinGecko, and Polygon, then upserts to Supabase.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';
const SUPABASE_SERVICE_KEY = process.env.SUPABASESKTradoLux;

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

const FRED_SERIES = [
  { id: 'DGS10',          key: 'treasury_10y'         },
  { id: 'DGS2',           key: 'treasury_2y'           },
  { id: 'FEDFUNDS',       key: 'fed_funds_rate'        },
  { id: 'WILL5000INDFC',  key: 'wilshire5000'          },
  { id: 'GDP',            key: 'gdp_billions'          },
  { id: 'SP500DIV',       key: 'sp500_dividend_yield'  },
];

function getBuffettZone(value) {
  if (value < 75)         return 'Undervalued';
  if (value < 90)         return 'Fair';
  if (value < 115)        return 'Elevated';
  if (value < 135)        return 'Overvalued';
  return 'Extreme';
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  // --- Auth ---
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  if (!authCheck.ok) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // --- API keys ---
  const FRED_API_KEY = process.env.FRED_API_KEY;
  const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

  if (!FRED_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FRED_API_KEY not set in Netlify env vars' }),
    };
  }
  if (!POLYGON_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'POLYGON_API_KEY not set in Netlify env vars' }),
    };
  }

  // --- Fetch FRED series in parallel ---
  let fredResults;
  try {
    fredResults = await Promise.all(
      FRED_SERIES.map(async ({ id, key }) => {
        const url = `${FRED_BASE}?series_id=${id}&api_key=${FRED_API_KEY}&sort_order=desc&limit=1&file_type=json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`FRED ${id} returned HTTP ${res.status}`);
        const data = await res.json();
        const raw = data.observations && data.observations[0] && data.observations[0].value;
        if (raw === undefined || raw === null) throw new Error(`FRED ${id}: missing observation value`);
        return { key, value: parseFloat(raw) };
      })
    );
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FRED fetch failed', detail: String(err) }),
    };
  }

  // Map FRED results into a flat object
  const fredData = {};
  for (const { key, value } of fredResults) {
    fredData[key] = value;
  }

  // --- Fetch Bitcoin from CoinGecko (non-fatal) ---
  let bitcoinData = { bitcoin_usd: null, bitcoin_usd_24h_change: null, bitcoin_usd_7d_change: null };
  try {
    const cgRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_7d_change=true'
    );
    if (cgRes.ok) {
      const cgJson = await cgRes.json();
      bitcoinData = {
        bitcoin_usd:             cgJson.bitcoin?.usd             ?? null,
        bitcoin_usd_24h_change:  cgJson.bitcoin?.usd_24h_change  ?? null,
        bitcoin_usd_7d_change:   cgJson.bitcoin?.usd_7d_change   ?? null,
      };
    }
  } catch {
    // CoinGecko failure is non-fatal; leave nulls
  }

  // --- Fetch Gold via Polygon (fatal) ---
  let gold_price;
  try {
    const polyRes = await fetch(`https://api.polygon.io/v2/last/trade/GLD?apiKey=${POLYGON_API_KEY}`);
    if (!polyRes.ok) throw new Error(`Polygon GLD returned HTTP ${polyRes.status}`);
    const polyJson = await polyRes.json();
    gold_price = polyJson.results?.p ?? null;
    if (gold_price === null) throw new Error('Polygon GLD: missing results.p');
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Polygon fetch failed', detail: String(err) }),
    };
  }

  // --- Derived metrics ---
  const buffett_indicator_pct = (fredData.wilshire5000 / fredData.gdp_billions) * 100;
  const buffett_zone = getBuffettZone(buffett_indicator_pct);
  const yield_curve_spread_bps = (fredData.treasury_10y - fredData.treasury_2y) * 100;
  const forward_pe = parseFloat(process.env.FORWARD_PE || '21.5');
  const equity_risk_premium_pct = (1 / forward_pe * 100) - fredData.treasury_10y;

  // --- Build response payload ---
  const payload = {
    date: todayISO(),
    ...fredData,
    ...bitcoinData,
    gold_price,
    buffett_indicator_pct,
    buffett_zone,
    yield_curve_spread_bps,
    equity_risk_premium_pct,
  };

  // --- Upsert to Supabase (non-fatal on error, still return data) ---
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/macro_indicators_daily`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Upsert failure does not block the response
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
};
