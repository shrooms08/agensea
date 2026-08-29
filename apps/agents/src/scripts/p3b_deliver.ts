/** Deliver to specific pre-funded jobs (hire path is relay-blocked). */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For } from '../erc8183/addresses.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../erc8183/manifest.ts';
import { updateAgent, readState, SECRETS, ROOT } from '../agent/state.ts';
import { analyzeLp } from '../pancake/lp.ts';
import { planGrid } from '../grid/analyze.ts';
import { compareYields } from '../yield/compare.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map(c=>c.chainId));
const addrs = erc8183For(97);
const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: agentSigner });

const JOBS: [string, bigint][] = [['agent3', 754n], ['agent4', 753n]];
const WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', USDT='0x55d398326f99059fF775485246999027B3197955';

for (const [key, jobId] of JOBS) {
  const job = await getErc8183Job(BNB_TESTNET, jobId);
  const task = JSON.parse(job.description);
  console.log(`\n[${key}] job ${jobId} ${job.statusName} skill=${task.skill}`);
  if (job.statusName !== 'FUNDED') { console.log('  not FUNDED, skipping'); continue; }

  const tFunded = Date.now();
  const t0 = Date.now();
  const result = key === 'agent3'
    ? await planGrid(task.token0, task.token1, task.fee, task.capitalUsd)
    : await compareYields(task.positionUsd);
  const analysisMs = Date.now() - t0;
  console.log(`  analysis ${analysisMs}ms`);

  const cur = readState()[key];
  const manifest: DeliverableManifest = {
    version: 1, job_id: Number(jobId), chain_id: 97,
    contracts: { commerce: addrs.commerce, router: addrs.router, policy: addrs.policy },
    response: { content: JSON.stringify(result), content_type: 'application/json' },
    metadata: { agent: cur.name, agent_id: cur.agentId, category: cur.category, analysed_chain: 56 },
  };
  const hash = manifestHash(manifest);
  const canonical = canonicalize(manifest);
  const url = 'data:application/json;base64,' + Buffer.from(canonical,'utf8').toString('base64');

  const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS, `${key}-session.key`),'utf8').trim() as `0x${string}`);
  const session = { walletAddress: wallet.address, signer: ss, publicKey: cur.sessionPublicKey as `0x${string}`,
    permissions: { calls: cur.sessionCalls, spend: [{ limit: BigInt(cur.sessionCap), period: 'hour' as const }] },
    expiry: cur.sessionExpiry as number };
  const data = encodeFunctionData({ abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']),
    functionName: 'submit', args: [jobId, hash, optParams(url)] });
  const res = await client.execute({ session, calls: [{ to: addrs.commerce, data }] });
  const ttd = Date.now() - tFunded;
  const after = await getErc8183Job(BNB_TESTNET, jobId);
  const match = after.deliverable.toLowerCase() === hash.toLowerCase();
  console.log(`  submit tx=${res.transactionHash} status=${after.statusName} hashMatch=${match} ttd=${(ttd/1000).toFixed(1)}s manifest=${canonical.length}B`);
  await updateAgent(key, { jobId: jobId.toString(), submitTx: res.transactionHash ?? null, manifestHash: hash,
    onChainDeliverable: after.deliverable, hashMatch: match, deliverableUrl: url, manifestBytes: canonical.length,
    analysisMs, timeToDeliverableMs: ttd, jobStatusAfterSubmit: after.statusName, submittedAt: after.submittedAt.toString(), analysis: result });
}

// agent2's job 752 is already SUBMITTED — inspect what landed there
const j752 = await getErc8183Job(BNB_TESTNET, 752n);
console.log(`\n[agent2] job 752 ${j752.statusName} deliverable=${j752.deliverable}`);
