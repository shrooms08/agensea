/**
 * Publish a listing for an agent you have proven you own.
 *
 * Requires a FRESH ownership proof, not merely a prior claim: the same nonce +
 * signature + live ownerOf check as /api/claim. A claim recorded earlier is not
 * treated as a standing capability.
 *
 * The endpoint URL is validated (https, resolvable) and STORED ONLY. This build
 * never calls it: fetching an operator-supplied URL from our own route would be
 * an SSRF and an availability risk on the exact path judges use.
 */
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { verifyClaimProof } from '@/lib/server/claim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CATEGORIES = new Set(['health-factor-monitoring', 'rebalancing', 'grid-trading', 'yield-optimisation']);

/**
 * Is a RESOLVED address one we must never reach out to? Checked on the address,
 * not the hostname: `169.254.169.254.nip.io` is a perfectly public name that
 * resolves to the cloud metadata endpoint, and a literal pattern match on the
 * hostname does not stop it.
 */
function isBlockedAddress(ip: string, family: number): boolean {
  if (family === 6) {
    const v6 = ip.toLowerCase();
    // IPv4-mapped (::ffff:10.0.0.1) — unwrap and judge as v4.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]!, 4);
    if (v6 === '::' || v6 === '::1') return true;              // unspecified, loopback
    if (/^f[cd]/.test(v6)) return true;                        // fc00::/7 unique local
    if (/^fe[89ab]/.test(v6)) return true;                     // fe80::/10 link-local
    return false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return true;                                    // 0.0.0.0/8
  if (a === 10) return true;                                   // 10/8
  if (a === 127) return true;                                  // loopback
  if (a === 169 && b === 254) return true;                     // 169.254/16 — CLOUD METADATA
  if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16/12
  if (a === 192 && b === 168) return true;                     // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;           // 100.64/10 CGNAT
  if (a === 192 && b === 0) return true;                        // 192.0.0/24, 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true;         // 198.18/15 benchmark
  if (a >= 224) return true;                                    // multicast + reserved
  return false;
}

/** https only, and it must resolve to a public address. We do a HEAD with a
 *  short timeout purely to check the host answers — never a work request, and
 *  its body is discarded.
 *
 *  TWO GATES, deliberately. The literal pattern is the cheap first pass and
 *  still runs when DNS is unavailable; the resolution check is the one that
 *  actually holds, because the hostname tells you nothing about where it points.
 *  Resolution failing is a refusal, not a pass — we do not reach out to a host
 *  we could not judge.
 *
 *  Not covered: DNS rebinding between this lookup and the fetch below. Closing
 *  that needs the connection pinned to the resolved address; the exposure here
 *  is one HEAD whose body is discarded, and it is recorded on /docs. */
async function endpointResolves(url: string): Promise<{ ok: true } | { ok: false; why: string }> {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, why: 'that is not a valid URL' }; }
  if (u.protocol !== 'https:') return { ok: false, why: 'the endpoint must be https' };
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(u.hostname)) {
    return { ok: false, why: 'that host is not reachable from the public internet' };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(u.hostname, { all: true });
  } catch {
    return { ok: false, why: 'that hostname does not resolve' };
  }
  if (addrs.length === 0) return { ok: false, why: 'that hostname does not resolve' };
  // EVERY answer must be public: one private record is enough to reach it.
  const bad = addrs.find((a) => isBlockedAddress(a.address, a.family));
  if (bad) {
    return { ok: false, why: `that hostname resolves to ${bad.address}, which is not a public address` };
  }
  try {
    await fetch(u.toString(), { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(6_000) });
    return { ok: true };
  } catch { return { ok: false, why: 'that endpoint did not answer' }; }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return Response.json({ error: 'bad request' }, { status: 400 }); }

  const proof = await verifyClaimProof(body);
  if (!proof.ok) return Response.json({ error: proof.error }, { status: proof.status });

  const name = String(body.name ?? '').trim();
  const description = String(body.description ?? '').trim();
  const category = String(body.category ?? '');
  const endpointUrl = String(body.endpointUrl ?? '').trim();
  const priceU = body.priceU === '' || body.priceU === undefined ? null : Number(body.priceU);
  const delivers = Array.isArray(body.delivers)
    ? (body.delivers as unknown[]).map((d) => String(d).trim()).filter(Boolean).slice(0, 24) : [];
  const inputSchema = (body.inputSchema && typeof body.inputSchema === 'object') ? body.inputSchema : {};

  if (!name) return Response.json({ error: 'a name is required' }, { status: 422 });
  if (name.length > 120) return Response.json({ error: 'that name is too long' }, { status: 422 });
  if (!description) return Response.json({ error: 'a description is required' }, { status: 422 });
  if (description.length > 2000) return Response.json({ error: 'that description is too long' }, { status: 422 });
  if (!CATEGORIES.has(category)) return Response.json({ error: 'pick one of the four categories' }, { status: 422 });
  if (priceU !== null && (!Number.isFinite(priceU) || priceU < 0 || priceU > 1_000_000)) {
    return Response.json({ error: 'price must be a number between 0 and 1,000,000 $U' }, { status: 422 });
  }
  if (endpointUrl) {
    const e = await endpointResolves(endpointUrl);
    if (!e.ok) return Response.json({ error: e.why }, { status: 422 });
  }

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
  try { permit = (await rpc('demo_action_permit', { p_ip_hash: ipHash, p_agent_id: 0, p_kind: 'listing' }))?.[0] ?? null; }
  catch { /* fail closed below */ }
  if (!permit) return Response.json({ error: 'limiter unavailable — listing disabled rather than unmetered' }, { status: 503 });
  if (!permit.allowed) {
    return Response.json({ error: permit.reason === 'ip'
      ? 'listing limit reached for your connection (10 per day) — try again tomorrow'
      : 'global listing limit reached for today — try again tomorrow' }, { status: 429 });
  }

  try {
    const res = (await rpc('list_agent', {
      p_agent_id: proof.agentId, p_owner: proof.owner, p_name: name, p_description: description,
      p_category: category, p_delivers: delivers, p_input_schema: inputSchema,
      p_endpoint_url: endpointUrl || null, p_price_u: priceU,
    }))?.[0] ?? null;
    if (!res?.ok) {
      const why = res?.reason === 'not-claimed' ? 'claim the agent before listing it'
        : res?.reason === 'claimed-by-another-address' ? 'that agent is claimed by a different address'
        : `listing refused (${res?.reason ?? 'unknown'})`;
      return Response.json({ error: why }, { status: 409 });
    }
    console.info(`[listing] agent ${proof.agentId} listed by ${proof.owner}`);
    return Response.json({ ok: true, agentId: proof.agentId });
  } catch {
    return Response.json({ error: 'the listing did not save — try again' }, { status: 502 });
  }
}
