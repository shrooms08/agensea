/**
 * POST /api/revoke/[agentId] — revoke the agent's session on chain, admin-
 * keyed server-side. Rate-limited BEFORE any chain work (1/IP/day, 4/global/
 * day — a visitor cannot grief the demo agents dead: the session heals
 * automatically on the next demo hire via the tombstone-safe register:false
 * path). Returns the revocation tx and the ACCOUNT-read authority state.
 */
import { createHash } from 'node:crypto';
import { revokeAgentSession, readAuthority } from '@/lib/server/session-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const VALID = new Set([2012, 2013, 2014, 2015]);

export async function POST(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { agentId: raw } = await ctx.params;
  const agentId = Number(raw);
  if (!VALID.has(agentId)) return Response.json({ error: 'unknown agent' }, { status: 404 });

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
  const ipHash = createHash('sha256').update('agensea-demo:' + ip).digest('hex');
  let permit: { allowed: boolean; reason: string } | null = null;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL!.replace(/\/$/, '')}/rest/v1/rpc/demo_action_permit`, {
      method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_ip_hash: ipHash, p_agent_id: agentId, p_kind: 'revoke' }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    permit = ((await r.json()) as { allowed: boolean; reason: string }[])?.[0] ?? null;
  } catch { /* fail closed below */ }
  if (!permit) return Response.json({ error: 'limiter unavailable — revoke disabled rather than unmetered' }, { status: 503 });
  if (!permit.allowed) {
    const msg = permit.reason === 'ip'
      ? 'revoke demo limit reached for your connection (1 per day)'
      : 'global revoke demo limit reached for today (4 per day)';
    return Response.json({ error: msg, reason: permit.reason }, { status: 429 });
  }

  try {
    const { tx } = await revokeAgentSession(agentId);
    let authority = await readAuthority(agentId);
    for (let i = 0; i < 5 && authority?.active !== false; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      authority = await readAuthority(agentId);
    }
    return Response.json({ ok: true, tx, authority });
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    return Response.json({ error: /relay|execut/i.test(m) ? 'the relay did not confirm the revocation' : 'could not reach the chain' }, { status: 502 });
  }
}

/** GET: current authority, chain-read — used by the panel. */
export async function GET(_req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await ctx.params;
  const a = await readAuthority(Number(agentId));
  return Response.json({ authority: a }, { headers: { 'cache-control': 'no-store' } });
}
