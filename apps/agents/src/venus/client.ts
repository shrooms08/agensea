/**
 * Venus position reader. READ-ONLY: eth_call against public data, no key, no
 * transaction. The chain guard deliberately does NOT apply here — it guards the
 * SIGNING path. Reading mainnet is safe because nothing is signed.
 */
import process from 'node:process';
import { VENUS, type VenusChain } from './addresses.ts';

const SEL = {
  getAssetsIn: '0xabfceffc',
  getAccountLiquidity: '0x5ec88c79',
  markets: '0x8e8f294b',
  oracle: '0x7dc0d1d0',
  getAccountSnapshot: '0xc37f68e2',
  getUnderlyingPrice: '0xfc57d4df',
  symbol: '0x95d89b41',
} as const;

const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const W = (hex: string, i: number) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const U = (hex: string, i: number) => BigInt('0x' + (W(hex, i) || '0'));

export function rpcFor(chainId: VenusChain): string {
  const d = VENUS[chainId];
  return process.env[d.rpcEnv]?.trim() || d.fallbackRpc;
}

async function call(rpc: string, to: string, data: string): Promise<string> {
  const r = await fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    signal: AbortSignal.timeout(30_000),
  });
  const b = (await r.json()) as { result?: string; error?: { message: string } };
  if (b.error) throw new Error(`eth_call ${to.slice(0, 10)}…: ${b.error.message}`);
  return b.result ?? '0x';
}

function decodeString(hex: string): string {
  if (hex.length < 130) return '';
  const len = parseInt(W(hex, 1), 16);
  const raw = hex.slice(2 + 128, 2 + 128 + len * 2);
  return Buffer.from(raw, 'hex').toString('utf8');
}

export interface MarketPosition {
  vToken: string;
  symbol: string;
  /** USD value of supplied collateral, 1e18-scaled */
  supplyUsd: bigint;
  /** USD value of borrows, 1e18-scaled */
  borrowUsd: bigint;
  /** collateralFactorMantissa — BORROWING power, 1e18-scaled */
  collateralFactor: bigint;
  /** liquidationThresholdMantissa — the level at which liquidation begins, 1e18 */
  liquidationThreshold: bigint;
  /** liquidationIncentiveMantissa — liquidator bonus, 1e18 (1.1e18 = 10%) */
  liquidationIncentive: bigint;
}

export interface VenusPosition {
  chainId: VenusChain;
  chainLabel: string;
  account: string;
  markets: MarketPosition[];
  /** Σ supplyUsd (unweighted), 1e18 */
  collateralUsd: bigint;
  /** Σ supplyUsd × liquidationThreshold, 1e18 — the liquidation-relevant figure */
  weightedCollateralUsd: bigint;
  /** Σ supplyUsd × collateralFactor, 1e18 — borrowing power (what getAccountLiquidity uses) */
  borrowPowerUsd: bigint;
  /** Σ borrowUsd, 1e18 */
  borrowedUsd: bigint;
  /** weightedCollateral / borrowed, as a float. null when nothing is borrowed. */
  healthFactor: number | null;
  /** Comptroller's own view, 1e18 */
  liquidity: bigint;
  shortfall: bigint;
  /** Weighted-average collateral factor across supplied markets, as a float */
  avgLiquidationThreshold: number | null;
  blockNumber: number;
}

export async function readVenusPosition(chainId: VenusChain, account: string): Promise<VenusPosition> {
  const d = VENUS[chainId];
  const rpc = rpcFor(chainId);
  const c = d.comptroller;

  const bnRes = await fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const blockNumber = parseInt(((await bnRes.json()) as { result: string }).result, 16);

  const oracle = '0x' + (await call(rpc, c, SEL.oracle)).slice(26);
  const assetsRaw = await call(rpc, c, SEL.getAssetsIn + pad(account));
  const n = parseInt(W(assetsRaw, 1), 16) || 0;
  const vTokens = Array.from({ length: n }, (_, i) => '0x' + W(assetsRaw, 2 + i).slice(24));

  const liqRaw = await call(rpc, c, SEL.getAccountLiquidity + pad(account));
  const liquidity = U(liqRaw, 1);
  const shortfall = U(liqRaw, 2);

  const markets: MarketPosition[] = [];
  let collateralUsd = 0n, weightedCollateralUsd = 0n, borrowPowerUsd = 0n, borrowedUsd = 0n, cfWeightSum = 0n;

  for (const v of vTokens) {
    const snap = await call(rpc, v, SEL.getAccountSnapshot + pad(account));
    const vBal = U(snap, 1), borrowBal = U(snap, 2), exRate = U(snap, 3);
    // Venus's Diamond markets() returns SEVEN words, not the legacy three:
    //   w0 isListed | w1 collateralFactor | w2 isVenus
    //   w3 liquidationThreshold | w4 liquidationIncentive | w5,w6 reserved
    // collateralFactor is borrowing power; liquidationThreshold is what actually
    // triggers liquidation, and they differ (e.g. vADA: CF=0, LT=0.63). A health
    // factor built on collateralFactor understates safety.
    const mk = await call(rpc, c, SEL.markets + pad(v));
    const collateralFactor = U(mk, 1);
    const liquidationThreshold = U(mk, 3) > 0n ? U(mk, 3) : collateralFactor;
    const liquidationIncentive = U(mk, 4);
    const price = U(await call(rpc, oracle, SEL.getUnderlyingPrice + pad(v)), 0);
    let symbol = v.slice(0, 8);
    try { symbol = decodeString(await call(rpc, v, SEL.symbol)) || symbol; } catch { /* non-standard */ }

    // Venus oracle price is scaled 1e(36 - underlyingDecimals), so
    // valueUsd(1e18) = underlyingAmount * price / 1e18.
    const underlying = (vBal * exRate) / 10n ** 18n;
    const supplyUsd = (underlying * price) / 10n ** 18n;
    const borrowUsd = (borrowBal * price) / 10n ** 18n;

    if (supplyUsd > 0n || borrowUsd > 0n) {
      markets.push({ vToken: v, symbol, supplyUsd, borrowUsd, collateralFactor, liquidationThreshold, liquidationIncentive });
      collateralUsd += supplyUsd;
      weightedCollateralUsd += (supplyUsd * liquidationThreshold) / 10n ** 18n;
      borrowPowerUsd += (supplyUsd * collateralFactor) / 10n ** 18n;
      borrowedUsd += borrowUsd;
      cfWeightSum += supplyUsd * liquidationThreshold;
    }
  }

  const healthFactor = borrowedUsd > 0n
    ? Number((weightedCollateralUsd * 10_000n) / borrowedUsd) / 10_000
    : null;
  const avgLiquidationThreshold = collateralUsd > 0n
    ? Number(cfWeightSum / collateralUsd) / 1e18
    : null;

  return {
    chainId, chainLabel: d.label, account: account.toLowerCase(), markets,
    collateralUsd, weightedCollateralUsd, borrowPowerUsd, borrowedUsd, healthFactor,
    liquidity, shortfall, avgLiquidationThreshold, blockNumber,
  };
}

export const usd = (v: bigint) => Number(v / 10n ** 12n) / 1e6;
