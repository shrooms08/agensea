import process from 'node:process';
process.loadEnvFile(new URL('../../../../.env', import.meta.url).pathname);
const { planGrid } = await import('../grid/analyze.ts');
const WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', USDT='0x55d398326f99059fF775485246999027B3197955';
for (const w of [24, 6]) {
  try {
    const g = await planGrid(WBNB, USDT, 500, 10000, w);
    console.log(`\n${g.pair} ${g.feeTierPct}%  pool ${g.pool.slice(0,12)}  window ${g.windowHours}h samples ${g.samples}`);
    console.log(`  price ${g.currentPrice.toPrecision(8)}  twap ${g.twapPrice.toPrecision(8)}  range seen [${g.observedLowPrice.toPrecision(6)}, ${g.observedHighPrice.toPrecision(6)}]`);
    console.log(`  vol hourly ${g.hourlyVolPct.toFixed(4)}%  annualised ${g.annualisedVolPct.toFixed(1)}%`);
    console.log(`  grid [${g.lowerBound.toPrecision(6)}, ${g.upperBound.toPrecision(6)}] x${g.gridCount} @ ${g.gridSpacingPct.toFixed(3)}%  $${g.capitalPerLevelUsd.toFixed(2)}/level`);
    console.log(`  expected fills/day ${g.expectedFillsPerDay.toFixed(1)}`);
  } catch (e) { console.log(`\nwindow ${w}h -> ${(e as Error).message}`); }
}
