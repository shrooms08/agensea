/** Phase 3a step 5: wait out the dispute window, settle, verify escrow released. */
import process from 'node:process';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For } from '../erc8183/addresses.ts';
import { verifyManifest, type DeliverableManifest } from '../erc8183/manifest.ts';
import { state, save, ROOT } from '../agent/state.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
const rpc = BNB_TESTNET.publicRpcUrl;
const jobId = BigInt(state.jobId);
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const call = async (to: string, data: string) => {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
  return ((await r.json()) as any).result as string;
};
const uBal = async (a: string) => BigInt(await call(addrs.paymentToken, '0x70a08231' + pad(a)));

// --- BUYER-SIDE VERIFICATION: fetch the manifest and reproduce the hash -----
const job0 = await getErc8183Job(BNB_TESTNET, jobId);
const url: string = state.deliverableUrl;
const fetched = JSON.parse(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8')) as DeliverableManifest;
const ok = verifyManifest(fetched, job0.deliverable);
console.log('BUYER VERIFICATION');
console.log(`  on-chain job.deliverable : ${job0.deliverable}`);
console.log(`  recomputed from manifest : ${ok ? 'MATCH' : 'MISMATCH'}`);
console.log(`  manifest job_id=${fetched.job_id} chain_id=${fetched.chain_id}`);
const inner = JSON.parse(fetched.response.content);
console.log(`  delivered healthFactor=${inner.healthFactor} risk=${inner.riskLevel}`);
if (!ok) throw new Error('deliverable hash does not match manifest — refusing to settle');

const dwRaw = await call(addrs.policy, '0x117f5f92'); // disputeWindow()
const disputeWindow = dwRaw && dwRaw !== '0x' ? Number(BigInt(dwRaw)) : 900;
const submittedAt = Number(job0.submittedAt);
const readyAt = submittedAt + disputeWindow;
console.log(`\nsubmittedAt=${submittedAt}  disputeWindow=${disputeWindow}s (read from policy)  settle-eligible at ${readyAt}`);

const buyerSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const providerU0 = await uBal(state.provider);

while (Math.floor(Date.now() / 1000) < readyAt + 5) {
  const left = readyAt - Math.floor(Date.now() / 1000);
  process.stdout.write(`  waiting ${left}s for dispute window...\n`);
  await new Promise((r) => setTimeout(r, Math.min(60_000, Math.max(5_000, left * 1000))));
}

// settle is PERMISSIONLESS; encoded directly because settleErc8183Job() would
// resolve the SDK's broken policy the same way hireErc8183Agent() did.
const wallet = await client.createWallet({ signer: buyerSigner });
const data = encodeFunctionData({ abi: parseAbi(['function settle(uint256 jobId, bytes evidence)']), functionName: 'settle', args: [jobId, '0x'] });
const res = await client.execute({ wallet, signer: buyerSigner, calls: [{ to: addrs.router, data }] });
const tSettled = Date.now();
console.log(`\nsettle status=${res.status} tx=${res.transactionHash}`);

const job1 = await getErc8183Job(BNB_TESTNET, jobId);
const providerU1 = await uBal(state.provider);
console.log(`job ${jobId} now: ${job1.statusName}`);
console.log(`provider $U: ${providerU0} -> ${providerU1}  (delta ${providerU1 - providerU0})`);

Object.assign(state, {
  settleTx: res.transactionHash ?? null, tSettledMs: tSettled,
  jobStatusAfterSettle: job1.statusName, providerUDelta: (providerU1 - providerU0).toString(),
  buyerVerified: ok, submittedAtOnChain: submittedAt,
});
save();
const tF = state.tFundedMs as number, tS = state.tSubmittedMs as number;
console.log(`\nTIME TO DELIVERABLE (funded -> submitted): ${((tS - tF) / 1000).toFixed(1)}s   [agent performance]`);
console.log(`TIME TO SETTLEMENT  (submitted -> settled): ${((tSettled - tS) / 1000).toFixed(1)}s   [protocol overhead]`);
