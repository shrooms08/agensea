import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { manifestHash, optParams, type DeliverableManifest } from '../erc8183/manifest.ts';
import { readState, updateAgent, SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const cur = readState().agent2;
const jobId = BigInt(cur.jobId);
const url: string = cur.deliverableUrl;
const m = JSON.parse(Buffer.from(url.slice(url.indexOf(',')+1),'base64').toString('utf8')) as DeliverableManifest;
const hash = manifestHash(m);
const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: agentSigner });
const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS,'agent2-session.key'),'utf8').trim() as `0x${string}`);
const session = { walletAddress: wallet.address, signer: ss, publicKey: cur.sessionPublicKey as `0x${string}`,
  permissions:{ calls: cur.sessionCalls, spend:[{limit:BigInt(cur.sessionCap),period:'hour' as const}] }, expiry: cur.sessionExpiry as number };
const data = encodeFunctionData({ abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']), functionName:'submit', args:[jobId,hash,optParams(url)] });
console.log(`optParams size: ${(optParams(url).length-2)/2} bytes`);
const r = await client.execute({ session, calls:[{ to: addrs.commerce, data }], noWait: true });
console.log(`callsId ${r.callsId}`);
for (let i=0;i<20;i++){
  const q = await fetch(BNB_TESTNET.relayUrl!, {method:'POST',headers:{'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',id:1,method:'wallet_getCallsStatus',params:[r.callsId]})});
  const s = (await q.json()) as any;
  console.log(`  t+${i*5}s status=${s.result?.status} receipts=${s.result?.receipts?.length ?? 0}`);
  if (s.result?.status===200){ console.log(`  tx ${s.result.receipts[0].transactionHash}`); break; }
  if (s.result?.status>=400) break;
  await new Promise(x=>setTimeout(x,5000));
}
const j = await getErc8183Job(BNB_TESTNET, jobId);
console.log(`job ${jobId} -> ${j.statusName} match=${j.deliverable.toLowerCase()===hash.toLowerCase()}`);
if (j.statusName==='SUBMITTED') await updateAgent('agent2',{ onChainDeliverable:j.deliverable, hashMatch:j.deliverable.toLowerCase()===hash.toLowerCase(), jobStatusAfterSubmit:j.statusName, submittedAt:j.submittedAt.toString() });
