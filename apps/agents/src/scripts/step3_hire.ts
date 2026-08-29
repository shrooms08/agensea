/** Phase 3a step 3: fund a second address and hire our own agent. */
import process from 'node:process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For, assertPolicyWhitelisted, sdkPolicyIsBroken } from '../erc8183/addresses.ts';
import { state, save, SECRETS, ROOT } from '../agent/state.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
await assertPolicyWhitelisted(addrs, BNB_TESTNET.publicRpcUrl);
console.log('[guard] chain 97 + policy whitelist asserted\n');

const rpc = BNB_TESTNET.publicRpcUrl;
const call = async (to: string, data: string) => {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
  return ((await r.json()) as any).result as string;
};
const bal = async (a: string) => {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [a, 'latest'] }) });
  return BigInt(((await r.json()) as any).result);
};
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uBal = async (a: string) => BigInt(await call(addrs.paymentToken, '0x70a08231' + pad(a)));

const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const agentWallet = await client.createWallet({ signer: agentSigner });
console.log(`agent (provider): ${agentWallet.address}`);
console.log(`  tBNB ${await bal(agentWallet.address)}  $U ${await uBal(agentWallet.address)}`);

// --- buyer key (persisted; never an ephemeral signer) ---------------------
const buyerKeyFile = resolve(SECRETS, 'buyer.key');
let buyerKey: `0x${string}`;
if (existsSync(buyerKeyFile)) buyerKey = readFileSync(buyerKeyFile, 'utf8').trim() as `0x${string}`;
else { buyerKey = generatePrivateKey(); writeFileSync(buyerKeyFile, buyerKey, { mode: 0o600 }); }
const buyerSigner = signerFromPrivateKey(buyerKey);
const buyerWallet = await client.createWallet({ signer: buyerSigner });
console.log(`buyer (client)  : ${buyerWallet.address}`);
console.log(`  tBNB ${await bal(buyerWallet.address)}  $U ${await uBal(buyerWallet.address)}`);
state.buyer = buyerWallet.address; state.provider = agentWallet.address; save();

// --- fund the buyer from the agent account -------------------------------
const NEED_BNB = 25_000_000_000_000_000n; // 0.025
const NEED_U = 5_000_000_000_000_000_000n; // 5 $U
if ((await bal(buyerWallet.address)) < NEED_BNB / 2n || (await uBal(buyerWallet.address)) < 2n * 10n ** 18n) {
  console.log('\nfunding buyer from the agent account...');
  const transfer = '0xa9059cbb' + pad(buyerWallet.address) + NEED_U.toString(16).padStart(64, '0');
  const res = await client.execute({
    wallet: agentWallet, signer: agentSigner,
    calls: [
      { to: buyerWallet.address as `0x${string}`, value: NEED_BNB },
      { to: addrs.paymentToken, data: transfer as `0x${string}` },
    ],
  });
  console.log(`  fund status=${res.status} tx=${res.transactionHash}`);
  state.fundBuyerTx = res.transactionHash ?? null; save();
  console.log(`  buyer now: tBNB ${await bal(buyerWallet.address)}  $U ${await uBal(buyerWallet.address)}`);
}

// --- hire -----------------------------------------------------------------
const BUDGET = 1_000_000_000_000_000_000n; // 1 $U
const task = JSON.stringify({
  skill: 'venus-health-factor',
  chainId: 56,
  account: '0xb76b35db3f2a7d8346013d9b02edbf756cf27c72',
  want: ['healthFactor', 'collateral', 'borrowed', 'liquidationThreshold', 'recommendation'],
});
console.log(`\nhiring provider=${agentWallet.address} budget=${BUDGET} ($U 1.0)`);
console.log(`task: ${task}`);
const t0 = Date.now();
// hireErc8183Agent() ignores our overridden addresses and would send the SDK's
// broken policy to registerJob (verified: reverts 0xc94463e3). Build the calls
// explicitly against the corrected struct and execute them ourselves.
if (sdkPolicyIsBroken(97)) console.log('NOTE: SDK policy differs from override; using buildHireCalls, not hireErc8183Agent');
const counterHex = await call(addrs.commerce, '0x50355d76'); // jobCounter()
const jobId = BigInt(counterHex) + 1n;
const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
const hireCalls = buildHireCalls({ addresses: addrs, jobId, provider: agentWallet.address, description: task, budget: BUDGET, expiredAt });
console.log(`predicted jobId=${jobId} (jobCounter+1); ${hireCalls.length} calls batched`);
const hire = await client.execute({ wallet: buyerWallet, signer: buyerSigner, calls: hireCalls });
const tFunded = Date.now();
console.log(`\nhire status=${hire.status} tx=${hire.transactionHash}`);
console.log(`hire wall-clock: ${((tFunded - t0) / 1000).toFixed(1)}s`);

const job = await getErc8183Job(BNB_TESTNET, jobId);
console.log(`job status: ${job.statusName} client=${job.client} provider=${job.provider} budget=${job.budget}`);
state.jobId = jobId.toString();
state.hireTx = hire.transactionHash ?? null;
state.task = task;
state.tFundedMs = tFunded;
state.jobStatusAfterHire = job.statusName;
save();
