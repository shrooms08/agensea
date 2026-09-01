/**
 * Claim an ERC-8004 agent by proving you control its owner.
 *
 *   GET  ?owner=0x…    -> candidate agents from OUR sweep (a UI affordance)
 *   GET  ?agentId=N    -> an HMAC'd nonce bound to that agentId, and the
 *                         canonical message to sign
 *   POST {agentId, nonce, exp, mac, signature}
 *                      -> recovers the signer, requires it to equal
 *                         ownerOf(agentId) read LIVE from the registry, then
 *                         records the claim
 *
 * The agentId is never trusted from the request alone: the nonce MAC covers it
 * (so a signature cannot be replayed onto another agent) and the chain read is
 * what authorises. Rate limited on its own kind.
 */
import { createHash } from 'node:crypto';
import { issueNonce, verifyClaimProof, agentsOwnedBy } from '@/lib/server/claim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = url.searchParams.get('owner');
  const agentId = url.searchParams.get('agentId');
  if (owner) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return Response.json({ error: 'bad address' }, { status: 400 });
    return Response.json({ agents: await agentsOwnedBy(owner) }, { headers: { 'cache-control': 'no-store' } });
  }
  if (agentId) {
    const n = Number(agentId);
    if (!Number.isInteger(n) || n < 1 || n > 100_000_000) return Response.json({ error: 'bad agent id' }, { status: 400 });
    return Response.json(issueNonce(n), { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ error: 'pass owner or agentId' }, { status: 400 });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return Response.json({ error: 'bad request' }, { status: 400 }); }

  // ---- ownership proof first; nothing is written for an unproven caller ----
  const proof = await verifyClaimProof(body);
  if (!proof.ok) return Response.json({ error: proof.error }, { status: proof.status });

  // ---- then the limiter, on its own kind ----------------------------------
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
  const ipHash = createHash('sha256').update('agensea-demo:' + ip).digest('hex');
  const base = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY!;
  const rpc = async (fn: string, payload: unknown) => {
    const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload), cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    return (await r.json()) as { allowed?: boolean; reason?: string; ok?: boolean }[];
  };

  let permit: { allowed?: boolean; reason?: string } | null = null;
  try { permit = (await rpc('demo_action_permit', { p_ip_hash: ipHash, p_agent_id: 0, p_kind: 'claim' }))?.[0] ?? null; }
  catch { /* fail closed below */ }
  if (!permit) return Response.json({ error: 'limiter unavailable — claiming disabled rather than unmetered' }, { status: 503 });
  if (!permit.allowed) {
    return Response.json({ error: permit.reason === 'ip'
      ? 'claim limit reached for your connection (3 per day) — try again tomorrow'
      : 'global claim limit reached for today — try again tomorrow' }, { status: 429 });
  }

  try {
    const res = (await rpc('claim_agent', { p_agent_id: proof.agentId, p_owner: proof.owner }))?.[0] ?? null;
    if (!res?.ok) {
      return Response.json({ error: res?.reason === 'claimed-by-another-address'
        ? 'that agent has already been claimed by a different address'
        : `claim refused (${res?.reason ?? 'unknown'})` }, { status: 409 });
    }
    console.info(`[claim] agent ${proof.agentId} claimed by ${proof.owner}`);
    return Response.json({ ok: true, agentId: proof.agentId, owner: proof.owner });
  } catch {
    return Response.json({ error: 'the claim did not record — try again' }, { status: 502 });
  }
}
