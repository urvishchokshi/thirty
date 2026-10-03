// GET /api/stats - the live numbers shown on the page, computed in Supabase by the plan_stats view.
import { getStats } from './_lib/supabase.js';

export async function GET() {
  try {
    const s = (await getStats()) || {};
    return Response.json(
      {
        plans_generated: Number(s.plans_generated || 0),
        avg_saving_per_month: Number(s.avg_saving_per_month || 0),
        overspending_pct: Number(s.overspending_pct || 0),
        avg_runout_day: Number(s.avg_runout_day || 0),
        visitors: Number(s.visitors || 0),
        last_plan_at: s.last_plan_at || null,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' } },
    );
  } catch (e) {
    console.error('stats failed:', e.message);
    return Response.json({ error: 'db', message: 'Live numbers are unavailable right now.' }, { status: 503 });
  }
}
