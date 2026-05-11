// netlify/functions/index-snapshot.js
// Public endpoint — no auth required.
// Returns real-time Finnhub quotes for major US indices.

const INDEX_SYMBOLS = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^NYA', '^OEX', '^W5000'];

exports.handler = async () => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const KEY = process.env.FINNHUB_API_KEY;
  if (!KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'FINNHUB_API_KEY not set' }),
    };
  }

  try {
    const results = await Promise.all(
      INDEX_SYMBOLS.map(sym =>
        fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${KEY}`, {
          headers: { Accept: 'application/json' },
        })
          .then(r => r.ok ? r.json() : null)
          .then(data => ({ sym, data }))
          .catch(() => ({ sym, data: null }))
      )
    );

    const quotes = {};
    for (const { sym, data } of results) {
      if (data && typeof data.c === 'number') quotes[sym] = data;
    }

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
      body: JSON.stringify(quotes),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
