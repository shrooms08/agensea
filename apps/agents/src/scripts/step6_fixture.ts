/** 3c: open a small, movable Venus position on chain 97 as a demo fixture. */
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
console.log('[guard] chain 97 asserted — this step WRITES, so the guard matters here\n');

const COMPTROLLER = '0x94d1820b2D1c7c7452A163983Dc888CEC546b77D' as const;
const VBNB = '0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c' as const;
const VUSDT = '0xb7526572FFE56AB9D7489838Bf2E18e3323b441A' as const;
const SUPPLY = 8_000_000_000_000_000n;   // 0.008 tBNB — under the 0.01 cap
const BORROW_USDT = 4_000_000n;          // 4 USDT (6 decimals)

const signer = signerFromPrivateKey(process.env.AGENT_KEY!.trim() as `0x${string}`);
const wallet = await client.createWallet({ signer });
console.log(`fixture account: ${wallet.address}`);

const before = await analyze(97, wallet.address);
console.log(`before: HF=${before.healthFactor} collateral=$${before.collateralUsd.toFixed(4)} borrowed=$${before.borrowedUsd.toFixed(4)}`);

const calls = [
  { to: COMPTROLLER, data: encodeFunctionData({ abi: parseAbi(['function enterMarkets(address[] vTokens)']), functionName: 'enterMarkets', args: [[VBNB]] }) },
  { to: VBNB, value: SUPPLY, data: encodeFunctionData({ abi: parseAbi(['function mint()']), functionName: 'mint' }) },
  { to: VUSDT, data: encodeFunctionData({ abi: parseAbi(['function borrow(uint256 amount)']), functionName: 'borrow', args: [BORROW_USDT] }) },
];
console.log(`\nenterMarkets([vBNB]) + mint(${SUPPLY} wei) + borrow(${BORROW_USDT} = 4 USDT)`);
const res = await client.execute({ wallet, signer, calls });
console.log(`status=${res.status} tx=${res.transactionHash}`);

const after = await analyze(97, wallet.address);
console.log(`\nAFTER — chain 97 fixture position`);
console.log(`  HEALTH FACTOR ${after.healthFactor}   risk ${after.riskLevel}`);
console.log(`  collateral $${after.collateralUsd.toFixed(4)} (weighted $${after.weightedCollateralUsd.toFixed(4)})`);
console.log(`  borrowed   $${after.borrowedUsd.toFixed(4)}`);
console.log(`  drop to liquidation: ${after.priceDropToLiquidation !== null ? (after.priceDropToLiquidation * 100).toFixed(2) + '%' : 'n/a'}`);
for (const m of after.markets) console.log(`    ${m.symbol.padEnd(8)} supply $${m.supplyUsd.toFixed(4)} borrow $${m.borrowUsd.toFixed(4)} LT ${m.liquidationThreshold}`);
console.log(`\n  recommendation: ${after.recommendation}`);
Object.assign(state, { fixtureTx: res.transactionHash ?? null, fixture: after });
save();
