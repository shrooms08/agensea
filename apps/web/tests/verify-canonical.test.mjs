/**
 * Byte-exact canonicalisation regression test — the CLIENT verify algorithm
 * (WalletHire's in-browser recompute) against known-good hashes. This exact
 * comparison has caught three canonicalisation errors; run it whenever either
 * side of the hashing changes.
 *
 *   node tests/verify-canonical.test.mjs      (or: npm test)
 *
 * Fixture 1: job 840's real manifest vs its ON-CHAIN deliverable hash.
 * Fixture 2: synthetic non-ASCII manifest (em dash, pi, surrogate-pair emoji)
 *            vs the hash produced by apps/agents' manifestHash — the
 *            authoritative server implementation.
 */
import { keccak256, stringToHex } from 'viem';

// —— the client algorithm, verbatim from components/WalletHire.tsx ——
const sortStringify = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(sortStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + sortStringify(v[k])).join(',') + '}';
};
const clientHash = (manifest) => {
  let canon = '';
  for (const ch of sortStringify(manifest)) {
    if (ch.codePointAt(0) < 0x80) { canon += ch; continue; }
    for (let i = 0; i < ch.length; i++) canon += '\\u' + ch.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return keccak256(stringToHex(canon));
};

const CASES = [
  { name: 'job 840 manifest vs on-chain deliverable',
    manifest: {"job_id": 840, "version": 1, "chain_id": 97, "metadata": {"agent_id": 2012, "wallet_hire": true, "analysed_chain": 56}, "response": {"content": "{\"account\":\"0xb76b35db3f2a7d8346013d9b02edbf756cf27c72\",\"chainId\":56,\"chainLabel\":\"BNB Smart Chain mainnet\",\"blockNumber\":119220679,\"healthFactor\":3.4671,\"riskLevel\":\"HEALTHY\",\"collateralUsd\":28727.768133,\"weightedCollateralUsd\":22333.182042,\"borrowPowerUsd\":20690.554999,\"borrowedUsd\":6441.427815,\"avgLiquidationThreshold\":0.777407487368148,\"priceDropToLiquidation\":0.711574514724121,\"recommendation\":\"Health factor is 3.4671, a comfortable buffer \u2014 collateral would have to fall 71.2% before liquidation. No action needed; re-check if you borrow more or markets move sharply.\",\"markets\":[{\"symbol\":\"vBNB\",\"supplyUsd\":8317.535153,\"borrowUsd\":0,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8},{\"symbol\":\"vBTC\",\"supplyUsd\":13911.358465,\"borrowUsd\":0,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8},{\"symbol\":\"vADA\",\"supplyUsd\":1067.308344,\"borrowUsd\":0,\"collateralFactor\":0,\"liquidationThreshold\":0.63},{\"symbol\":\"vDOT\",\"supplyUsd\":51.596797,\"borrowUsd\":0,\"collateralFactor\":0,\"liquidationThreshold\":0},{\"symbol\":\"vUSDT\",\"supplyUsd\":0.002214,\"borrowUsd\":6441.427815,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8},{\"symbol\":\"vLINK\",\"supplyUsd\":1218.846887,\"borrowUsd\":0,\"collateralFactor\":0,\"liquidationThreshold\":0.63},{\"symbol\":\"vXRP\",\"supplyUsd\":566.890086,\"borrowUsd\":0,\"collateralFactor\":0.5,\"liquidationThreshold\":0.65},{\"symbol\":\"vSOL\",\"supplyUsd\":1675.939044,\"borrowUsd\":0,\"collateralFactor\":0.65,\"liquidationThreshold\":0.72},{\"symbol\":\"vETH\",\"supplyUsd\":1918.291137,\"borrowUsd\":0,\"collateralFactor\":0.8,\"liquidationThreshold\":0.8}]}", "content_type": "application/json"}, "contracts": {"policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA", "router": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25", "commerce": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE"}},
    expected: '0x659c3ed29e4efa345f3bb425406222ff7cb614537f5ae4958ca6c414470f1b1c' },
  { name: 'synthetic non-ASCII manifest vs server manifestHash',
    manifest: { version: 1, job_id: 1, chain_id: 97, contracts: { commerce: '0x0', router: '0x0', policy: '0x0' },
      response: { content: 'em dash — and π and 🐟', content_type: 'text/plain' }, metadata: { note: 'non-ascii fixture' } },
    expected: '0x45b17405089e3e8c4441707cb8add10a0f15d26bd339d3d37a716c33ea1b3203' },
];

let failed = 0;
for (const c of CASES) {
  const got = clientHash(c.manifest);
  const ok = got.toLowerCase() === c.expected.toLowerCase();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `\n      got      ${got}\n      expected ${c.expected}`}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
