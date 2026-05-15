// claude-edge.js — Netlify Edge Function for Claude API proxy
// Runs on Deno Deploy at the edge — zero cold start, global latency <50ms
// Replaces netlify/functions/claude-proxy.mjs for the SSE streaming path

const SUPABASE_URL      = 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default async (request, context) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST')    return new Response('Method Not Allowed', { status: 405, headers: CORS });

  // Verify Supabase JWT
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY }
  });
  if (!authRes.ok) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  // Cap tokens to prevent runaway costs
  const payload = { ...body, max_tokens: Math.min(body.max_tokens || 1000, 2000), stream: true };

  // Retry on 529 overload
  let anthropicRes;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1000));
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (anthropicRes.status !== 529) break;
    console.warn(`[claude-edge] 529 overload — retry ${attempt + 1}`);
  }

  if (!anthropicRes.ok && anthropicRes.status !== 200) {
    const err = await anthropicRes.text();
    console.error('[claude-edge] Anthropic error:', anthropicRes.status, err);
    return new Response(JSON.stringify({ error: 'AI service error', status: anthropicRes.status }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  // Pipe the SSE stream directly to the client — edge function stays alive for full stream
  return new Response(anthropicRes.body, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
};

export const config = { path: '/api/claude-edge' };
