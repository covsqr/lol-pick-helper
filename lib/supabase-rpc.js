const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vwcmdowgzptxdhmhahhz.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3Y21kb3dnenB0eGRobWhhaGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY4NDEsImV4cCI6MjA5NDU5Mjg0MX0.BHb3CCg6sZv_K31VFpbiap0PrxkBTyMsrgWsYAtynfg';

const RPC_ALLOWLIST = new Set([
  'app_signup',
  'app_login',
  'app_logout',
  'app_get_state',
  'app_save_settings',
  'app_save_pool',
  'app_add_feedback',
  'app_riot_get_state',
  'app_riot_save_sync'
]);

async function callSupabaseRpc(fn, params = {}) {
  if (!RPC_ALLOWLIST.has(fn)) {
    return {
      data: null,
      error: { message: 'RPC not allowed' }
    };
  }

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params || {})
    });
  } catch (error) {
    return {
      data: null,
      error: {
        message: 'Supabase 프로젝트에 연결할 수 없습니다. 프로젝트가 paused 상태인지, Project URL이 바뀌었는지 확인해 주세요.',
        details: error.message
      }
    };
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    return {
      data: null,
      error: {
        message: body?.message || body?.error || `Supabase RPC failed: ${response.status}`,
        details: body
      }
    };
  }

  return {
    data: body,
    error: null
  };
}

export {
  callSupabaseRpc
};
