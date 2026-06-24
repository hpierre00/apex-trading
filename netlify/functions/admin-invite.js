import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Invalid token' }) };

  const { data: profile } = await supabase.from('profiles').select('admin').eq('id', user.id).single();
  if (!profile?.admin) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Admin access required' }) };

  if (event.httpMethod === 'GET') {
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, email, plan, subscription_status, admin, created_at')
      .order('created_at', { ascending: false });
    if (error) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ users }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, email, plan, userId } = body;

  if (action === 'invite') {
    if (!email) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'email required' }) };
    const invitePlan = plan || 'elite';
    const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { plan: invitePlan, invited_by: user.email }
    });
    if (inviteErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: inviteErr.message }) };
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert({ id: inviteData.user.id, email, plan: invitePlan, subscription_status: 'invited', updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (profileErr) console.warn('[admin-invite] profile upsert warning:', profileErr.message);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, email, plan: invitePlan }) };
  }

  if (['suspend', 'reactivate', 'terminate'].includes(action)) {
    if (!userId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'userId required' }) };
    const update = action === 'suspend'
      ? { subscription_status: 'suspended', updated_at: new Date().toISOString() }
      : action === 'reactivate'
      ? { subscription_status: 'active', updated_at: new Date().toISOString() }
      : { subscription_status: 'terminated', plan: 'free', updated_at: new Date().toISOString() };
    const { error: updateErr } = await supabase.from('profiles').update(update).eq('id', userId);
    if (updateErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: updateErr.message }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action }) };
  }

  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
}
