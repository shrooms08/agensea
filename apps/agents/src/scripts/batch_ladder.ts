import process from 'node:process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { readState, SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const st = readState();
const s = signerFromPrivateKey(readFileSync(resolve(SECRETS,'buyer.key'),'utf8').trim() as `0x${string}`);
const w = await client.createWallet({ signer: s });
const call = async (to:string,data:string)=>{const r=await fetch(BNB_TESTNET.publicRpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data},'latest']})});return ((await r.json()) as any).result as string;};

// N trivial self-transfers: does batch SIZE alone break simulation?
for (const n of [1,2,3,5]) {
  const calls = Array.from({length:n},()=>({ to: w.address as `0x${string}`, value: 1n }));
  try { const r = await client.execute({ wallet:w, signer:s, calls }); console.log(`  ${n} trivial calls -> ${r.status}`); }
  catch(e){ console.log(`  ${n} trivial calls -> FAILED ${(e as Error).message.slice(0,70)}`); }
}
// the ERC-8183 batch, sliced
const jobId = BigInt(await call(addrs.commerce,'0x50355d76')) + 1n;
const full = buildHireCalls({ addresses: addrs, jobId, provider: st.smartAccount, description: 'probe',
  budget: 1_000_000_000_000_000_000n, expiredAt: BigInt(Math.floor(Date.now()/1000)+3600) });
for (const n of [1,2,3]) {
  try { const r = await client.execute({ wallet:w, signer:s, calls: full.slice(0,n) }); console.log(`  first ${n} hire calls -> ${r.status}`); }
  catch(e){ console.log(`  first ${n} hire calls -> FAILED ${(e as Error).message.slice(0,70)}`); }
}
