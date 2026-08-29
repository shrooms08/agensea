/**
 * GET /api/health — liveness probe that ACTUALLY QUERIES POSTGRES.
 *
 * WHY THIS IS NOT /api/revalidate: revalidatePath() only marks paths stale. It
 * issues no database query, so a cron hitting it generates zero DB activity and
 * the Supabase free-tier pause clock (7 days of low activity) keeps running.
 * This route exists to be the activity.
 *
 * Caching is disabled at every level — a cached 200 would defeat the entire
 * purpose by reporting health without touching the database.
 *
 * Returns 503 when the read fails, so a paused or unreachable project surfaces
 * as a red CI run rather than as silence.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
  const started = Date.now();
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;

  if (!url || !anon) {
    return Response.json(
      { ok: false, error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured', at: new Date().toISOString() },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    // Smallest real read that proves Postgres answered. registry_stats is 8
    // rows and anon has SELECT on it under RLS.
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/registry_stats?select=key,value,measured_at&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });

    const elapsedMs = Date.now() - started;

    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return Response.json(
        { ok: false, error: `supabase responded ${res.status}`, detail: body, elapsedMs, at: new Date().toISOString() },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }

    const rows = (await res.json()) as { key: string; value: string; measured_at: string }[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json(
        { ok: false, error: 'registry_stats returned no rows', elapsedMs, at: new Date().toISOString() },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }

    return Response.json(
      { ok: true, row: rows[0], elapsedMs, at: new Date().toISOString() },
      { status: 200, headers: { 'cache-control': 'no-store, no-cache, must-revalidate' } },
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: (e as Error).message, elapsedMs: Date.now() - started, at: new Date().toISOString() },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
