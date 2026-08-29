/**
 * Revoke every non-admin key registered in KeyStore for the account.
 *
 * Sessions 1 and 2 were granted with SDK-generated ephemeral signers that were
 * lost on process exit — live on-chain permissions with no key. revokeSession
 * is admin-signed and accepts a public key, so the lost signers do not block
 * cleanup.
 *
 * Public keys are recovered from KeyStore itself, not from local artifacts.
 */
import process from 'node:process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(HERE, '../../../..', '.env'));

const KEYSTORE = '0x6b8361c29d05d498b1a12b54a37310f94171e94a';
const log = (s: string) => process.stdout.write(s + '\n');

async function call(to: string, data: string): Promise<string> {
  const r = await fetch(BNB_TESTNET.publicRpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    signal: AbortSignal.timeout(30_000),
  });
  const b = (await r.json()) as { result?: string; error?: { message: string } };
  if (b.error) throw new Error(b.error.message);
  return b.result ?? '0x';
}
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');

/** getKeys(address) -> bytes32[] */
async function getKeys(acct: string): Promise<string[]> {
  const d = await call(KEYSTORE, '0x34e80c34' + pad(acct));
  const body = d.slice(2);
  const len = parseInt(body.slice(64, 128), 16);
  return Array.from({ length: len }, (_, i) => '0x' + body.slice(128 + i * 64, 128 + i * 64 + 64));
}
/** getPublicKey(address,bytes32) -> bytes */
async function getPublicKey(acct: string, keyId: string): Promise<string> {
  const d = await call(KEYSTORE, '0x7cefdd5d' + pad(acct) + keyId.replace(/^0x/, ''));
  const body = d.slice(2);
  const len = parseInt(body.slice(64, 128), 16);
  return '0x' + body.slice(128, 128 + len * 2);
}

async function main() {
  const client = createClient({ chains: [BNB_TESTNET] });
  await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
  const adminSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
  const wallet = await client.createWallet({ signer: adminSigner });
  const acct = wallet.address;
  const adminPub = adminSigner.publicKey.toLowerCase();

  log(`account   : ${acct}`);
  log(`admin pub : ${adminPub.slice(0, 26)}...\n`);

  const before = await getKeys(acct);
  log(`KeyStore getKeys BEFORE (${before.length}):`);
  const targets: { keyId: string; pub: string }[] = [];
  for (const k of before) {
    const pub = (await getPublicKey(acct, k)).toLowerCase();
    const isAdmin = pub === adminPub;
    log(`  ${k}  ${isAdmin ? 'ADMIN (keep)' : 'SESSION (revoke)'}  pub=${pub.slice(0, 26)}...`);
    if (!isAdmin) targets.push({ keyId: k, pub });
  }

  if (targets.length === 0) { log('\nnothing to revoke.'); return; }

  const results: Record<string, unknown>[] = [];
  for (const t of targets) {
    log(`\nrevoking ${t.keyId} ...`);
    try {
      const rev = await client.revokeSession({ wallet, signer: adminSigner, session: t.pub as `0x${string}` });
      log(`  status ${rev.status}  tx ${rev.transactionHash ?? '(none)'}`);
      results.push({ keyId: t.keyId, status: rev.status, tx: rev.transactionHash ?? null });
    } catch (e) {
      log(`  FAILED: ${(e as Error).message}`);
      results.push({ keyId: t.keyId, error: (e as Error).message });
    }
  }

  const after = await getKeys(acct);
  log(`\nKeyStore getKeys AFTER (${after.length}):`);
  for (const k of after) {
    const pub = (await getPublicKey(acct, k)).toLowerCase();
    log(`  ${k}  ${pub === adminPub ? 'ADMIN' : '*** STILL A SESSION KEY ***'}`);
  }
  const onlyAdmin = after.length === 1 && (await getPublicKey(acct, after[0]!)).toLowerCase() === adminPub;
  log(`\nonly the admin key remains: ${onlyAdmin ? 'YES' : 'NO'}`);
  writeFileSync('/tmp/revoke_out.json', JSON.stringify({ before, results, after, onlyAdmin }, null, 2));
}
main().catch((e) => { process.stderr.write(`\nREVOKE FAILED: ${e?.stack ?? e}\n`); process.exit(1); });
