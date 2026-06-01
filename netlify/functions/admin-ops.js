import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function handler() {
  const results = {};

  const dbStart = Date.now();
  try {
    await supabase.from('profiles').select('id').limit(1);
    results.dbPingMs = Date.now() - dbStart;
    results.dbStatus = 'ok';
  } catch (e) {
    results.dbStatus = 'error';
    results.dbError = e.message;
  }

  const polyStart = Date.now();
  try {
    const resp = await fetch('https://api.polygon.io/v1/marketstatus/now?apiKey=' + process.env.POLYGON_API_KEY);
    const json = await resp.json();
    results.polygonPingMs = Date.now() - polyStart;
    results.polygonStatus = resp.ok ? 'ok' : 'error';
    results.marketStatus = json.market || 'unknown';
  } catch (e) {
    results.polygonStatus = 'error';
  }

  const today = new Date(); today.setHours(0,0,0,0);
  const { count: eventsToday } = await supabase
    .from('app_telemetry')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today.toISOString());

  const { count: eventsWeek } = await supabase
    .from('app_telemetry')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  results.telemetryToday = eventsToday || 0;
  results.telemetryWeek  = eventsWeek  || 0;

  const { count: errors } = await supabase
    .from('app_telemetry')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())
    .eq('event_type', 'error');

  results.errorRateToday = eventsToday > 0 ? ((errors || 0) / eventsToday * 100).toFixed(1) : 0;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results)
  };
}
