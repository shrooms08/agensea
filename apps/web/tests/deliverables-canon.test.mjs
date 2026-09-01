/**
 * Every published deliverable must reproduce its recorded hash under the
 * canonicalisation it declares — and NOT under the other one where the two
 * differ. Offline: hashes come from data/deliverables.ts, each of which was
 * checked against the chain when it was committed.
 *
 *   node tests/deliverables-canon.test.mjs      (or: npm test)
 *
 * This exists because lib/verify.ts implemented one rule and asserted it served
 * every deliverable. It did — for the five published at the time. Jobs 795 and
 * 796 use the other rule, and publishing them under the old assumption would
 * have rendered a FALSE MISMATCH, which is the one failure mode the VERIFY
 * block exists to prevent.
 */
import { keccak256, stringToHex } from 'viem';
import { readFileSync } from 'node:fs';

// data/deliverables.ts is a JSON object literal behind a cast; pull it out
// rather than importing TypeScript from a plain .mjs test.
const src = readFileSync(new URL('../data/deliverables.ts', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('= {') + 2, src.lastIndexOf('} as unknown as') + 1);
// TS allows a trailing comma before the closing brace; JSON does not.
const DELIVERABLES = JSON.parse(body.replace(/,(\s*[}\]])/g, '$1'));

const sortStringify = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(sortStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + sortStringify(v[k])).join(',') + '}';
};
const escapeNonAscii = (s) => {
  let out = '';
  for (const ch of s) {
    if (ch.codePointAt(0) < 0x80) { out += ch; continue; }
    for (let i = 0; i < ch.length; i++) out += '\\u' + ch.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return out;
};
const hash = (m, canon) => {
  const json = sortStringify(m);
  return keccak256(stringToHex(canon === 'escaped' ? escapeNonAscii(json) : json));
};

let failed = 0;
const ids = Object.keys(DELIVERABLES).sort((a, b) => Number(a) - Number(b));
if (ids.length === 0) { console.log('FAIL  no deliverables parsed'); process.exit(1); }

for (const id of ids) {
  const d = DELIVERABLES[id];
  if (d.canon !== 'raw' && d.canon !== 'escaped') {
    console.log(`FAIL  job ${id}: canon is ${JSON.stringify(d.canon)}, expected 'raw' or 'escaped'`);
    failed++; continue;
  }
  const declared = hash(d.manifest, d.canon);
  const other = hash(d.manifest, d.canon === 'raw' ? 'escaped' : 'raw');
  const ok = declared.toLowerCase() === d.hash.toLowerCase();
  const ascii = declared.toLowerCase() === other.toLowerCase();
  if (!ok) {
    console.log(`FAIL  job ${id} (${d.canon})\n      got      ${declared}\n      recorded ${d.hash}`);
    failed++; continue;
  }
  // Where the manifest has non-ASCII, the OTHER rule must not also reproduce it;
  // that is what makes the per-job label load-bearing rather than decorative.
  console.log(`PASS  job ${id} reproduces under '${d.canon}'${ascii ? ' (pure ASCII — both rules agree)' : ' only'}`);
}

console.log(failed ? `\n${failed} deliverable(s) FAILED` : `\nall ${ids.length} deliverables verified`);
process.exit(failed ? 1 : 0);
