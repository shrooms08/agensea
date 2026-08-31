/**
 * MAINNET REGISTRATION — chain 56 ONLY. Single purpose: register first-party
 * agents in the mainnet ERC-8004 IdentityRegistry, one at a time.
 *
 * RUN ONCE, 31 Aug 2026: agent 2012 (Venus Health Factor Monitor) registered
 * as mainnet agentId 322885, tx 0x381cff9788d7c6866f56609035a49fa9dca78ed0
 * 1540884b0557beec4b377807, fee 0.000879383 BNB (12.7x raw gas). The
 * remaining three agents were DELIBERATELY NOT registered — one mainnet
 * identity is sufficient for the claim, and three more would cost another
 * bridge for no additional claim.
 *
 * This is a SEPARATE mainnet path. It does not touch chain-guard.ts and the
 * testnet scripts keep their chain-97 guard exactly as they are. This script
 * enforces the inverse guard: it refuses to run unless everything — env,
 * client config, and the RPC itself, read off the wire — says chain 56.
 *
 * Usage:
 *   npx tsx src/scripts/mainnet_register_56.ts 2012          # dry-run: report only
 *   npx tsx src/scripts/mainnet_register_56.ts 2012 --send   # real money
 *
 * The agent URI is read live from the TESTNET registry (the registered
 * metadata is chain-agnostic: description names both chains, services carry
 * no addresses) so mainnet registers byte-identical metadata.
 */
import process from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, signerFromPrivateKey, BNB, registerErc8004Agent } from '@altananetwork/sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(resolve(HERE, '../../../../.env'));

const REGISTRY_56 = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'; // the contract the sweep read 317,468 agents from
const REGISTRY_97 = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const TESTNET_RPC = 'https://bsc-testnet-rpc.publicnode.com';
const WALLET = '0x85d32d525E1812FeE7001f34DD6dd86154619090';
const TESTNET_IDS: Record<string, { name: string }> = {
  '2012': { name: 'Venus Health Factor Monitor' },
  '2013': { name: 'PancakeSwap V3 Rebalancing Monitor' },
  '2014': { name: 'Grid Trading Parameter Advisor' },
  '2015': { name: 'BSC Yield Route Optimiser' },
};

const rpc = async (url: string, method: string, params: unknown[]) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  const j = (await r.json()) as { result?: unknown; error?: unknown };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
};
const main = (m: string, p: unknown[]) => rpc(BNB.publicRpcUrl, m, p);

// ---- guard: chain 56, asserted three ways, before any signer exists --------
if (process.env.ALTANA_CHAIN && process.env.ALTANA_CHAIN !== '56') {
  throw new Error(`refusing: ALTANA_CHAIN=${process.env.ALTANA_CHAIN} is set and is not 56. This script is mainnet-only.`);
}
if (BNB.chainId !== 56) throw new Error(`refusing: SDK BNB config says chainId ${BNB.chainId}`);
const live = parseInt(String(await main('eth_chainId', [])), 16);
if (live !== 56) throw new Error(`refusing: RPC ${BNB.publicRpcUrl} reports chainId ${live}, not 56`);
console.log('[guard] chain 56 verified off the wire');

// ---- verify the registry has code ------------------------------------------
const code = String(await main('eth_getCode', [REGISTRY_56, 'latest']));
if (code === '0x') throw new Error('refusing: registry has no code on 56');
console.log(`[registry] ${REGISTRY_56}: ${(code.length - 2) / 2} bytes of code`);

// ---- inputs ----------------------------------------------------------------
const testnetId = process.argv[2];
const send = process.argv.includes('--send');
if (!testnetId || !TESTNET_IDS[testnetId]) throw new Error(`usage: mainnet_register_56.ts <2012|2013|2014|2015> [--send]`);

const uriRaw = String(await rpc(TESTNET_RPC, 'eth_call', [{ to: REGISTRY_97,
  data: '0xc87b56dd' + BigInt(testnetId).toString(16).padStart(64, '0') }, 'latest']));
// decode string return
const off = Number(BigInt('0x' + uriRaw.slice(2, 66)));
const len = Number(BigInt('0x' + uriRaw.slice(2 + off * 2, 2 + off * 2 + 64)));
const uri = Buffer.from(uriRaw.slice(2 + off * 2 + 64, 2 + off * 2 + 64 + len * 2), 'hex').toString('utf8');
const meta = JSON.parse(Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8')) as { name: string };
if (meta.name !== TESTNET_IDS[testnetId]!.name) {
  throw new Error(`refusing: testnet ${testnetId} metadata name is "${meta.name}", expected "${TESTNET_IDS[testnetId]!.name}"`);
}
console.log(`[metadata] read from chain 97 agent ${testnetId}: "${meta.name}" (${uri.length} chars, byte-identical re-registration)`);

const balBefore = BigInt(String(await main('eth_getBalance', [WALLET, 'latest'])));
console.log(`[wallet] ${WALLET} balance: ${Number(balBefore) / 1e18} BNB`);

// calldata as the SDK will build it: register(string,(string,bytes)[]) with empty metadata array
const { encodeFunctionData } = await import('viem');
const calldata = encodeFunctionData({
  abi: [{ name: 'register', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' },
             { name: 'metadata', type: 'tuple[]', components: [
               { name: 'metadataKey', type: 'string' }, { name: 'metadataValue', type: 'bytes' }] }],
    outputs: [{ name: 'agentId', type: 'uint256' }] }] as const,
  functionName: 'register', args: [uri, []],
});
console.log(`[calldata] ${calldata.slice(0, 10)}… (${(calldata.length - 2) / 2} bytes) -> ${REGISTRY_56}`);
const est = await main('eth_estimateGas', [{ from: WALLET, to: REGISTRY_56, data: calldata }, 'latest']);
const gasPrice = BigInt(String(await main('eth_gasPrice', [])));
console.log(`[estimate] inner register call: ${Number(BigInt(String(est)))} gas at ${Number(gasPrice) / 1e9} gwei ` +
  `(raw ~${(Number(BigInt(String(est))) * Number(gasPrice)) / 1e18} BNB; relay adds 7702 delegation + KeyStore registration + orchestrator overhead and its fee margin)`);

if (!send) { console.log('\nDRY RUN — nothing sent. Re-run with --send to register for real.'); process.exit(0); }

// ---- real money below ------------------------------------------------------
const adminSigner = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const client = createClient({ chains: [BNB] });
for (const c of client.chains) if (c.chainId !== 56) throw new Error(`refusing: client chain ${c.chainId}`);
const wallet = await client.createWallet({ signer: adminSigner });
if (wallet.address.toLowerCase() !== WALLET.toLowerCase()) throw new Error(`refusing: signer derives ${wallet.address}, expected ${WALLET}`);
console.log('[relay] account registered with mainnet relay (counterfactual). Sending register intent…');

const res = await registerErc8004Agent(wallet, adminSigner, { agentUri: uri }, { network: BNB });
console.log(`\nMAINNET agentId: ${res.agentId}`);
console.log(`tx: ${res.transactionHash}`);
console.log(`explorer: https://bscscan.com/tx/${res.transactionHash}`);

const rcpt = (await main('eth_getTransactionReceipt', [res.transactionHash])) as { gasUsed: string; effectiveGasPrice: string; from: string } | null;
const balAfter = BigInt(String(await main('eth_getBalance', [WALLET, 'latest'])));
const fee = balBefore - balAfter;
console.log(`\nfee charged to the account: ${Number(fee) / 1e18} BNB`);
if (rcpt) {
  const raw = BigInt(rcpt.gasUsed) * BigInt(rcpt.effectiveGasPrice);
  console.log(`L1 tx: gasUsed ${Number(BigInt(rcpt.gasUsed))} at ${Number(BigInt(rcpt.effectiveGasPrice)) / 1e9} gwei -> raw ${Number(raw) / 1e18} BNB (submitter ${rcpt.from})`);
  console.log(`fee multiple over raw gas: ${(Number(fee) / Number(raw)).toFixed(2)}x`);
}
console.log(`remaining balance: ${Number(balAfter) / 1e18} BNB`);
const codeNow = String(await main('eth_getCode', [WALLET, 'latest']));
console.log(`wallet code on 56 now: ${codeNow === '0x' ? 'NONE' : codeNow} (${(codeNow.length - 2) / 2} bytes)`);
