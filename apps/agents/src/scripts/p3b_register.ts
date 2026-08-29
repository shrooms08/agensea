/** Phase 3b: register identities + grant scoped sessions for agents 2, 3, 4. */
import process from 'node:process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { createClient, signerFromPrivateKey, BNB_TESTNET, registerErc8004Agent, getErc8004Agent, type CallPermission } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { erc8183For, assertPolicyWhitelisted } from '../erc8183/addresses.ts';
import { AGENTS, recordFor } from '../agent/agents.ts';
import { toAgentUri, fromAgentUri } from '../agent/identity.ts';
import { updateAgent, readState, SECRETS, ROOT } from '../agent/state.ts';

process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const addrs = erc8183For(97);
await assertPolicyWhitelisted(addrs, BNB_TESTNET.publicRpcUrl);
console.log('[guard] chain 97 + policy whitelist asserted\n');

const adminSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer: adminSigner });
console.log(`shared smart account (provider for all three): ${wallet.address}\n`);

// Agent 1 used 1,780,070,842,932,652 wei before a submit fee had been measured.
// Measured submit fee is 47,105,300,000,000 wei, so 2x is the right cap now.
const CAP = 94_210_600_000_000n;
const AGENT1_CAP = 1_780_070_842_932_652n;
console.log(`session cap ${CAP} wei (2x measured submit fee 47,105,300,000,000)`);
console.log(`Agent 1 used ${AGENT1_CAP} wei -> reduction factor ${(Number(AGENT1_CAP) / Number(CAP)).toFixed(1)}x\n`);

const calls: CallPermission[] = [{ signature: 'submit(uint256,bytes32,bytes)', to: addrs.commerce }];

for (const a of AGENTS) {
  const cur = readState()[a.key] ?? {};
  console.log(`=== ${a.key}: ${a.name} (${a.category}) ===`);

  let agentId = cur.agentId as string | undefined;
  if (!agentId) {
    const uri = toAgentUri(recordFor(a));
    const res = await registerErc8004Agent(wallet, adminSigner, { agentUri: uri }, { network: BNB_TESTNET });
    agentId = res.agentId.toString();
    await updateAgent(a.key, { agentId, registerTx: res.transactionHash ?? null, category: a.category, name: a.name });
    console.log(`  registered agentId=${agentId} tx=${res.transactionHash}`);
  } else console.log(`  already registered agentId=${agentId}`);

  const onchain = await getErc8004Agent(BNB_TESTNET, BigInt(agentId!));
  const dec = fromAgentUri(String(onchain.agentUri)) as Record<string, unknown>;
  console.log(`  tokenURI ${String(onchain.agentUri).length} chars -> name="${dec.name}" category="${dec.category}" x402Support=${dec.x402Support}`);

  if (!cur.sessionAddress) {
    const k = generatePrivateKey();
    const ss = signerFromPrivateKey(k);
    writeFileSync(resolve(SECRETS, `${a.key}-session.key`), k, { mode: 0o600 });
    const expiry = Math.floor(Date.now() / 1000) + 24 * 3600;
    const session = await client.grantSession({
      wallet, signer: adminSigner, sessionSigner: ss,
      permissions: { calls, spend: [{ limit: CAP, period: 'hour' }] }, expiry, register: true,
    });
    await updateAgent(a.key, {
      sessionAddress: session.signer.address, sessionPublicKey: session.publicKey,
      sessionGrantTx: session.transactionHash ?? null, sessionExpiry: expiry,
      sessionCap: CAP.toString(), sessionCalls: calls, keyFile: `.secrets/${a.key}-session.key`,
    });
    console.log(`  session ${session.signer.address} grant tx=${session.transactionHash}`);
  } else console.log(`  session already granted: ${cur.sessionAddress}`);
  console.log(`  CallPermission: ${JSON.stringify(calls)}\n`);
}
console.log('done.');
