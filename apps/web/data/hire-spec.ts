/**
 * Hire-page spec: what each agent DELIVERS, what the buyer PROVIDES, and the
 * measured numbers behind the transaction preview.
 *
 * DELIVERS rows name REAL keys of that agent's deliverable — every `key` below
 * exists in the committed manifest for that agent (data/deliverables.ts), and
 * tests/hire-spec.test.mjs fails if one ever stops existing. Nothing here is
 * invented; where we have no data, there is no row.
 *
 * PROVIDES is the buyer's input. It is prefilled with a target we have actually
 * analysed so a judge can hire in one click, editable so they can point the
 * agent somewhere else, validated in the browser (format) and again on the
 * server against chain state before any wallet transaction is offered. The
 * chosen value is written into the job description, so it is bound on chain and
 * echoed in the deliverable manifest.
 */
import type { CategorySlug } from '@/data/first-party-agents';

export interface DeliversRow { key: string; label: string }
export type TargetKind = 'address' | 'tokenId' | 'pool' | 'usd';
export interface TargetSpec {
  kind: TargetKind;
  label: string;
  hint: string;
  prefill: string;
  /** Fixed inputs the agent does not take from the buyer, stated so the
   *  preview never implies a knob that does not exist. */
  fixed?: string;
}

/**
 * PancakeSwap V3 pools on BSC mainnet for the grid agent. Every address was
 * read from the V3 factory (`getPool`) and checked for live liquidity and at
 * least 3h of oracle observations on 1 Sep 2026 — never taken from docs.
 */
export const GRID_POOLS: Record<string, { token0: string; token1: string; fee: number; pool: string }> = {
  'WBNB/USDT 0.05%': { token0: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', token1: '0x55d398326f99059fF775485246999027B3197955', fee: 500, pool: '0x36696169C63e42cd08ce11f5deeBbCeBae652050' },
  'BTCB/USDT 0.05%': { token0: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', token1: '0x55d398326f99059fF775485246999027B3197955', fee: 500, pool: '0x46Cf1cF8c69595804ba91dFdd8d6b960c9B0a7C4' },
  'ETH/USDT 0.05%':  { token0: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', token1: '0x55d398326f99059fF775485246999027B3197955', fee: 500, pool: '0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5' },
  'CAKE/WBNB 0.25%': { token0: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', token1: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', fee: 2500, pool: '0x133B3D95bAD5405d14d53473671200e9342896BF' },
};

export const DELIVERS: Record<number, DeliversRow[]> = {
  2012: [
    { key: 'healthFactor', label: 'health factor' },
    { key: 'collateralUsd', label: 'collateral supplied (USD)' },
    { key: 'borrowedUsd', label: 'borrowings (USD)' },
    { key: 'markets', label: 'per-market liquidation thresholds' },
    { key: 'priceDropToLiquidation', label: 'price drop to liquidation' },
    { key: 'recommendation', label: 'plain-language risk recommendation' },
  ],
  2013: [
    { key: 'inRange', label: 'in or out of range' },
    { key: 'priceCurrent', label: 'current price' },
    { key: 'rangeWidthPct', label: 'range width' },
    { key: 'distanceToEdgePct', label: 'distance to range edge' },
    { key: 'uncollectedFees0', label: 'uncollected fees' },
    { key: 'recommendedLower', label: 'recommended re-centred range' },
    { key: 'recommendation', label: 'rebalance recommendation' },
  ],
  2014: [
    { key: 'hourlyVolPct', label: 'realised volatility (hourly)' },
    { key: 'annualisedVolPct', label: 'annualised volatility' },
    { key: 'lowerBound', label: 'grid bounds' },
    { key: 'gridCount', label: 'grid level count' },
    { key: 'capitalPerLevelUsd', label: 'capital per level' },
    { key: 'expectedFillsPerDay', label: 'expected fills per day' },
    { key: 'recommendation', label: 'grid recommendation' },
  ],
  2015: [
    { key: 'venues', label: 'supply APR at each venue' },
    { key: 'best', label: 'best venue' },
    { key: 'gasCostUsd', label: 'gas cost to switch' },
    { key: 'breakEvenDays', label: 'break-even time' },
    { key: 'assumptions', label: 'assumptions, stated' },
    { key: 'recommendation', label: 'route recommendation' },
  ],
};

export const TARGETS: Record<number, TargetSpec> = {
  2012: {
    kind: 'address', label: 'BSC mainnet wallet address',
    hint: 'Any address with a Venus position. Checked on chain before you sign.',
    prefill: '0xb76b35db3f2a7d8346013d9b02edbf756cf27c72',
  },
  2013: {
    kind: 'tokenId', label: 'PancakeSwap V3 position tokenId',
    hint: 'Any V3 position NFT id. Checked on chain before you sign.',
    prefill: '6801109',
  },
  2014: {
    kind: 'pool', label: 'PancakeSwap V3 pool',
    hint: 'Volatility and grid bounds come from this pool’s own TWAP oracle.',
    prefill: 'WBNB/USDT 0.05%',
    fixed: 'capital 10,000 USD · 24h window',
  },
  2015: {
    kind: 'usd', label: 'position size (USD)',
    hint: 'Sets the spread-versus-gas break-even the agent computes.',
    prefill: '10000',
    fixed: 'asset BTCB — the Venus, Aave V3 and Lista readers are BTCB-specific',
  },
};

/** Format-only validation, shared by the browser and the server. Chain-state
 *  checks (position exists, address has entered a Venus market) run server-side
 *  in /api/agent-work before any work begins. */
export function validateTarget(agentId: number, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const spec = TARGETS[agentId];
  if (!spec) return { ok: false, error: 'unknown agent' };
  const v = raw.trim();
  if (!v) return { ok: false, error: `${spec.label} is required` };
  switch (spec.kind) {
    case 'address':
      return /^0x[0-9a-fA-F]{40}$/.test(v) ? { ok: true, value: v.toLowerCase() }
        : { ok: false, error: 'that is not a wallet address — expected 0x followed by 40 hex characters' };
    case 'tokenId':
      return /^\d{1,12}$/.test(v) ? { ok: true, value: v }
        : { ok: false, error: 'that is not a position id — expected digits only' };
    case 'pool':
      return GRID_POOLS[v] ? { ok: true, value: v }
        : { ok: false, error: `unknown pool — pick one of: ${Object.keys(GRID_POOLS).join(', ')}` };
    case 'usd': {
      const n = Number(v);
      return Number.isFinite(n) && n >= 100 && n <= 1_000_000
        ? { ok: true, value: String(Math.round(n)) }
        : { ok: false, error: 'enter a position size between 100 and 1,000,000 USD' };
    }
  }
}

/**
 * Gas for the five buyer transactions, MEASURED from the receipts of job 844
 * (the wallet-native hire proven on the preview, 31 Aug 2026). The preview
 * multiplies this by the live gas price rather than guessing a fee.
 */
export const MEASURED_GAS = {
  approve: 40_357, createJob: 284_619, registerJob: 102_564, setBudget: 96_162, fund: 102_529,
  get total() { return this.approve + this.createJob + this.registerJob + this.setBudget + this.fund; },
  source: 'measured from job 844 receipts, 31 Aug 2026',
} as const;

export const SLUG_BY_AGENT: Record<number, CategorySlug> = {
  2012: 'health-factor-monitoring', 2013: 'rebalancing', 2014: 'grid-trading', 2015: 'yield-optimisation',
};
