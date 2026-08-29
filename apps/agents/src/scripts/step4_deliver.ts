/** Phase 3a step 4: agent detects the funded job, analyses, submits deliverable. */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For, assertPolicyWhitelisted } from '../erc8183/addresses.ts';
import { analyze } from '../venus/analyze.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../erc8183/manifest.ts';
import { state, save, SECRETS, ROOT } from '../agent/state.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
await assertPolicyWhitelisted(addrs, BNB_TESTNET.publicRpcUrl);

const jobId = BigInt(state.jobId);
const job = await getErc8183Job(BNB_TESTNET, jobId);
console.log(`job ${jobId}: ${job.statusName}  provider=${job.provider}  budget=${job.budget}`);
if (job.statusName !== 'FUNDED') throw new Error(`job is ${job.statusName}, expected FUNDED`);
if (job.provider.toLowerCase() !== String(state.provider).toLowerCase()) throw new Error('provider mismatch');

// --- the actual work -------------------------------------------------------
const task = JSON.parse(job.description) as { chainId: 56 | 97; account: string };
console.log(`\ntask: analyse ${task.account} on chain ${task.chainId}`);
const tStart = Date.now();
const result = await analyze(task.chainId, task.account);
const tAnalysed = Date.now();
console.log(`  HEALTH FACTOR ${result.healthFactor}  risk ${result.riskLevel}`);
console.log(`  collateral $${result.collateralUsd.toFixed(2)} (weighted $${result.weightedCollateralUsd.toFixed(2)})  borrowed $${result.borrowedUsd.toFixed(2)}`);
console.log(`  avg liquidation threshold ${result.avgLiquidationThreshold?.toFixed(4)}  drop-to-liquidation ${(result.priceDropToLiquidation! * 100).toFixed(2)}%`);
console.log(`  analysis took ${tAnalysed - tStart}ms`);

// --- manifest --------------------------------------------------------------
const manifest: DeliverableManifest = {
  version: 1,
  job_id: Number(jobId),
  chain_id: 97,
  contracts: { commerce: addrs.commerce, router: addrs.router, policy: addrs.policy },
  response: { content: JSON.stringify(result), content_type: 'application/json' },
  metadata: { agent: 'venus-health-factor-monitor', agent_id: String(state.agentId), analysed_chain: task.chainId, analysed_block: result.blockNumber },
};
const hash = manifestHash(manifest);
const canonical = canonicalize(manifest);
console.log(`\nmanifest canonical bytes: ${canonical.length}`);
console.log(`deliverable (keccak256) : ${hash}`);

// Self-contained retrieval pointer. Production would use hosted storage; Phase 1b
// measured 59/59 hosted agent URIs returning 404, so a data: URI cannot rot.
const url = 'data:application/json;base64,' + Buffer.from(canonical, 'utf8').toString('base64');
const op = optParams(url);
console.log(`optParams bytes: ${(op.length - 2) / 2}`);

// --- submit THROUGH THE SCOPED SESSION -------------------------------------
const sessionKey = readFileSync(resolve(SECRETS, 'agent1-session.key'), 'utf8').trim() as `0x${string}`;
const sessionSigner = signerFromPrivateKey(sessionKey);
const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: agentSigner });

const data = encodeFunctionData({
  abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']),
  functionName: 'submit', args: [jobId, hash, op],
});
console.log(`\nsubmitting via session ${sessionSigner.address} (allowlist: submit only)`);
const session = {
  walletAddress: wallet.address, signer: sessionSigner,
  publicKey: state.session.publicKey as `0x${string}`,
  permissions: { calls: state.session.permissions.calls,
    spend: [{ limit: BigInt(state.session.permissions.spend[0].limit), period: 'hour' as const }] },
  expiry: state.session.expiry as number,
};
const balBefore = BigInt(await (await fetch(BNB_TESTNET.publicRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet.address, 'latest'] }) })).json().then((r: any) => r.result));
const res = await client.execute({ session, calls: [{ to: addrs.commerce, data }] });
const tSubmitted = Date.now();
const balAfter = BigInt(await (await fetch(BNB_TESTNET.publicRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet.address, 'latest'] }) })).json().then((r: any) => r.result));
console.log(`submit status=${res.status} tx=${res.transactionHash}`);
console.log(`submit fee charged to account: ${balBefore - balAfter} wei`);

const after = await getErc8183Job(BNB_TESTNET, jobId);
console.log(`\njob ${jobId} now: ${after.statusName}`);
console.log(`on-chain deliverable: ${after.deliverable}`);
console.log(`local manifest hash : ${hash}`);
console.log(`MATCH: ${after.deliverable.toLowerCase() === hash.toLowerCase()}`);

Object.assign(state, {
  manifest, manifestHash: hash, deliverableUrl: url, submitTx: res.transactionHash ?? null,
  submitFeeWei: (balBefore - balAfter).toString(), tSubmittedMs: tSubmitted,
  analysisMs: tAnalysed - tStart, analysis: result, jobStatusAfterSubmit: after.statusName,
  onChainDeliverable: after.deliverable, submittedAt: after.submittedAt.toString(),
});
save();
