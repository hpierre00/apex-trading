// netlify/functions/stripe-checkout.js
// Creates a Stripe Checkout session with 14-day free trial.
// Requires: STRIPE_SECRET_KEY, SUPABASE_ANON_KEY in Netlify env vars.

const Stripe = require('stripe');

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

function errResponse(msg, statusCode = 400) {
  return {
    statusCode,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: msg }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return errResponse('Method not allowed', 405);

  // Verify Supabase JWT
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return errResponse('Unauthorized', 401);

  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  if (!authCheck.ok) return errResponse('Unauthorized', 401);

  const user = await authCheck.json();

  // Parse and validate request body
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return errResponse('Invalid JSON'); }

  const { priceId } = body;
  if (!priceId || !VALID_PRICE_IDS.has(priceId)) return errResponse('Invalid price');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return errResponse('Stripe not configured', 500);

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

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (e) {
    return errResponse('Stripe error: ' + e.message, 502);
  }
};
