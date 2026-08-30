/** Settles the design question for the revoke demo: after a revoke and a
 *  register:false re-grant (tombstone-safe heal), can the session be revoked
 *  AGAIN? Uses agent3/2014 (least demo traffic). Real txs, tiny fees. */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import { erc8183For } from '../erc8183/addresses.ts';
import { readState, SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
const addrs = erc8183For(97);
const admin = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: admin });
const meta = JSON.parse(readFileSync(resolve(ROOT, 'apps/web/data/demo-sessions.json'), 'utf8'))
  .sessions.find((s: { agentId: number }) => s.agentId === 2014);
const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS, 'agent3-session.key'), 'utf8').trim() as `0x${string}`);

const KEYSTORE = '0x6b8361C29d05D498b1a12B54A37310f94171E94A';
const rpc = async (data: string) => {
  const r = await fetch(BNB_TESTNET.publicRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: KEYSTORE, data }, 'latest'] }) });
  return ((await r.json()) as { result?: string }).result ?? '0x';
};
const keysOf = async () => {
  const h = (await rpc('0x34e80c34' + wallet.address.slice(2).toLowerCase().padStart(64, '0'))).slice(2);
  const n = parseInt(h.slice(64, 128) || '0', 16);
  return Array.from({ length: n }, (_, i) => '0x' + h.slice(128 + i * 64, 192 + i * 64));
};
const grant = () => client.grantSession({ wallet, signer: admin, sessionSigner: ss,
  permissions: { calls: meta.calls, spend: [{ limit: BigInt(meta.capWei), period: 'hour' as const }] },
  expiry: meta.expiry, register: false });
const revoke = () => client.revokeSession({ wallet, signer: admin, session: meta.publicKey as `0x${string}` });

console.log('keys before          :', (await keysOf()).length);
try {
  const r1 = await revoke();
  console.log('REVOKE #1            : OK tx=' + (r1.transactionHash ?? '?'));
} catch (e) { console.log('REVOKE #1            : FAILED', (e as Error).message.slice(0, 100)); }
console.log('keys after revoke #1 :', (await keysOf()).length);
try {
  const g = await grant();
  console.log('re-grant register:false: OK tx=' + ((g as { transactionHash?: string }).transactionHash ?? '?'));
} catch (e) { console.log('re-grant             : FAILED', (e as Error).message.slice(0, 100)); }
try {
  const r2 = await revoke();
  console.log('REVOKE #2            : OK tx=' + (r2.transactionHash ?? '?'));
} catch (e) { console.log('REVOKE #2            : FAILED —', (e as Error).message.slice(0, 120)); }
try {
  const g2 = await grant();
  console.log('re-grant #2          : OK tx=' + ((g2 as { transactionHash?: string }).transactionHash ?? '?'));
} catch (e) { console.log('re-grant #2          : FAILED', (e as Error).message.slice(0, 100)); }
console.log('keys at end          :', (await keysOf()).length);
