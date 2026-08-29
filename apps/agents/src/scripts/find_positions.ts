/** 3b: locate real mainnet Venus borrowers with varied health factors. */
import process from 'node:process';
import { writeFileSync } from 'node:fs';
import { SCAN_MARKETS, BORROW_TOPIC } from '../venus/addresses.ts';
import { analyze } from '../venus/analyze.ts';
process.loadEnvFile(new URL('../../../../.env', import.meta.url).pathname);

const RPC = 'https://bsc-rpc.publicnode.com'; // serves recent getLogs with an address filter
const WINDOW = 5000, WINDOWS = Number(process.env.SCAN_WINDOWS ?? 8);

async function rpc<T>(m: string, p: unknown[]): Promise<T> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }), signal: AbortSignal.timeout(30_000) });
  const b = (await r.json()) as { result?: T; error?: { message: string } };
  if (b.error) throw new Error(b.error.message);
  return b.result as T;
}

const head = parseInt(await rpc<string>('eth_blockNumber', []), 16);
console.log(`mainnet head ${head}; scanning ${WINDOWS} x ${WINDOW}-block windows across ${SCAN_MARKETS[56].length} markets`);

const found = new Set<string>();
for (let w = 0; w < WINDOWS && found.size < 40; w++) {
  const to = head - w * WINDOW, from = to - WINDOW;
  for (const mkt of SCAN_MARKETS[56]) {
    try {
      const logs = await rpc<{ data: string }[]>('eth_getLogs', [{
        address: mkt, topics: [BORROW_TOPIC],
        fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16),
      }]);
      for (const l of logs) found.add('0x' + l.data.slice(26, 66).toLowerCase());
    } catch { /* window/market unavailable — keep going */ }
  }
  if (w % 2 === 0) process.stdout.write(`  window ${w + 1}/${WINDOWS}: ${found.size} candidates\n`);
}
console.log(`\n${found.size} distinct borrowers found; computing health factors...\n`);

const rows = [];
for (const a of found) {
  try {
    const r = await analyze(56, a);
    if (r.borrowedUsd > 1) rows.push(r);
  } catch (e) { console.log(`  ${a} -> read failed: ${(e as Error).message.slice(0, 60)}`); }
}
rows.sort((x, y) => (x.healthFactor ?? 1e9) - (y.healthFactor ?? 1e9));
console.log('HEALTH FACTOR DISTRIBUTION (real mainnet positions)');
for (const r of rows) {
  console.log(`  HF ${String(r.healthFactor?.toFixed(4)).padStart(10)}  ${r.riskLevel.padEnd(12)} ` +
    `collateral $${r.collateralUsd.toFixed(0).padStart(10)}  borrowed $${r.borrowedUsd.toFixed(0).padStart(10)}  ${r.account}`);
}
writeFileSync('/tmp/positions.json', JSON.stringify(rows, null, 2));
console.log(`\nwrote ${rows.length} positions to /tmp/positions.json`);
