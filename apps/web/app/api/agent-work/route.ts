/**
 * POST /api/agent-work — the agent's side of a WALLET-NATIVE hire.
 * On-chain verification runs BEFORE anything else (job exists, FUNDED,
 * provider is our agents' wallet AS RECORDED IN THE JOB, buyer is not a
 * platform wallet); only then the limiter (kind 'agentwork', 6/IP/day,
 * 30/global/day — the judge's $U funds the job, ours only pays the submit
 * relay fee), then analysis + session-key submit, streamed as NDJSON.
 *
 * GET ?address=0x… — the stuck-funded recovery scan: FUNDED jobs for that
 * buyer against our provider, read from chain state.
 */
import { createHash } from 'node:crypto';
import { runAgentWork, verifyJobOnChain, findFundedJobs } from '@/lib/server/agent-work';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: 'bad address' }, { status: 400 });
  try { return Response.json({ jobs: await findFundedJobs(address) }, { headers: { 'cache-control': 'no-store' } }); }
  catch { return Response.json({ error: 'chain scan failed' }, { status: 502 }); }
}

export async function POST(req: Request) {
  let jobId: bigint;
  try {
    const body = (await req.json()) as { jobId?: string | number };
    jobId = BigInt(body.jobId!);
    if (jobId <= 0n || jobId > 100_000_000n) throw new Error('range');
  } catch { return Response.json({ error: 'bad jobId' }, { status: 400 }); }

  // ---- on-chain verification FIRST -----------------------------------------
  const v = await verifyJobOnChain(jobId);
  if (!v.ok) return Response.json({ error: v.error }, { status: 409 });

  // ---- then the limiter ----------------------------------------------------
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
  const ipHash = createHash('sha256').update('agensea-demo:' + ip).digest('hex');
  const base = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY!;
  let permit: { allowed: boolean; reason: string } | null = null;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/demo_action_permit`, {
      method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_ip_hash: ipHash, p_agent_id: v.agentId, p_kind: 'agentwork' }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    permit = ((await r.json()) as { allowed: boolean; reason: string }[])?.[0] ?? null;
  } catch { /* fail closed below */ }
  if (!permit) return Response.json({ error: 'limiter unavailable — agent work disabled rather than unmetered' }, { status: 503 });
  if (!permit.allowed) {
    return Response.json({ error: permit.reason === 'ip'
      ? 'agent-work limit reached for your connection (6 per day) — your escrow is safe; resume tomorrow or reclaim after expiry'
      : 'global agent-work limit reached for today — your escrow is safe; resume tomorrow or reclaim after expiry',
      reason: permit.reason }, { status: 429 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const ev of runAgentWork(jobId)) controller.enqueue(enc.encode(JSON.stringify(ev) + '\n'));
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ stage: 'error', kind: 'internal', message: String((e as Error)?.message ?? e).slice(0, 160) }) + '\n'));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
