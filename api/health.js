// GET /api/health - shows which settings the functions can see (true/false only, never the values).
export function GET() {
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return Response.json({
    gemini_key_set: Boolean(process.env.GEMINI_API_KEY),
    supabase_url_set: Boolean(process.env.SUPABASE_URL),
    supabase_key_set: Boolean(key),
    supabase_key_type: key.startsWith('sb_secret_') ? 'secret' : key.startsWith('eyJ') ? 'legacy_jwt' : key ? 'other' : 'none',
    env: process.env.VERCEL_ENV || 'unknown',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
