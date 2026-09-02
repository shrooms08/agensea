/**
 * Operator claim — SERVER ONLY.
 *
 * An operator proves they control the owner of an ERC-8004 agent on chain 56.
 * The proof is the same shape as the gas dispenser's: we issue an HMAC'd nonce,
 * the operator signs a canonical message, and we recover the signer. The nonce
 * MAC covers the agentId, so a signature obtained for one agent cannot be
 * replayed against another.
 *
 * OUR TABLE FINDS CANDIDATES; THE CHAIN DECIDES. The swept agent_liveness.owner
 * column is only used to show an operator which agents they might claim. The
 * claim itself requires recovered signer === ownerOf(agentId) read live from the
 * IdentityRegistry at request time, so a stale or poisoned row cannot authorise
 * anything. A supplied agentId is never trusted on its own.
 */
import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { sbSelect } from '@/lib/supabase';

const IDENTITY_56 = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const OWNER_OF = '0x6352211e'; // cast sig 'ownerOf(uint256)'
const MAINNET_RPC = process.env.ALCHEMY_BSC ?? 'https://bsc-rpc.publicnode.com';
const NONCE_TTL_MS = 10 * 60_000;

const hmacKey = () => {
  const s = process.env.REVALIDATE_SECRET;
  if (!s) throw new Error('secret not configured');
  return createHash('sha256').update('agensea-agent-claim:' + s).digest();
};
const mac = (nonce: string, exp: number, agentId: number) =>
  createHmac('sha256', hmacKey()).update(`${nonce}.${exp}.${agentId}`).digest('hex');

export const claimMessage = (nonce: string, exp: number, agentId: number) =>
  `AgenSea agent claim\n\n` +
  `Signing proves you control the owner of this agent.\n` +
  `No transaction is authorised by this signature.\n\n` +
  `chain: 56\nagentId: ${agentId}\nnonce: ${nonce}\nexpires: ${exp}`;

export function issueNonce(agentId: number) {
  const nonce = randomBytes(16).toString('hex');
  const exp = Date.now() + NONCE_TTL_MS;
  return { nonce, exp, mac: mac(nonce, exp, agentId), message: claimMessage(nonce, exp, agentId) };
}

/**
 * ownerOf(agentId) read from the registry. null when the token does not exist
 * (the call reverts) or the RPC cannot be reached — the caller must treat null
 * as "cannot prove", never as "allowed".
 *
 * FRESHNESS IS A PARAMETER, AND THE SAFE VALUE IS THE DEFAULT. Authorising a
 * claim must never be decided on a cached answer, so this stays no-store unless
 * a caller explicitly asks otherwise. Rendering a listing is the one case that
 * may use a cached read: it decides what to DISPLAY, not what to permit, and an
 * uncached fetch here opts every page that lists an agent out of static
 * rendering. See lib/server/listings.ts.
 */
export async function ownerOfOnChain(
  agentId: number,
  opts: { revalidate?: number } = {},
): Promise<string | null> {
  try {
    const data = OWNER_OF + BigInt(agentId).toString(16).padStart(64, '0');
    const res = await fetch(MAINNET_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      ...(opts.revalidate === undefined
        ? { cache: 'no-store' as const }
        : { next: { revalidate: opts.revalidate } }),
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: IDENTITY_56, data }, 'latest'] }),
    });
    const j = (await res.json()) as { result?: string; error?: unknown };
    if (j.error || typeof j.result !== 'string' || j.result.length < 66) return null;
    const addr = '0x' + j.result.slice(-40);
    return /^0x0{40}$/.test(addr) ? null : addr.toLowerCase();
  } catch { return null; }
}

/** Verify a claim proof. Returns the proven agentId + owner, or an error. */
export async function verifyClaimProof(input: Record<string, unknown>): Promise<{ ok: true; agentId: number; owner: string } | { ok: false; error: string; status: number }> {
  const agentId = Number(input.agentId);
  const { nonce, exp, mac: presented, signature } = input as Record<string, string | number>;
  if (!Number.isInteger(agentId) || agentId < 1 || agentId > 100_000_000) {
    return { ok: false, error: 'bad agent id', status: 400 };
  }
  if (typeof nonce !== 'string' || typeof presented !== 'string' || typeof signature !== 'string' || typeof exp !== 'number') {
    return { ok: false, error: 'bad request', status: 400 };
  }
  const expect = mac(nonce, exp, agentId);
  if (presented.length !== expect.length || !timingSafeEqual(Buffer.from(presented), Buffer.from(expect))) {
    return { ok: false, error: 'invalid nonce for this agent', status: 401 };
  }
  if (Date.now() > exp) return { ok: false, error: 'nonce expired — start the claim again', status: 401 };

  let recovered: string;
  try {
    recovered = (await recoverMessageAddress({
      message: claimMessage(nonce, exp, agentId), signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch { return { ok: false, error: 'signature does not verify', status: 401 }; }

  const owner = await ownerOfOnChain(agentId);
  if (!owner) {
    return { ok: false, error: `could not read ownerOf(${agentId}) from chain 56 — the agent may not exist, or the RPC did not answer`, status: 502 };
  }
  if (owner !== recovered) {
    return { ok: false, error: `that wallet does not own agent ${agentId} — the registry says the owner is ${owner.slice(0, 10)}…`, status: 403 };
  }
  return { ok: true, agentId, owner };
}

export interface OwnedAgent { agent_id: number; client_count: number; checked_at: string }

/** Candidates from OUR sweep — what to offer the operator. Never authority. */
export async function agentsOwnedBy(address: string): Promise<OwnedAgent[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return [];
  const { rows } = await sbSelect<OwnedAgent>('agent_liveness', {
    query: `select=agent_id,client_count,checked_at&owner=eq.${address.toLowerCase()}&order=client_count.desc,agent_id.asc`,
    truncate: { reason: 'claim candidate list is a UI affordance; 200 is far beyond any real operator', limit: 200 },
    revalidate: 0,
  });
  return rows;
}
