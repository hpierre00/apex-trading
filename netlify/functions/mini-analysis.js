// netlify/functions/mini-analysis.js
// Public endpoint for Chrome extension — no auth required.
// Rate limited by Netlify's built-in DDoS protection.

const SYSTEM_PROMPT = `You are a concise trading analyst for the Tradolux AI Chrome extension.
Given a stock ticker, provide a brief multi-factor analysis.

Respond ONLY with valid JSON in this exact format:
{
  "agents": [
    { "name": "Chart Intelligence", "verdict": "BULLISH" },
    { "name": "Sentiment", "verdict": "NEUTRAL" },
    { "name": "Fundamental", "verdict": "STRONG" },
    { "name": "Risk Management", "verdict": "CAUTION" },
    { "name": "Macro", "verdict": "HEADWIND" }
  ],
  "summary": "2-3 sentence plain English summary of the overall picture for this stock right now."
}

Verdict must be one of: BULLISH, BEARISH, NEUTRAL, STRONG, WEAK, CAUTION, HEADWIND, TAILWIND.
Be direct and specific. No disclaimers. No markdown. Valid JSON only.`;

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return {
    statusCode: 500,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Service not configured' })
  };

  let ticker;
  try {
    const body = JSON.parse(event.body || '{}');
    ticker = (body.ticker || '').trim().toUpperCase();
  } catch(e) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid ticker' }) };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Analyze ${ticker}` }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[mini-analysis] Anthropic error:', res.status, err);
      return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'AI service error' }) };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      console.error('[mini-analysis] JSON parse error:', text);
      return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parse error' }) };
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch(e) {
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
  }
};
