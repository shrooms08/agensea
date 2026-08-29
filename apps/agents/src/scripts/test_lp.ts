import process from 'node:process';
process.loadEnvFile(new URL('../../../../.env', import.meta.url).pathname);
const { analyzeLp } = await import('../pancake/lp.ts');
for (const id of [7277254n, 6801109n, 7189562n]) {
  try {
    const r = await analyzeLp(id);
    console.log(`\n#${r.tokenId} ${r.token0.symbol}/${r.token1.symbol} fee ${r.fee/10000}% pool ${r.pool.slice(0,10)}`);
    console.log(`  ticks [${r.tickLower}, ${r.tickUpper}] current ${r.currentTick} -> ${r.inRange ? 'IN RANGE' : 'OUT OF RANGE'}`);
    console.log(`  price ${r.priceCurrent.toPrecision(8)} range [${r.priceLower.toPrecision(8)}, ${r.priceUpper.toPrecision(8)}]`);
    console.log(`  amounts ${r.amount0.toPrecision(6)} ${r.token0.symbol} + ${r.amount1.toPrecision(6)} ${r.token1.symbol}`);
    console.log(`  uncollected fees ${r.uncollectedFees0.toPrecision(6)} / ${r.uncollectedFees1.toPrecision(6)}`);
    console.log(`  width ${r.rangeWidthPct.toFixed(2)}%  edge distance ${r.distanceToEdgePct.toFixed(2)}%`);
    console.log(`  rec: ${r.recommendation.slice(0,150)}`);
  } catch (e) { console.log(`\n#${id} -> ${(e as Error).message}`); }
}
