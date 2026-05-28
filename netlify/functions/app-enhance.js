// Netlify Function: app-enhance
// Monthly cron (first Monday of each month, 7am ET = 11:00 UTC).
// Analyzes app telemetry + signal accuracy and generates product improvement suggestions via Claude.
// Manual trigger: POST with X-Cron-Secret header.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://soghksmuocrgtttmnete.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvZ2hrc211b2NyZ3R0dG1uZXRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTg4MTEsImV4cCI6MjA5MjY5NDgxMX0.FWRiSZG5yGsJdZvntD5LrqmV07NFEjZWjisJSK95b7A';
const SUPABASE_SERVICE_KEY = process.env.SUPABASESKTradoLux;

const SUPABASE_SERVICE_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'apikey': SUPABASE_SERVICE_KEY,
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cron-Secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const isScheduler = Boolean(event.headers['x-nf-request-id']);
  const secret = event.headers['x-cron-secret'] || '';
  if (!isScheduler && secret !== process.env.CRON_SECRET) {
    return {
      statusCode: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }),
    };
  }

  const today = todayISO();

  // ── Step 1: Fetch last 30 days of app_telemetry ───────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let telemetryAgg = {};
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/app_telemetry?created_at=gte.${thirtyDaysAgo}&order=created_at.desc&limit=10000`,
      { headers: SUPABASE_SERVICE_HEADERS }
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const key = `${r.feature_name}|${r.user_plan || 'unknown'}`;
          if (!telemetryAgg[key]) telemetryAgg[key] = { count: 0, duration_sum: 0 };
          telemetryAgg[key].count++;
          telemetryAgg[key].duration_sum += r.session_duration_sec || 0;
        }
      }
    }
  } catch (err) {
    console.warn('[app-enhance] telemetry fetch failed (non-fatal):', err.message);
  }

  const telemetrySummary = Object.entries(telemetryAgg).map(([key, v]) => {
    const [feature_name, user_plan] = key.split('|');
    return {
      feature_name,
      user_plan,
      event_count: v.count,
      avg_session_duration_sec: v.count ? Math.round(v.duration_sum / v.count) : 0,
    };
  }).sort((a, b) => b.event_count - a.event_count).slice(0, 20);

  // ── Step 2: Signal accuracy by symbol and timeframe ───────────────────────
  let signalAccuracy = [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/signal_microstructure_log?created_at=gte.${thirtyDaysAgo}&outcome_at_1hr=not.is.null&order=created_at.desc&limit=5000`,
      { headers: SUPABASE_SERVICE_HEADERS }
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) {
        const groups = {};
        for (const r of rows) {
          const key = `${r.symbol}|${r.timeframe}`;
          if (!groups[key]) groups[key] = { wins: 0, total: 0 };
          groups[key].total++;
          if (r.outcome_at_1hr === 'WIN') groups[key].wins++;
        }
        signalAccuracy = Object.entries(groups)
          .filter(([, g]) => g.total >= 5)
          .map(([key, g]) => {
            const [symbol, timeframe] = key.split('|');
            return { symbol, timeframe, accuracy_pct: parseFloat(((g.wins / g.total) * 100).toFixed(1)), sample_size: g.total };
          })
          .sort((a, b) => b.sample_size - a.sample_size)
          .slice(0, 15);
      }
    }
  } catch (err) {
    console.warn('[app-enhance] signal accuracy fetch failed (non-fatal):', err.message);
  }

  // ── Step 3: Call Claude for product improvements ──────────────────────────
  const claudePrompt = `You are a product analyst for a trading platform called Tradolux. Given this usage and signal accuracy data, identify the top 5 improvements that would most increase user retention and signal quality.

Usage data (top features by event count in last 30 days):
${JSON.stringify(telemetrySummary, null, 2)}

Signal accuracy by symbol and timeframe:
${JSON.stringify(signalAccuracy, null, 2)}

For each improvement return exactly this structure:
{ "priority": "high"|"medium"|"low", "category": "ux"|"feature"|"bug"|"data", "title": "one line max 60 chars", "description": "two sentences", "implementation_notes": "specific changes Claude Code would make" }

Return a JSON array of exactly 5 items only, no prose, no markdown.`;

  let improvements = [];
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: 'You are a product analyst. Output only valid JSON arrays, no prose, no markdown.',
        messages: [{ role: 'user', content: claudePrompt }],
      }),
    });
    if (!claudeRes.ok) throw new Error(`Claude API returned ${claudeRes.status}`);
    const claudeData = await claudeRes.json();
    let rawText = claudeData.content?.[0]?.text || '';
    rawText = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    improvements = JSON.parse(rawText);
    if (!Array.isArray(improvements)) throw new Error('Not an array');
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Claude API failed', detail: String(err) }),
    };
  }

  // ── Step 4a: Try GitHub PR if GITHUB_TOKEN is set ─────────────────────────
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (GITHUB_TOKEN) {
    try {
      const branch = `auto-enhance/${today}`;
      const repo = 'hpierre00/apex-trading';
      const apiBase = `https://api.github.com/repos/${repo}`;
      const ghHeaders = {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
      };

      // Get main branch SHA
      const refRes = await fetch(`${apiBase}/git/ref/heads/main`, { headers: ghHeaders });
      if (!refRes.ok) throw new Error('Could not get main SHA');
      const { object: { sha: mainSha } } = await refRes.json();

      // Create branch
      await fetch(`${apiBase}/git/refs`, {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
      });

      // Build markdown content
      const mdLines = [
        `# Tradolux Enhancement Report — ${today}`,
        '',
        `Generated by app-enhance on ${new Date().toISOString()}`,
        '',
        '## Top 5 Product Improvements',
        '',
        ...improvements.map((imp, i) => [
          `### ${i + 1}. ${imp.title}`,
          `**Priority:** ${imp.priority} | **Category:** ${imp.category}`,
          '',
          imp.description,
          '',
          `**Implementation notes:** ${imp.implementation_notes}`,
          '',
        ].join('\n')),
      ].join('\n');

      const filePath = `reports/enhancements-${today}.md`;
      const content = Buffer.from(mdLines).toString('base64');

      // Create file
      await fetch(`${apiBase}/contents/${filePath}`, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: `[AutoEnhance] Add enhancement report ${today}`,
          content,
          branch,
        }),
      });

      // Create PR
      const prRes = await fetch(`${apiBase}/pulls`, {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({
          title: `[AutoEnhance] Monthly product improvements — ${today}`,
          head: branch,
          base: 'main',
          body: `Auto-generated by app-enhance function.\n\n${improvements.map(i => `- **${i.priority.toUpperCase()}** ${i.title}`).join('\n')}`,
        }),
      });
      const pr = await prRes.json();
      console.log('[app-enhance] PR created:', pr.html_url);
    } catch (err) {
      console.warn('[app-enhance] GitHub PR creation failed:', err.message);
    }
  } else {
    console.warn('[app-enhance] GitHub PR creation skipped — add GITHUB_TOKEN env var to enable');
    // Fallback: upsert to app_telemetry
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/app_telemetry`, {
        method: 'POST',
        headers: { ...SUPABASE_SERVICE_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          event_type: 'enhancement_report',
          feature_name: 'app_enhance',
          user_plan: 'system',
          session_duration_sec: 0,
          metadata: { date: today, improvements },
        }),
      });
    } catch (err) {
      console.error('[app-enhance] telemetry fallback upsert failed:', err.message);
    }
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, improvementsGenerated: improvements.length }),
  };
};
