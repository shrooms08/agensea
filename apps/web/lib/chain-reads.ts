/**
 * Server-side mainnet reads for the category pages — the same reads the agents
 * perform, cached under the site's ISR discipline (24h + on-demand revalidate;
 * the 6-hourly keepalive's revalidate call keeps them fresher in practice).
 *
 * RPC: ALCHEMY_BSC when configured (needed for the one archival read — Lista's
 * realised APR), falling back to a public endpoint for spot reads. Every
 * function returns null on ANY failure; pages render "data temporarily
 * unavailable" for null — never a crash, never an invented number.
 *
 * All selectors computed with `cast sig`, never recalled:
 *   supplyRatePerBlock() 0xae9d70b0 · borrowRatePerBlock() 0xf8f9da28
 *   interestRateModel()  0xf3fdb15a · blocksPerYear()      0xa385fb96
 *   slot0()              0x3850c7bd · positions(uint256)   0x99fbab88
 *   observe(uint32[])    0x883bdbfd · getReserveData(addr) 0x35ea6a75
 *   convertToAssets(u)   0x07a2d13a
 */

const PUBLIC_RPC = 'https://bsc-rpc.publicnode.com';
const rpcUrl = () => process.env.ALCHEMY_BSC?.trim() || PUBLIC_RPC;

const pad = (h: string | number | bigint) => BigInt(h).toString(16).padStart(64, '0');
const padAddr = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');

async function ethCall(to: string, data: string, block: string = 'latest'): Promise<string | null> {
  try {
    const res = await fetch(rpcUrl(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, block] }),
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const b = (await res.json()) as { result?: string; error?: unknown };
    return b.error || typeof b.result !== 'string' ? null : b.result;
  } catch { return null; }
}

async function blockNumber(): Promise<number | null> {
  try {
    const res = await fetch(rpcUrl(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(12_000), next: { revalidate: 86400 },
    });
    const b = (await res.json()) as { result?: string };
    return b.result ? parseInt(b.result, 16) : null;
  } catch { return null; }
}

const num = (hex: string | null, at = 0): bigint | null =>
  hex && hex.length >= 2 + (at + 1) * 64 ? BigInt('0x' + hex.slice(2 + at * 64, 2 + (at + 1) * 64)) : null;

export interface Stamp { readAt: string }
const stamp = (): Stamp => ({ readAt: new Date().toISOString() });

/* ------------------------------------------------------------------ health */
const VENUS_MARKETS = [
  { symbol: 'BTCB', vToken: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B' },
  { symbol: 'BNB',  vToken: '0xA07c5b74C9B40447a954e1466938b865b6BBea36' },
  { symbol: 'ETH',  vToken: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8' },
  { symbol: 'USDT', vToken: '0xfD5840Cd36d94D7229439859C0112a4185BC0255' },
];

export async function readVenusRates() {
  // blocksPerYear from the first market's IRM — it is chain cadence, shared.
  const irm = num(await ethCall(VENUS_MARKETS[0]!.vToken, '0xf3fdb15a'));
  if (irm === null) return null;
  const bpy = num(await ethCall('0x' + irm.toString(16).padStart(40, '0'), '0xa385fb96'));
  if (bpy === null) return null;
  const rows: { symbol: string; supplyAprPct: number; borrowAprPct: number }[] = [];
  for (const m of VENUS_MARKETS) {
    const s = num(await ethCall(m.vToken, '0xae9d70b0'));
    const b = num(await ethCall(m.vToken, '0xf8f9da28'));
    if (s === null || b === null) return null;
    rows.push({
      symbol: m.symbol,
      supplyAprPct: (Number(s) / 1e18) * Number(bpy) * 100,
      borrowAprPct: (Number(b) / 1e18) * Number(bpy) * 100,
    });
  }
  return { rows, blocksPerYear: Number(bpy), ...stamp() };
}

/* -------------------------------------------------------------- rebalancing */
const REF_POOL = '0x7e58f160b5b77b8b24cd9900c09a3e730215ac47'; // ASTER/USDT 0.05%
const REF_POSITION = { tokenId: 6801109, tickLower: 47100, tickUpper: 48040 };

export async function readRefPool() {
  const s0 = await ethCall(REF_POOL, '0x3850c7bd');
  if (!s0) return null;
  const sqrtX96 = num(s0, 0)!;
  let tick = Number(num(s0, 1)!);
  if (tick > 2 ** 23) tick -= 2 ** 24; // int24 sign
  const price = (Number(sqrtX96) / 2 ** 96) ** 2; // both tokens 18 decimals
  const inRange = tick >= REF_POSITION.tickLower && tick <= REF_POSITION.tickUpper;
  return { pool: REF_POOL, pair: 'ASTER/USDT', feePct: 0.05, tick, price,
           position: REF_POSITION, inRange, ...stamp() };
}

/* ------------------------------------------------------------- grid-trading */
const GRID_POOL = '0x36696169c63e42cd08ce11f5deebbcebae652050'; // USDT/WBNB 0.05%

/**
 * eth_call that surfaces the failure instead of swallowing it, so a caller
 * can tell an oracle "OLD" revert (window too long) from a dead RPC.
 */
async function ethCallOrError(to: string, data: string): Promise<{ result: string } | { error: string }> {
  try {
    const res = await fetch(rpcUrl(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return { error: `http ${res.status}` };
    const b = (await res.json()) as { result?: string; error?: { message?: string; data?: string } };
    if (b.error) return { error: `${b.error.message ?? 'error'} ${b.error.data ?? ''}`.trim() };
    return typeof b.result === 'string' ? { result: b.result } : { error: 'no result' };
  } catch (e) { return { error: String((e as Error)?.message ?? e) }; }
}

// Uniswap-style oracles revert with Error("OLD") when a secondsAgo predates
// the oldest retained observation. "OLD" = 0x4f4c44 inside the revert data.
const isOldRevert = (err: string) => /\bOLD\b/.test(err) || /4f4c44/i.test(err);

/** Rungs tried in order; the first the oracle can serve wins. A rung below 3h
 *  cannot yield a volatility figure (fewer than two hourly returns has no
 *  dispersion and would print 0.000%), so 1h renders unavailable, honestly. */
const VOL_LADDER_HOURS = [15, 12, 9, 6, 3, 1] as const;

export async function readRealisedVol() {
  // Hourly TWAPs from the pool's own oracle, one observe() call per rung. The
  // pool's observation ring (cardinality 900, one write per swap-block) often
  // covers less than 15h, and observe() then reverts OLD; step down to the
  // longest window it actually retains and LABEL that window — never imply 15h.
  for (const hours of VOL_LADDER_HOURS) {
    const agos: number[] = [];
    for (let i = hours; i >= 0; i--) agos.push(i * 3600);
    const head = '0x883bdbfd' + pad(32) + pad(agos.length) + agos.map((a) => pad(a)).join('');
    const r = await ethCallOrError(GRID_POOL, head);
    if ('error' in r) {
      console.info(`[realised-vol] rung ${hours}h failed: ${isOldRevert(r.error) ? 'OLD (oracle does not retain that far)' : r.error.slice(0, 80)}`);
      continue;
    }
    // returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)
    const h = r.result.slice(2);
    const arr1At = Number(BigInt('0x' + h.slice(0, 64))) / 32;
    const len = Number(BigInt('0x' + h.slice(arr1At * 64, arr1At * 64 + 64)));
    const cums: bigint[] = [];
    for (let i = 0; i < len; i++) {
      let v = BigInt('0x' + h.slice((arr1At + 1 + i) * 64, (arr1At + 2 + i) * 64));
      if (v >= 1n << 255n) v -= 1n << 256n;
      cums.push(v);
    }
    const twapTicks: number[] = [];
    for (let i = 1; i < cums.length; i++) twapTicks.push(Number(cums[i]! - cums[i - 1]!) / 3600);
    const rets: number[] = [];
    for (let i = 1; i < twapTicks.length; i++) rets.push((twapTicks[i]! - twapTicks[i - 1]!) * Math.log(1.0001));
    if (rets.length < 2) {
      console.info(`[realised-vol] rung ${hours}h served but has ${rets.length} hourly return(s) — no dispersion, rendering unavailable`);
      return null;
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    const hourlyVolPct = Math.sqrt(varr) * 100;
    const windowHours = twapTicks.length; // the span of hourly TWAPs actually used
    console.info(`[realised-vol] rung ${hours}h succeeded (${hours === VOL_LADDER_HOURS[0] ? 'top rung' : 'stepped down'}); window ${windowHours}h, ${rets.length} returns`);
    return { pool: GRID_POOL, pair: 'USDT/WBNB', feePct: 0.05, windowHours, requestedHours: VOL_LADDER_HOURS[0],
             hourlyVolPct, annualisedVolPct: hourlyVolPct * Math.sqrt(24 * 365), ...stamp() };
  }
  console.info('[realised-vol] every rung failed — unavailable');
  return null;
}

/* ------------------------------------------------------------------- yield */
const BTCB = '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c';
const AAVE_POOL = '0x6807dc923806fE8Fd134338EABCA509979a7e0cB';
const LISTA_VAULT = '0xe46b8e65006e6450bdd8cb7d3274ab4f76f4c705';

export async function readYieldRoutes() {
  const venusRates = await readVenusRates();
  const venus = venusRates?.rows.find((r) => r.symbol === 'BTCB')?.supplyAprPct ?? null;

  const aaveRaw = await ethCall(AAVE_POOL, '0x35ea6a75' + padAddr(BTCB));
  const aave = aaveRaw ? (Number(num(aaveRaw, 2)!) / 1e27) * 100 : null;

  // Lista realised APR needs an ARCHIVAL read (~2M blocks back). Alchemy serves
  // it; a public RPC will not — in that case the row renders unavailable
  // rather than substituting a made-up figure.
  let lista: { aprPct: number; windowDays: number } | null = null;
  const head = await blockNumber();
  if (head) {
    const nowH = await ethCall(LISTA_VAULT, '0x07a2d13a' + pad(10n ** 18n));
    const thenH = await ethCall(LISTA_VAULT, '0x07a2d13a' + pad(10n ** 18n), '0x' + (head - 2_000_000).toString(16));
    const nowV = num(nowH), thenV = num(thenH);
    if (nowV && thenV && thenV > 0n) {
      const windowDays = (2_000_000 * 0.45) / 86400; // measured ~0.45s blocks
      const growth = Number(nowV - thenV) / Number(thenV);
      lista = { aprPct: (growth * 365 / windowDays) * 100, windowDays };
    }
  }
  return { venus, aave, lista, ...stamp() };
}
