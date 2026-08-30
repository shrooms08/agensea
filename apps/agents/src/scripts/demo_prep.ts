/**
 * Demo-hire prep: renew ALL FOUR sessions with a KNOWN expiry persisted to a
 * committed, key-free JSON (the advantage run granted three with an expiry it
 * never persisted — the web route needs the exact session tuple to sign), top
 * up the platform buyer, and report demo-job headroom.
 */
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For } from '../erc8183/addresses.ts';
import { readState, SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
const rpc = BNB_TESTNET.publicRpcUrl;
const jrpc = async (m: string, p: unknown[]) => {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) });
  return ((await r.json()) as { result?: string }).result!;
};
const bal = async (a: string) => BigInt(await jrpc('eth_getBalance', [a, 'latest']));
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uBal = async (a: string) => BigInt(await jrpc('eth_call', [{ to: addrs.paymentToken, data: '0x70a08231' + pad(a) }, 'latest']));

const st = readState();
const admin = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: admin });
const buyerSigner = signerFromPrivateKey(readFileSync(resolve(SECRETS, 'buyer.key'), 'utf8').trim() as `0x${string}`);
const buyer = await client.createWallet({ signer: buyerSigner });

const CAP = 94_210_600_000_000n;
const EXPIRY = Math.floor(new Date('2026-09-30T00:00:00Z').getTime() / 1000);
const CALLS = [{ signature: 'submit(uint256,bytes32,bytes)', to: addrs.commerce }];
const DEFS = [
  { agentId: 2012, keyFile: 'agent1-session.key' },
  { agentId: 2013, keyFile: 'agent2-session.key' },
  { agentId: 2014, keyFile: 'agent3-session.key' },
  { agentId: 2015, keyFile: 'agent4-session.key' },
];
const out: Record<string, unknown>[] = [];
for (const d of DEFS) {
  const ss = signerFromPrivateKey(readFileSync(resolve(SECRETS, d.keyFile), 'utf8').trim() as `0x${string}`);
  const s = await client.grantSession({
    wallet, signer: admin, sessionSigner: ss,
    permissions: { calls: CALLS, spend: [{ limit: CAP, period: 'hour' as const }] },
    expiry: EXPIRY, register: false,
  });
  console.log(`  ${d.agentId}: session renewed to ${new Date(EXPIRY * 1000).toISOString().slice(0, 10)} tx=${(s as { transactionHash?: string }).transactionHash ?? '(none)'}`);
  out.push({ agentId: d.agentId, address: ss.address, publicKey: s.publicKey,
             expiry: EXPIRY, capWei: CAP.toString(),
             calls: CALLS, walletAddress: wallet.address });
}
writeFileSync(resolve(ROOT, 'apps/web/data/demo-sessions.json'),
  JSON.stringify({ _comment: 'Session tuples for the demo-hire route. PUBLIC data only — addresses, public keys, expiries. Private keys live in server env.', sessions: out }, null, 2));
console.log('  demo-sessions.json written (no private material)');

// ---- top-ups: faucet to buyer, then $U + tBNB from provider ----
let bU = await uBal(buyer.address);
if (bU < 20n * 10n ** 18n) {
  try {
    const r = await client.execute({ wallet: buyer, signer: buyerSigner,
      calls: [{ to: '0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3', data: '0x359cf2b7' }] });
    console.log(`  buyer faucet claim tx=${r.transactionHash}`);
  } catch (e) { console.log(`  faucet claim skipped: ${(e as Error).message.slice(0, 60)}`); }
}
bU = await uBal(buyer.address);
const pU = await uBal(wallet.address);
if (bU < 25n * 10n ** 18n && pU > 12n * 10n ** 18n) {
  const amt = 10n * 10n ** 18n;
  const data = ('0xa9059cbb' + pad(buyer.address) + amt.toString(16).padStart(64, '0')) as `0x${string}`;
  const r = await client.execute({ wallet, signer: admin, calls: [{ to: addrs.paymentToken, data }] });
  console.log(`  provider -> buyer 10 $U tx=${r.transactionHash}`);
}
// tBNB: send 0.015 from provider so buyer gas headroom exceeds the $U headroom
try {
  const r = await client.execute({ wallet, signer: admin,
    calls: [{ to: buyer.address, data: '0x' as `0x${string}`, value: 15n * 10n ** 15n }] });
  console.log(`  provider -> buyer 0.015 tBNB tx=${r.transactionHash}`);
} catch (e) { console.log(`  tBNB transfer failed (non-fatal): ${(e as Error).message.slice(0, 70)}`); }

const fB = await bal(buyer.address), fU = await uBal(buyer.address);
const pB = await bal(wallet.address), pU2 = await uBal(wallet.address);
const HIRE_GAS = 960_000_000_000_000n;   // ~measured buyer cost per hire
const jobsByU = fU / 10n ** 18n;
const jobsByGas = fB / HIRE_GAS;
console.log('\nHEADROOM REPORT');
console.log(`  buyer    ${buyer.address}  ${Number(fB) / 1e18} tBNB  ${Number(fU) / 1e18} $U`);
console.log(`  provider ${wallet.address}  ${Number(pB) / 1e18} tBNB  ${Number(pU2) / 1e18} $U`);
console.log(`  demo jobs fundable: min($U=${jobsByU}, gas=${jobsByGas}) = ${jobsByU < jobsByGas ? jobsByU : jobsByGas}`);
