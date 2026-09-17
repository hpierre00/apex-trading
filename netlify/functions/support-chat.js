// netlify/functions/support-chat.js
// Public AI support chat endpoint — no auth required. Answers general
// Tradolux questions using Claude; refuses personalized trading advice and
// routes account-specific issues to the contact form.

const SYSTEM_PROMPT = `You are the Tradolux support assistant, embedded on tradolux.com.

Tradolux is an AI-powered capital markets intelligence platform for independent
traders and investors. Five simultaneous learning agents generate and evaluate
trading signals in a closed-loop system that improves over time. Tradolux is
NOT a broker — it does not execute trades or hold customer funds, and it is
not a registered investment adviser.

Your job: answer visitor questions about what Tradolux is, how the signal
engine works at a high level, and general pricing/account FAQs.

Rules:
- Never give personalized financial, investment, or trading advice. If asked,
  say plainly you can't do that, but you can explain how the signals work.
- Never invent pricing, features, or guarantees you are not certain of — if
  unsure, say so and point the visitor to the contact form.
- Keep answers short: 2-4 sentences, plain language, no markdown headers.
- For account-specific issues (billing, login, refunds, bugs), don't try to
  resolve them — direct the visitor to the contact form so a human follows up.
- Never claim guaranteed returns or cite specific performance numbers.`;

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { message, history } = body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Message is required.' }) };
  }
  if (message.length > 1000) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Message is too long.' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    console.error('[support-chat] ANTHROPIC_API_KEY not configured');
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Support chat is temporarily unavailable.' }) };
  }

  const safeHistory = Array.isArray(history)
    ? history
        .slice(-8)
        .filter((m) => m && typeof m.role === 'string' && typeof m.content === 'string')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content).slice(0, 1000),
        }))
    : [];

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [...safeHistory, { role: 'user', content: message }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error('[support-chat] Anthropic API error:', errText);
      return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Support chat is temporarily unavailable.' }) };
    }

    const data = await claudeRes.json();
    const reply = (data && data.content && data.content[0] && data.content[0].text && data.content[0].text.trim())
      || "Sorry, I couldn't generate a response. Please try the contact form instead.";

    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ reply }) };
  } catch (e) {
    console.error('[support-chat] failed:', e.message);
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Support chat is temporarily unavailable.' }) };
  }
};
