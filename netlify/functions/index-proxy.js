// netlify/functions/index-proxy.js
// Public endpoint — no auth required.
// Returns cleaned Finnhub index quotes with friendly keys and computed fields.

const INDEXES = {
  '^GSPC':  { key: 'SP500',   label: 'S&P 500'     },
  '^DJI':   { key: 'DOW',     label: 'DJIA'        },
  '^IXIC':  { key: 'NASDAQ',  label: 'NASDAQ'      },
  '^RUT':   { key: 'RUT',     label: 'RUSSELL 2K'  },
  '^NYA':   { key: 'NYSE',    label: 'NYSE COMP'   },
  '^OEX':   { key: 'OEX',     label: 'S&P 100'     },
  '^W5000': { key: 'W5000',   label: 'WILSHIRE 5K' },
};

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
      Object.keys(INDEXES).map(sym =>
        fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${KEY}`, {
          headers: { Accept: 'application/json' },
        })
          .then(r => r.ok ? r.json() : null)
          .then(data => ({ sym, data }))
          .catch(() => ({ sym, data: null }))
      )
    );

    const out = {};
    for (const { sym, data } of results) {
      if (!data || typeof data.c !== 'number') continue;
      const { key, label } = INDEXES[sym];
      out[key] = {
        label,
        price:     data.c,
        change:    data.d  ?? null,
        changePct: data.dp ?? null,
        prevClose: data.pc ?? null,
        high:      data.h  ?? null,
        low:       data.l  ?? null,
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
      body: JSON.stringify(out),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
