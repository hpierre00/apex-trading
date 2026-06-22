// stripe-webhook.js
// Handles Stripe webhook events → updates Supabase + sends Day 1 trial email.
// Day 7 / Day 13 emails are handled by send-trial-emails.js (daily cron).
// No npm packages — uses Node crypto + fetch throughout.

const crypto = require('crypto');
const { sendEmail, emailDay1 } = require('./_trial-emails');

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
async function updateUserPlan(userId, email, plan, status, customerId, subscriptionId, trialEnd) {
  const svcKey = process.env.SUPABASESKTradoLux;
  if (!svcKey) { console.error('[webhook] SUPABASESKTradoLux not set'); return; }
  const filter = userId ? `id=eq.${encodeURIComponent(userId)}` : `email=eq.${encodeURIComponent(email)}`;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${filter}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': svcKey,
      'Authorization': `Bearer ${svcKey}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      plan, subscription_status: status,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      trial_end: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString()
    })
  });
  if (!r.ok) { console.error('[webhook] Supabase error:', await r.text()); return; }
  const updated = await r.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    console.error(`[webhook] PATCH matched 0 rows for ${userId ? 'userId='+userId : 'email='+email} — plan NOT applied`);
    return;
  }
  console.log(`[webhook] ${userId || email} → ${plan}/${status}`);
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
        const userId   = sub.metadata?.supabase_user_id || null;

        await updateUserPlan(userId, email, plan, sub.status, customerId, subId, trialEnd);

        // Day 1 — immediate welcome
        await sendEmail(emailDay1(email, plan));
        // Day 7 / Day 13 handled by send-trial-emails.js daily cron
        break;
      }

      case 'customer.subscription.updated': {
        const sub      = stripeEvent.data.object;
        const customer = await stripeGet(`/customers/${sub.customer}`);
        const email    = customer.email;
        const userId   = sub.metadata?.supabase_user_id || null;
        if (!email && !userId) break;
        const priceId  = sub.items?.data[0]?.price?.id;
        const plan     = PRICE_TO_PLAN[priceId] || 'starter';
        await updateUserPlan(userId, email, plan, sub.status, sub.customer, sub.id, sub.trial_end);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub      = stripeEvent.data.object;
        const customer = await stripeGet(`/customers/${sub.customer}`);
        const email    = customer.email;
        const userId   = sub.metadata?.supabase_user_id || null;
        if (!email && !userId) break;
        await updateUserPlan(userId, email, 'free', 'canceled', sub.customer, sub.id, null);
        break;
      }
    }
  } catch (e) {
    console.error('[webhook] Error:', e);
    return { statusCode: 500, body: 'Internal error' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
