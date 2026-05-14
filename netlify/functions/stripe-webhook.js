// stripe-webhook.js
// Handles Stripe webhook events → updates Supabase + sends Day 1/7/13 trial emails via Resend
// No npm packages — uses Node crypto + fetch throughout

const crypto = require('crypto');

const SUPABASE_URL        = 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';

const PRICE_TO_PLAN = {
  'price_1TUAErRAfobZUNrF4Wj4cOgy': 'starter',
  'price_1TUAExRAfobZUNrFpRWN4SUP': 'starter',
  'price_1TU4wlRAfobZUNrFPmVgeONk': 'pro',
  'price_1TU4wpRAfobZUNrFa6We3bUb': 'pro',
  'price_1TU4wuRAfobZUNrF7AhIbytY': 'elite',
  'price_1TU4wzRAfobZUNrFENR9U7XR': 'elite',
};

// ── Stripe webhook signature verification (no SDK needed) ─────────────────
function verifySignature(rawBody, sigHeader, secret) {
  const parts = {};
  sigHeader.split(',').forEach(p => { const [k,v] = p.split('='); parts[k] = v; });
  const { t, v1 } = parts;
  if (!t || !v1) return null;
  const hmac = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(hmac,'hex'), Buffer.from(v1,'hex'))) return null;
  } catch { return null; }
  if (Math.abs(Date.now()/1000 - parseInt(t)) > 300) return null;
  return JSON.parse(rawBody);
}

// ── Stripe REST helpers ───────────────────────────────────────────────────
async function stripeGet(path) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET}` }
  });
  return r.json();
}

// ── Supabase update ───────────────────────────────────────────────────────
async function updateUserPlan(email, plan, status, customerId, subscriptionId, trialEnd) {
  const svcKey = process.env.SUPABASESKTradoLux;
  if (!svcKey) { console.error('[webhook] SUPABASESKTradoLux not set'); return; }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': svcKey,
      'Authorization': `Bearer ${svcKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      plan, subscription_status: status,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      trial_end: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString()
    })
  });
  if (!r.ok) console.error('[webhook] Supabase error:', await r.text());
  else console.log(`[webhook] ${email} → ${plan}/${status}`);
}

// ── Resend email sender ───────────────────────────────────────────────────
async function sendEmail({ to, subject, html, scheduled_at }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('[email] RESEND_API_KEY not set — skipping'); return; }
  const body = { from: 'Tradolux <hello@tradolux.com>', to: [to], subject, html };
  if (scheduled_at) body.scheduled_at = scheduled_at;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) console.error('[email] Resend error:', d);
  else console.log(`[email] Sent to ${to} — ${scheduled_at ? 'scheduled '+scheduled_at : 'immediate'}`);
}

// ── Email templates ───────────────────────────────────────────────────────
function emailDay1(email, plan) {
  return {
    to: email,
    subject: `Your Tradolux 14-day trial has started ⚡`,
    html: `
<div style="font-family:monospace;background:#060c1a;color:#e8edf8;padding:32px;max-width:560px;margin:0 auto;border-radius:8px;">
  <div style="color:#0ecb81;font-size:20px;font-weight:700;letter-spacing:2px;margin-bottom:8px;">TRADOLUX</div>
  <div style="color:#6b7a9e;font-size:11px;letter-spacing:1px;margin-bottom:24px;">AI TRADING TERMINAL</div>
  <div style="font-size:16px;font-weight:700;margin-bottom:16px;">Your ${plan.toUpperCase()} trial is live.</div>
  <div style="color:#a0aec0;line-height:1.7;margin-bottom:24px;">
    You have 14 days of full access to Tradolux. Here is what to do first:
  </div>
  <div style="margin-bottom:12px;padding:12px 16px;background:#070e20;border-left:3px solid #0ecb81;border-radius:4px;">
    <strong style="color:#0ecb81;">1.</strong> Open the app and tap <strong>⚡ INSTANT ASSESSMENT</strong> on any chart.
  </div>
  <div style="margin-bottom:12px;padding:12px 16px;background:#070e20;border-left:3px solid #0ecb81;border-radius:4px;">
    <strong style="color:#0ecb81;">2.</strong> Check the <strong>AI AGENTS</strong> panel — 5 agents analyse chart, sentiment, fundamentals, risk, and macro simultaneously.
  </div>
  <div style="margin-bottom:24px;padding:12px 16px;background:#070e20;border-left:3px solid #0ecb81;border-radius:4px;">
    <strong style="color:#0ecb81;">3.</strong> Watch the <strong>SIGNALS</strong> strip — live trade setups with entry, stop, and target auto-generated.
  </div>
  <a href="https://tradolux.com/app" style="display:inline-block;background:#0ecb81;color:#060c1a;font-weight:700;font-family:monospace;padding:12px 24px;border-radius:4px;text-decoration:none;letter-spacing:1px;">OPEN TRADOLUX →</a>
  <div style="margin-top:24px;color:#4a5470;font-size:11px;">You are receiving this because you started a trial at tradolux.com</div>
</div>`
  };
}

function emailDay7(email, plan) {
  return {
    to: email,
    subject: `You're halfway through your Tradolux trial`,
    html: `
<div style="font-family:monospace;background:#060c1a;color:#e8edf8;padding:32px;max-width:560px;margin:0 auto;border-radius:8px;">
  <div style="color:#0ecb81;font-size:20px;font-weight:700;letter-spacing:2px;margin-bottom:8px;">TRADOLUX</div>
  <div style="color:#6b7a9e;font-size:11px;letter-spacing:1px;margin-bottom:24px;">AI TRADING TERMINAL</div>
  <div style="font-size:16px;font-weight:700;margin-bottom:16px;">7 days in. 7 days left.</div>
  <div style="color:#a0aec0;line-height:1.7;margin-bottom:24px;">
    You are halfway through your ${plan.toUpperCase()} trial. Here is what traders use most on Tradolux:
  </div>
  <div style="margin-bottom:12px;padding:12px 16px;background:#070e20;border-radius:4px;">
    <span style="color:#c9a84c;font-weight:700;">⚡ Instant Assessment</span><br>
    <span style="color:#6b7a9e;font-size:12px;">One tap. Full chart + sentiment + risk + macro analysis in seconds.</span>
  </div>
  <div style="margin-bottom:12px;padding:12px 16px;background:#070e20;border-radius:4px;">
    <span style="color:#c9a84c;font-weight:700;">📊 Smart Signals</span><br>
    <span style="color:#6b7a9e;font-size:12px;">Entry, stop loss, and take profit auto-calculated from the chart.</span>
  </div>
  <div style="margin-bottom:24px;padding:12px 16px;background:#070e20;border-radius:4px;">
    <span style="color:#c9a84c;font-weight:700;">🤖 5 AI Agents</span><br>
    <span style="color:#6b7a9e;font-size:12px;">Chart, Sentiment, Fundamental, Risk, and Macro running simultaneously.</span>
  </div>
  <a href="https://tradolux.com/app" style="display:inline-block;background:#0ecb81;color:#060c1a;font-weight:700;font-family:monospace;padding:12px 24px;border-radius:4px;text-decoration:none;letter-spacing:1px;">OPEN TRADOLUX →</a>
  <div style="margin-top:24px;color:#4a5470;font-size:11px;">7 days remain on your trial.</div>
</div>`
  };
}

function emailDay13(email, plan) {
  return {
    to: email,
    subject: `Your Tradolux trial ends tomorrow`,
    html: `
<div style="font-family:monospace;background:#060c1a;color:#e8edf8;padding:32px;max-width:560px;margin:0 auto;border-radius:8px;">
  <div style="color:#0ecb81;font-size:20px;font-weight:700;letter-spacing:2px;margin-bottom:8px;">TRADOLUX</div>
  <div style="color:#6b7a9e;font-size:11px;letter-spacing:1px;margin-bottom:24px;">AI TRADING TERMINAL</div>
  <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:#f6465d;">Trial ends in 24 hours.</div>
  <div style="color:#a0aec0;line-height:1.7;margin-bottom:24px;">
    Your ${plan.toUpperCase()} trial expires tomorrow. After that, AI Agents, Instant Assessment, and live signals will be locked.
  </div>
  <div style="margin-bottom:24px;padding:16px;background:#0d1526;border:1px solid #0ecb8133;border-radius:6px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:12px;color:#0ecb81;">Keep your access — upgrade now</div>
    <div style="color:#6b7a9e;font-size:12px;margin-bottom:4px;">✓ All 5 AI Agents</div>
    <div style="color:#6b7a9e;font-size:12px;margin-bottom:4px;">✓ Instant Assessment (unlimited)</div>
    <div style="color:#6b7a9e;font-size:12px;margin-bottom:4px;">✓ Smart signals with entry/stop/target</div>
    <div style="color:#6b7a9e;font-size:12px;">✓ Live IEX market data</div>
  </div>
  <a href="https://tradolux.com/app" style="display:inline-block;background:#0ecb81;color:#060c1a;font-weight:700;font-family:monospace;padding:14px 28px;border-radius:4px;text-decoration:none;letter-spacing:1px;font-size:14px;">UPGRADE NOW →</a>
  <div style="margin-top:24px;color:#4a5470;font-size:11px;">This is your last reminder. Trial expires in 24 hours.</div>
</div>`
  };
}

// ── Main handler ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig     = event.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeEvent = verifySignature(event.body, sig, secret);
  if (!stripeEvent) {
    console.error('[webhook] Signature verification failed');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  console.log('[webhook] Event:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      case 'checkout.session.completed': {
        const session    = stripeEvent.data.object;
        const email      = session.customer_email || session.customer_details?.email;
        const customerId = session.customer;
        const subId      = session.subscription;
        if (!email || !subId) break;

        const sub      = await stripeGet(`/subscriptions/${subId}`);
        const priceId  = sub.items?.data[0]?.price?.id;
        const plan     = PRICE_TO_PLAN[priceId] || 'starter';
        const trialEnd = sub.trial_end; // unix timestamp

        await updateUserPlan(email, plan, sub.status, customerId, subId, trialEnd);

        // Day 1 — immediate welcome
        await sendEmail(emailDay1(email, plan));

        if (trialEnd) {
          const day7  = new Date((trialEnd - (7 * 86400)) * 1000).toISOString();
          const day13 = new Date((trialEnd - (1 * 86400)) * 1000).toISOString();
          await sendEmail({ ...emailDay7(email, plan),  scheduled_at: day7  });
          await sendEmail({ ...emailDay13(email, plan), scheduled_at: day13 });
          console.log(`[email] Scheduled Day 7 → ${day7}  Day 13 → ${day13}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub      = stripeEvent.data.object;
        const customer = await stripeGet(`/customers/${sub.customer}`);
        const email    = customer.email;
        if (!email) break;
        const priceId  = sub.items?.data[0]?.price?.id;
        const plan     = PRICE_TO_PLAN[priceId] || 'starter';
        await updateUserPlan(email, plan, sub.status, sub.customer, sub.id, sub.trial_end);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub      = stripeEvent.data.object;
        const customer = await stripeGet(`/customers/${sub.customer}`);
        const email    = customer.email;
        if (!email) break;
        await updateUserPlan(email, 'free', 'canceled', sub.customer, sub.id, null);
        break;
      }
    }
  } catch (e) {
    console.error('[webhook] Error:', e);
    return { statusCode: 500, body: 'Internal error' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
