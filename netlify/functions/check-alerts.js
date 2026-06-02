import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler() {
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('*, profiles(email)')
    .eq('is_active', true)
    .eq('is_triggered', false);

  if (error) return { statusCode: 500, body: error.message };
  if (!alerts?.length) return { statusCode: 200, body: 'no active alerts' };

  const symbols = [...new Set(alerts.map(a => a.symbol))];
  const snapMap = {};
  try {
    const resp = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${symbols.join(',')}&apiKey=${process.env.POLYGON_API_KEY}`
    );
    const json = await resp.json();
    for (const t of (json.tickers || [])) {
      snapMap[t.ticker] = {
        price:     t.day?.c || t.lastTrade?.p || 0,
        open:      t.day?.o || 0,
        pctChange: t.todaysChangePerc || 0,
        volume:    t.day?.v || 0,
        avgVolume: t.prevDay?.v || 1,
      };
    }
  } catch (e) { return { statusCode: 500, body: 'polygon error: ' + e.message }; }

  let triggered = 0;
  for (const alert of alerts) {
    const snap = snapMap[alert.symbol];
    if (!snap) continue;
    let fired = false, triggerValue = null;
    switch (alert.alert_type) {
      case 'price_above':    fired = snap.price >= alert.threshold;                              triggerValue = snap.price;     break;
      case 'price_below':    fired = snap.price <= alert.threshold;                              triggerValue = snap.price;     break;
      case 'pct_move_up':    fired = snap.pctChange >= alert.threshold;                          triggerValue = snap.pctChange; break;
      case 'pct_move_down':  fired = snap.pctChange <= -Math.abs(alert.threshold);               triggerValue = snap.pctChange; break;
      case 'volume_spike':   fired = (snap.volume / snap.avgVolume) >= (alert.threshold || 2);  triggerValue = snap.volume / snap.avgVolume; break;
      default: continue;
    }
    if (!fired) continue;
    await supabase.from('alerts').update({
      is_triggered: true, triggered_at: new Date().toISOString(),
      trigger_value: triggerValue, updated_at: new Date().toISOString(),
    }).eq('id', alert.id);

    if ((alert.notification_method === 'email' || alert.notification_method === 'both') && alert.profiles?.email) {
      const dir = alert.alert_type.includes('above') || alert.alert_type === 'pct_move_up' ? '\u25b2' : '\u25bc';
      const val = alert.alert_type.includes('pct') ? triggerValue?.toFixed(2)+'%' : alert.alert_type === 'volume_spike' ? triggerValue?.toFixed(1)+'x vol' : '$'+triggerValue?.toFixed(2);
      await supabase.auth.admin.sendRawEmail({
        to: alert.profiles.email,
        subject: `${dir} Tradolux Alert: ${alert.symbol} \u2014 ${alert.label || alert.alert_type}`,
        html: `<div style="font-family:monospace;background:#0b1221;color:#e2e8f0;padding:24px;border-radius:8px"><div style="font-size:18px;font-weight:700;color:#f5a623;margin-bottom:8px">${dir} ${alert.symbol} Alert Triggered</div><div>Type: <b>${alert.alert_type.replace(/_/g,' ').toUpperCase()}</b></div><div>Value: <b>${val}</b></div><br><a href="https://tradolux.com" style="background:#f5a623;color:#0b1221;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:700">Open Tradolux \u2192</a></div>`,
      }).catch(() => {});
    }
    triggered++;
  }
  return { statusCode: 200, body: `checked ${alerts.length} alerts, triggered ${triggered}` };
}
