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
  /** PostgREST query string, e.g. "select=agent_id&order=agent_id.asc" */
  query: string;
  /** Ask PostgREST for an exact total in Content-Range. */
  count?: boolean;
  /**
   * Explicit page. Supplying this means you WANT one page — the read is a
   * deliberate slice (server-side pagination), not a whole-relation read.
   */
  range?: [number, number];
  /**
   * Opt out of paging and accept a truncated result. Requires a reason, which
   * is logged, so a silent truncation cannot be introduced by accident.
   */
  truncate?: { reason: string; limit: number };
  /** Safety ceiling for an unranged read. Exceeding it THROWS rather than
   *  silently returning a prefix. agent_liveness is 301,992 rows. */
  maxRows?: number;
  revalidate?: number;
}

export interface SelectResult<T> { rows: T[]; total: number | null; status: number }

const PAGE = 1000;          // PostgREST's default and maximum page size
const DEFAULT_MAX_ROWS = 20000;

/**
 * Read rows. PAGES TO EXHAUSTION BY DEFAULT.
 *
 * PostgREST caps an unpaged select at 1000 rows and returns the prefix with no
 * error, so the naive call silently understates every relation larger than the
 * cap. agent_liveness_with_clients is 4,348 rows: rendered unpaged it would
 * show 1,000 beside a headline of 4,348. That class of bug is why this pages
 * by default and throws instead of truncating.
 *
 * Three modes:
 *   range     -> exactly that page (deliberate server-side pagination)
 *   truncate  -> one page of `limit`, reason recorded
 *   otherwise -> every row, or throw if the relation exceeds maxRows
 */
export async function sbSelect<T = unknown>(table: string, opts: SelectOpts): Promise<SelectResult<T>> {
  const base = (extra: Record<string, string>) => {
    const h: Record<string, string> = { apikey: ANON!, Authorization: `Bearer ${ANON}`, ...extra };
    return h;
  };
  const fetchPage = async (from: number, to: number, wantCount: boolean) => {
    const headers = base(wantCount ? { Prefer: 'count=exact', Range: `${from}-${to}` } : { Range: `${from}-${to}` });
    const res = await fetch(`${BASE}/rest/v1/${table}?${opts.query}`, {
      headers, next: { revalidate: opts.revalidate ?? 60 },
    });
    const cr = res.headers.get('content-range');
    const total = cr && cr.includes('/') && cr.split('/')[1] !== '*' ? Number(cr.split('/')[1]) : null;
    if (!res.ok) throw new Error(`supabase ${table} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { rows: (await res.json()) as T[], total, status: res.status };
  };

  // Mode 1: caller wants one specific page.
  if (opts.range) {
    return fetchPage(opts.range[0], opts.range[1], opts.count ?? false);
  }

  // Mode 2: caller deliberately accepts a truncated read.
  if (opts.truncate) {
    const r = await fetchPage(0, opts.truncate.limit - 1, opts.count ?? false);
    return r;
  }

  // Mode 3 (default): page to exhaustion.
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const first = await fetchPage(0, PAGE - 1, true);
  if (first.total !== null && first.total > maxRows) {
    throw new Error(
      `sbSelect ${table}: ${first.total} rows exceeds maxRows ${maxRows}. ` +
      `Use range: [from, to] for server-side pagination, or truncate: { reason, limit } ` +
      `if a partial read is genuinely intended. Refusing to return a silent prefix.`,
    );
  }
  const rows = [...first.rows];
  while (first.total !== null && rows.length < first.total) {
    const next = await fetchPage(rows.length, rows.length + PAGE - 1, false);
    if (next.rows.length === 0) break;
    rows.push(...next.rows);
  }
  return { rows, total: first.total, status: first.status };
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

/**
 * Exact row count for a relation. STANDING RULE: rows.length is never a count.
 * PostgREST caps an unpaged select (default 1000 rows), so .length silently
 * understates any relation larger than the cap. This asks for count=exact and
 * reads Content-Range, which is authoritative regardless of page size.
 */
export async function sbCount(table: string, filter = ''): Promise<number> {
  const q = filter ? `select=${filter.split('&')[0]?.includes('=') ? 'id' : 'id'}&${filter}` : 'select=*';
  const res = await fetch(`${BASE}/rest/v1/${table}?${filter || 'select=*'}`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact', Range: '0-0' },
    cache: 'no-store',
  });
  const cr = res.headers.get('content-range');
  if (!res.ok || !cr || !cr.includes('/')) {
    throw new Error(`sbCount ${table} -> ${res.status} ${cr ?? '(no content-range)'}`);
  }
  const n = Number(cr.split('/')[1]);
  if (!Number.isFinite(n)) throw new Error(`sbCount ${table}: unparseable Content-Range ${cr}`);
  return n;
}
