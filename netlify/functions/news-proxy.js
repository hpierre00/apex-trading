// netlify/functions/news-proxy.js
// Proxies Finnhub market news — no auth required (public page)

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_KEY) return {
    statusCode: 500,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'API key not configured' })
  };

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB_KEY}`
    );
    if (!res.ok) throw new Error('Finnhub error: ' + res.status);
    const data = await res.json();
    // Return top 8 articles with only needed fields
    const clean = (data || []).slice(0, 8).map(a => ({
      headline: a.headline,
      source: a.source,
      url: a.url,
      datetime: a.datetime
    }));
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(clean)
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
