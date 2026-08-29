/**
 * ERC-8183 DeliverableManifest.
 *
 * Schema and hash contract come from bnb-chain/bnbagent-sdk
 * (python/bnbagent/erc8183/schema.py) — NOT from @altananetwork/sdk, which has
 * no seller path and therefore produces no manifest.
 *
 *   deliverable (bytes32) = keccak256(canonical manifest JSON)
 *   optParams   (bytes)   = JSON {"deliverable_url": "..."}
 *   canonical             = JSON with sorted keys and no whitespace
 */
import { keccak256, toHex } from 'viem';

export const SCHEMA_VERSION = 1;

export interface DeliverableManifest {
  version: number;
  job_id: number;
  chain_id: number;
  contracts: { commerce: string; router: string; policy: string };
  response: { content: string; content_type: string };
  metadata: Record<string, unknown>;
}

/**
 * Deterministic: sorted keys, no whitespace, and NON-ASCII ESCAPED.
 *
 * Must match Python's json.dumps(obj, sort_keys=True, separators=(",", ":")),
 * which is what bnbagent's schema.py hashes. Python defaults to
 * ensure_ascii=True and emits "\u2014" for an em-dash; JS JSON.stringify emits
 * the raw UTF-8 character. Without this escaping the two languages produce
 * different bytes — and therefore different keccak hashes — for any manifest
 * containing non-ASCII text. Our own recommendation strings contain em-dashes,
 * so this is not hypothetical: jobs 754 and 757 were hashed before this fix.
 */
function escapeNonAscii(json: string): string {
  let out = '';
  for (const ch of json) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) { out += ch; continue; }
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10), lo = 0xdc00 + (v & 0x3ff);
      out += '\\u' + hi.toString(16).padStart(4, '0') + '\\u' + lo.toString(16).padStart(4, '0');
    } else {
      out += '\\u' + cp.toString(16).padStart(4, '0');
    }
  }
  return out;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return escapeNonAscii(JSON.stringify(value));
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const o = value as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => `${escapeNonAscii(JSON.stringify(k))}:${canonicalize(o[k])}`).join(',') + '}';
}

export function manifestHash(m: DeliverableManifest): `0x${string}` {
  return keccak256(toHex(canonicalize(m)));
}

export function optParams(deliverableUrl: string): `0x${string}` {
  return toHex(JSON.stringify({ deliverable_url: deliverableUrl }));
}

/** Reproduce the hash from a fetched manifest — what a buyer/verifier runs. */
export function verifyManifest(fetched: DeliverableManifest, onChain: string): boolean {
  return manifestHash(fetched).toLowerCase() === onChain.toLowerCase();
}
