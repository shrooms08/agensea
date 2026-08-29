/**
 * Agent 2 — PancakeSwap V3 concentrated-liquidity position analysis.
 *
 * The Altana "PancakeSwap Liquidity" skill is V2-only and mainnet-only; its own
 * SKILL.md says "Concentrated liquidity (PancakeSwap V3 and Infinity) is a
 * different product with price ranges and NFT positions. It is not covered by
 * this skill." So this reads the V3 contracts directly.
 *
 * Addresses from pancakeswap/pancake-v3-contracts deployments/bscMainnet.json,
 * each verified with cast code.
 */
import process from 'node:process';

export const PCS = {
  factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  nfpm: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364',
} as const;

const SEL = {
  positions: '0x99fbab88',      // positions(uint256)
  getPool: '0x1698ee82',        // getPool(address,address,uint24)
  slot0: '0x3850c7bd',
  liquidity: '0x1a686502',
  feeGrowthGlobal0: '0xf3058399',
  feeGrowthGlobal1: '0x46141319',
  ticks: '0xf30dba93',          // ticks(int24)
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
} as const;

const rpc = () => process.env.ALCHEMY_BSC?.trim() || 'https://bsc-rpc.publicnode.com';
async function call(to: string, data: string): Promise<string> {
  const r = await fetch(rpc(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    signal: AbortSignal.timeout(30_000) });
  const b = (await r.json()) as { result?: string; error?: { message: string } };
  if (b.error) throw new Error(`eth_call ${to.slice(0, 10)}: ${b.error.message}`);
  return b.result ?? '0x';
}
const W = (h: string, i: number) => BigInt('0x' + h.slice(2 + i * 64, 2 + (i + 1) * 64));
const toSigned = (v: bigint, bits: number) => { const m = 1n << BigInt(bits); return v >= m / 2n ? v - m : v; };
const pad = (v: string | bigint) => (typeof v === 'bigint' ? v.toString(16) : v.replace(/^0x/, '').toLowerCase()).padStart(64, '0');
const padInt = (v: bigint, bits = 24) => (v < 0n ? ((1n << 256n) + v) : v).toString(16).padStart(64, '0');
function decStr(h: string): string {
  if (h.length < 130) return '';
  const len = parseInt(h.slice(66, 130), 16);
  return Buffer.from(h.slice(130, 130 + len * 2), 'hex').toString('utf8');
}

const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;
/** sqrt price at a tick, as X96. */
function sqrtAtTick(tick: number): bigint {
  // 1.0001^(tick/2) * 2^96 — float is ample for a reporting-grade estimate
  return BigInt(Math.floor(Math.pow(1.0001, tick / 2) * 2 ** 96));
}

export interface LpAnalysis {
  tokenId: string; pool: string; fee: number;
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  tickLower: number; tickUpper: number; currentTick: number;
  inRange: boolean; liquidity: string;
  priceCurrent: number; priceLower: number; priceUpper: number;
  amount0: number; amount1: number;
  uncollectedFees0: number; uncollectedFees1: number;
  tokensOwed0: number; tokensOwed1: number;
  rangeWidthPct: number; distanceToEdgePct: number;
  recommendedLower: number; recommendedUpper: number;
  recommendation: string;
  blockNumber: number;
}

export async function analyzeLp(tokenId: bigint): Promise<LpAnalysis> {
  const bnRes = await fetch(rpc(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
  const blockNumber = parseInt(((await bnRes.json()) as any).result, 16);

  const p = await call(PCS.nfpm, SEL.positions + pad(tokenId));
  const token0 = '0x' + p.slice(2 + 2 * 64 + 24, 2 + 3 * 64);
  const token1 = '0x' + p.slice(2 + 3 * 64 + 24, 2 + 4 * 64);
  const fee = Number(W(p, 4));
  const tickLower = Number(toSigned(W(p, 5), 256));
  const tickUpper = Number(toSigned(W(p, 6), 256));
  const liquidity = W(p, 7);
  const feeGrowthInside0Last = W(p, 8);
  const feeGrowthInside1Last = W(p, 9);
  const tokensOwed0 = W(p, 10);
  const tokensOwed1 = W(p, 11);
  if (liquidity === 0n && tokensOwed0 === 0n && tokensOwed1 === 0n) {
    throw new Error(`position ${tokenId} is empty (liquidity 0, nothing owed) — nothing to analyse`);
  }

  const dec0 = Number(W(await call(token0, SEL.decimals), 0));
  const dec1 = Number(W(await call(token1, SEL.decimals), 0));
  const sym0 = decStr(await call(token0, SEL.symbol)) || token0.slice(0, 8);
  const sym1 = decStr(await call(token1, SEL.symbol)) || token1.slice(0, 8);

  const pool = '0x' + (await call(PCS.factory, SEL.getPool + pad(token0) + pad(token1) + fee.toString(16).padStart(64, '0'))).slice(26);
  const slot0 = await call(pool, SEL.slot0);
  const sqrtPriceX96 = W(slot0, 0);
  const currentTick = Number(toSigned(W(slot0, 1), 256));

  const inRange = currentTick >= tickLower && currentTick < tickUpper;

  // price of token0 in token1, decimal-adjusted
  const sp = Number(sqrtPriceX96) / Number(Q96);
  const priceCurrent = sp * sp * 10 ** (dec0 - dec1);
  const priceLower = Math.pow(1.0001, tickLower) * 10 ** (dec0 - dec1);
  const priceUpper = Math.pow(1.0001, tickUpper) * 10 ** (dec0 - dec1);

  // Position composition (Uniswap V3 standard formulas)
  const sA = sqrtAtTick(tickLower), sB = sqrtAtTick(tickUpper);
  const sP = sqrtPriceX96 < sA ? sA : sqrtPriceX96 > sB ? sB : sqrtPriceX96;
  const amt0Raw = liquidity * Q96 * (sB - sP) / (sP * sB || 1n);
  const amt1Raw = liquidity * (sP - sA) / Q96;
  const amount0 = Number(amt0Raw) / 10 ** dec0;
  const amount1 = Number(amt1Raw) / 10 ** dec1;

  // Uncollected fees: feeGrowthInside(now) - feeGrowthInsideLast, scaled by L
  const fgg0 = W(await call(pool, SEL.feeGrowthGlobal0), 0);
  const fgg1 = W(await call(pool, SEL.feeGrowthGlobal1), 0);
  const tl = await call(pool, SEL.ticks + padInt(BigInt(tickLower)));
  const tu = await call(pool, SEL.ticks + padInt(BigInt(tickUpper)));
  const lo0 = W(tl, 2), lo1 = W(tl, 3), up0 = W(tu, 2), up1 = W(tu, 3);
  const below0 = currentTick >= tickLower ? lo0 : fgg0 - lo0;
  const below1 = currentTick >= tickLower ? lo1 : fgg1 - lo1;
  const above0 = currentTick < tickUpper ? up0 : fgg0 - up0;
  const above1 = currentTick < tickUpper ? up1 : fgg1 - up1;
  const inside0 = BigInt.asUintN(256, fgg0 - below0 - above0);
  const inside1 = BigInt.asUintN(256, fgg1 - below1 - above1);
  const owed0 = tokensOwed0 + (liquidity * BigInt.asUintN(256, inside0 - feeGrowthInside0Last)) / Q128;
  const owed1 = tokensOwed1 + (liquidity * BigInt.asUintN(256, inside1 - feeGrowthInside1Last)) / Q128;

  const rangeWidthPct = ((priceUpper - priceLower) / priceCurrent) * 100;
  const distanceToEdgePct = inRange
    ? Math.min((priceCurrent - priceLower) / priceCurrent, (priceUpper - priceCurrent) / priceCurrent) * 100
    : 0;

  // Recommendation: re-centre on the current tick, preserving the existing width.
  const halfWidth = Math.round((tickUpper - tickLower) / 2);
  const spacing = fee === 100 ? 1 : fee === 500 ? 10 : fee === 2500 ? 50 : 200;
  const snap = (t: number) => Math.round(t / spacing) * spacing;
  const recommendedLower = snap(currentTick - halfWidth);
  const recommendedUpper = snap(currentTick + halfWidth);

  let recommendation: string;
  if (!inRange) {
    const side = currentTick < tickLower ? 'below' : 'above';
    recommendation =
      `OUT OF RANGE — price is ${side} the position's band, so it is earning NO fees and sits entirely in ` +
      `${side === 'below' ? sym0 : sym1}. Re-centre to ticks [${recommendedLower}, ${recommendedUpper}] ` +
      `(same width, centred on the current tick ${currentTick}) to resume earning. Re-entering realises the ` +
      `divergence loss already incurred; holding does not recover it while out of range.`;
  } else if (distanceToEdgePct < 5) {
    recommendation =
      `IN RANGE but only ${distanceToEdgePct.toFixed(2)}% from an edge — a small move exits the band and stops ` +
      `fee accrual. The band spans ${rangeWidthPct.toFixed(2)}% of current price. Widen or re-centre to ` +
      `[${recommendedLower}, ${recommendedUpper}] if you cannot monitor closely.`;
  } else {
    recommendation =
      `IN RANGE with ${distanceToEdgePct.toFixed(2)}% headroom to the nearest edge; the band spans ` +
      `${rangeWidthPct.toFixed(2)}% of current price. No action needed. A tighter band would earn more fees ` +
      `per unit of capital but exit range sooner — only worth it if you actively rebalance.`;
  }

  return {
    tokenId: tokenId.toString(), pool, fee,
    token0: { address: token0, symbol: sym0, decimals: dec0 },
    token1: { address: token1, symbol: sym1, decimals: dec1 },
    tickLower, tickUpper, currentTick, inRange, liquidity: liquidity.toString(),
    priceCurrent, priceLower, priceUpper, amount0, amount1,
    uncollectedFees0: Number(owed0) / 10 ** dec0, uncollectedFees1: Number(owed1) / 10 ** dec1,
    tokensOwed0: Number(tokensOwed0) / 10 ** dec0, tokensOwed1: Number(tokensOwed1) / 10 ** dec1,
    rangeWidthPct, distanceToEdgePct, recommendedLower, recommendedUpper, recommendation, blockNumber,
  };
}
