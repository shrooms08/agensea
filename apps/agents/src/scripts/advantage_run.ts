/**
 * TERMIX AGENT ADVANTAGE REPORT — hire arm.
 *
 * Runs the three FROZEN tasks (evidence/inputs.json) through the full
 * ERC-8183 flow on chain 97, sequentially (one buyer account = one nonce;
 * concurrency proved impossible in Phase 3b). Per task it records wall-clock
 * from the hire call to the on-chain-verified deliverable, every tx hash, and
 * the buyer + provider balance deltas in tBNB and $U. All timings are real;
 * nothing here estimates anything.
 *
 * Sessions expired 29 Aug; fresh grants are issued to the SAME persisted
 * session signers (README footgun 3 recipe), 30-day expiry to outlive judging.
 */
import process from 'node:process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For, assertPolicyWhitelisted } from '../erc8183/addresses.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../erc8183/manifest.ts';
import { readState, updateState, SECRETS, ROOT } from '../agent/state.ts';
import { readVenusPosition } from '../venus/client.ts';
import { analyzePosition } from '../venus/analyze.ts';
import { analyzeLp } from '../pancake/lp.ts';
import { compareYields } from '../yield/compare.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const EVIDENCE = resolve(ROOT, 'apps/agents/evidence');
mkdirSync(EVIDENCE, { recursive: true });
const INPUTS = JSON.parse(readFileSync(resolve(EVIDENCE, 'inputs.json'), 'utf8'));

const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
await assertPolicyWhitelisted(addrs, BNB_TESTNET.publicRpcUrl);
console.log('[guard] chain 97 + policy whitelist asserted\n');

const rpc = BNB_TESTNET.publicRpcUrl;
const jrpc = async (method: string, params: unknown[]) => {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return ((await r.json()) as { result?: string }).result!;
};
const ethCall = (to: string, data: string) => jrpc('eth_call', [{ to, data }, 'latest']);
const bal = async (a: string) => BigInt(await jrpc('eth_getBalance', [a, 'latest']));
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uBal = async (a: string) => BigInt(await ethCall(addrs.paymentToken, '0x70a08231' + pad(a)));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const st = readState();
const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const agentWallet = await client.createWallet({ signer: agentSigner });
const buyerSigner = signerFromPrivateKey(readFileSync(resolve(SECRETS, 'buyer.key'), 'utf8').trim() as `0x${string}`);
const buyerWallet = await client.createWallet({ signer: buyerSigner });
const provider = agentWallet.address;
console.log(`provider ${provider}\nbuyer    ${buyerWallet.address}\n`);

// ---------------------------------------------------------------------------
// 0. Buyer funding: 3 jobs x 1 $U. The faucet pays 10 $U per address / 30 min.
// ---------------------------------------------------------------------------
let bu = await uBal(buyerWallet.address);
if (bu < 3n * 10n ** 18n) {
  console.log(`buyer $U=${bu} — claiming faucet`);
  const r = await client.execute({ wallet: buyerWallet, signer: buyerSigner,
    calls: [{ to: '0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3', data: '0x359cf2b7' }] });
  console.log(`  faucet tx ${r.transactionHash}`);
  bu = await uBal(buyerWallet.address);
}
console.log(`buyer $U = ${Number(bu) / 1e18}\n`);
if (bu < 3n * 10n ** 18n) throw new Error('buyer underfunded — faucet cooldown? stop.');

// ---------------------------------------------------------------------------
// 1. Fresh sessions (expired 29 Aug). Same persisted signers, 30-day expiry.
// ---------------------------------------------------------------------------
const CAP = 94_210_600_000_000n;                    // 2x measured submit fee
const EXPIRY = Math.floor(Date.now() / 1000) + 30 * 86400;
const CALLS = [{ signature: 'submit(uint256,bytes32,bytes)', to: addrs.commerce }];

interface TaskDef { key: 'T1' | 'T2' | 'T3'; stateKey: string; keyFile: string; agentId: number; name: string; category: string }
const DEFS: TaskDef[] = [
  { key: 'T1', stateKey: 'agent1', keyFile: 'agent1-session.key', agentId: 2012, name: 'Venus Health Factor Monitor', category: 'health-factor-monitoring' },
  { key: 'T2', stateKey: 'agent2', keyFile: 'agent2-session.key', agentId: 2013, name: 'PancakeSwap V3 Rebalancing Monitor', category: 'rebalancing' },
  { key: 'T3', stateKey: 'agent4', keyFile: 'agent4-session.key', agentId: 2015, name: 'BSC Yield Route Optimiser', category: 'yield-optimisation' },
];

const sessions: Record<string, { session: unknown; grantTx: string | null; grantFeeWei: string }> = {};
for (const d of DEFS) {
  const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS, d.keyFile), 'utf8').trim() as `0x${string}`);
  const b0 = await bal(provider);
  // RENEWAL: the signers' keys are already REGISTERED in KeyStore from the
  // original grants (a registration persists; revoking tombstones the keyId
  // rather than freeing it — re-register reverts "key already registered").
  // So renewal is account-level only: grant a fresh session to the same
  // persisted signer with register: false. The on-chain registration that the
  // Altana criterion cares about is the original, still-visible record.
  const s = await client.grantSession({
    wallet: agentWallet, signer: agentSigner, sessionSigner: ss,
    permissions: { calls: CALLS, spend: [{ limit: CAP, period: 'hour' as const }] },
    expiry: EXPIRY, register: false,
  });
  const b1 = await bal(provider);
  sessions[d.key] = { session: s, grantTx: (s as { transactionHash?: string }).transactionHash ?? null, grantFeeWei: (b0 - b1).toString() };
  console.log(`[${d.key}] session re-granted for ${d.name}: ${ss.address} tx=${sessions[d.key]!.grantTx} fee=${b0 - b1}wei`);
}
console.log();

// ---------------------------------------------------------------------------
// 2. The three tasks, sequential. Timer starts at the hire call.
// ---------------------------------------------------------------------------
async function analyse(key: 'T1' | 'T2' | 'T3'): Promise<unknown> {
  if (key === 'T1') return analyzePosition(await readVenusPosition(56, INPUTS.T1.input.wallet));
  if (key === 'T2') return analyzeLp(BigInt(INPUTS.T2.input.tokenId));
  return compareYields(INPUTS.T3.input.positionSizeUsd);
}

const results: Record<string, unknown> = {};
for (const d of DEFS) {
  console.log(`=== ${d.key} — ${d.name} ===`);
  const task = { advantageReport: d.key, ...INPUTS[d.key].input, task: INPUTS[d.key].task };
  const description = JSON.stringify(task);
  const buyerB0 = await bal(buyerWallet.address); const buyerU0 = await uBal(buyerWallet.address);
  const provB0 = await bal(provider); const provU0 = await uBal(provider);

  // HIRE — the clock starts on this call.
  const tStart = Date.now();
  let jobId = 0n, hireTx: string | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    jobId = BigInt(await ethCall(addrs.commerce, '0x50355d76')) + 1n;
    try {
      const res = await client.execute({ wallet: buyerWallet, signer: buyerSigner,
        calls: buildHireCalls({ addresses: addrs, jobId, provider, description,
          budget: 10n ** 18n, expiredAt: BigInt(Math.floor(Date.now() / 1000) + 3600) }) });
      const job = await getErc8183Job(BNB_TESTNET, jobId);
      if (job.description !== description) throw new Error('jobId race lost');
      if (job.statusName !== 'FUNDED') throw new Error(`status ${job.statusName}`);
      hireTx = res.transactionHash ?? null;
      break;
    } catch (e) {
      console.log(`  hire attempt ${attempt}: ${(e as Error).message.slice(0, 80)}`);
      if (attempt === 5) throw e;
      await sleep(1500);
    }
  }
  console.log(`  hired jobId=${jobId} tx=${hireTx}`);

  // ANALYSE (the agent's real work, mainnet reads)
  const tA0 = Date.now();
  const analysis = await analyse(d.key);
  const analysisMs = Date.now() - tA0;

  // SUBMIT via the fresh session
  const manifest: DeliverableManifest = {
    version: 1, job_id: Number(jobId), chain_id: 97,
    contracts: { commerce: addrs.commerce, router: addrs.router, policy: addrs.policy },
    response: { content: JSON.stringify(analysis), content_type: 'application/json' },
    metadata: { agent: d.name, agent_id: d.agentId, category: d.category, analysed_chain: 56, advantage_task: d.key },
  };
  const hash = manifestHash(manifest);
  const url = 'data:application/json;base64,' + Buffer.from(canonicalize(manifest), 'utf8').toString('base64');
  const data = encodeFunctionData({ abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']),
    functionName: 'submit', args: [jobId, hash, optParams(url)] });
  const res = await client.execute({ session: sessions[d.key]!.session as never, calls: [{ to: addrs.commerce, data }] });

  // VERIFY on chain — the clock stops when the hash matches.
  const job = await getErc8183Job(BNB_TESTNET, jobId);
  const verified = job.deliverable.toLowerCase() === hash.toLowerCase();
  const tVerified = Date.now();
  if (!verified) throw new Error(`${d.key}: on-chain deliverable does not match manifest`);

  const buyerB1 = await bal(buyerWallet.address); const buyerU1 = await uBal(buyerWallet.address);
  const provB1 = await bal(provider); const provU1 = await uBal(provider);

  const rec = {
    task: d.key, agentId: d.agentId, agent: d.name, input: INPUTS[d.key].input,
    jobId: jobId.toString(), hireTx, submitTx: res.transactionHash ?? null,
    deliverableHash: hash, onChain: job.deliverable, verified, jobStatus: job.statusName,
    grantTx: sessions[d.key]!.grantTx, grantFeeWei: sessions[d.key]!.grantFeeWei,
    wallClockMs: tVerified - tStart, analysisMs,
    cost: {
      buyerU: (buyerU0 - buyerU1).toString(), buyerGasWei: (buyerB0 - buyerB1).toString(),
      providerGasWei: (provB0 - provB1).toString(), providerUEarned: (provU1 - provU0).toString(),
    },
    timestamps: { hireCallAt: tStart, verifiedAt: tVerified },
  };
  results[d.key] = rec;
  writeFileSync(resolve(EVIDENCE, `${d.key}-agent-deliverable.json`), canonicalize(manifest));
  writeFileSync(resolve(EVIDENCE, `${d.key}-agent-analysis.json`), JSON.stringify(analysis, null, 2));
  console.log(`  ${d.key} VERIFIED job=${jobId} wallClock=${(rec.wallClockMs / 1000).toFixed(1)}s analysis=${(analysisMs / 1000).toFixed(1)}s\n`);
}

writeFileSync(resolve(EVIDENCE, 'hire-arm.json'), JSON.stringify(results, null, 2));
await updateState({ advantageRun: { at: new Date().toISOString(), jobs: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, (v as { jobId: string }).jobId])) } });
console.log('hire arm complete -> evidence/hire-arm.json');
