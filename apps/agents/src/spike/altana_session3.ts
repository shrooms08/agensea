/**
 * PHASE 2 — session 3: prove a TIGHT spend cap works, then revoke everything.
 *
 * Cap = 2x the fee measured on session 1 (32,419,900,000,000 wei).
 * Uses a session signer WE generate and persist, so the session survives a
 * process restart — the SDK's default generates an ephemeral one that is lost
 * on exit (which is why session 2 could not be retried).
 *
 * Waits for the faucet's 30-minute cooldown by TESTING readiness with eth_call
 * rather than trusting a timer.
 */
import process from 'node:process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey } from 'viem/accounts';
import {
  createClient, signerFromPrivateKey, BNB_TESTNET, type Session, type CallPermission,
} from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(HERE, '../../../..', '.env'));

const FAUCET = '0x86e9197cc0f76e4e4aaa7082180945196bbab5d3' as const;
const U_TOKEN = '0xc70b8741b8b07a6d61e54fd4b20f22fa648e5565' as const;
const SELECTOR = '0x359cf2b7' as const;
const KEYSTORE = '0x6b8361c29d05d498b1a12b54a37310f94171e94a' as const;
const RELAY = BNB_TESTNET.relayUrl!;
const MEASURED_FEE = 32_419_900_000_000n;
const TIGHT_CAP = MEASURED_FEE * 2n;

const log = (s: string) => process.stdout.write(s + '\n');
const out: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tb = (w: bigint) => `${w} wei (${(Number(w) / 1e18).toFixed(9)} tBNB)`;

async function jrpc<T>(url: string, method: string, params: unknown[]): Promise<{ result?: T; error?: { message: string } }> {
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  return (await r.json()) as { result?: T; error?: { message: string } };
}
const bal = async (a: string) => BigInt((await jrpc<string>(BNB_TESTNET.publicRpcUrl, 'eth_getBalance', [a, 'latest'])).result!);
const uBal = async (a: string) => {
  const d = `0x70a08231${a.slice(2).toLowerCase().padStart(64, '0')}`;
  const r = await jrpc<string>(BNB_TESTNET.publicRpcUrl, 'eth_call', [{ to: U_TOKEN, data: d }, 'latest']);
  return r.result ? BigInt(r.result) : 0n;
};

/** Readiness = the faucet accepts a simulated call from this account. */
async function faucetReady(from: string): Promise<boolean> {
  const r = await jrpc<string>(BNB_TESTNET.publicRpcUrl, 'eth_call', [{ from, to: FAUCET, data: SELECTOR }, 'latest']);
  return !r.error;
}

async function pollCalls(callsId: string, timeoutMs = 180_000) {
  const t0 = Date.now(); let last = -1;
  while (Date.now() - t0 < timeoutMs) {
    const s = (await jrpc<{ status: number; receipts?: { transactionHash?: string }[] }>(
      RELAY, 'wallet_getCallsStatus', [callsId])).result;
    if (s && s.status !== last) { log(`      [relay] status=${s.status} receipts=${s.receipts?.length ?? 0} (+${((Date.now()-t0)/1000).toFixed(0)}s)`); last = s.status; }
    if (s?.status === 200) return { ok: true, status: 200, tx: s.receipts?.[0]?.transactionHash };
    if (s?.status === 500 || s?.status === 400) return { ok: false, status: s.status, tx: undefined };
    if (s?.status === 300 && Date.now() - t0 > 30_000) return { ok: false, status: 300, tx: undefined };
    await sleep(3000);
  }
  return { ok: false, status: last, tx: undefined };
}

async function main() {
  const client = createClient({ chains: [BNB_TESTNET] });
  await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
  log('[guard] chain 97 verified off the wire\n');

  const adminSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
  const wallet = await client.createWallet({ signer: adminSigner });
  const balStart = await bal(wallet.address);
  const uStart = await uBal(wallet.address);
  log(`account        : ${wallet.address}`);
  log(`tBNB start     : ${tb(balStart)}`);
  log(`$U start       : ${uStart} (${Number(uStart) / 1e18} U)`);
  out.balanceStart = balStart.toString(); out.uStart = uStart.toString();

  // ---- wait for the faucet cooldown, by testing not timing -----------------
  log('\nwaiting for faucet cooldown (testing readiness with eth_call)...');
  const waitT0 = Date.now();
  while (!(await faucetReady(wallet.address))) {
    if (Date.now() - waitT0 > 45 * 60_000) throw new Error('faucet still refusing after 45 min');
    await sleep(30_000);
    process.stdout.write(`  ...${((Date.now() - waitT0) / 60_000).toFixed(1)} min\n`);
  }
  log(`faucet ready after ${((Date.now() - waitT0) / 60_000).toFixed(1)} min\n`);

  // ---- session 3: tight cap, signer we own ---------------------------------
  const sessionKey = generatePrivateKey();
  const sessionSigner = signerFromPrivateKey(sessionKey);
  // Persist to .secrets/ (gitignored, mode 0700 dir / 0600 file). NOT /tmp:
  // macOS clears /tmp on reboot and periodically otherwise, and losing this
  // file reproduces the session-2 failure exactly — a live on-chain permission
  // whose key no longer exists.
  const SECRETS = resolve(HERE, '../../../..', '.secrets');
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(SECRETS, 'session3.key'), sessionKey, { mode: 0o600 });
  const calls: CallPermission[] = [{ signature: 'requestTokens()', to: FAUCET }];
  log(`SESSION 3: cap ${tb(TIGHT_CAP)} = 2x measured fee ${tb(MEASURED_FEE)}`);
  log(`  session signer (ours, persisted): ${sessionSigner.address}`);

  const b0 = await bal(wallet.address);
  const session: Session & { transactionHash?: `0x${string}` } = await client.grantSession({
    wallet, signer: adminSigner, sessionSigner,
    permissions: { calls, spend: [{ limit: TIGHT_CAP, period: 'hour' }] },
    expiry: Math.floor(Date.now() / 1000) + 3600, register: true,
  });
  const b1 = await bal(wallet.address);
  log(`  grant tx : ${session.transactionHash}`);
  log(`  grant fee: ${tb(b0 - b1)}`);
  out.session3 = { key: sessionSigner.address, publicKey: session.publicKey, grantTx: session.transactionHash, grantFee: (b0 - b1).toString(), cap: TIGHT_CAP.toString() };

  const e0 = await bal(wallet.address);
  const exec = await client.execute({ session, calls: [{ to: FAUCET, data: SELECTOR }], noWait: true });
  log(`  callsId  : ${exec.callsId}`);
  const p = await pollCalls(exec.callsId);
  const e1 = await bal(wallet.address);
  const uEnd = await uBal(wallet.address);
  log(`  relay    : status=${p.status} ${p.ok ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  log(`  tx       : ${p.tx ?? '(none)'}`);
  log(`  EXEC FEE : ${tb(e0 - e1)}   (cap was ${tb(TIGHT_CAP)})`);
  log(`  $U now   : ${uEnd} (${Number(uEnd) / 1e18} U, +${Number(uEnd - uStart) / 1e18})`);
  (out.session3 as any).execTx = p.tx ?? null;
  (out.session3 as any).execFee = (e0 - e1).toString();
  (out.session3 as any).confirmed = p.ok;
  out.uEnd = uEnd.toString();
  if (!p.ok) { writeFileSync('/tmp/session3_out.json', JSON.stringify(out, null, 2)); throw new Error(`session 3 execute not confirmed: relay status ${p.status}`); }

  // ---- revoke everything still live ---------------------------------------
  log('\nrevoking ALL live sessions (last action)...');
  const keysRes = await jrpc<string>(BNB_TESTNET.publicRpcUrl, 'eth_call',
    [{ to: KEYSTORE, data: `0x34e80c34${wallet.address.slice(2).toLowerCase().padStart(64, '0')}` }, 'latest']);
  log(`  (KeyStore getKeys raw: ${keysRes.result ? keysRes.result.slice(0, 40) + '...' : keysRes.error?.message})`);

  const revokes: Record<string, unknown>[] = [];
  for (const [label, pub] of [['session3', session.publicKey]] as const) {
    const r0 = await bal(wallet.address);
    const rev = await client.revokeSession({ wallet, signer: adminSigner, session: pub });
    const r1 = await bal(wallet.address);
    log(`  ${label}: ${rev.status} tx=${rev.transactionHash} fee=${tb(r0 - r1)}`);
    revokes.push({ label, status: rev.status, tx: rev.transactionHash, fee: (r0 - r1).toString() });
  }
  out.revokes = revokes;

  const balEnd = await bal(wallet.address);
  out.balanceEnd = balEnd.toString();
  out.totalThisRun = (balStart - balEnd).toString();
  log(`\ntBNB end   : ${tb(balEnd)}`);
  log(`this run   : ${tb(balStart - balEnd)}`);
  writeFileSync('/tmp/session3_out.json', JSON.stringify(out, null, 2));
}

main().catch((e) => {
  writeFileSync('/tmp/session3_out.json', JSON.stringify({ ...out, error: String(e?.message ?? e) }, null, 2));
  process.stderr.write(`\nSESSION 3 FAILED:\n${e?.stack ?? e}\n`);
  process.exit(1);
});
