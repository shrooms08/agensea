/**
 * Supabase read client for SERVER components and route handlers.
 *
 * Uses the PUBLISHABLE (anon) key only. That key is public by design; safety
 * comes from RLS (003_rls.sql / 004_fanout.sql): anon holds SELECT-only on the
 * public tables and NOTHING on sweep_cursor.
 *
 * The service_role key is never imported here and must never reach the client.
 * It is not read from this module at all.
 */
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

if (!URL_) throw new Error('SUPABASE_URL is not set');
if (!ANON) throw new Error('SUPABASE_ANON_KEY is not set');
if (ANON.startsWith('sb_secret_') || ANON.startsWith('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUi')) {
  throw new Error('SUPABASE_ANON_KEY looks like a SERVICE key — refusing to start');
}

const BASE = URL_.replace(/\/$/, '');

export interface SelectOpts {
  /** PostgREST query string, e.g. "select=agent_id&limit=5" */
  query: string;
  /** Ask PostgREST for an exact total in Content-Range. */
  count?: boolean;
  /** Range header for server-side pagination. */
  range?: [number, number];
  revalidate?: number;
}

export interface SelectResult<T> { rows: T[]; total: number | null; status: number }

export async function sbSelect<T = unknown>(table: string, opts: SelectOpts): Promise<SelectResult<T>> {
  const headers: Record<string, string> = {
    apikey: ANON!,
    Authorization: `Bearer ${ANON}`,
  };
  if (opts.count) headers['Prefer'] = 'count=exact';
  if (opts.range) headers['Range'] = `${opts.range[0]}-${opts.range[1]}`;

  const res = await fetch(`${BASE}/rest/v1/${table}?${opts.query}`, {
    headers,
    next: { revalidate: opts.revalidate ?? 60 },
  });
  const cr = res.headers.get('content-range');
  const total = cr && cr.includes('/') ? Number(cr.split('/')[1]) : null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`supabase ${table} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return { rows: (await res.json()) as T[], total: Number.isFinite(total) ? total : null, status: res.status };
}

/** Probe helper: returns the outcome instead of throwing, so a denial is data. */
export async function sbProbe(table: string, query: string) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
    cache: 'no-store',
  });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body: body.slice(0, 200) };
}
