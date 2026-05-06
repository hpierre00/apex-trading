// netlify/functions/stripe-webhook.js
// Handles Stripe webhook events to update user subscription status in Supabase.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Map Stripe price IDs to plan names
const PRICE_TO_PLAN = {
  'price_1TUAErRAfobZUNrF4Wj4cOgy': 'starter',  // Starter monthly
  'price_1TUAExRAfobZUNrFpRWN4SUP': 'starter',  // Starter annual
  'price_1TU4wlRAfobZUNrFPmVgeONk': 'pro',       // Pro monthly
  'price_1TU4wpRAfobZUNrFa6We3bUb': 'pro',       // Pro annual
  'price_1TU4wuRAfobZUNrF7AhIbytY': 'elite',     // Elite monthly
  'price_1TU4wzRAfobZUNrFENR9U7XR': 'elite',     // Elite annual
};

async function updateUserPlan(email, plan, status, stripeCustomerId, subscriptionId, trialEnd) {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('[stripe-webhook] SUPABASE_SERVICE_KEY not set');
    return;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      plan,
      subscription_status: status,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: subscriptionId,
      trial_end: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString()
    })
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[stripe-webhook] Supabase update failed:', err);
  } else {
    console.log(`[stripe-webhook] Updated ${email} → plan:${plan} status:${status}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('[stripe-webhook] Event:', stripeEvent.type);

  try {
    switch (stripeEvent.type) {

      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const email = session.customer_email || session.customer_details?.email;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        if (!email || !subscriptionId) break;

        // Fetch subscription to get price ID
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'starter';
        const status = sub.status; // trialing, active, etc.
        const trialEnd = sub.trial_end;

        await updateUserPlan(email, plan, status, customerId, subscriptionId, trialEnd);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        const customerId = sub.customer;
        const priceId = sub.items.data[0]?.price?.id;
        const plan = PRICE_TO_PLAN[priceId] || 'starter';
        const status = sub.status;
        const trialEnd = sub.trial_end;

        // Get customer email
        const customer = await stripe.customers.retrieve(customerId);
        const email = customer.email;
        if (!email) break;

        await updateUserPlan(email, plan, status, customerId, sub.id, trialEnd);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const customerId = sub.customer;
        const customer = await stripe.customers.retrieve(customerId);
        const email = customer.email;
        if (!email) break;

        await updateUserPlan(email, 'free', 'canceled', customerId, sub.id, null);
        break;
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err);
    return { statusCode: 500, body: 'Internal error' };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
