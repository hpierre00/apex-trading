// netlify/functions/market-snapshot.js
// Public market snapshot proxy — NO auth required.
// Used by market-preview.html (pre-login page).

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  // Health check
  const params = event.queryStringParameters || {};
  if (params.health === '1') {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', time: Date.now() }),
    };
  }

  const symbols = params.symbols || 'AAPL,TSLA,NVDA,AMD,MSFT';
  const ALPACA_KEY = process.env.ALPACA_KEY_ID;
  const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY;

  if (!ALPACA_KEY || !ALPACA_SECRET) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Alpaca credentials not configured' }),
    };
  }

  try {
    const resp = await fetch(
      `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symbols}&feed=iex`,
      {
        headers: {
          'APCA-API-KEY-ID': ALPACA_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET,
        },
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[market-snapshot] Alpaca error:', resp.status, errText);
      return {
        statusCode: resp.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Alpaca error', status: resp.status, detail: errText }),
      };
    }

    const text = await resp.text();
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    console.error('[market-snapshot] fetch error:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
