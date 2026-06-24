import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALERT_EMAIL = 'hpierre00@gmail.com';
const SITE_URL    = 'https://tradolux.com';

async function sendAlert(subject, body) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error('[site-monitor] SENDGRID_API_KEY missing — alert not sent:', subject);
    return;
  }
  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
      from: { email: 'alerts@tradolux.com', name: 'Tradolux Monitor' },
      subject,
      content: [{ type: 'text/plain', value: body }]
    })
  });
}

async function logResult(checks, hasFailure) {
  try {
    await supabase.from('app_telemetry').insert({
      event_type: 'monitor_run',
      feature_name: hasFailure ? 'monitor_alert' : 'monitor_ok',
      metadata: JSON.stringify(checks),
      plan: 'system',
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error('[site-monitor] log failed:', e.message);
  }
}

async function checkUrl(label, url, expectStatus = 200, timeoutMs = 10000) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    const ms = Date.now() - start;
    const ok = res.status === expectStatus;
    return { label, ok, status: res.status, ms, error: ok ? null : `Expected ${expectStatus}, got ${res.status}` };
  } catch (e) {
    return { label, ok: false, status: null, ms: Date.now() - start, error: e.message };
  }
}

async function checkSupabase() {
  const start = Date.now();
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    const ms = Date.now() - start;
    return { label: 'Supabase DB', ok: !error, ms, error: error?.message || null };
  } catch (e) {
    return { label: 'Supabase DB', ok: false, ms: Date.now() - start, error: e.message };
  }
}

async function checkPolygon() {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return { label: 'Polygon API', ok: false, ms: 0, error: 'POLYGON_API_KEY not set' };
  return checkUrl('Polygon API', `https://api.polygon.io/v1/marketstatus/now?apiKey=${key}`);
}

export async function handler() {
  const now = new Date().toISOString();
  console.log(`[site-monitor] Starting checks at ${now}`);

  const results = await Promise.all([
    checkUrl('Homepage',          `${SITE_URL}/`),
    checkUrl('Pricing page',      `${SITE_URL}/pricing.html`),
    checkUrl('Admin-ops function',`${SITE_URL}/.netlify/functions/admin-ops`),
    checkSupabase(),
    checkPolygon()
  ]);

  const failures = results.filter(r => !r.ok);
  const hasFailure = failures.length > 0;

  console.log('[site-monitor] Results:', JSON.stringify(results, null, 2));

  if (hasFailure) {
    const lines = [
      `TRADOLUX MONITOR ALERT — ${now}`,
      '',
      `${failures.length} check(s) failed:`,
      '',
      ...failures.map(f => `  x ${f.label}: ${f.error || `HTTP ${f.status}`} (${f.ms}ms)`),
      '',
      'All checks:',
      ...results.map(r => `  ${r.ok ? 'ok' : 'x'} ${r.label} (${r.ms}ms)${r.error ? ' — ' + r.error : ''}`),
      '',
      'Dashboard: https://app.netlify.com/projects/tradolux',
      'Supabase:  https://supabase.com/dashboard/project/soghksmuocrgtttmnete'
    ];

    const subject = `Tradolux Alert: ${failures.map(f => f.label).join(', ')} DOWN`;
    await sendAlert(subject, lines.join('\n'));
    console.error('[site-monitor] Failures detected. Alert sent.');
  } else {
    console.log('[site-monitor] All checks passed');
  }

  await logResult(results, hasFailure);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: !hasFailure, checks: results, ts: now })
  };
}
