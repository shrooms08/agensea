/** One-off permissionless settle of specific SUBMITTED jobs, via the relay —
 *  the exact path p3b_settle proved (a plain EOA settle tx reverts). */
import process from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For } from '../erc8183/addresses.ts';
const HERE = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(HERE, '../../../../.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
const signer = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer });
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uBal = async (a: string) => { const r = await fetch(BNB_TESTNET.publicRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: addrs.paymentToken, data: '0x70a08231' + pad(a) }, 'latest'] }) }); return BigInt(((await r.json()) as { result: string }).result); };
for (const arg of process.argv.slice(2)) {
  const id = BigInt(arg);
  const j = await getErc8183Job(BNB_TESTNET, id);
  if (j.statusName !== 'SUBMITTED') { console.log(`job ${id}: ${j.statusName}, skipping`); continue; }
  const before = await uBal(wallet.address);
  const data = encodeFunctionData({ abi: parseAbi(['function settle(uint256 jobId, bytes evidence)']), functionName: 'settle', args: [id, '0x'] });
  const r = await client.execute({ wallet, signer, calls: [{ to: addrs.router, data }] });
  const j2 = await getErc8183Job(BNB_TESTNET, id);
  const after = await uBal(wallet.address);
  console.log(`job ${id}: settle tx=${r.transactionHash} -> ${j2.statusName}  provider $U +${Number(after - before) / 1e18}`);
}
