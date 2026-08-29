/** Resubmit a persisted manifest. Possible only because we write before submitting. */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { manifestHash, optParams, type DeliverableManifest } from '../erc8183/manifest.ts';
import { updateAgent, readState, SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const key = process.argv[2]!;
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const cur = readState()[key];
const jobId = BigInt(cur.jobId);
const url: string = cur.deliverableUrl;
const manifest = JSON.parse(Buffer.from(url.slice(url.indexOf(',')+1),'base64').toString('utf8')) as DeliverableManifest;
const hash = manifestHash(manifest);
console.log(`${key} job ${jobId}: persisted manifest rehashes to ${hash}`);
console.log(`  matches stored hash: ${hash.toLowerCase()===String(cur.manifestHash).toLowerCase()}`);
const job = await getErc8183Job(BNB_TESTNET, jobId);
console.log(`  job status ${job.statusName}`);
if (job.statusName !== 'FUNDED') { console.log('  not FUNDED — nothing to do'); process.exit(0); }
const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: agentSigner });
const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS,`${key}-session.key`),'utf8').trim() as `0x${string}`);
const session = { walletAddress: wallet.address, signer: ss, publicKey: cur.sessionPublicKey as `0x${string}`,
  permissions:{ calls: cur.sessionCalls, spend:[{limit:BigInt(cur.sessionCap),period:'hour' as const}] }, expiry: cur.sessionExpiry as number };
const data = encodeFunctionData({ abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']), functionName:'submit', args:[jobId,hash,optParams(url)] });
const t0 = Date.now();
const res = await client.execute({ session, calls:[{ to: addrs.commerce, data }] });
const after = await getErc8183Job(BNB_TESTNET, jobId);
const match = after.deliverable.toLowerCase()===hash.toLowerCase();
console.log(`  submit tx=${res.transactionHash} status=${after.statusName} hashMatch=${match} (${((Date.now()-t0)/1000).toFixed(1)}s)`);
await updateAgent(key, { submitTx: res.transactionHash ?? null, onChainDeliverable: after.deliverable,
  hashMatch: match, jobStatusAfterSubmit: after.statusName, submittedAt: after.submittedAt.toString(),
  timeToDeliverableMs: cur.timeToDeliverableMs ?? null });
