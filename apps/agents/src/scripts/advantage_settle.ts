/** Settle the three advantage-run jobs once their 900s dispute windows lapse,
 *  then print old-vs-new marketplace completion counts. */
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const signer = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer });
const EV = resolve(ROOT, 'apps/agents/evidence');
const arm = JSON.parse(readFileSync(resolve(EV, 'hire-arm.json'), 'utf8'));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
for (const k of ['T1', 'T2', 'T3'] as const) {
  const id = BigInt(arm[k].jobId);
  for (;;) {
    const j = await getErc8183Job(BNB_TESTNET, id);
    if (j.statusName === 'COMPLETED') { console.log(`${k} job ${id}: already COMPLETED (swept)`); arm[k].settleTx = arm[k].settleTx ?? '(permissionless sweep)'; break; }
    const eligible = Number(j.submittedAt) + 900;
    const now = Math.floor(Date.now() / 1000);
    if (now < eligible) { await sleep((eligible - now + 5) * 1000); continue; }
    const data = encodeFunctionData({ abi: parseAbi(['function settle(uint256 jobId, bytes evidence)']), functionName: 'settle', args: [id, '0x'] });
    const r = await client.execute({ wallet, signer, calls: [{ to: addrs.router, data }] });
    const j2 = await getErc8183Job(BNB_TESTNET, id);
    console.log(`${k} job ${id}: settle tx=${r.transactionHash} -> ${j2.statusName}`);
    arm[k].settleTx = r.transactionHash ?? null; arm[k].finalStatus = j2.statusName;
    break;
  }
}
writeFileSync(resolve(EV, 'hire-arm.json'), JSON.stringify(arm, null, 2));
console.log('SETTLE DONE');
