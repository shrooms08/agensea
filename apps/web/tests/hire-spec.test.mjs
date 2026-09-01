/**
 * The hire page claims each agent delivers certain fields. This test asserts
 * every declared key actually exists in that agent's COMMITTED deliverable
 * manifest (data/deliverables.ts) — so the "what the agent delivers" column
 * can never drift into describing output the agent does not produce.
 *
 *   node tests/hire-spec.test.mjs      (run by: npm test)
 */
import { readFileSync } from 'node:fs';

const readTs = (path, marker, endMarker) => {
  const src = readFileSync(path, 'utf8');
  return src.slice(src.indexOf(marker), endMarker ? src.lastIndexOf(endMarker) : undefined);
};

// committed manifests -> { agentId: analysisKeys[] }
const dsrc = readFileSync('data/deliverables.ts', 'utf8');
const deliverables = JSON.parse(dsrc.slice(dsrc.indexOf('= {') + 2, dsrc.lastIndexOf('} as unknown') + 1));
const keysByAgent = new Map();
for (const v of Object.values(deliverables)) {
  const agentId = Number(v.manifest.metadata.agent_id);
  const keys = Object.keys(JSON.parse(v.manifest.response.content));
  keysByAgent.set(agentId, new Set([...(keysByAgent.get(agentId) ?? []), ...keys]));
}

// declared DELIVERS rows, parsed out of the spec without importing TypeScript
const hsrc = readFileSync('data/hire-spec.ts', 'utf8');
const block = hsrc.slice(hsrc.indexOf('export const DELIVERS'), hsrc.indexOf('export const TARGETS'));
const declared = new Map();
for (const m of block.matchAll(/(\d{4}):\s*\[([\s\S]*?)\],\n/g)) {
  declared.set(Number(m[1]), [...m[2].matchAll(/key:\s*'([^']+)'/g)].map((x) => x[1]));
}

let failed = 0;
for (const [agentId, keys] of declared) {
  const real = keysByAgent.get(agentId);
  if (!real) { console.log(`FAIL  agent ${agentId}: no committed manifest to check against`); failed++; continue; }
  const missing = keys.filter((k) => !real.has(k));
  console.log(`${missing.length ? 'FAIL' : 'PASS'}  agent ${agentId}: ${keys.length} declared field(s)` +
    (missing.length ? ` — not in the manifest: ${missing.join(', ')}` : ''));
  if (missing.length) failed++;
}
if (declared.size !== 4) { console.log(`FAIL  expected 4 agents in DELIVERS, parsed ${declared.size}`); failed++; }
process.exit(failed === 0 ? 0 : 1);
