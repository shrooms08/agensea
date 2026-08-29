/** Prove the fixture health factor moves on command: borrow 2 more USDT. */
import process from 'node:process';
import { resolve } from 'node:path';
import { encodeFunctionData, parseAbi } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import { assertChain97 } from '../chain-guard.ts';
import { analyze } from '../venus/analyze.ts';
import { state, save, ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const client = createClient({ chains: [BNB_TESTNET] });
await assertChain97(BNB_TESTNET, client.chains.map((c) => c.chainId));
const VUSDT = '0xb7526572FFE56AB9D7489838Bf2E18e3323b441A' as const;
const signer = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer });
const before = await analyze(97, wallet.address);
console.log(`before: HF=${before.healthFactor} (${before.riskLevel}) borrowed=$${before.borrowedUsd.toFixed(4)}`);
const res = await client.execute({ wallet, signer, calls: [{ to: VUSDT,
  data: encodeFunctionData({ abi: parseAbi(['function borrow(uint256 amount)']), functionName: 'borrow', args: [2_000_000n] }) }] });
console.log(`borrow 2 more USDT: status=${res.status} tx=${res.transactionHash}`);
const after = await analyze(97, wallet.address);
console.log(`after : HF=${after.healthFactor} (${after.riskLevel}) borrowed=$${after.borrowedUsd.toFixed(4)}`);
console.log(`\n  ${after.recommendation}`);
Object.assign(state, { fixtureMoveTx: res.transactionHash ?? null, fixtureAfterMove: after });
save();
