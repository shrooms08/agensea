/**
 * Agent work for WALLET-NATIVE hires — SERVER ONLY. The judge's own wallet
 * funded the job; this runs the analysis and submits the deliverable through
 * the agent's session key. Deliberately standalone: the sponsored path in
 * hire.ts stays byte-for-byte untouched until cutover.
 *
 * TRUST NOTHING FROM THE REQUEST beyond the jobId. Everything is re-read from
 * chain before any work: the job exists, is FUNDED, its budget covers the
 * price, its PROVIDER — as recorded in the job on-chain, not from config — is
 * our agents' wallet (so a crafted jobId against someone else's provider can
 * never make our session key sign work for a job we don't own), and its buyer
 * is not one of our own platform wallets.
 */
import 'server-only';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../../../agents/src/erc8183/addresses.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../../../agents/src/erc8183/manifest.ts';
import { readVenusPosition } from '../../../agents/src/venus/client.ts';
import { analyzePosition } from '../../../agents/src/venus/analyze.ts';
import { analyzeLp } from '../../../agents/src/pancake/lp.ts';
import { planGrid } from '../../../agents/src/grid/analyze.ts';
import { compareYields } from '../../../agents/src/yield/compare.ts';
import { encodeFunctionData, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import SESSIONS from '@/data/demo-sessions.json';
import { AGENTS_WALLET } from '@/data/first-party-agents';
import { GRID_POOLS, TARGETS, validateTarget } from '@/data/hire-spec';
import { readAuthority, healAgentSession } from './session-admin';

export type WorkEvent =
  | { stage: 'job-verified'; jobId: string; agentId: number; provider: string; buyer: string; budget: string; target: string }
  | { stage: 'analysing' }
  | { stage: 'analysed'; ms: number }
  | { stage: 'session-restored'; tx: string }
  | { stage: 'submitted'; tx: string }
  | { stage: 'verified'; hash: string; onChain: string; manifest: unknown; analysis: unknown }
  | { stage: 'settlement-pending'; eligibleAt: number; note: string }
  | { stage: 'error'; kind: 'relay' | 'rpc' | 'verification' | 'internal'; message: string };

/** Each agent's work, parameterised by the buyer's validated target. */
const TASKS: Record<number, { run: (target: string) => Promise<unknown> }> = {
  2012: { run: async (t) => analyzePosition(await readVenusPosition(56, t)) },
  2013: { run: (t) => analyzeLp(BigInt(t)) },
  2014: { run: (t) => { const p = GRID_POOLS[t]!; return planGrid(p.token0, p.token1, p.fee, 10_000); } },
  2015: { run: (t) => compareYields(Number(t)) },
};

/* ---------------------------------------------------------------- targets */
const MAINNET_RPC = process.env.ALCHEMY_BSC ?? 'https://bsc-rpc.publicnode.com';
const VENUS_COMPTROLLER_56 = '0xfD36E2c2a6789Db23113685031d7F16329158384'; // apps/agents/src/venus/addresses.ts
const PCS_NFPM_56 = '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364';          // apps/agents/src/pancake/lp.ts
const PCS_FACTORY_56 = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';       // apps/agents/src/grid/analyze.ts
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');

async function mainnetCall(to: string, data: string): Promise<string | null> {
  try {
    const r = await fetch(MAINNET_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    const j = (await r.json()) as { result?: string; error?: unknown };
    return j.error || typeof j.result !== 'string' ? null : j.result;
  } catch { return null; }
}

/**
 * Chain-state validation of the buyer's target. Runs BEFORE the wallet is
 * asked to sign anything (the route exposes a validate-only mode the page
 * calls first) and AGAIN inside runAgentWork, so a job funded around the
 * check still cannot make the agent analyse a target that does not exist.
 */
export async function validateTargetOnChain(agentId: number, rawTarget: string): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  const fmt = validateTarget(agentId, rawTarget);
  if (!fmt.ok) return fmt;
  const t = fmt.value;
  if (agentId === 2012) {
    const res = await mainnetCall(VENUS_COMPTROLLER_56, '0xabfceffc' + pad(t)); // getAssetsIn(address)
    if (res === null) return { ok: false, error: 'could not reach BSC mainnet to check that address — try again in a moment' };
    // dynamic address[]: length lives at word 1
    const len = res.length >= 130 ? Number(BigInt('0x' + res.slice(66, 130))) : 0;
    if (len === 0) return { ok: false, error: 'that address has no Venus position — it has entered no Venus markets, so there is no health factor to report' };
    return { ok: true, value: t };
  }
  if (agentId === 2013) {
    const res = await mainnetCall(PCS_NFPM_56, '0x99fbab88' + BigInt(t).toString(16).padStart(64, '0')); // positions(uint256)
    if (res === null || res === '0x') return { ok: false, error: `position ${t} does not exist on PancakeSwap V3` };
    return { ok: true, value: t };
  }
  if (agentId === 2014) {
    const p = GRID_POOLS[t]!;
    const res = await mainnetCall(PCS_FACTORY_56, '0x1698ee82' + pad(p.token0) + pad(p.token1) + p.fee.toString(16).padStart(64, '0'));
    const pool = res && res !== '0x' ? '0x' + res.slice(26) : null;
    if (!pool || /^0x0+$/.test(pool)) return { ok: false, error: `no PancakeSwap V3 pool for ${t}` };
    return { ok: true, value: t };
  }
  return { ok: true, value: t }; // 2015: position size, format-checked only
}

/** The target as written into the job description by the buyer's own tx. */
export function targetFromDescription(description: string): string | null {
  try {
    const d = JSON.parse(description) as { target?: unknown };
    return typeof d.target === 'string' ? d.target : null;
  } catch { return null; }
}
const PRICE = 10n ** 18n; // 1 $U

export async function verifyJobOnChain(jobId: bigint): Promise<
  { ok: true; agentId: number; provider: string; buyer: string; budget: bigint; target: string | null } | { ok: false; error: string }> {
  const job = await getErc8183Job(BNB_TESTNET, jobId);
  if (!job || job.client === '0x0000000000000000000000000000000000000000') return { ok: false, error: 'job does not exist' };
  if (job.statusName !== 'FUNDED') return { ok: false, error: `job is ${job.statusName}, not FUNDED` };
  // Provider check FROM THE JOB ON-CHAIN: our agents' wallet or nothing.
  if (String(job.provider).toLowerCase() !== AGENTS_WALLET.toLowerCase()) {
    return { ok: false, error: 'job provider is not an AgenSea agent' };
  }
  if (job.budget < PRICE) return { ok: false, error: 'budget below the 1 $U price' };
  const buyer = String(job.client).toLowerCase();
  const sponsored = privateKeyToAccount((process.env.DEMO_BUYER_KEY ?? '0x' + '1'.repeat(64)) as `0x${string}`).address.toLowerCase();
  if (buyer === sponsored || buyer === AGENTS_WALLET.toLowerCase()) {
    return { ok: false, error: 'platform wallets use the sponsored path' };
  }
  let agentId = 0;
  try { agentId = Number((JSON.parse(job.description) as { agentId?: unknown }).agentId); } catch { /* fall through */ }
  if (!TASKS[agentId]) return { ok: false, error: 'job description does not name a hireable agent (2012-2015)' };
  return { ok: true, agentId, provider: job.provider, buyer: job.client, budget: job.budget, target: targetFromDescription(job.description) };
}

const classify = (e: unknown): 'relay' | 'rpc' => {
  const m = String((e as Error)?.message ?? e);
  return /relay|execut|intent|bundle/i.test(m) ? 'relay' : 'rpc';
};

export async function* runAgentWork(jobId: bigint): AsyncGenerator<WorkEvent> {
  const v = await verifyJobOnChain(jobId);
  if (!v.ok) { yield { stage: 'error', kind: 'verification', message: v.error }; return; }
  const { agentId } = v;
  // The target is whatever the buyer's own createJob wrote on chain. Older
  // jobs (before the input shipped) carry none and fall back to the prefill.
  const rawTarget = v.target ?? TARGETS[agentId]!.prefill;
  const checked = await validateTargetOnChain(agentId, rawTarget);
  if (!checked.ok) { yield { stage: 'error', kind: 'verification', message: `the job's target is not analysable: ${checked.error}` }; return; }
  const target = checked.value;
  yield { stage: 'job-verified', jobId: jobId.toString(), agentId, provider: v.provider, buyer: v.buyer, budget: v.budget.toString(), target };

  const meta = (SESSIONS as { sessions: { agentId: number; publicKey: string; expiry: number; capWei: string; calls: { signature: string; to: string }[]; walletAddress: string }[] })
    .sessions.find((s) => s.agentId === agentId);
  const sessionKey = process.env[`DEMO_SESSION_KEY_${agentId}`]?.trim();
  if (!meta || !sessionKey) { yield { stage: 'error', kind: 'internal', message: 'agent signing not configured' }; return; }

  yield { stage: 'analysing' };
  let analysis: unknown; const tA = Date.now();
  try { analysis = await TASKS[agentId]!.run(target); }
  catch { yield { stage: 'error', kind: 'rpc', message: 'analysis read failed — could not reach BSC mainnet' }; return; }
  yield { stage: 'analysed', ms: Date.now() - tA };

  try {
    const auth = await readAuthority(agentId);
    if (auth && !auth.active) {
      const { tx } = await healAgentSession(agentId);
      yield { stage: 'session-restored', tx: tx ?? '' };
    }
  } catch { /* submit surfaces the real failure */ }

  const addrs = erc8183For(97);
  const manifest: DeliverableManifest = {
    version: 1, job_id: Number(jobId), chain_id: 97,
    contracts: { commerce: addrs.commerce, router: addrs.router, policy: addrs.policy },
    response: { content: JSON.stringify(analysis), content_type: 'application/json' },
    metadata: { agent_id: agentId, wallet_hire: true, target, analysed_chain: 56 },
  };
  const hash = manifestHash(manifest);
  const url = 'data:application/json;base64,' + Buffer.from(canonicalize(manifest), 'utf8').toString('base64');
  try {
    const client = createClient({ chains: [BNB_TESTNET] });
    const ss = signerFromPrivateKey(sessionKey as `0x${string}`);
    const session = {
      walletAddress: meta.walletAddress as `0x${string}`, signer: ss,
      publicKey: meta.publicKey as `0x${string}`,
      permissions: { calls: meta.calls as never, spend: [{ limit: BigInt(meta.capWei), period: 'hour' as const }] },
      expiry: meta.expiry,
    };
    const data = encodeFunctionData({ abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']),
      functionName: 'submit', args: [jobId, hash, optParams(url)] });
    const res = await client.execute({ session: session as never, calls: [{ to: addrs.commerce, data }] });
    if (!res.transactionHash) {
      // Relay accepted the intent but reported no tx (unmapped status — see
      // altana-sdk#57). Verify from chain rather than trusting the resolve.
      const check = await getErc8183Job(BNB_TESTNET, jobId);
      if (check.deliverable.toLowerCase() !== hash.toLowerCase()) {
        yield { stage: 'error', kind: 'relay', message: 'the relay did not confirm the submit — your escrow is untouched; reload and resume in a minute' };
        return;
      }
    }
    yield { stage: 'submitted', tx: res.transactionHash ?? '' };
  } catch (e) {
    yield { stage: 'error', kind: classify(e), message: 'deliverable submit did not confirm — relay timeout or session rejection' };
    return;
  }

  try {
    const job = await getErc8183Job(BNB_TESTNET, jobId);
    if (job.deliverable.toLowerCase() !== hash.toLowerCase()) {
      const unsubmitted = /^0x0+$/.test(job.deliverable);
      yield { stage: 'error', kind: unsubmitted ? 'relay' : 'internal',
              message: unsubmitted
                ? 'the submit did not land on chain — your escrow is untouched; reload and resume in a minute'
                : 'on-chain deliverable does not match the manifest hash' };
      return;
    }
    // persist for the footer strip + later re-verification (best-effort)
    try {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/demo_record_deliverable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY!, authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ p_job_id: Number(jobId), p_agent_id: agentId, p_manifest: manifest }),
      });
    } catch { /* non-fatal */ }
    yield { stage: 'verified', hash, onChain: job.deliverable, manifest: JSON.parse(canonicalize(manifest)), analysis };
    yield { stage: 'settlement-pending', eligibleAt: Math.floor(Date.now() / 1000) + 900,
            note: 'escrow releases to the agent after the 900-second dispute window; the keeper sweeps it automatically' };
  } catch {
    yield { stage: 'error', kind: 'rpc', message: 'could not read the job back from chain to verify' };
  }
}

/** FUNDED jobs for a buyer against OUR provider, scanned from chain state —
 *  the stuck-funded recovery surface. */
export async function findFundedJobs(buyer: string): Promise<{ jobId: string; agentId: number; expiredAt: number; expired: boolean }[]> {
  const rpc = async (data: string) => {
    const r = await fetch(BNB_TESTNET.publicRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: erc8183For(97).commerce, data }, 'latest'] }) });
    return ((await r.json()) as { result?: string }).result;
  };
  const head = Number(BigInt((await rpc('0x50355d76')) ?? '0x0'));
  const out: { jobId: string; agentId: number; expiredAt: number; expired: boolean }[] = [];
  const ids = Array.from({ length: Math.min(40, head) }, (_, i) => head - i);
  for (let i = 0; i < ids.length; i += 8) {
    const jobs = await Promise.all(ids.slice(i, i + 8).map(async (id) => ({ id, job: await getErc8183Job(BNB_TESTNET, BigInt(id)).catch(() => null) })));
    for (const { id, job } of jobs) {
      if (!job || job.statusName !== 'FUNDED') continue;
      if (String(job.client).toLowerCase() !== buyer.toLowerCase()) continue;
      if (String(job.provider).toLowerCase() !== AGENTS_WALLET.toLowerCase()) continue;
      let agentId = 0; try { agentId = Number((JSON.parse(job.description) as { agentId?: unknown }).agentId); } catch { /* skip */ }
      if (!TASKS[agentId]) continue;
      out.push({ jobId: String(id), agentId, expiredAt: Number(job.expiredAt), expired: Date.now() / 1000 > Number(job.expiredAt) });
    }
  }
  return out;
}
