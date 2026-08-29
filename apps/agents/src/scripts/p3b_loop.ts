/** Phase 3b: hire all three agents CONCURRENTLY, then deliver concurrently. */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For, assertPolicyWhitelisted } from '../erc8183/addresses.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../erc8183/manifest.ts';
import { updateAgent, readState, SECRETS, ROOT } from '../agent/state.ts';
import { analyzeLp } from '../pancake/lp.ts';
import { planGrid } from '../grid/analyze.ts';
import { compareYields } from '../yield/compare.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
await assertPolicyWhitelisted(addrs, BNB_TESTNET.publicRpcUrl);
console.log('[guard] chain 97 + policy whitelist asserted\n');

const rpc = BNB_TESTNET.publicRpcUrl;
const ethCall = async (to: string, data: string) => {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
  return ((await r.json()) as any).result as string;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const st = readState();
const provider = st.smartAccount as `0x${string}`;
const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const agentWallet = await client.createWallet({ signer: agentSigner });
const buyerKey = readFileSync(resolve(SECRETS, 'buyer.key'), 'utf8').trim() as `0x${string}`;
const buyerSigner = signerFromPrivateKey(buyerKey);
const buyerWallet = await client.createWallet({ signer: buyerSigner });
console.log(`provider ${agentWallet.address}\nbuyer    ${buyerWallet.address}\n`);

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';

const TASKS = {
  agent2: { skill: 'pancakeswap-v3-rebalance', chainId: 56, tokenId: '6801109',
            want: ['inRange', 'fees', 'recommendedRange'] },
  agent3: { skill: 'grid-parameters', chainId: 56, token0: WBNB, token1: USDT, fee: 500,
            capitalUsd: 10000, want: ['bounds', 'gridCount', 'capitalPerLevel', 'expectedFills'] },
  agent4: { skill: 'yield-route', chainId: 56, asset: 'BTCB', positionUsd: 10000,
            want: ['aprByVenue', 'gasToSwitch', 'breakEvenDays'] },
} as const;

const BUDGET = 1_000_000_000_000_000_000n; // 1 $U

/** Hire with jobCounter-collision retry: jobId is predicted as counter+1, and
 *  three concurrent hires race for the same slot. registerJob is client-only so
 *  a loser reverts harmlessly; re-read and retry. */
async function hire(key: string, task: unknown): Promise<{ jobId: bigint; tx: string | null; tFunded: number }> {
  const description = JSON.stringify(task);
  for (let attempt = 1; attempt <= 6; attempt++) {
    const jobId = BigInt(await ethCall(addrs.commerce, '0x50355d76')) + 1n; // jobCounter()
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const calls = buildHireCalls({ addresses: addrs, jobId, provider, description, budget: BUDGET, expiredAt });
    try {
      const res = await client.execute({ wallet: buyerWallet, signer: buyerSigner, calls });
      const job = await getErc8183Job(BNB_TESTNET, jobId);
      // Identify OUR job by its description. Status and provider are NOT enough:
      // all three agents share one provider address and one buyer, so a losing
      // racer sees a FUNDED job with a matching provider and wrongly claims it.
      // That is exactly how job 750 ended up with three claimants.
      if (job.description !== description) {
        throw new Error(`lost jobId ${jobId} race — description belongs to another task`);
      }
      if (job.statusName !== 'FUNDED') throw new Error(`job ${jobId} is ${job.statusName}, expected FUNDED`);
      console.log(`  [${key}] hired jobId=${jobId} tx=${res.transactionHash} (attempt ${attempt})`);
      return { jobId, tx: res.transactionHash ?? null, tFunded: Date.now() };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 90);
      console.log(`  [${key}] hire attempt ${attempt} lost the jobId race or failed: ${msg}`);
      if (attempt === 6) throw e;
      await sleep(1200 + Math.floor(Math.random() * 1800));
    }
  }
  throw new Error('unreachable');
}

async function runAnalysis(key: keyof typeof TASKS): Promise<unknown> {
  if (key === 'agent2') return analyzeLp(BigInt(TASKS.agent2.tokenId));
  if (key === 'agent3') return planGrid(TASKS.agent3.token0, TASKS.agent3.token1, TASKS.agent3.fee, TASKS.agent3.capitalUsd);
  return compareYields(TASKS.agent4.positionUsd);
}

async function deliver(key: keyof typeof TASKS, jobId: bigint, tFunded: number, result: unknown, analysisMs: number) {
  const cur = readState()[key];

  const manifest: DeliverableManifest = {
    version: 1, job_id: Number(jobId), chain_id: 97,
    contracts: { commerce: addrs.commerce, router: addrs.router, policy: addrs.policy },
    response: { content: JSON.stringify(result), content_type: 'application/json' },
    metadata: { agent: cur.name, agent_id: cur.agentId, category: cur.category, analysed_chain: 56 },
  };
  const hash = manifestHash(manifest);
  const canonical = canonicalize(manifest);
  const url = 'data:application/json;base64,' + Buffer.from(canonical, 'utf8').toString('base64');

  const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS, `${key}-session.key`), 'utf8').trim() as `0x${string}`);
  const session = {
    walletAddress: agentWallet.address, signer: ss, publicKey: cur.sessionPublicKey as `0x${string}`,
    permissions: { calls: cur.sessionCalls, spend: [{ limit: BigInt(cur.sessionCap), period: 'hour' as const }] },
    expiry: cur.sessionExpiry as number,
  };
  const data = encodeFunctionData({
    abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']),
    functionName: 'submit', args: [jobId, hash, optParams(url)],
  });
  const res = await client.execute({ session, calls: [{ to: addrs.commerce, data }] });
  const tSubmitted = Date.now();
  const job = await getErc8183Job(BNB_TESTNET, jobId);
  const match = job.deliverable.toLowerCase() === hash.toLowerCase();
  console.log(`  [${key}] submitted job ${jobId} tx=${res.transactionHash} status=${job.statusName} hashMatch=${match} ttd=${((tSubmitted - tFunded) / 1000).toFixed(1)}s`);

  await updateAgent(key, {
    jobId: jobId.toString(), submitTx: res.transactionHash ?? null,
    manifestHash: hash, onChainDeliverable: job.deliverable, hashMatch: match,
    deliverableUrl: url, manifestBytes: canonical.length,
    analysisMs, timeToDeliverableMs: tSubmitted - tFunded,
    jobStatusAfterSubmit: job.statusName, submittedAt: job.submittedAt.toString(), analysis: result,
  });
  return { key, jobId, match };
}

// An Altana smart account has ONE nonce, so concurrent execute() calls from the
// same account fail with InvalidNonce(0x756688fe) — verified. Concurrency must
// come from separate accounts, or be confined to reads. All three agents share a
// provider account here, so:
//   - on-chain writes (hire, submit) are SERIALISED
//   - the analyses, which are pure eth_call, run CONCURRENTLY
// The 900s dispute windows still overlap: submits land within ~30s of each other.
console.log('--- HIRES (serialised: one account, one nonce) ---');
const keys = ['agent2', 'agent3', 'agent4'] as const;
const hires: { k: typeof keys[number]; jobId: bigint; tx: string | null; tFunded: number }[] = [];
for (const k of keys) {
  const h = await hire(k, TASKS[k]);
  await updateAgent(k, { jobId: h.jobId.toString(), hireTx: h.tx, tFundedMs: h.tFunded });
  hires.push({ k, ...h });
}

console.log('\n--- ANALYSES (concurrent: read-only, no nonce) ---');
const tA0 = Date.now();
const analyses = await Promise.all(keys.map(async (k) => {
  const t = Date.now();
  const r = await runAnalysis(k);
  console.log(`  [${k}] analysis done in ${Date.now() - t}ms`);
  return { k, r, ms: Date.now() - t };
}));
console.log(`  wall-clock for all three concurrently: ${Date.now() - tA0}ms`);

console.log('\n--- SUBMITS (serialised) ---');
const out: { key: string; jobId: bigint; match: boolean }[] = [];
for (const h of hires) {
  const a = analyses.find((x) => x.k === h.k)!;
  out.push(await deliver(h.k, h.jobId, h.tFunded, a.r, a.ms));
}
console.log('\nsummary:', out.map((o) => `${o.key}:job${o.jobId}:${o.match ? 'MATCH' : 'MISMATCH'}`).join('  '));
