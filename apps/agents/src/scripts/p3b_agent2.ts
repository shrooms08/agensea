import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For } from '../erc8183/addresses.ts';
import { manifestHash, optParams, canonicalize, type DeliverableManifest } from '../erc8183/manifest.ts';
import { updateAgent, readState, SECRETS, ROOT } from '../agent/state.ts';
import { analyzeLp } from '../pancake/lp.ts';
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
const pad=(a:string)=>a.replace(/^0x/,'').toLowerCase().padStart(64,'0');
const uBal=async(a:string)=>BigInt(await call(addrs.paymentToken,'0x70a08231'+pad(a)));

if (await uBal(buyerWallet.address) < 1_000_000_000_000_000_000n) {
  console.log('funding buyer with 2 $U...');
  const d = '0xa9059cbb'+pad(buyerWallet.address)+(2_000_000_000_000_000_000n).toString(16).padStart(64,'0');
  const r = await client.execute({ wallet, signer: agentSigner, calls: [{ to: addrs.paymentToken, data: d as `0x${string}` }] });
  console.log(`  ${r.status} tx=${r.transactionHash}  buyer $U now ${await uBal(buyerWallet.address)}`);
}

const desc = JSON.stringify({ skill:'pancakeswap-v3-rebalance', chainId:56, tokenId:'6801109', want:['inRange','fees','recommendedRange'] });
let jobId = 0n, hireTx: string|null = null, tFunded = 0;
for (let a=1; a<=4; a++) {
  jobId = BigInt(await call(addrs.commerce,'0x50355d76')) + 1n;
  const calls = buildHireCalls({ addresses: addrs, jobId, provider: st.smartAccount, description: desc,
    budget: 1_000_000_000_000_000_000n, expiredAt: BigInt(Math.floor(Date.now()/1000)+3600) });
  try {
    const r = await client.execute({ wallet: buyerWallet, signer: buyerSigner, calls });
    const j = await getErc8183Job(BNB_TESTNET, jobId);
    if (j.description !== desc) throw new Error('lost jobId race');
    hireTx = r.transactionHash ?? null; tFunded = Date.now();
    console.log(`hired job ${jobId} tx=${hireTx} status=${j.statusName}`); break;
  } catch(e) { console.log(`  hire attempt ${a}: ${(e as Error).message.slice(0,80)}`); if (a===4) process.exit(1); await new Promise(r=>setTimeout(r,4000)); }
}

const t0 = Date.now();
const result = await analyzeLp(6801109n);
const analysisMs = Date.now()-t0;
const cur = readState().agent2;
const manifest: DeliverableManifest = { version:1, job_id:Number(jobId), chain_id:97,
  contracts:{commerce:addrs.commerce,router:addrs.router,policy:addrs.policy},
  response:{content:JSON.stringify(result),content_type:'application/json'},
  metadata:{agent:cur.name,agent_id:cur.agentId,category:cur.category,analysed_chain:56} };
const hash = manifestHash(manifest); const canonical = canonicalize(manifest);
const url = 'data:application/json;base64,'+Buffer.from(canonical,'utf8').toString('base64');
// PERSIST BEFORE SUBMIT: job 752 became unverifiable because the manifest was
// only written after a submit that then crashed. Write first, submit second.
await updateAgent('agent2', { jobId: jobId.toString(), hireTx, manifestHash: hash, deliverableUrl: url,
  manifestBytes: canonical.length, analysisMs, analysis: result });

const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS,'agent2-session.key'),'utf8').trim() as `0x${string}`);
const session = { walletAddress: wallet.address, signer: ss, publicKey: cur.sessionPublicKey as `0x${string}`,
  permissions:{ calls: cur.sessionCalls, spend:[{limit:BigInt(cur.sessionCap),period:'hour' as const}] }, expiry: cur.sessionExpiry as number };
const data = encodeFunctionData({ abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']), functionName:'submit', args:[jobId,hash,optParams(url)] });
const res = await client.execute({ session, calls:[{ to: addrs.commerce, data }] });
const ttd = Date.now()-tFunded;
const after = await getErc8183Job(BNB_TESTNET, jobId);
const match = after.deliverable.toLowerCase()===hash.toLowerCase();
console.log(`submit tx=${res.transactionHash} status=${after.statusName} hashMatch=${match} ttd=${(ttd/1000).toFixed(1)}s manifest=${canonical.length}B`);
await updateAgent('agent2', { submitTx: res.transactionHash ?? null, onChainDeliverable: after.deliverable,
  hashMatch: match, timeToDeliverableMs: ttd, jobStatusAfterSubmit: after.statusName, submittedAt: after.submittedAt.toString() });
