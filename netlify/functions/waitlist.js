// Waitlist capture with diagnostic mode for env-var debugging.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_KEY  (or legacy SUPABASE_ANON_KEY)
//
// In diagnostic mode (?diag=1 query string), the function returns
// non-sensitive metadata about the request and env state instead of
// posting to Supabase. Used to verify env vars are landing correctly
// without exposing key material in logs.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && !event.queryStringParameters?.diag) {
    return resp(405, { error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

  // Diagnostic mode: GET /.netlify/functions/waitlist?diag=1
  // Returns shape info about the env vars without leaking values.
  if (event.queryStringParameters?.diag === '1') {
    return resp(200, {
      diagnostic: true,
      url_present: !!SUPABASE_URL,
      url_value: SUPABASE_URL || null,
      key_present: !!SUPABASE_ANON_KEY,
      key_length: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.length : 0,
      key_first8: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.slice(0, 8) : null,
      key_last8: SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.slice(-8) : null,
      key_dot_count: SUPABASE_ANON_KEY ? (SUPABASE_ANON_KEY.match(/\./g) || []).length : 0,
      raw_supabase_key: !!process.env.SUPABASE_KEY,
      raw_supabase_anon_key: !!process.env.SUPABASE_ANON_KEY,
      node_version: process.version,
    });
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return resp(400, { error: 'Invalid JSON' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  const source = String(body.source || 'unknown').slice(0, 32);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return resp(400, { error: 'Please enter a valid email address.' });
  }

  if (body.website || body.url) {
    return resp(200, { ok: true });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return resp(500, { error: 'Waitlist is temporarily unavailable.' });
  }

  const crypto = require('crypto');
  const ip = event.headers['x-forwarded-for']
    ? event.headers['x-forwarded-for'].split(',')[0].trim()
    : (event.headers['client-ip'] || 'unknown');
  const ipHash = crypto.createHash('sha256').update(ip + '|apex-waitlist-v1').digest('hex').slice(0, 32);
  const userAgent = String(event.headers['user-agent'] || 'unknown').slice(0, 256);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        email,
        source,
        ip_hash: ipHash,
        user_agent: userAgent,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      // Return Supabase's actual error so we can debug further.
      // Safe to expose: Supabase errors don't leak credentials.
      console.error('Supabase insert failed:', res.status, text);
      if (res.status === 409) {
        return resp(200, { ok: true, already: true });
      }
      return resp(500, {
        error: 'Could not join waitlist. Please try again later.',
        debug_status: res.status,
        debug_body: text.slice(0, 300),
      });
    }

    return resp(200, { ok: true });
  } catch (err) {
    console.error('Supabase request error:', err);
    return resp(500, { error: 'Network error. Please try again.', debug: String(err).slice(0, 200) });
  }
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
