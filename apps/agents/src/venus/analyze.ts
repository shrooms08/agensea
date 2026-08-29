/** Health-factor analysis: risk classification + plain-language recommendation. */
import { readVenusPosition, usd, type VenusPosition } from './client.ts';
import type { VenusChain } from './addresses.ts';

export type RiskLevel = 'NO_DEBT' | 'HEALTHY' | 'MODERATE' | 'ELEVATED' | 'CRITICAL' | 'LIQUIDATABLE';

export interface Analysis {
  account: string;
  chainId: number;
  chainLabel: string;
  blockNumber: number;
  healthFactor: number | null;
  riskLevel: RiskLevel;
  collateralUsd: number;
  weightedCollateralUsd: number;
  borrowPowerUsd: number;
  borrowedUsd: number;
  avgLiquidationThreshold: number | null;
  /** How far the collateral can fall before liquidation, as a fraction. */
  priceDropToLiquidation: number | null;
  recommendation: string;
  markets: { symbol: string; supplyUsd: number; borrowUsd: number; collateralFactor: number; liquidationThreshold: number }[];
}

export function classify(hf: number | null): RiskLevel {
  if (hf === null) return 'NO_DEBT';
  if (hf < 1.0) return 'LIQUIDATABLE';
  if (hf < 1.1) return 'CRITICAL';
  if (hf < 1.3) return 'ELEVATED';
  if (hf < 1.8) return 'MODERATE';
  return 'HEALTHY';
}

function recommend(hf: number | null, risk: RiskLevel, drop: number | null, borrowed: number): string {
  const pct = drop === null ? null : `${(drop * 100).toFixed(1)}%`;
  switch (risk) {
    case 'NO_DEBT':
      return 'No outstanding borrows. There is no liquidation risk on this account; collateral is idle and could be deployed or withdrawn freely.';
    case 'LIQUIDATABLE':
      return `Health factor is ${hf!.toFixed(4)}, below 1.0. This position is ELIGIBLE FOR LIQUIDATION RIGHT NOW. Repay debt or add collateral immediately; a liquidator can seize collateral at a bonus at any block.`;
    case 'CRITICAL':
      return `Health factor is ${hf!.toFixed(4)}. A collateral price drop of only ${pct} triggers liquidation. Act now: repay part of the $${borrowed.toFixed(0)} borrowed, or add collateral. Do not rely on monitoring alone at this level.`;
    case 'ELEVATED':
      return `Health factor is ${hf!.toFixed(4)}. A ${pct} collateral drawdown would trigger liquidation — within a normal day's volatility for crypto collateral. Reduce leverage or top up collateral to move above 1.5.`;
    case 'MODERATE':
      return `Health factor is ${hf!.toFixed(4)}. The position survives a ${pct} collateral drawdown. This is a workable but not comfortable buffer; consider trimming debt before a volatile event.`;
    case 'HEALTHY':
      return `Health factor is ${hf!.toFixed(4)}, a comfortable buffer — collateral would have to fall ${pct} before liquidation. No action needed; re-check if you borrow more or markets move sharply.`;
  }
}

export function analyzePosition(p: VenusPosition): Analysis {
  const risk = classify(p.healthFactor);
  // Liquidation hits when weightedCollateral * (1-d) == borrowed  ->  d = 1 - 1/HF
  const drop = p.healthFactor !== null && p.healthFactor > 0 ? 1 - 1 / p.healthFactor : null;
  const borrowed = usd(p.borrowedUsd);
  return {
    account: p.account, chainId: p.chainId, chainLabel: p.chainLabel, blockNumber: p.blockNumber,
    healthFactor: p.healthFactor, riskLevel: risk,
    collateralUsd: usd(p.collateralUsd),
    weightedCollateralUsd: usd(p.weightedCollateralUsd),
    borrowPowerUsd: usd(p.borrowPowerUsd),
    borrowedUsd: borrowed,
    avgLiquidationThreshold: p.avgLiquidationThreshold,
    priceDropToLiquidation: drop,
    recommendation: recommend(p.healthFactor, risk, drop, borrowed),
    markets: p.markets.map((m) => ({
      symbol: m.symbol, supplyUsd: usd(m.supplyUsd), borrowUsd: usd(m.borrowUsd),
      collateralFactor: Number(m.collateralFactor) / 1e18,
      liquidationThreshold: Number(m.liquidationThreshold) / 1e18,
    })),
  };
}

export async function analyze(chainId: VenusChain, account: string): Promise<Analysis> {
  return analyzePosition(await readVenusPosition(chainId, account));
}
