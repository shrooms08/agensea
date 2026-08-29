import process from 'node:process';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { readState, updateAgent, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const st = readState();
const signer = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer });
const pad=(a:string)=>a.replace(/^0x/,'').toLowerCase().padStart(64,'0');
const uBal=async(a:string)=>{const r=await fetch(BNB_TESTNET.publicRpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:addrs.paymentToken,data:'0x70a08231'+pad(a)},'latest']})});return BigInt(((await r.json()) as any).result);};
for (const k of ['agent2','agent3','agent4']) {
  const a = st[k]; const id = BigInt(a.jobId);
  const j = await getErc8183Job(BNB_TESTNET, id);
  if (j.statusName !== 'SUBMITTED') { console.log(`${k} job ${id}: already ${j.statusName}`); await updateAgent(k,{finalStatus:j.statusName}); continue; }
  const before = await uBal(wallet.address);
  const t0 = Date.now();
  const data = encodeFunctionData({abi:parseAbi(['function settle(uint256 jobId, bytes evidence)']),functionName:'settle',args:[id,'0x']});
  const r = await client.execute({ wallet, signer, calls:[{ to: addrs.router, data }] });
  const after = await uBal(wallet.address);
  const j2 = await getErc8183Job(BNB_TESTNET, id);
  console.log(`${k} job ${id}: settle tx=${r.transactionHash} -> ${j2.statusName}  $U +${after-before}  (${((Date.now()-t0)/1000).toFixed(1)}s)`);
  await updateAgent(k,{ settleTx:r.transactionHash ?? null, finalStatus:j2.statusName, providerUDelta:(after-before).toString(),
    timeToSettlementMs: Number(j2.submittedAt)>0 ? (Date.now()-Number(j2.submittedAt)*1000) : null });
}
