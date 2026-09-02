/**
 * Receipt fallback for the hire flow.
 *
 * WHY THIS EXISTS. The browser polls for receipts through ONE endpoint — the
 * chain default in lib/wallet/config.ts — while the wallet broadcasts through
 * its OWN node, which we neither choose nor can see. When our endpoint lags or
 * rate-limits, viem's waitForTransactionReceipt times out on a transaction that
 * is already mined, and the flow reported that as a FAILURE. A judge then reads
 * "failed" about a transaction that succeeded and took their money.
 *
 * So when the poll times out we ask a second endpoint directly, by hash. This
 * walks the same RPCS list lib/verify.ts uses, with the same rule: HTTP 429 is
 * a TRANSPORT failure, never an answer. "Not found" from a reachable endpoint
 * is a real "not mined yet"; a rate-limited endpoint tells us nothing at all,
 * and the two must never be conflated.
 */
import { RPCS } from '@/lib/verify';

export type ReceiptLookup =
  /** Mined. `success` false means it reverted on chain — a real failure. */
  | { kind: 'mined'; success: boolean; endpoint: string }
  /** Every endpoint answered and none had it. Genuinely not on chain yet. */
  | { kind: 'absent' }
  /** No endpoint could be reached. We know NOTHING — never render as failure. */
  | { kind: 'unreachable'; detail: string };

/**
 * Read a receipt for `hash` from the fallback endpoints, in order.
 *
 * Returns on the first endpoint that gives a definite answer. An endpoint that
 * 429s or errors is skipped, not believed.
 */
export async function receiptByHash(hash: string, timeoutMs = 8000): Promise<ReceiptLookup> {
  const failures: string[] = [];
  let sawDefiniteAbsence = false;

  for (const url of RPCS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      });
      if (res.status === 429) { failures.push(`${host(url)}: rate limited (HTTP 429)`); continue; }
      if (!res.ok) { failures.push(`${host(url)}: HTTP ${res.status}`); continue; }
      const body = (await res.json()) as { result?: { status?: string } | null; error?: { message?: string } };
      if (body.error) { failures.push(`${host(url)}: ${body.error.message ?? 'RPC error'}`); continue; }
      // A reachable endpoint returning null means "no such receipt" — definite.
      if (body.result == null) { sawDefiniteAbsence = true; continue; }
      return { kind: 'mined', success: body.result.status === '0x1', endpoint: host(url) };
    } catch (e) {
      failures.push(`${host(url)}: ${(e as Error).name === 'AbortError' ? 'timed out' : String((e as Error).message).slice(0, 40)}`);
    } finally {
      clearTimeout(t);
    }
  }
  if (sawDefiniteAbsence) return { kind: 'absent' };
  return { kind: 'unreachable', detail: failures.join(' · ') || 'no endpoint answered' };
}

const host = (url: string) => {
  try { return new URL(url).host; } catch { return url; }
};
