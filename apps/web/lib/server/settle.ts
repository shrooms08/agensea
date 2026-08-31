/**
 * Our keeper — SERVER ONLY. Settles SUBMITTED jobs against OUR provider once
 * the 900s dispute window has elapsed, via the relay path (a plain EOA settle
 * tx reverts even from the provider address — measured; see settle_ids.ts).
 */
import 'server-only';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../../../agents/src/erc8183/addresses.ts';
import { encodeFunctionData, parseAbi } from 'viem';
import { AGENTS_WALLET, DISPUTE_WINDOW_SECONDS } from '@/data/first-party-agents';

export async function verifySettleable(jobId: bigint): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await getErc8183Job(BNB_TESTNET, jobId);
  if (!job || job.client === '0x0000000000000000000000000000000000000000') return { ok: false, error: 'job does not exist' };
  if (job.statusName === 'COMPLETED') return { ok: false, error: 'already settled' };
  if (job.statusName !== 'SUBMITTED') return { ok: false, error: `job is ${job.statusName}, not SUBMITTED` };
  if (String(job.provider).toLowerCase() !== AGENTS_WALLET.toLowerCase()) return { ok: false, error: 'job provider is not an AgenSea agent' };
  const eligibleAt = Number(job.submittedAt) + DISPUTE_WINDOW_SECONDS;
  if (Date.now() / 1000 < eligibleAt) return { ok: false, error: `dispute window open for another ${Math.ceil(eligibleAt - Date.now() / 1000)}s` };
  return { ok: true };
}

export async function settleJob(jobId: bigint): Promise<{ tx: string | null; status: string }> {
  const key = process.env.DEMO_ADMIN_KEY?.trim();
  if (!key) throw new Error('keeper not configured');
  const client = createClient({ chains: [BNB_TESTNET] });
  const signer = signerFromPrivateKey(key as `0x${string}`);
  const wallet = await client.createWallet({ signer });
  const addrs = erc8183For(97);
  const data = encodeFunctionData({ abi: parseAbi(['function settle(uint256 jobId, bytes evidence)']), functionName: 'settle', args: [jobId, '0x'] });
  const res = await client.execute({ wallet, signer, calls: [{ to: addrs.router, data }] });
  const after = await getErc8183Job(BNB_TESTNET, jobId);
  return { tx: res.transactionHash ?? null, status: after.statusName };
}

/** Keepalive backstop: sweep every settle-eligible job of ours in the recent window. */
export async function sweepSettle(): Promise<{ jobId: string; tx: string | null; status: string }[]> {
  const addrs = erc8183For(97);
  const r = await fetch(BNB_TESTNET.publicRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: addrs.commerce, data: '0x50355d76' }, 'latest'] }) });
  const head = Number(BigInt(((await r.json()) as { result?: string }).result ?? '0x0'));
  const out: { jobId: string; tx: string | null; status: string }[] = [];
  for (let id = head; id > Math.max(0, head - 60); id--) {
    const v = await verifySettleable(BigInt(id));
    if (!v.ok) continue;
    try { out.push({ jobId: String(id), ...(await settleJob(BigInt(id))) }); }
    catch (e) { out.push({ jobId: String(id), tx: null, status: `settle failed: ${String((e as Error).message).slice(0, 60)}` }); }
  }
  return out;
}
