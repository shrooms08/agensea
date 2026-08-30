/**
 * Platform-sponsored demo hire — SERVER ONLY.
 *
 * Runs the proven ERC-8183 cycle from the advantage run: 5-call hire batch
 * (buyer smart account) -> real analysis (mainnet reads) -> submit via the
 * agent's scoped session key -> on-chain hash verify. Settlement happens
 * after the 900s dispute window and is reported as pending, honestly.
 *
 * Keys come from server env (DEMO_BUYER_KEY, DEMO_SESSION_KEY_<agentId>),
 * are never logged, and never leave this module. Session tuples (public data)
 * come from data/demo-sessions.json, written by demo_prep.ts.
 */
import 'server-only';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../../../agents/src/erc8183/addresses.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../../../agents/src/erc8183/manifest.ts';
import { readVenusPosition } from '../../../agents/src/venus/client.ts';
import { analyzePosition } from '../../../agents/src/venus/analyze.ts';
import { analyzeLp } from '../../../agents/src/pancake/lp.ts';
import { planGrid } from '../../../agents/src/grid/analyze.ts';
import { compareYields } from '../../../agents/src/yield/compare.ts';
import { encodeFunctionData, parseAbi } from 'viem';
import SESSIONS from '@/data/demo-sessions.json';

export type HireEvent =
  | { stage: 'funded'; jobId: string; tx: string }
  | { stage: 'analysing' }
  | { stage: 'analysed'; ms: number }
  | { stage: 'submitted'; tx: string }
  | { stage: 'verified'; hash: string; onChain: string; manifest: unknown; analysis: unknown }
  | { stage: 'settlement-pending'; eligibleAt: number; note: string }
  | { stage: 'error'; kind: 'relay' | 'rpc' | 'internal'; message: string };

/** Demo inputs per agent — same frozen references the site already documents. */
const DEMO_TASKS: Record<number, { describe: Record<string, unknown>; run: () => Promise<unknown> }> = {
  2012: { describe: { task: 'venus-health', wallet: '0xb76b35db3f2a7d8346013d9b02edbf756cf27c72' },
          run: async () => analyzePosition(await readVenusPosition(56, '0xb76b35db3f2a7d8346013d9b02edbf756cf27c72')) },
  2013: { describe: { task: 'pcs-v3-rebalance', tokenId: '6801109' },
          run: () => analyzeLp(6801109n) },
  2014: { describe: { task: 'grid-parameters', pair: 'USDT/WBNB', fee: 500, capitalUsd: 10000 },
          run: () => planGrid('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', '0x55d398326f99059fF775485246999027B3197955', 500, 10000) },
  2015: { describe: { task: 'yield-route', asset: 'BTCB', positionUsd: 10000 },
          run: () => compareYields(10000) },
};

const classify = (e: unknown): 'relay' | 'rpc' => {
  const m = String((e as Error)?.message ?? e);
  return /relay|execut|intent|bundle/i.test(m) ? 'relay' : 'rpc';
};

export async function* runDemoHire(agentId: number): AsyncGenerator<HireEvent> {
  const meta = (SESSIONS as { sessions: { agentId: number; address: string; publicKey: string; expiry: number; capWei: string; calls: { signature: string; to: string }[]; walletAddress: string }[] })
    .sessions.find((s) => s.agentId === agentId);
  const task = DEMO_TASKS[agentId];
  if (!meta || !task) { yield { stage: 'error', kind: 'internal', message: 'unknown agent' }; return; }

  const buyerKey = process.env.DEMO_BUYER_KEY?.trim();
  const sessionKey = process.env[`DEMO_SESSION_KEY_${agentId}`]?.trim();
  if (!buyerKey || !sessionKey) { yield { stage: 'error', kind: 'internal', message: 'demo signing not configured' }; return; }

  const client = createClient({ chains: [BNB_TESTNET] });
  const addrs = erc8183For(97);
  const rpc = async (method: string, params: unknown[]) => {
    const r = await fetch(BNB_TESTNET.publicRpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    return ((await r.json()) as { result?: string }).result!;
  };

  const buyerSigner = signerFromPrivateKey(buyerKey as `0x${string}`);
  const buyerWallet = await client.createWallet({ signer: buyerSigner });
  const description = JSON.stringify({ demo: true, ...task.describe, at: Date.now() });

  // HIRE, with the jobId-race retry from the proven path
  let jobId = 0n, hireTx: string | null = null;
  try {
    for (let attempt = 1; attempt <= 4; attempt++) {
      jobId = BigInt(await rpc('eth_call', [{ to: addrs.commerce, data: '0x50355d76' }, 'latest'])) + 1n;
      try {
        const res = await client.execute({ wallet: buyerWallet, signer: buyerSigner,
          calls: buildHireCalls({ addresses: addrs, jobId, provider: meta.walletAddress as `0x${string}`,
            description, budget: 10n ** 18n, expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600) }) });
        const job = await getErc8183Job(BNB_TESTNET, jobId);
        if (job.description !== description || job.statusName !== 'FUNDED') throw new Error('jobId race lost');
        hireTx = res.transactionHash ?? null;
        break;
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise((r2) => setTimeout(r2, 1500));
      }
    }
  } catch (e) {
    yield { stage: 'error', kind: classify(e), message: 'could not fund the escrow — the relay or chain did not answer' };
    return;
  }
  yield { stage: 'funded', jobId: jobId.toString(), tx: hireTx ?? '' };

  // ANALYSE
  yield { stage: 'analysing' };
  let analysis: unknown; const tA = Date.now();
  try { analysis = await task.run(); }
  catch { yield { stage: 'error', kind: 'rpc', message: 'analysis read failed — could not reach BSC mainnet' }; return; }
  yield { stage: 'analysed', ms: Date.now() - tA };

  // SUBMIT via the scoped session
  const manifest: DeliverableManifest = {
    version: 1, job_id: Number(jobId), chain_id: 97,
    contracts: { commerce: addrs.commerce, router: addrs.router, policy: addrs.policy },
    response: { content: JSON.stringify(analysis), content_type: 'application/json' },
    metadata: { agent_id: agentId, demo: true, analysed_chain: 56 },
  };
  const hash = manifestHash(manifest);
  const url = 'data:application/json;base64,' + Buffer.from(canonicalize(manifest), 'utf8').toString('base64');
  try {
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
    yield { stage: 'submitted', tx: res.transactionHash ?? '' };
  } catch (e) {
    yield { stage: 'error', kind: classify(e), message: 'deliverable submit did not confirm — relay timeout or session rejection' };
    return;
  }

  // VERIFY on chain
  try {
    const job = await getErc8183Job(BNB_TESTNET, jobId);
    if (job.deliverable.toLowerCase() !== hash.toLowerCase()) {
      yield { stage: 'error', kind: 'internal', message: 'on-chain deliverable does not match the manifest hash' };
      return;
    }
    yield { stage: 'verified', hash, onChain: job.deliverable, manifest: JSON.parse(canonicalize(manifest)), analysis };
    yield { stage: 'settlement-pending', eligibleAt: Math.floor(Date.now() / 1000) + 900,
            note: 'escrow releases after the 900-second dispute window — protocol overhead, not agent latency' };
  } catch {
    yield { stage: 'error', kind: 'rpc', message: 'could not read the job back from chain to verify' };
  }
}
