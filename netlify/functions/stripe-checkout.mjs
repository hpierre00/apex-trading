// Netlify Function v2 — creates a Stripe Checkout session with 14-day trial.
// Requires: STRIPE_SECRET_KEY in Netlify env vars.

export const config = { path: '/api/stripe-checkout' };

import Stripe from 'stripe';

const SUPABASE_URL      = 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';

const VALID_PRICE_IDS = new Set([
  'price_1TUAErRAfobZUNrF4Wj4cOgy', // Starter monthly
  'price_1TUAExRAfobZUNrFpRWN4SUP', // Starter annual
  'price_1TU4wlRAfobZUNrFPmVgeONk', // Pro monthly
  'price_1TU4wpRAfobZUNrFa6We3bUb', // Pro annual
  'price_1TU4wuRAfobZUNrF7AhIbytY', // Elite monthly
  'price_1TU4wzRAfobZUNrFENR9U7XR', // Elite annual
]);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: cors });
  if (req.method !== 'POST') return err('Method not allowed', 405);

  // Verify Supabase JWT
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return err('Unauthorized', 401);

  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  if (!authCheck.ok) return err('Unauthorized', 401);

  const user = await authCheck.json();

  // Parse and validate request body
  let body;
  try { body = await req.json(); }
  catch { return err('Invalid JSON'); }

  const { priceId } = body;
  if (!priceId || !VALID_PRICE_IDS.has(priceId)) return err('Invalid price');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return err('Stripe not configured', 500);

  try {
    const stripe = new Stripe(stripeKey);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      customer_email: user.email,
      success_url: 'https://tradolux.com/app?upgraded=1',
      cancel_url:  'https://tradolux.com/app',
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return err('Stripe error: ' + e.message, 502);
  }
};
