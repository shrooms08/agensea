/**
 * Agent 3 — grid-trading parameter recommendation.
 *
 * Volatility is measured from the pool's OWN TWAP oracle (observe()), not from a
 * price API. Liquidity and depth come from the pool contract. Every number is
 * on-chain; the data window is stated explicitly and no backtest is claimed.
 */
import process from 'node:process';

const SEL = {
  getPool: '0x1698ee82', slot0: '0x3850c7bd', liquidity: '0x1a686502',
  observe: '0x883bdbfd', symbol: '0x95d89b41', decimals: '0x313ce567',
} as const;
export const FACTORY = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';

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
const signed = (v: bigint, bits: number) => { const m = 1n << BigInt(bits); return v >= m / 2n ? v - m : v; };
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
function decStr(h: string): string {
  if (h.length < 130) return '';
  const len = parseInt(h.slice(66, 130), 16);
  return Buffer.from(h.slice(130, 130 + len * 2), 'hex').toString('utf8');
}

export interface GridPlan {
  pool: string; pair: string; feeTierPct: number;
  blockNumber: number;
  windowHours: number; samples: number;
  currentPrice: number; twapPrice: number;
  hourlyVolPct: number; annualisedVolPct: number;
  observedLowPrice: number; observedHighPrice: number;
  poolLiquidity: string;
  lowerBound: number; upperBound: number; gridCount: number;
  capitalPerLevelUsd: number; gridSpacingPct: number;
  expectedFillsPerDay: number;
  recommendation: string;
  assumptions: string[];
  dataWindow: string;
}

export async function planGrid(
  token0: string, token1: string, fee: number, capitalUsd = 10_000, windowHours = 24,
): Promise<GridPlan> {
  const requestedHours = windowHours;
  const bnRes = await fetch(rpc(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
  const blockNumber = parseInt(((await bnRes.json()) as any).result, 16);

  const pool = '0x' + (await call(FACTORY, SEL.getPool + pad(token0) + pad(token1) + fee.toString(16).padStart(64, '0'))).slice(26);
  if (/^0x0+$/.test(pool)) throw new Error(`no PancakeSwap V3 pool for ${token0}/${token1} at fee ${fee}`);

  // The pool sorts tokens by address, so token0/token1 as passed by the caller
  // may be reversed. Price is always token1-per-token0 in the POOL's ordering.
  const t0 = '0x' + (await call(pool, '0x0dfe1681')).slice(26); // token0()
  const t1 = '0x' + (await call(pool, '0xd21220a7')).slice(26); // token1()
  const dec0 = Number(W(await call(t0, SEL.decimals), 0));
  const dec1 = Number(W(await call(t1, SEL.decimals), 0));
  const sym0 = decStr(await call(t0, SEL.symbol)), sym1 = decStr(await call(t1, SEL.symbol));
  const slot0 = await call(pool, SEL.slot0);
  const currentTick = Number(signed(W(slot0, 1), 256));
  const poolLiquidity = W(await call(pool, SEL.liquidity), 0);
  const tickToPrice = (t: number) => Math.pow(1.0001, t) * 10 ** (dec0 - dec1);
  const currentPrice = tickToPrice(currentTick);

  // --- TWAP series from the pool's own oracle -------------------------------
  // The oracle ring buffer only retains so much history, and a busier pool
  // consumes it faster (measured: 12-16h on the WBNB/USDT 0.05% pool, 4-8h on
  // the 0.01% pool despite a LARGER cardinality). Probe the real limit rather
  // than assume 24h, and report the window actually used.
  const canObserve = async (secondsAgo: number): Promise<boolean> => {
    try {
      await call(pool, SEL.observe + (32).toString(16).padStart(64, '0') + (1).toString(16).padStart(64, '0')
        + secondsAgo.toString(16).padStart(64, '0'));
      return true;
    } catch { return false; }
  };
  let lo = 1, hi = windowHours;
  if (!(await canObserve(hi * 3600))) {
    if (!(await canObserve(lo * 3600))) throw new Error(`pool oracle retains less than 1h of history — cannot measure volatility`);
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await canObserve(mid * 3600)) lo = mid; else hi = mid; }
    windowHours = lo;
  }
  const step = 3600;
  const agos: number[] = [];
  for (let i = windowHours; i >= 0; i--) agos.push(i * step);
  // NB: no 0x prefix here — this is appended to the selector, not a standalone hex string.
  const head = (32).toString(16).padStart(64, '0') + agos.length.toString(16).padStart(64, '0')
    + agos.map((a) => a.toString(16).padStart(64, '0')).join('');
  let observed: string;
  try { observed = await call(pool, SEL.observe + head); }
  catch (e) { throw new Error(`pool.observe failed over ${windowHours}h — the oracle may not retain that far: ${(e as Error).message}`); }

  // observe() returns TWO dynamic arrays: (int56[] tickCumulatives,
  // uint160[] secondsPerLiquidityCumulativeX128s). Word 0 is the offset to the
  // FIRST array; word 1 is the offset to the SECOND. Reading word 1 as a length
  // (0xa0 = 160) walks off the end of the buffer.
  const arr0Word = Number(W(observed, 0)) / 32;
  const n = Number(W(observed, arr0Word));
  const cums: bigint[] = [];
  for (let i = 0; i < n; i++) cums.push(signed(W(observed, arr0Word + 1 + i), 56));
  if (cums.length < 3) throw new Error('oracle returned too few observations to measure volatility');

  const twapTicks: number[] = [];
  for (let i = 1; i < cums.length; i++) twapTicks.push(Number(cums[i]! - cums[i - 1]!) / step);

  const LN = Math.log(1.0001);
  const rets = twapTicks.slice(1).map((t, i) => (t - twapTicks[i]!) * LN);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const hourlyVol = Math.sqrt(varr);
  const annualisedVol = hourlyVol * Math.sqrt(24 * 365);

  const prices = twapTicks.map(tickToPrice);
  const observedLowPrice = Math.min(...prices), observedHighPrice = Math.max(...prices);
  const twapPrice = tickToPrice(twapTicks[twapTicks.length - 1]!);

  // --- grid parameters -------------------------------------------------------
  // Bound at +/- 2 sigma over the window: covers ~95% of moves if returns were
  // normal. They are not, so this is a heuristic, stated as one.
  const windowVol = hourlyVol * Math.sqrt(windowHours);
  const lowerBound = currentPrice * Math.exp(-2 * windowVol);
  const upperBound = currentPrice * Math.exp(2 * windowVol);
  // Space grids one hourly sigma apart so a typical hour crosses about one level.
  const gridSpacingPct = Math.max(0.05, hourlyVol * 100);
  const gridCount = Math.max(3, Math.min(50, Math.round(Math.log(upperBound / lowerBound) / (gridSpacingPct / 100))));
  const capitalPerLevelUsd = capitalUsd / gridCount;
  // A level fills when price traverses its spacing; expected crossings/day scale
  // with realised vol over the day divided by spacing.
  const expectedFillsPerDay = (hourlyVol * Math.sqrt(24)) / (gridSpacingPct / 100);

  const recommendation =
    `Over the last ${windowHours}h the ${sym0}/${sym1} ${fee / 10000}% pool realised ${(hourlyVol * 100).toFixed(4)}% hourly ` +
    `volatility (${(annualisedVol * 100).toFixed(1)}% annualised), trading between ${observedLowPrice.toPrecision(6)} and ` +
    `${observedHighPrice.toPrecision(6)}. A grid from ${lowerBound.toPrecision(6)} to ${upperBound.toPrecision(6)} ` +
    `(+/-2 sigma) with ${gridCount} levels spaced ${gridSpacingPct.toFixed(3)}% apart puts $${capitalPerLevelUsd.toFixed(2)} at each level. ` +
    `At the measured volatility that is roughly ${expectedFillsPerDay.toFixed(1)} level-crossings per day. ` +
    `Grid trading loses money in a sustained trend — if price leaves the band you hold the losing side, so treat the ` +
    `bounds as a stop, not a suggestion.`;

  return {
    pool, pair: `${sym0}/${sym1}`, feeTierPct: fee / 10000, blockNumber,
    windowHours, samples: twapTicks.length, currentPrice, twapPrice,
    hourlyVolPct: hourlyVol * 100, annualisedVolPct: annualisedVol * 100,
    observedLowPrice, observedHighPrice, poolLiquidity: poolLiquidity.toString(),
    lowerBound, upperBound, gridCount, capitalPerLevelUsd, gridSpacingPct, expectedFillsPerDay,
    recommendation,
    dataWindow: `${windowHours}h of hourly TWAPs from pool.observe() (${requestedHours}h requested; oracle retained ${windowHours}h), ${twapTicks.length} samples, ending at block ${blockNumber}`,
    assumptions: [
      `volatility is REALISED over the stated window only — it is not a forecast`,
      `bounds are +/-2 sigma assuming log-normal returns; crypto returns are fat-tailed, so breaches are more likely than 5%`,
      `expected fills are a crossings estimate from realised vol / grid spacing, NOT a backtest — no historical fill simulation was run`,
      `capital per level is a naive equal split; no inventory or fee modelling`,
      `pool fee tier ${fee / 10000}% is charged per fill and is not netted out of the estimate`,
    ],
  };
}
