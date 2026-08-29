/** Phase 3a step 1: register the agent's ERC-8004 identity on chain 97. */
import process from 'node:process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, signerFromPrivateKey, BNB_TESTNET, registerErc8004Agent, getErc8004Agent } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { AGENT_RECORD, toAgentUri, fromAgentUri } from '../agent/identity.ts';
import { erc8183For, assertPolicyWhitelisted } from '../erc8183/addresses.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
process.loadEnvFile(resolve(ROOT, '.env'));
const STATE = resolve(ROOT, '.secrets/phase3a.json');
const state: Record<string, unknown> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });

const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
console.log('[guard] chain 97 verified off the wire before any signer was constructed');

const addrs = erc8183For(97);
console.log(`[erc8183] commerce=${addrs.commerce}\n          router  =${addrs.router}\n          policy  =${addrs.policy}  (overridden)`);
await assertPolicyWhitelisted(addrs, BNB_TESTNET.publicRpcUrl);
console.log('[erc8183] router.policyWhitelist(policy) == true  ASSERTED\n');

const adminSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: adminSigner });
console.log(`smart account: ${wallet.address}`);

if (state.agentId) {
  console.log(`already registered: agentId=${state.agentId}`);
} else {
  const uri = toAgentUri(AGENT_RECORD);
  console.log(`agentUri length: ${uri.length} chars (data: URI)`);
  const res = await registerErc8004Agent(wallet, adminSigner, { agentUri: uri }, { network: BNB_TESTNET });
  console.log(`register status=${res.status} tx=${res.transactionHash} agentId=${res.agentId}`);
  state.agentId = res.agentId.toString();
  state.registerTx = res.transactionHash ?? null;
  state.smartAccount = wallet.address;
  save();
}

const onchain = await getErc8004Agent(BNB_TESTNET, BigInt(state.agentId as string));
console.log(`\non-chain owner   : ${onchain.owner}`);
console.log(`on-chain tokenURI: ${String(onchain.agentUri).slice(0, 60)}…  (${String(onchain.agentUri).length} chars)`);
const decoded = fromAgentUri(String(onchain.agentUri)) as Record<string, unknown>;
console.log('decoded record   :', JSON.stringify({
  name: decoded.name, category: decoded.category, x402Support: decoded.x402Support,
  services: decoded.services, active: decoded.active,
}, null, 2));
save();
