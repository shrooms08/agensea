/**
 * Agent 4 — supply-APR comparison across Venus, Aave V3 and Lista on BSC.
 * All rates are read LIVE on-chain. No cached or documented figures.
 *
 *  Venus  : vToken.supplyRatePerBlock() x interestRateModel.blocksPerYear()
 *           (both read from the contracts; blocksPerYear is 70,080,000, not assumed)
 *  Aave V3: Pool.getReserveData(asset).currentLiquidityRate, a ray already
 *           normalised to an annual rate
 *  Lista  : ERC-4626 share-price growth measured between two archive states,
 *           annualised. Lista exposes no instantaneous rate getter, so this is a
 *           REALISED trailing APR, not a spot rate — labelled as such.
 */
import process from 'node:process';

export const ADDR = {
  venusComptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
  aavePool: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
  btcb: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
  listaBtcVault: '0xe46b8e65006e6450bdd8cb7d3274ab4f76f4c705',
} as const;

const SEL = {
  supplyRatePerBlock: '0xae9d70b0',
  interestRateModel: '0xf3fdb15a',
  blocksPerYear: '0xa385fb96',
  getReserveData: '0x35ea6a75',
  convertToAssets: '0x07a2d13a',
  totalAssets: '0x01e1d114',
} as const;

const rpc = () => process.env.ALCHEMY_BSC?.trim() || 'https://bsc-rpc.publicnode.com';

async function ethCall(to: string, data: string, block: string | number = 'latest'): Promise<string> {
  const tag = typeof block === 'number' ? '0x' + block.toString(16) : block;
  const r = await fetch(rpc(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, tag] }),
    signal: AbortSignal.timeout(30_000) });
  const b = (await r.json()) as { result?: string; error?: { message: string } };
  if (b.error) throw new Error(`eth_call ${to.slice(0, 10)} @${tag}: ${b.error.message}`);
  return b.result ?? '0x';
}
async function blockNumber(): Promise<number> {
  const r = await fetch(rpc(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
  return parseInt(((await r.json()) as any).result, 16);
}
async function blockTimestamp(bn: number): Promise<number> {
  const r = await fetch(rpc(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['0x' + bn.toString(16), false] }) });
  return parseInt(((await r.json()) as any).result.timestamp, 16);
}
const W = (h: string, i: number) => BigInt('0x' + h.slice(2 + i * 64, 2 + (i + 1) * 64));
const pad = (a: string) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');

export interface Venue {
  venue: string;
  asset: string;
  supplyAprPct: number;
  method: string;
  spot: boolean;
  detail: Record<string, string | number>;
}

export async function venusApr(): Promise<Venue> {
  const rate = W(await ethCall(ADDR.vBTC, SEL.supplyRatePerBlock), 0);
  const irm = '0x' + (await ethCall(ADDR.vBTC, SEL.interestRateModel)).slice(26);
  const bpy = W(await ethCall(irm, SEL.blocksPerYear), 0);
  const apr = (Number(rate) / 1e18) * Number(bpy) * 100;
  return { venue: 'Venus', asset: 'BTCB', supplyAprPct: apr, spot: true,
    method: 'supplyRatePerBlock() x interestRateModel.blocksPerYear()',
    detail: { supplyRatePerBlock: rate.toString(), blocksPerYear: bpy.toString(), interestRateModel: irm } };
}

export async function aaveApr(): Promise<Venue> {
  const raw = await ethCall(ADDR.aavePool, SEL.getReserveData + pad(ADDR.btcb));
  const rate = W(raw, 2); // currentLiquidityRate, ray (1e27)
  return { venue: 'Aave V3', asset: 'BTCB', supplyAprPct: (Number(rate) / 1e27) * 100, spot: true,
    method: 'Pool.getReserveData(asset).currentLiquidityRate (ray)',
    detail: { currentLiquidityRate: rate.toString(), ray: '1e27' } };
}

/** Realised trailing APR from ERC-4626 share price across a measured window. */
export async function listaApr(lookbackBlocks = 2_000_000): Promise<Venue> {
  const head = await blockNumber();
  const past = head - lookbackBlocks;
  const ONE = 10n ** 18n;
  const now = W(await ethCall(ADDR.listaBtcVault, SEL.convertToAssets + ONE.toString(16).padStart(64, '0')), 0);
  const then = W(await ethCall(ADDR.listaBtcVault, SEL.convertToAssets + ONE.toString(16).padStart(64, '0'), past), 0);
  const tNow = await blockTimestamp(head), tThen = await blockTimestamp(past);
  const days = (tNow - tThen) / 86400;
  const growth = Number(now - then) / Number(then);
  const apr = days > 0 ? (growth * 365 / days) * 100 : 0;
  return { venue: 'Lista', asset: 'BTCB', supplyAprPct: apr, spot: false,
    method: `ERC-4626 share-price growth over ${lookbackBlocks} blocks, annualised (REALISED, not spot)`,
    detail: { sharePriceNow: now.toString(), sharePriceThen: then.toString(),
      windowDays: days.toFixed(2), fromBlock: past, toBlock: head } };
}

export interface YieldReport {
  asset: string; chainId: number; blockNumber: number;
  venues: Venue[]; best: Venue;
  gasCostToSwitchTBnb: number; gasCostUsd: number;
  breakEvenDays: number | null; positionSizeUsd: number;
  recommendation: string; assumptions: string[];
}

/** Gas to exit one venue and enter another, priced live. */
async function switchGasUsd(bnbPriceUsd: number): Promise<{ tbnb: number; usd: number; gasUnits: number }> {
  const r = await fetch(rpc(), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }) });
  const gasPrice = BigInt(((await r.json()) as any).result);
  // withdraw + approve + deposit, measured-order-of-magnitude for Compound/Aave style calls
  const gasUnits = 450_000n;
  const wei = gasPrice * gasUnits;
  const tbnb = Number(wei) / 1e18;
  return { tbnb, usd: tbnb * bnbPriceUsd, gasUnits: Number(gasUnits) };
}

export async function compareYields(positionSizeUsd = 10_000, bnbPriceUsd = 687): Promise<YieldReport> {
  const bn = await blockNumber();
  const venues = await Promise.all([venusApr(), aaveApr(), listaApr()]);
  venues.sort((a, b) => b.supplyAprPct - a.supplyAprPct);
  const best = venues[0]!;
  const worst = venues[venues.length - 1]!;
  const gas = await switchGasUsd(bnbPriceUsd);
  const deltaPct = best.supplyAprPct - worst.supplyAprPct;
  const annualGainUsd = (deltaPct / 100) * positionSizeUsd;
  const breakEvenDays = annualGainUsd > 0 ? (gas.usd / annualGainUsd) * 365 : null;

  const rec = breakEvenDays === null
    ? `No positive spread between venues, so switching cannot pay for itself. Stay where you are.`
    : breakEvenDays > 365
      ? `${best.venue} leads at ${best.supplyAprPct.toFixed(4)}% vs ${worst.venue} at ${worst.supplyAprPct.toFixed(4)}%, but on $${positionSizeUsd.toLocaleString()} that spread is only $${annualGainUsd.toFixed(2)}/yr against $${gas.usd.toFixed(2)} of gas — break-even ${breakEvenDays.toFixed(0)} days, longer than a year. NOT worth switching.`
      : `Move to ${best.venue} at ${best.supplyAprPct.toFixed(4)}% (from ${worst.venue} at ${worst.supplyAprPct.toFixed(4)}%). On $${positionSizeUsd.toLocaleString()} the spread is $${annualGainUsd.toFixed(2)}/yr against $${gas.usd.toFixed(2)} of gas; break-even in ${breakEvenDays.toFixed(1)} days. Worth it if you hold longer than that.`;

  return {
    asset: 'BTCB', chainId: 56, blockNumber: bn, venues, best,
    gasCostToSwitchTBnb: gas.tbnb, gasCostUsd: gas.usd,
    breakEvenDays, positionSizeUsd, recommendation: rec,
    assumptions: [
      `gas: ${gas.gasUnits} units for withdraw+approve+deposit at the live eth_gasPrice`,
      `BNB priced at $${bnbPriceUsd} for the gas conversion`,
      `Lista's figure is a REALISED trailing APR from share-price growth (no spot-rate getter exists); Venus and Aave are spot rates`,
      `break-even assumes rates hold constant, which they do not`,
    ],
  };
}
