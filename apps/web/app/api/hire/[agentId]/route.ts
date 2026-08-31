/**
 * POST /api/hire/[agentId] — platform-sponsored demo hire. SPENDS REAL FUNDS
 * (1 $U + gas per call), so the rate limiter runs BEFORE anything else:
 * enforced atomically in Postgres (demo_action_permit kind='hire',
 * 007_demo_actions.sql; limits live there). Raw IPs are never stored — only a
 * salted sha256. Responses stream as NDJSON stage events.
 */
import { createHash } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { BNB_TESTNET } from '@altananetwork/sdk';
import { ERC8183 } from '@/data/first-party-agents';
import { runDemoHire } from '@/lib/server/hire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const VALID = new Set([2012, 2013, 2014, 2015]);

export async function POST(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { agentId: raw } = await ctx.params;
  const agentId = Number(raw);
  if (!VALID.has(agentId)) return Response.json({ error: 'unknown agent' }, { status: 404 });

  // ---- pre-flight: is the sponsor wallet funded? ---------------------------
  // BEFORE the limiter, so an empty wallet never consumes a slot. Without
  // this the path burned 4 relay retries and then reported "could not fund
  // the escrow — the relay or chain did not answer", blaming the relay for an
  // empty wallet and letting a judge retry into the same wall.
  const budget = BigInt(process.env.DEMO_JOB_BUDGET_WEI ?? '1000000000000000000'); // 1 $U, the job budget
  try {
    const buyer = privateKeyToAccount(process.env.DEMO_BUYER_KEY!.trim() as `0x${string}`).address;
    const r = await fetch(BNB_TESTNET.publicRpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [
        { to: ERC8183.paymentToken, data: '0x70a08231' + buyer.slice(2).toLowerCase().padStart(64, '0') }, 'latest'] }),
    });
    const bal = BigInt(((await r.json()) as { result: string }).result);
    if (bal < budget) {
      return Response.json({
        error: 'sponsored demo budget exhausted — the platform wallet is out of $U; it refills automatically from the testnet faucet every 6 hours, try again later',
        reason: 'budget',
      }, { status: 429 });
    }
  } catch { /* balance unreadable: fall through — the limiter and the hire path still gate funds */ }

  // ---- limiter; this is not optional ---------------------------------------
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
  const ipHash = createHash('sha256').update('agensea-demo:' + ip).digest('hex');
  const base = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY!;
  let permit: { allowed: boolean; reason: string } | null = null;
  try {
    // demo_action_permit with kind='hire' (007): counted separately from
    // revokes. The older demo_hire_permit counted every row regardless of
    // kind, so each revoke — a scored feature judges will use — silently
    // consumed a hire slot, per-IP and global.
    const r = await fetch(`${base}/rest/v1/rpc/demo_action_permit`, {
      method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_ip_hash: ipHash, p_agent_id: agentId, p_kind: 'hire' }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    const rows = (await r.json()) as { allowed: boolean; reason: string }[];
    permit = rows?.[0] ?? null;
  } catch { /* limiter unreachable */ }
  if (!permit) {
    // Fail CLOSED: if the limiter cannot be consulted, no funds move.
    return Response.json({ error: 'limiter unavailable — demo disabled rather than unmetered' }, { status: 503 });
  }
  if (!permit.allowed) {
    const msg = permit.reason === 'ip'
      ? 'demo limit reached for your connection (2 per day) — try again tomorrow'
      : 'global demo limit reached for today (6 sponsored jobs per day)';
    return Response.json({ error: msg, reason: permit.reason }, { status: 429 });
  }

  // ---- stream the cycle ---------------------------------------------------
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const ev of runDemoHire(agentId)) {
          controller.enqueue(enc.encode(JSON.stringify(ev) + '\n'));
        }
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({
          stage: 'error', kind: 'internal', message: String((e as Error)?.message ?? e).slice(0, 160),
        }) + '\n'));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}
