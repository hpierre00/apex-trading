// netlify/functions/contact-form.js
// Public contact form endpoint — no auth required. Sends a notification via
// Resend to CONTACT_NOTIFY_EMAIL with Reply-To set to the visitor's address.

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, email, subject, message, company, website } = body;

  // "website" is a hidden honeypot field — real visitors never fill it in.
  if (website) {
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  }

  if (!name || !email || !message) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Name, email, and message are required.' }) };
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }
  if (String(message).length > 5000) {
    return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Message is too long.' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const NOTIFY_TO = process.env.CONTACT_NOTIFY_EMAIL || 'hpierre00@gmail.com';
  const FROM_ADDRESS = process.env.CONTACT_FROM_EMAIL || 'Tradolux <notifications@tradolux.com>';

  if (!RESEND_API_KEY) {
    console.error('[contact-form] RESEND_API_KEY is not configured');
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Server misconfiguration.' }) };
  }

  const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  const html = `
    <h2>New contact form submission — Tradolux</h2>
    <p><strong>Name:</strong> ${esc(name)}</p>
    <p><strong>Email:</strong> ${esc(email)}</p>
    ${company ? `<p><strong>Company:</strong> ${esc(company)}</p>` : ''}
    ${subject ? `<p><strong>Subject:</strong> ${esc(subject)}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p>${esc(message).replace(/\n/g, '<br>')}</p>
  `;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [NOTIFY_TO],
        reply_to: email,
        subject: `New contact form message${subject ? `: ${subject}` : ''}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('[contact-form] Resend error:', errText);
      return { statusCode: 502, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed to send message. Please try again later.' }) };
    }
  } catch (e) {
    console.error('[contact-form] send failed:', e.message);
    return { statusCode: 500, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed to send message. Please try again later.' }) };
  }

  return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
};
