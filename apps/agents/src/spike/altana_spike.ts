/**
 * PHASE 2 - Altana session-key spike. BSC TESTNET (chain 97) ONLY.
 *
 * Proves one real on-chain transaction executes through a narrowly scoped
 * session key: create account -> grant session -> register in KeyStore ->
 * execute requestTokens() -> verify -> revoke.
 *
 * AGENT_KEY is read from .env and never printed.
 */
import process from 'node:process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createClient, signerFromPrivateKey, BNB_TESTNET,
  type Session, type CallPermission, type SpendPermission,
} from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const ENV_PATH = resolve(REPO_ROOT, '.env');
if (!existsSync(ENV_PATH)) throw new Error(`FATAL: no .env at ${ENV_PATH}`);
process.loadEnvFile(ENV_PATH);

const FAUCET = '0x86e9197cc0f76e4e4aaa7082180945196bbab5d3' as const; // verified 1402 bytes on chain 97
const REQUEST_TOKENS_SELECTOR = '0x359cf2b7' as const;                 // cast sig "requestTokens()"

const log = (s: string) => process.stdout.write(s + '\n');
const out: Record<string, unknown> = {};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(BNB_TESTNET.publicRpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const b = (await r.json()) as { result?: T; error?: { message: string } };
  if (b.error) throw new Error(`${method}: ${b.error.message}`);
  return b.result as T;
}
const balanceOf = async (a: string) => BigInt(await rpc<string>('eth_getBalance', [a, 'latest']));
const fmt = (w: bigint) => `${w} wei (${(Number(w) / 1e18).toFixed(9)} tBNB)`;

async function main() {
  log('=== PHASE 2 SPIKE — Altana session key, BSC testnet ===\n');

  // ---- chain guard BEFORE any signer exists -------------------------------
  const client = createClient({ chains: [BNB_TESTNET] });
  await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
  log(`[guard] chain id read back from ${BNB_TESTNET.publicRpcUrl} = 97 OK`);
  log(`[guard] client chains: ${client.chains.map((c) => c.chainId).join(',')}`);
  log(`[guard] ALTANA_CHAIN env = ${process.env.ALTANA_CHAIN ?? '(unset)'}\n`);

  const key = process.env.AGENT_KEY?.trim();
  if (!key) throw new Error('FATAL: AGENT_KEY missing from .env');
  const adminSigner = signerFromPrivateKey(key as `0x${string}`);
  log(`admin signer address : ${adminSigner.address}`);

  // ---- (a) smart account ---------------------------------------------------
  const wallet = await client.createWallet({ signer: adminSigner });
  log(`(a) smart account    : ${wallet.address}`);
  out.smartAccount = wallet.address;
  out.adminSigner = adminSigner.address;

  const balStart = await balanceOf(wallet.address);
  log(`    balance before   : ${fmt(balStart)}`);
  out.balanceBefore = balStart.toString();

  // ---- (b) narrowest possible session -------------------------------------
  const calls: CallPermission[] = [{ signature: 'requestTokens()', to: FAUCET }];
  const spend: SpendPermission[] = [{ limit: 1n, period: 'hour' }]; // 1 wei native = minimum above zero
  const expiry = Math.floor(Date.now() / 1000) + 3600;              // 1 hour
  const permissions = { calls, spend };
  log(`\n(b) session scope requested (verbatim):`);
  log(JSON.stringify({ permissions, expiry }, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), 2));

  // ---- (c) grant + KeyStore registration ----------------------------------
  const session: Session & { transactionHash?: `0x${string}` } = await client.grantSession({
    wallet, signer: adminSigner, permissions, expiry, register: true,
  });
  log(`\n(c) session key addr : ${session.signer.address}`);
  log(`    session publicKey: ${session.publicKey}`);
  log(`    KeyStore grant tx: ${session.transactionHash ?? '(relay reported no hash)'}`);
  out.sessionKey = session.signer.address;
  out.sessionPublicKey = session.publicKey;
  out.grantTx = session.transactionHash ?? null;
  out.scopeAccepted = JSON.parse(JSON.stringify(
    { permissions: session.permissions, expiry: session.expiry },
    (_k, v) => (typeof v === 'bigint' ? `${v}n` : v),
  ));

  const balAfterGrant = await balanceOf(wallet.address);
  log(`    balance after grant: ${fmt(balAfterGrant)}  (delta ${balStart - balAfterGrant} wei)`);
  out.balanceAfterGrant = balAfterGrant.toString();

  // ---- (d) execute ONE real tx through the session key --------------------
  log(`\n(d) executing requestTokens() on ${FAUCET} THROUGH THE SESSION KEY`);
  const exec = await client.execute({
    session,
    calls: [{ to: FAUCET, data: REQUEST_TOKENS_SELECTOR }],
  });
  log(`    status  : ${exec.status}`);
  log(`    callsId : ${exec.callsId}`);
  log(`    tx hash : ${exec.transactionHash ?? '(none reported)'}`);
  out.executeStatus = exec.status;
  out.executeCallsId = exec.callsId;
  out.executeTx = exec.transactionHash ?? null;

  const balAfterExec = await balanceOf(wallet.address);
  log(`    balance after exec: ${fmt(balAfterExec)}`);
  out.balanceAfterExecute = balAfterExec.toString();

  if (exec.transactionHash) {
    const rcpt = await rpc<{ status: string; gasUsed: string; from: string; effectiveGasPrice?: string }>(
      'eth_getTransactionReceipt', [exec.transactionHash]);
    log(`    receipt status : ${rcpt?.status}`);
    log(`    receipt from   : ${rcpt?.from}   <- who actually paid gas`);
    log(`    gasUsed        : ${rcpt?.gasUsed}`);
    out.receiptFrom = rcpt?.from ?? null;
    out.receiptStatus = rcpt?.status ?? null;
    out.gasUsed = rcpt?.gasUsed ?? null;
  }

  // ---- (f) revoke ----------------------------------------------------------
  log(`\n(f) revoking session ${session.publicKey.slice(0, 22)}...`);
  const rev = await client.revokeSession({ wallet, signer: adminSigner, session });
  log(`    status  : ${rev.status}`);
  log(`    tx hash : ${rev.transactionHash ?? '(none reported)'}`);
  out.revokeStatus = rev.status;
  out.revokeTx = rev.transactionHash ?? null;

  const balEnd = await balanceOf(wallet.address);
  log(`    balance after revoke: ${fmt(balEnd)}`);
  out.balanceAfter = balEnd.toString();
  out.totalSpentWei = (balStart - balEnd).toString();
  log(`\nTOTAL tBNB consumed  : ${fmt(balStart - balEnd)}`);

  writeFileSync('/tmp/spike_out.json', JSON.stringify(out, null, 2));
  log('\nartifact written to /tmp/spike_out.json');
}

main().catch((e) => {
  writeFileSync('/tmp/spike_out.json', JSON.stringify({ ...out, error: String(e?.message ?? e) }, null, 2));
  process.stderr.write(`\nSPIKE FAILED (stopping, no workaround):\n${e?.stack ?? e}\n`);
  process.exit(1);
});
