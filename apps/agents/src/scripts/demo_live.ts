/** Demo fixture: one full hire -> deliverable, timed. Target < 15s. */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For } from '../erc8183/addresses.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../erc8183/manifest.ts';
import { readState, updateState, SECRETS, ROOT } from '../agent/state.ts';
import { compareYields } from '../yield/compare.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map(c=>c.chainId));
const addrs = erc8183For(97);
const st = readState();
const agentSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: agentSigner });
const buyerSigner = signerFromPrivateKey(readFileSync(resolve(SECRETS,'buyer.key'),'utf8').trim() as `0x${string}`);
const buyerWallet = await client.createWallet({ signer: buyerSigner });
const call = async (to:string,data:string)=>{const r=await fetch(BNB_TESTNET.publicRpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data},'latest']})});return ((await r.json()) as any).result as string;};

const desc = JSON.stringify({ skill:'yield-route', chainId:56, asset:'BTCB', positionUsd:10000 });
const jobId = BigInt(await call(addrs.commerce,'0x50355d76')) + 1n;
const T0 = Date.now();
const calls = buildHireCalls({ addresses: addrs, jobId, provider: st.smartAccount, description: desc,
  budget: 1_000_000_000_000_000_000n, expiredAt: BigInt(Math.floor(Date.now()/1000)+3600) });
const h = await client.execute({ wallet: buyerWallet, signer: buyerSigner, calls });
const tFunded = Date.now();
console.log(`FUNDED   job ${jobId}  tx=${h.transactionHash}  (+${((tFunded-T0)/1000).toFixed(1)}s)`);

const result = await compareYields(10000);
const tAnalysed = Date.now();
console.log(`ANALYSED                                    (+${((tAnalysed-tFunded)/1000).toFixed(1)}s)`);

const cur = st.agent4;
const manifest: DeliverableManifest = { version:1, job_id:Number(jobId), chain_id:97,
  contracts:{commerce:addrs.commerce,router:addrs.router,policy:addrs.policy},
  response:{content:JSON.stringify(result),content_type:'application/json'},
  metadata:{agent:cur.name,agent_id:cur.agentId,category:cur.category,analysed_chain:56} };
const hash = manifestHash(manifest);
const url='data:application/json;base64,'+Buffer.from(canonicalize(manifest),'utf8').toString('base64');
const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS,'agent4-session.key'),'utf8').trim() as `0x${string}`);
const session = { walletAddress: wallet.address, signer: ss, publicKey: cur.sessionPublicKey as `0x${string}`,
  permissions:{ calls: cur.sessionCalls, spend:[{limit:BigInt(cur.sessionCap),period:'hour' as const}] }, expiry: cur.sessionExpiry as number };
const data = encodeFunctionData({abi:parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']),functionName:'submit',args:[jobId,hash,optParams(url)]});
const s = await client.execute({ session, calls:[{ to: addrs.commerce, data }] });
const tSub = Date.now();
const j = await getErc8183Job(BNB_TESTNET, jobId);
console.log(`SUBMITTED tx=${s.transactionHash}  status=${j.statusName}  match=${j.deliverable.toLowerCase()===hash.toLowerCase()}  (+${((tSub-tAnalysed)/1000).toFixed(1)}s)`);
console.log(`\nTOTAL funded -> deliverable: ${((tSub-tFunded)/1000).toFixed(1)}s   (hire itself ${((tFunded-T0)/1000).toFixed(1)}s)`);
await updateState({ demoJob: { jobId: jobId.toString(), hireTx: h.transactionHash, submitTx: s.transactionHash,
  fundedToDeliverableMs: tSub-tFunded, hash, status: j.statusName } });
