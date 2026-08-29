/**
 * PHASE 2 SPIKE RETRY — BSC TESTNET (chain 97) ONLY.
 *
 * Session 1: spend cap 0.01 tBNB, call allowlist = requestTokens() on the faucet.
 * Measures the ACTUAL relay fee charged to the account, separately from L1 gas.
 * Session 2: cap sized to ~2x that measured fee, proving a genuinely tight cap works.
 * Revocation happens LAST, only after both executes are confirmed on-chain.
 *
 * Polls wallet_getCallsStatus directly: the SDK's waitForCalls maps only
 * 200/500 and hangs the full 240s on anything else (status 300 did exactly
 * that on the first attempt).
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
process.loadEnvFile(resolve(REPO_ROOT, '.env'));

const FAUCET = '0x86e9197cc0f76e4e4aaa7082180945196bbab5d3' as const;
const SELECTOR = '0x359cf2b7' as const;
const RELAY = BNB_TESTNET.relayUrl!;

const log = (s: string) => process.stdout.write(s + '\n');
const out: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function jrpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const b = (await r.json()) as { result?: T; error?: { message: string } };
  if (b.error) throw new Error(`${method}: ${b.error.message}`);
  return b.result as T;
}
const bal = async (a: string) => BigInt(await jrpc<string>(BNB_TESTNET.publicRpcUrl, 'eth_getBalance', [a, 'latest']));
const tb = (w: bigint) => `${w} wei (${(Number(w) / 1e18).toFixed(9)} tBNB)`;

/** Poll the relay directly, surfacing EVERY status including unmapped ones. */
async function pollCalls(callsId: string, timeoutMs = 150_000) {
  const t0 = Date.now(); let last = -1;
  while (Date.now() - t0 < timeoutMs) {
    const s = await jrpc<{ status: number; receipts?: { transactionHash?: string; status?: string }[] }>(
      RELAY, 'wallet_getCallsStatus', [callsId]);
    if (s.status !== last) {
      log(`      [relay] status=${s.status} receipts=${s.receipts?.length ?? 0}  (+${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      last = s.status;
    }
    if (s.status === 200) return { ok: true, status: s.status, receipts: s.receipts ?? [] };
    if (s.status === 500 || s.status === 400) return { ok: false, status: s.status, receipts: s.receipts ?? [] };
    if (s.status === 300 && (Date.now() - t0) > 30_000) {
      return { ok: false, status: 300, receipts: s.receipts ?? [] }; // unmapped: bail early
    }
    await sleep(3000);
  }
  return { ok: false, status: last, receipts: [] as { transactionHash?: string; status?: string }[] };
}

const CALLS: CallPermission[] = [{ signature: 'requestTokens()', to: FAUCET }];

async function runSession(
  client: ReturnType<typeof createClient>, wallet: { address: `0x${string}` },
  adminSigner: Parameters<typeof client.grantSession>[0]['signer'],
  label: string, limit: bigint,
) {
  const spend: SpendPermission[] = [{ limit, period: 'hour' }];
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  log(`\n--- ${label}: spend cap ${tb(limit)}, expiry +1h`);
  log(`    call allowlist: ${JSON.stringify(CALLS)}`);

  const bGrant0 = await bal(wallet.address);
  const session: Session & { transactionHash?: `0x${string}` } = await client.grantSession({
    wallet, signer: adminSigner, permissions: { calls: CALLS, spend }, expiry, register: true,
  });
  const bGrant1 = await bal(wallet.address);
  log(`    session key : ${session.signer.address}`);
  log(`    grant tx    : ${session.transactionHash ?? '(none)'}`);
  log(`    grant fee   : ${tb(bGrant0 - bGrant1)}`);

  const bExec0 = await bal(wallet.address);
  log(`    executing requestTokens() through the session key...`);
  const exec = await client.execute({ session, calls: [{ to: FAUCET, data: SELECTOR }], noWait: true });
  log(`    callsId     : ${exec.callsId}`);
  const polled = await pollCalls(exec.callsId);
  const txHash = polled.receipts?.[0]?.transactionHash;
  const bExec1 = await bal(wallet.address);
  const execFee = bExec0 - bExec1;

  let gasUsed: string | null = null, rcptStatus: string | null = null, from: string | null = null;
  if (txHash) {
    const r = await jrpc<{ gasUsed: string; status: string; from: string }>(
      BNB_TESTNET.publicRpcUrl, 'eth_getTransactionReceipt', [txHash]);
    gasUsed = r?.gasUsed ?? null; rcptStatus = r?.status ?? null; from = r?.from ?? null;
  }
  log(`    relay status: ${polled.status}  ${polled.ok ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  log(`    tx hash     : ${txHash ?? '(none)'}`);
  log(`    receipt     : status=${rcptStatus} gasUsed=${gasUsed} from=${from}`);
  log(`    RELAY FEE charged to account : ${tb(execFee)}   <- the number that sizes the cap`);
  log(`    L1 gas used by relay submitter: ${gasUsed ? BigInt(gasUsed).toString() : 'n/a'} gas`);

  return {
    label, sessionKey: session.signer.address, publicKey: session.publicKey,
    grantTx: session.transactionHash ?? null, grantFee: (bGrant0 - bGrant1).toString(),
    callsId: exec.callsId, relayStatus: polled.status, confirmed: polled.ok,
    txHash: txHash ?? null, receiptStatus: rcptStatus, gasUsed, submitter: from,
    execFee: execFee.toString(), spendCap: limit.toString(), session,
  };
}

async function main() {
  log('=== PHASE 2 SPIKE RETRY — Altana session keys, BSC testnet ===\n');
  const client = createClient({ chains: [BNB_TESTNET] });
  await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
  log('[guard] chain 97 verified off the wire before any signer was built\n');

  const key = process.env.AGENT_KEY?.trim();
  if (!key) throw new Error('FATAL: AGENT_KEY missing from .env');
  const adminSigner = signerFromPrivateKey(key as `0x${string}`);
  const wallet = await client.createWallet({ signer: adminSigner });
  const balStart = await bal(wallet.address);
  log(`smart account : ${wallet.address}`);
  log(`balance start : ${tb(balStart)}`);
  out.smartAccount = wallet.address;
  out.balanceStart = balStart.toString();

  // ---- SESSION 1: generous cap, measure the real fee ----------------------
  const s1 = await runSession(client, wallet, adminSigner, 'SESSION 1', 10_000_000_000_000_000n);
  out.session1 = { ...s1, session: undefined };
  if (!s1.confirmed) {
    log('\n*** SESSION 1 EXECUTE DID NOT CONFIRM — stopping, session left LIVE for retry ***');
    writeFileSync('/tmp/retry_out.json', JSON.stringify(out, null, 2));
    process.exit(1);
  }

  // ---- SESSION 2: cap sized to ~2x the measured fee -----------------------
  const measured = BigInt(s1.execFee);
  const tightCap = measured > 0n ? measured * 2n : 1_000_000_000_000_000n;
  log(`\n=== measured execute fee = ${tb(measured)} -> tight cap = ${tb(tightCap)} ===`);
  const s2 = await runSession(client, wallet, adminSigner, 'SESSION 2 (tight cap)', tightCap);
  out.session2 = { ...s2, session: undefined };
  out.tightCap = tightCap.toString();

  // ---- revoke BOTH, last ---------------------------------------------------
  log('\n--- revoking both sessions (last action, after confirmations) ---');
  for (const s of [s1, s2]) {
    if (!s.session) continue;
    const b0 = await bal(wallet.address);
    const rev = await client.revokeSession({ wallet, signer: adminSigner, session: s.session });
    const b1 = await bal(wallet.address);
    log(`    ${s.label}: ${rev.status}  tx=${rev.transactionHash ?? '(none)'}  fee=${tb(b0 - b1)}`);
    (out as any)[`${s.label.startsWith('SESSION 1') ? 'revoke1' : 'revoke2'}`] =
      { status: rev.status, tx: rev.transactionHash ?? null, fee: (b0 - b1).toString() };
  }

  const balEnd = await bal(wallet.address);
  out.balanceEnd = balEnd.toString();
  out.totalSpent = (balStart - balEnd).toString();
  log(`\nbalance end   : ${tb(balEnd)}`);
  log(`TOTAL CONSUMED across both sessions: ${tb(balStart - balEnd)}`);
  writeFileSync('/tmp/retry_out.json', JSON.stringify(out, null, 2));
  log('\nartifact -> /tmp/retry_out.json');
}

main().catch((e) => {
  writeFileSync('/tmp/retry_out.json', JSON.stringify({ ...out, error: String(e?.message ?? e) }, null, 2));
  process.stderr.write(`\nRETRY FAILED (stopping, no workaround):\n${e?.stack ?? e}\n`);
  process.exit(1);
});
