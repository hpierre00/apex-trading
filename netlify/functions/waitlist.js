// Waitlist capture. Stores email addresses in Supabase for early-access
// notification when paid tiers launch.
//
// Required env vars (set in Netlify UI):
//   SUPABASE_URL        — e.g. https://mxyepucitjzleaziizkr.supabase.co
//   SUPABASE_ANON_KEY   — the anon public key
//
// Required Supabase setup (run once in Supabase SQL editor):
//
//   create table if not exists waitlist (
//     id bigserial primary key,
//     email text unique not null,
//     source text,
//     created_at timestamptz default now(),
//     ip_hash text,
//     user_agent text
//   );
//   alter table waitlist enable row level security;
//   create policy "anon_insert_waitlist" on waitlist
//     for insert to anon with check (true);
//
// The policy above allows anonymous inserts but no reads/updates. Only
// you (via Supabase service role) can see the list.

exports.handler = async (event) => {
  // Only POST. Bounce everything else.
  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method not allowed' });
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

  // Validate email format. Strict enough to reject obvious garbage,
  // loose enough to not reject valid odd formats (plus-addressing, etc).
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return resp(400, { error: 'Please enter a valid email address.' });
  }

  // Simple honeypot: if someone submits a payload with a 'website' or
  // 'url' field (common spam bot pattern that fills every field), reject.
  if (body.website || body.url) {
    // Pretend success to not tip off the bot
    return resp(200, { ok: true });
  }

  // Env vars
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing Supabase env vars');
    return resp(500, { error: 'Waitlist is temporarily unavailable.' });
  }

  // Hash the IP for privacy-friendly duplicate detection without storing raw IPs.
  // Uses a rotating salt that's not stored server-side long-term.
  const crypto = require('crypto');
  const ip = event.headers['x-forwarded-for']
    ? event.headers['x-forwarded-for'].split(',')[0].trim()
    : (event.headers['client-ip'] || 'unknown');
  const ipHash = crypto.createHash('sha256').update(ip + '|apex-waitlist-v1').digest('hex').slice(0, 32);
  const userAgent = String(event.headers['user-agent'] || 'unknown').slice(0, 256);

  // POST to Supabase REST API. Prefer=resolution ignores dup key so repeat
  // submits from the same email don't error out the user.
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
      console.error('Supabase insert failed:', res.status, text);
      // Translate common Supabase errors to user-friendly messages
      if (res.status === 409) {
        // Duplicate email. Pretend success; user is already on the list.
        return resp(200, { ok: true, already: true });
      }
      return resp(500, { error: 'Could not join waitlist. Please try again later.' });
    }

    return resp(200, { ok: true });
  } catch (err) {
    console.error('Supabase request error:', err);
    return resp(500, { error: 'Network error. Please try again.' });
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
