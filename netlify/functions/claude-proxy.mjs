// Netlify Function v2 (ESM) — Claude API streaming proxy.
// Uses SSE pass-through so long assessments don't hit the 10-second
// synchronous timeout on the free tier. Auth via Supabase JWT.

const SUPABASE_URL     = 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: cors });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!authCheck.ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }

  // ── API key ────────────────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // ── Parse request ──────────────────────────────────────────────────────────
  let body;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400, headers: cors }); }

  const payload = {
    model:      body.model      || 'claude-sonnet-4-5',
    max_tokens: body.max_tokens || 1000,
    messages:   body.messages   || [],
    stream:     true,
  };
  if (body.system) payload.system = body.system;

  // ── Forward to Anthropic with SSE stream ───────────────────────────────────
  let anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify(payload),
  });

  // Retry once on 529 (Anthropic overloaded)
  if (anthropicResp.status === 529) {
    await new Promise(r => setTimeout(r, 2000));
    anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  if (!anthropicResp.ok) {
    const errText = await anthropicResp.text();
    return new Response(errText, {
      status: anthropicResp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Pipe Anthropic's SSE body straight to the client
  return new Response(anthropicResp.body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
};
