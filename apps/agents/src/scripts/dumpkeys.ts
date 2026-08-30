import process from 'node:process';
import { resolve } from 'node:path';
import { decodeAbiParameters } from 'viem';
import { ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const ACCT = '0x85d32d525E1812FeE7001f34DD6dd86154619090';
const r = await fetch('https://bsc-testnet-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ACCT, data: '0x2150c518' }, 'latest'] }) });
const h = ((await r.json()) as { result: string }).result;
const [keys, hashes] = decodeAbiParameters(
  [{ type: 'tuple[]', components: [{ name: 'expiry', type: 'uint40' }, { name: 'keyType', type: 'uint8' }, { name: 'isSuperAdmin', type: 'bool' }, { name: 'publicKey', type: 'bytes' }] },
   { type: 'bytes32[]' }] as const, h as `0x${string}`);
(keys as { expiry: number; keyType: number; isSuperAdmin: boolean; publicKey: string }[]).forEach((k, i) => {
  console.log(`[${i}] hash=${(hashes as string[])[i]!.slice(0, 12)}… type=${k.keyType} admin=${k.isSuperAdmin} expiry=${k.expiry ? new Date(k.expiry * 1000).toISOString().slice(0, 16) : 'never'} pub=${k.publicKey.slice(0, 46)}…len${(k.publicKey.length - 2) / 2}`);
});
