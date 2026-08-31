/**
 * POST /api/settle — our keeper, two callers:
 *  - {jobId}: client-triggered. The agent page fires it when the settlement
 *    countdown reaches zero, so a judge watches SUBMITTED become COMPLETED.
 *    On-chain verification first (SUBMITTED, our provider from the job
 *    record, window elapsed), then its own limiter kind (settle, 10/IP/day,
 *    60/global/day), then the relay settle.
 *  - {sweep:true} + Bearer REVALIDATE_SECRET: the keepalive backstop; sweeps
 *    every eligible job and reports which it settled.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { verifySettleable, settleJob, sweepSettle } from '@/lib/server/settle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sweepAuthorised(header: string | null): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false;
  const presented = header?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(presented), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  let body: { jobId?: string | number; sweep?: boolean };
  try { body = await req.json(); } catch { return Response.json({ error: 'bad request' }, { status: 400 }); }

  if (body.sweep) {
    if (!sweepAuthorised(req.headers.get('authorization'))) return Response.json({ error: 'unauthorised' }, { status: 401 });
    try { return Response.json({ settled: await sweepSettle() }); }
    catch (e) { return Response.json({ error: String((e as Error).message).slice(0, 120) }, { status: 502 }); }
  }

  let jobId: bigint;
  try { jobId = BigInt(body.jobId!); if (jobId <= 0n || jobId > 100_000_000n) throw new Error('range'); }
  catch { return Response.json({ error: 'bad jobId' }, { status: 400 }); }

  const v = await verifySettleable(jobId);
  if (!v.ok) return Response.json({ error: v.error }, { status: 409 });

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
  const ipHash = createHash('sha256').update('agensea-demo:' + ip).digest('hex');
  const base = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY!;
  let permit: { allowed: boolean; reason: string } | null = null;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/demo_action_permit`, {
      method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_ip_hash: ipHash, p_agent_id: 0, p_kind: 'settle' }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    permit = ((await r.json()) as { allowed: boolean; reason: string }[])?.[0] ?? null;
  } catch { /* fail closed */ }
  if (!permit) return Response.json({ error: 'limiter unavailable' }, { status: 503 });
  if (!permit.allowed) return Response.json({ error: 'settle limit reached — the keepalive sweep will settle it within hours', reason: permit.reason }, { status: 429 });

  try {
    const { tx, status } = await settleJob(jobId);
    console.info(`[settle] job ${jobId} -> ${status} tx=${tx}`);
    return Response.json({ ok: true, tx, status });
  } catch (e) {
    return Response.json({ error: 'settle did not confirm — the keepalive sweep will retry', detail: String((e as Error).message).slice(0, 100) }, { status: 502 });
  }
}
