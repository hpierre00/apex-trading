// send-trial-emails.js
// Daily cron. Finds trialing users whose trial_end is ~7 days out (Day 7) or ~1 day
// out (Day 13) and sends the reminder if not already sent. Replaces the old
// SendGrid send_at scheduling, which silently failed past SendGrid's 72-hour cap.

const { sendEmail, emailDay7, emailDay13 } = require('./_trial-emails');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soghksmuocrgtttmnete.supabase.co';

function sbHeaders(key) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'apikey': key };
}

exports.handler = async (event) => {
  const isScheduler = Boolean(event.headers['x-nf-request-id']);
  const secret = event.headers['x-cron-secret'] || '';
  if (!isScheduler && secret !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const svcKey = process.env.SUPABASESKTradoLux;
  if (!svcKey) return { statusCode: 500, body: 'SUPABASESKTradoLux not set' };
  const SB = sbHeaders(svcKey);

  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const DAY = 86400000;

  let day7Sent = 0, day13Sent = 0;

  // Day 7: trial_end 6-8 days out, not yet sent (2-day window absorbs daily cron timing)
  try {
    const url = `${SUPABASE_URL}/rest/v1/profiles` +
      `?subscription_status=eq.trialing` +
      `&trial_end=gte.${encodeURIComponent(iso(now + 6 * DAY))}` +
      `&trial_end=lte.${encodeURIComponent(iso(now + 8 * DAY))}` +
      `&trial_day7_email_sent_at=is.null` +
      `&select=id,email,plan`;
    const res = await fetch(url, { headers: SB });
    const rows = res.ok ? await res.json() : [];
    for (const row of rows) {
      if (!row.email) continue;
      await sendEmail(emailDay7(row.email, row.plan || 'starter'));
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${row.id}`, {
        method: 'PATCH', headers: { ...SB, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ trial_day7_email_sent_at: new Date().toISOString() }),
      });
      day7Sent++;
    }
  } catch (err) {
    console.error('[send-trial-emails] Day 7 batch failed:', err);
  }

  // Day 13: trial_end 0-2 days out, not yet sent
  try {
    const url = `${SUPABASE_URL}/rest/v1/profiles` +
      `?subscription_status=eq.trialing` +
      `&trial_end=gte.${encodeURIComponent(iso(now))}` +
      `&trial_end=lte.${encodeURIComponent(iso(now + 2 * DAY))}` +
      `&trial_day13_email_sent_at=is.null` +
      `&select=id,email,plan`;
    const res = await fetch(url, { headers: SB });
    const rows = res.ok ? await res.json() : [];
    for (const row of rows) {
      if (!row.email) continue;
      await sendEmail(emailDay13(row.email, row.plan || 'starter'));
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${row.id}`, {
        method: 'PATCH', headers: { ...SB, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ trial_day13_email_sent_at: new Date().toISOString() }),
      });
      day13Sent++;
    }
  } catch (err) {
    console.error('[send-trial-emails] Day 13 batch failed:', err);
  }

  console.log(`[send-trial-emails] day7Sent=${day7Sent} day13Sent=${day13Sent}`);
  return { statusCode: 200, body: JSON.stringify({ day7Sent, day13Sent }) };
};
