import process from 'node:process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import { SECRETS, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });

// health of the relay itself
for (const m of ['health', 'wallet_getCapabilities']) {
  try {
    const r = await fetch(BNB_TESTNET.relayUrl!, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: [] }), signal: AbortSignal.timeout(15000) });
    console.log(`relay ${m}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  } catch (e) { console.log(`relay ${m}: ${(e as Error).message}`); }
}

// minimal single-call execute from the buyer (no ERC-8183 involved)
const buyerKey = readFileSync(resolve(SECRETS, 'buyer.key'), 'utf8').trim() as `0x${string}`;
const signer = signerFromPrivateKey(buyerKey);
const wallet = await client.createWallet({ signer });
try {
  const res = await client.execute({ wallet, signer, calls: [{ to: wallet.address, value: 1n }] });
  console.log(`minimal self-transfer: status=${res.status} tx=${res.transactionHash}`);
} catch (e) {
  console.log(`minimal self-transfer FAILED: ${(e as Error).message.slice(0, 200)}`);
}
