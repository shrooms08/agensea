import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const KEYSTORE = '0x6b8361C29d05D498b1a12B54A37310f94171E94A';
const ACCT = '0x85d32d525E1812FeE7001f34DD6dd86154619090';
const RPC = 'https://bsc-testnet-rpc.publicnode.com';
const call = async (data: string) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: KEYSTORE, data }, 'latest'] }) });
  return ((await r.json()) as { result?: string }).result ?? '0x';
};
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const keysH = (await call('0x34e80c34' + pad(ACCT))).slice(2);
const n = parseInt(keysH.slice(64, 128), 16);
const ids = Array.from({ length: n }, (_, i) => '0x' + keysH.slice(128 + i * 64, 192 + i * 64));
const sessions = JSON.parse(readFileSync(resolve(ROOT, 'apps/web/data/demo-sessions.json'), 'utf8')).sessions;
// getPublicKey(address,bytes32) selector — computed: cast sig 'getPublicKey(address,bytes32)'
const SEL = process.argv[2]!;
for (const id of ids) {
  const pkH = await call(SEL + pad(ACCT) + id.slice(2));
  const raw = '0x' + pkH.slice(2 + 128, 2 + 128 + parseInt(pkH.slice(66, 130), 16) * 2);
  const m = sessions.find((s: { publicKey: string }) => s.publicKey.toLowerCase() === raw.toLowerCase());
  // isValidKey(address,bytes32) -> bool
  const valid = parseInt(await call(process.argv[3]! + pad(ACCT) + id.slice(2)), 16) === 1;
  console.log(`  ${id.slice(0, 14)}…  agent=${m ? m.agentId : 'admin/other'}  isValidKey=${valid}`);
}
