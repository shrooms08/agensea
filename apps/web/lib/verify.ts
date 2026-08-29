/**
 * Deliverable verification, browser-side.
 *
 * CANONICALISATION — one path, proven against all five deliverables:
 *   recursive key sort -> JSON.stringify (no whitespace) -> UTF-8 -> keccak256
 *
 * There is no escaping step and no per-job flag. Measured: jobs 748/757/754
 * each contain a U+2014 em dash and reproduce ONLY under raw UTF-8; jobs
 * 753/765 are pure ASCII and reproduce under either. So raw UTF-8 — which is
 * what JSON.stringify emits natively — serves all five.
 */
import { keccak256 } from 'js-sha3';

export const CANONICALISATION =
  'canonical JSON — recursively sorted keys, no whitespace, raw UTF-8 — keccak256';

/** Sort object keys recursively. Arrays keep their order; only keys are sorted. */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalise((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

export function manifestHash(manifest: unknown): string {
  const json = JSON.stringify(canonicalise(manifest));
  return '0x' + keccak256(new TextEncoder().encode(json));
}

export type VerifyState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'match'; computed: string; onChain: string; block: string }
  | { kind: 'mismatch'; computed: string; onChain: string }
  /** Transport failure. NEVER conflated with mismatch: we could not read the
   *  chain, so we do not know whether it matches. */
  | { kind: 'unreachable'; detail: string };

const RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
];
const COMMERCE = '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de';
const SEL_GET_JOB = '0xbf22c457';   // getJob(uint256), computed with cast sig

/** getJob returns a struct; word 0 is the ABI offset, deliverable is word 11. */
const DELIVERABLE_WORD = 11;

async function rpcCall(url: string, data: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: COMMERCE, data }, 'latest'] }),
  });
  if (res.status === 429) throw new Error('rate limited (HTTP 429)');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
  if (typeof body.result !== 'string') throw new Error('no result in RPC response');
  return body.result;
}

/**
 * Read job.deliverable from a public RPC. Tries each endpoint in turn; if all
 * fail the caller gets 'unreachable', never 'mismatch'.
 */
export async function readOnChainDeliverable(jobId: string): Promise<{ ok: true; hash: string; rpc: string } | { ok: false; detail: string }> {
  const data = SEL_GET_JOB + BigInt(jobId).toString(16).padStart(64, '0');
  const problems: string[] = [];
  for (const url of RPCS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const hex = (await rpcCall(url, data, ctrl.signal)).slice(2);
      const word = hex.slice(DELIVERABLE_WORD * 64, (DELIVERABLE_WORD + 1) * 64);
      if (word.length !== 64) throw new Error('short response; struct layout unexpected');
      return { ok: true, hash: '0x' + word, rpc: new URL(url).host };
    } catch (e) {
      problems.push(`${new URL(url).host}: ${(e as Error).message}`);
    } finally { clearTimeout(t); }
  }
  return { ok: false, detail: problems.join(' · ') };
}
