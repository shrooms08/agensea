/** Phase 3a step 2: grant the seller session, scoped to exactly one call. */
import process from 'node:process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { createClient, signerFromPrivateKey, BNB_TESTNET, type CallPermission } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For, assertPolicyWhitelisted } from '../erc8183/addresses.ts';
import { state, save, SECRETS, ROOT } from '../agent/state.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
await assertPolicyWhitelisted(addrs, BNB_TESTNET.publicRpcUrl);
console.log('[guard] chain 97 + policy whitelist asserted\n');

const adminSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: adminSigner });

// The seller's ONLY capability: submit a deliverable to the commerce kernel.
// Not createJob, not settle, not the registry — one selector at one address.
const calls: CallPermission[] = [
  { signature: 'submit(uint256,bytes32,bytes)', to: addrs.commerce },
];
// 2x the largest fee measured in Phase 2 (grant 890,035,421,466,326 wei).
// The actual submit fee is measured in step 4 and reported for tightening.
const CAP = 1_780_070_842_932_652n;

const sessionKey = generatePrivateKey();
const sessionSigner = signerFromPrivateKey(sessionKey);
writeFileSync(resolve(SECRETS, 'agent1-session.key'), sessionKey, { mode: 0o600 });

console.log('call allowlist (verbatim):', JSON.stringify(calls));
console.log(`spend cap: ${CAP} wei (${Number(CAP) / 1e18} tBNB), period hour`);

const expiry = Math.floor(Date.now() / 1000) + 24 * 3600;
const session = await client.grantSession({
  wallet, signer: adminSigner, sessionSigner,
  permissions: { calls, spend: [{ limit: CAP, period: 'hour' }] },
  expiry, register: true,
});
console.log(`\nsession address : ${session.signer.address}`);
console.log(`session publicKey: ${session.publicKey}`);
console.log(`grant tx        : ${session.transactionHash}`);

state.session = {
  address: session.signer.address, publicKey: session.publicKey,
  grantTx: session.transactionHash ?? null, expiry,
  permissions: { calls, spend: [{ limit: CAP.toString(), period: 'hour' }] },
  keyFile: '.secrets/agent1-session.key',
};
save();
console.log('\nsession persisted to .secrets/agent1-session.key (0600) + phase3a.json');
