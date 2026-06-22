// _trial-emails.js
// Shared email templates and sender — used by stripe-webhook.js (Day 1, immediate)
// and send-trial-emails.js (Day 7 / Day 13, sent when due rather than pre-scheduled).

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) { console.warn('[email] SENDGRID_API_KEY not set — skipping'); return; }

  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: 'hello@tradolux.com', name: 'Tradolux' },
    subject,
    content: [{ type: 'text/html', value: html }],
  };

  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const err = await r.text();
    console.error('[email] SendGrid error:', err);
  } else {
    console.log(`[email] Sent to ${to}`);
  }
}

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

module.exports = { sendEmail, emailDay1, emailDay7, emailDay13 };
