/**
 * Deliverable verification, browser-side.
 *
 * TWO CANONICALISATIONS EXIST, and each deliverable records which one it used.
 * Both sort keys recursively and emit JSON with no whitespace; they differ only
 * in how a non-ASCII character is encoded before hashing:
 *
 *   'raw'      the character as UTF-8, which is what JSON.stringify emits
 *   'escaped'  one \uXXXX per UTF-16 code unit (Python json ensure_ascii=True)
 *
 * The producer changed rule partway through: apps/agents' manifestHash escapes,
 * and every job it has submitted since that fix reproduces ONLY under 'escaped'.
 * Jobs submitted before it reproduce ONLY under 'raw'. A pure-ASCII manifest is
 * identical either way, so it verifies under both.
 *
 * MEASURED against the chain for all eight published deliverables:
 *   748 raw · 753 ascii · 754 raw · 757 raw · 765 ascii
 *   795 escaped · 796 escaped · 797 ascii
 *
 * This file previously implemented 'raw' only and claimed one path served
 * everything. That held for the five deliverables published at the time — three
 * predate the producer fix and two are pure ASCII — and would have reported a
 * FALSE MISMATCH on 795 and 796, which is worse than publishing nothing.
 */
import { keccak256 } from 'js-sha3';

/** Which non-ASCII encoding a given deliverable was hashed under. */
export type Canon = 'raw' | 'escaped';

export const CANONICALISATION = (canon: Canon) =>
  `canonical JSON — recursively sorted keys, no whitespace, ${
    canon === 'escaped' ? 'non-ASCII escaped as \\uXXXX' : 'raw UTF-8'
  } — keccak256`;

/** One \uXXXX per UTF-16 code unit, matching the producer's escapeNonAscii. */
function escapeNonAscii(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch.codePointAt(0)! < 0x80) { out += ch; continue; }
    for (let i = 0; i < ch.length; i++) out += '\\u' + ch.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return out;
}

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

export function manifestHash(manifest: unknown, canon: Canon): string {
  const json = JSON.stringify(canonicalise(manifest));
  return '0x' + keccak256(new TextEncoder().encode(canon === 'escaped' ? escapeNonAscii(json) : json));
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
