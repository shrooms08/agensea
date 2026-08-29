// B402 Bazaar HTTP client.
//
// SERVER-SIDE ONLY. binance.com is DNS-blocked by some ISPs, and this module
// must never be imported into browser code. Nothing here touches the DOM and
// nothing should make it into a client bundle.
import process from 'node:process';

export const BASE_URL = 'https://www.binance.com/bapi/ramp/v1/public/ramp/b402';

const REQUEST_DELAY_MS = 300;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The single address-normalisation point. The Bazaar returns the SAME address
 * in two different casings (0x8d0D000Ee... and 0x8d0d000ee...), so upstream
 * casing is never trusted: every `asset` and `payTo` passes through here before
 * it is stored, compared or grouped.
 */
export const lower = (v: unknown): string | null =>
  typeof v === 'string' ? v.toLowerCase() : null;

export interface RawAccept {
  scheme?: unknown;
  network?: unknown;
  asset?: unknown;
  maxAmountRequired?: unknown;
  payTo?: unknown;
}

export interface NormalizedAccept {
  scheme: string | null;
  network: string | null;
  /** lowercased */
  asset: string | null;
  /** kept as a STRING: these are wei-scale integers that exceed Number.MAX_SAFE_INTEGER */
  maxAmountRequired: string | null;
  /** lowercased */
  payTo: string | null;
}

export interface NormalizedItem {
  resource: string;
  type: string | null;
  x402Version: number | null;
  description: string | null;
  /** epoch milliseconds, as returned */
  lastUpdated: number | null;
  accepts: NormalizedAccept[];
  /** Binance documents quality.{l30DaysTotalCalls,...} but ships no such field today. */
  hasQuality: boolean;
  /** untouched upstream object, stored verbatim as jsonb */
  raw: unknown;
}

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
}

export interface Page {
  items: NormalizedItem[];
  pagination: Pagination;
  /** items the API returned that carried no `resource` field, so cannot be keyed */
  droppedNoResource: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Spacing is enforced across every call, not per-call, so concurrent callers
// cannot collectively exceed the intended rate.
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' ? v : v == null ? null : String(v);

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

function normalizeAccept(a: RawAccept): NormalizedAccept {
  return {
    scheme: asString(a?.scheme),
    network: asString(a?.network),
    asset: lower(a?.asset),
    maxAmountRequired: asString(a?.maxAmountRequired),
    payTo: lower(a?.payTo),
  };
}

function normalizeItem(raw: Record<string, unknown>): NormalizedItem | null {
  const resource = asString(raw?.resource);
  // resource_url is the primary key; an item without one cannot be stored.
  if (!resource) return null;
  const acceptsRaw = Array.isArray(raw?.accepts) ? (raw.accepts as RawAccept[]) : [];
  return {
    resource,
    type: asString(raw?.type),
    x402Version: asNumber(raw?.x402Version),
    description: asString(raw?.description),
    lastUpdated: asNumber(raw?.lastUpdated),
    accepts: acceptsRaw.map(normalizeAccept),
    hasQuality: Object.prototype.hasOwnProperty.call(raw ?? {}, 'quality') && raw.quality != null,
    raw,
  };
}

/**
 * GET /bazaar/resources?limit&offset, unwrapping the BAPI envelope.
 * Throws if success !== true. Retries up to MAX_ATTEMPTS on network error or
 * non-2xx, with exponential backoff.
 */
export async function fetchPage(limit: number, offset: number): Promise<Page> {
  const url = `${BASE_URL}/bazaar/resources?limit=${limit}&offset=${offset}`;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

      const env = (await res.json()) as Record<string, unknown>;
      if (env?.success !== true) {
        throw new Error(
          `BAPI envelope success=${String(env?.success)} code=${String(env?.code)} ` +
            `message=${String(env?.message ?? env?.messageDetail)}`,
        );
      }

      const data = (env.data ?? {}) as Record<string, unknown>;
      const itemsRaw = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      const p = (data.pagination ?? {}) as Record<string, unknown>;

      const items: NormalizedItem[] = [];
      let droppedNoResource = 0;
      for (const it of itemsRaw) {
        const n = normalizeItem(it);
        if (n) items.push(n);
        else droppedNoResource++;
      }

      return {
        items,
        droppedNoResource,
        pagination: {
          limit: asNumber(p.limit) ?? limit,
          offset: asNumber(p.offset) ?? offset,
          total: asNumber(p.total) ?? 0,
        },
      };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        const backoff = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        process.stderr.write(
          `  retry ${attempt}/${MAX_ATTEMPTS - 1} for offset=${offset}: ` +
            `${err instanceof Error ? err.message : String(err)} (waiting ${backoff}ms)\n`,
        );
        await sleep(backoff);
      }
    }
  }
  throw new Error(
    `fetchPage(limit=${limit}, offset=${offset}) failed after ${MAX_ATTEMPTS} attempts: ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
