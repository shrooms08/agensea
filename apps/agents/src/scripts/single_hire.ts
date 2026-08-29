import process from 'node:process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createClient, signerFromPrivateKey, BNB_TESTNET, buildHireCalls, getErc8183Job } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { readState, SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const st = readState();
const buyerSigner = signerFromPrivateKey(readFileSync(resolve(SECRETS,'buyer.key'),'utf8').trim() as `0x${string}`);
const buyerWallet = await client.createWallet({ signer: buyerSigner });
const call = async (to: string, data: string) => {
  const r = await fetch(BNB_TESTNET.publicRpcUrl, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data},'latest']})});
  return ((await r.json()) as any).result as string;
};
const jobId = BigInt(await call(addrs.commerce, '0x50355d76')) + 1n;
const desc = JSON.stringify({ skill:'pancakeswap-v3-rebalance', chainId:56, tokenId:'6801109' });
console.log(`jobCounter+1 = ${jobId}, description ${desc.length} bytes`);
const calls = buildHireCalls({ addresses: addrs, jobId, provider: st.smartAccount, description: desc,
  budget: 1_000_000_000_000_000_000n, expiredAt: BigInt(Math.floor(Date.now()/1000)+3600) });
console.log(`built ${calls.length} calls; policy in registerJob = ${addrs.policy}`);
try {
  const res = await client.execute({ wallet: buyerWallet, signer: buyerSigner, calls });
  console.log(`status=${res.status} tx=${res.transactionHash}`);
  const j = await getErc8183Job(BNB_TESTNET, jobId);
  console.log(`job ${jobId}: ${j.statusName} desc-match=${j.description===desc}`);
} catch (e) { console.log(`FAILED: ${(e as Error).message.slice(0,300)}`); }
