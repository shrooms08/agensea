/** Decode account-level getKeys() (porto: (Key[](expiry,keyType,isSuperAdmin,
 *  publicKey), bytes32[] keyHashes)), then the NEGATIVE test the revoke demo
 *  claims: revoke 2014 -> key gone from the ACCOUNT -> execute with its
 *  session actually FAILS -> heal (register:false) -> key back. */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeAbiParameters, encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const admin = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: admin });
const meta = JSON.parse(readFileSync(resolve(ROOT, 'apps/web/data/demo-sessions.json'), 'utf8'))
  .sessions.find((s: { agentId: number }) => s.agentId === 2014);
const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS, 'agent3-session.key'), 'utf8').trim() as `0x${string}`);

const call = async (data: string) => {
  const r = await fetch(BNB_TESTNET.publicRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: wallet.address, data }, 'latest'] }) });
  return ((await r.json()) as { result?: string }).result ?? '0x';
};
const GETKEYS = '0x2150c518'; // cast sig 'getKeys()' verified below
async function accountKeys() {
  const h = await call(GETKEYS);
  const [keys] = decodeAbiParameters(
    [{ type: 'tuple[]', components: [{ name: 'expiry', type: 'uint40' }, { name: 'keyType', type: 'uint8' }, { name: 'isSuperAdmin', type: 'bool' }, { name: 'publicKey', type: 'bytes' }] },
     { type: 'bytes32[]' }] as const, h as `0x${string}`);
  return keys as { expiry: number; keyType: number; isSuperAdmin: boolean; publicKey: string }[];
}
const status = async () => {
  const keys = await accountKeys();
  const k = keys.find((x) => x.publicKey.toLowerCase() === meta.publicKey.toLowerCase());
  return k ? `PRESENT expiry=${k.expiry} (${new Date(k.expiry * 1000).toISOString().slice(0, 10)})` : 'ABSENT';
};
console.log('2014 key on ACCOUNT before :', await status());

const rv = await client.revokeSession({ wallet, signer: admin, session: meta.publicKey as `0x${string}` });
console.log('revoke tx                  :', rv.transactionHash);
console.log('2014 key on ACCOUNT after  :', await status());

// try to transact with the revoked session: submit a bogus-but-well-formed call
try {
  const session = { walletAddress: wallet.address, signer: ss, publicKey: meta.publicKey as `0x${string}`,
    permissions: { calls: meta.calls, spend: [{ limit: BigInt(meta.capWei), period: 'hour' as const }] }, expiry: meta.expiry };
  const data = encodeFunctionData({ abi: parseAbi(['function submit(uint256 jobId, bytes32 deliverable, bytes optParams)']),
    functionName: 'submit', args: [999999n, ('0x' + '11'.repeat(32)) as `0x${string}`, '0x'] });
  await client.execute({ session: session as never, calls: [{ to: addrs.commerce, data }] });
  console.log('execute with revoked session: !!! SUCCEEDED (unexpected)');
} catch (e) {
  console.log('execute with revoked session: REJECTED —', (e as Error).message.slice(0, 90));
}

const g = await client.grantSession({ wallet, signer: admin, sessionSigner: ss,
  permissions: { calls: meta.calls, spend: [{ limit: BigInt(meta.capWei), period: 'hour' as const }] },
  expiry: meta.expiry, register: false });
console.log('heal (register:false) tx   :', (g as { transactionHash?: string }).transactionHash);
console.log('2014 key on ACCOUNT healed :', await status());
