// Newsletter signup with double opt-in (Resend).
//   POST  -> emails a signed confirmation link; adds nobody yet.
//   GET   -> verifies the signed link, then adds the contact to the segment and topic.
// Required env vars: SIGNUP_SECRET (long random string) and RESEND_API_KEY (full access).
// Optional overrides: NEWSLETTER_FROM_EMAIL, NEWSLETTER_REPLY_TO.
// Every failure redirects to subscribe.html?error=1&r=<code> so the cause is visible without server logs.
import { createHmac, timingSafeEqual } from "node:crypto";

const CFG = {
  name: "The Five-Lens Brief",
  site: "https://tradolux.com",
  from: process.env.NEWSLETTER_FROM_EMAIL || "Herold Pierre <herold@tradolux.com>",
  replyTo: process.env.NEWSLETTER_REPLY_TO || "hpierre00@gmail.com",
  segmentId: "66ef3411-2c65-4eb9-81f1-f7bdc11abb89",
  topicId: "4744720b-92e9-44a4-b3a6-91489fe41041",
};
const PAGE = `${CFG.site}/subscribe.html`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sign = (email) => createHmac("sha256", process.env.SIGNUP_SECRET || "").update(email).digest("hex");
const back = (q) => Response.redirect(`${PAGE}?${q}`, 303);
const fail = (code) => back(`error=1&r=${code}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Resend allows ~2 requests/second; retry on 429 so back-to-back calls don't fail.
const api = async (path, method, body) => {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  let res;
  for (let i = 0; i < 4; i++) {
    res = await fetch(`https://api.resend.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429) return res;
    await sleep(700 * (i + 1));
  }
  return res;
};

const handle = async (req) => {
  const missing = [!process.env.SIGNUP_SECRET && "secret", !process.env.RESEND_API_KEY && "resend"].filter(Boolean);
  if (missing.length) {
    console.error("[newsletter] missing env:", missing.join(","));
    return fail(`cfg_${missing.join("_")}`);
  }

  if (req.method === "POST") {
    const form = await req.formData();
    if (String(form.get("company") || "").trim()) return back("sent=1"); // honeypot
    const email = String(form.get("email") || "").trim().toLowerCase();
    const first = String(form.get("first_name") || "").trim().slice(0, 60);
    if (!EMAIL_RE.test(email) || email.length > 200) return fail("email");

    const link = `${CFG.site}/.netlify/functions/newsletter?email=${encodeURIComponent(email)}&first=${encodeURIComponent(first)}&sig=${sign(email)}`;
    const r = await api("/emails", "POST", {
      from: CFG.from,
      to: email,
      reply_to: CFG.replyTo,
      subject: `Confirm your subscription to ${CFG.name}`,
      html: `<p>Hi${first ? " " + esc(first) : ""},</p><p>Please confirm you want ${esc(CFG.name)} by clicking the link below.</p><p><a href="${link}">Confirm my subscription</a></p><p>If you didn't ask for this, ignore this email and nothing will happen.</p>`,
      text: `Confirm your subscription to ${CFG.name}: ${link}\n\nIf you didn't ask for this, ignore this email.`,
    });
    if (!r.ok) {
      console.error("[newsletter] confirmation send failed:", r.status, await r.text().catch(() => ""));
      return fail(`send_${r.status}`);
    }
    return back("sent=1");
  }

  if (req.method === "GET") {
    const u = new URL(req.url);
    const email = (u.searchParams.get("email") || "").toLowerCase();
    const first = (u.searchParams.get("first") || "").slice(0, 60);
    const sig = u.searchParams.get("sig") || "";
    const good = sign(email);
    if (!EMAIL_RE.test(email) || sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) {
      return fail("sig");
    }
    // One request: create (or update) the contact and set segment + topic together.
    const c = await api("/contacts", "POST", {
      email,
      first_name: first,
      unsubscribed: false,
      segments: [{ id: CFG.segmentId }],
      topics: [{ id: CFG.topicId, subscription: "opt_in" }],
    });
    if (!c.ok && c.status !== 409) {
      console.error("[newsletter] create contact failed:", c.status, await c.text().catch(() => ""));
      return fail(`contact_${c.status}`);
    }
    return back("confirmed=1");
  }

  return new Response("Method not allowed", { status: 405 });
};

export default async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[newsletter] unhandled:", e && e.message);
    return fail(`exception_${String((e && e.name) || "Error").replace(/[^A-Za-z]/g, "").slice(0, 20)}`);
  }
};
