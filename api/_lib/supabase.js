// Minimal Supabase (PostgREST) client using fetch. Runs only on the server with the service/secret key.
// New-style secret keys (sb_secret_...) go in the `apikey` header only; legacy service_role JWTs (eyJ...)
// also need `Authorization: Bearer`.

function cfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw Object.assign(new Error('Supabase env vars missing'), { code: 'config' });
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return { url, headers };
}

async function call(path, init = {}) {
  const { url, headers } = cfg();
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Supabase HTTP ${res.status}: ${text.slice(0, 300)}`), { code: 'db' });
  }
  return res;
}

/** Store one exchange (request + response) in the plans table. */
export async function insertPlan(row) {
  await call('plans', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
}

/** Count rows matching a PostgREST filter string, without downloading them. */
async function count(filter) {
  const res = await call(`plans?select=id&${filter}`, {
    method: 'GET',
    headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
  });
  const range = res.headers.get('content-range') || '*/0'; // e.g. "0-0/5" or "*/0"
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

/** Successful plans since `sinceIso` for this browser id and for this hashed IP (failed calls don't count). */
export async function countVisitorSince({ visitorId, ipHash, sinceIso }) {
  const since = `created_at=gte.${encodeURIComponent(sinceIso)}&status=eq.ok`;
  const [byVisitor, byIp] = await Promise.all([
    count(`${since}&visitor_id=eq.${encodeURIComponent(visitorId)}`),
    count(`${since}&ip_hash=eq.${encodeURIComponent(ipHash)}`),
  ]);
  return { byVisitor, byIp };
}

/** Plans generated site-wide since `sinceIso` (for the daily ceiling). */
export function countAllSince(sinceIso) {
  return count(`created_at=gte.${encodeURIComponent(sinceIso)}&status=eq.ok`);
}

/** Read-back numbers shown on the page (computed by the plan_stats view in SQL). */
export async function getStats() {
  const res = await call('plan_stats?select=*', { method: 'GET' });
  const rows = await res.json();
  return rows[0] || null;
}
