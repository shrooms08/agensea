/**
 * Ingest third-party metadata from 8004scan for the agents OUR OWN sweep could
 * not resolve — agents that have at least one client but no usable metadata of
 * their own. Run once; the data is served from our table afterwards.
 *
 * INGEST, NEVER PROXY. The Pro key expires 9 Sep 2026 and judging runs to
 * 23 Sep, so no runtime path may call their API. This script is the only thing
 * that ever talks to them.
 *
 * THE PLACEHOLDER FILTER IS THE POINT. 8004scan never answers "no data": an
 * agent it cannot resolve is returned as a synthesized `Agent #<id>` with an
 * empty description and metadata_completeness_score 0.0. Storing that as
 * recovered metadata would be inventing a finding. We drop those rows here,
 * and 013's CHECK constraint refuses them at the database even if this filter
 * is ever weakened.
 *
 *   npx tsx src/erc8004/enrich_8004scan.ts [--dry-run] [--limit N]
 */
import process from 'node:process';
import { supabase, withRetry } from '../env.ts';

const BASE = 'https://api.8004scan.io/api/v1';
const CHAIN = 56;
const PAGE = 100;                 // their cap; limit=500 silently returns zero
const PACE_MS = 420;              // ~140 req/min, under the observed per-minute ceiling
const SOURCE = '8004scan';
const PLACEHOLDER = /^Agent #\d+$/;

const KEY = process.env.EIGHT004SCAN_KEY?.trim();
if (!KEY) throw new Error('FATAL: EIGHT004SCAN_KEY missing from .env (value is never printed).');

const DRY = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG > -1 ? Number(process.argv[LIMIT_ARG + 1]) : Infinity;

interface ScanAgent {
  name?: string | null;
  description?: string | null;
  supported_protocols?: unknown;
  agent_url?: string | null;
  is_verified?: boolean | null;
  metadata_completeness_score?: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAgent(agentId: number): Promise<{ ok: true; a: ScanAgent } | { ok: false; why: string }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/agents/${CHAIN}/${agentId}`, {
        headers: { 'X-API-Key': KEY!, 'User-Agent': 'agensea-ingest/1.0' },
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 404) return { ok: false, why: 'not-indexed' };
      if (res.status === 429) { await sleep(15_000); continue; }
      if (!res.ok) { if (attempt === 3) return { ok: false, why: `http-${res.status}` }; await sleep(2_000); continue; }
      const body = (await res.json()) as { data?: ScanAgent } & ScanAgent;
      return { ok: true, a: (body.data ?? body) as ScanAgent };
    } catch {
      if (attempt === 3) return { ok: false, why: 'network' };
      await sleep(2_000);
    }
  }
  return { ok: false, why: 'exhausted' };
}

/** The whole point of this script. Returns null for anything we refuse to store. */
export function accept(agentId: number, a: ScanAgent):
  | { name: string; description: string | null; protocols: string[]; agent_url: string | null; is_verified: boolean | null }
  | { reject: 'placeholder' | 'blank' | 'nothing-useful' } {
  const name = (a.name ?? '').trim();
  const description = (a.description ?? '').trim();
  const completeness = Number(a.metadata_completeness_score ?? 0);
  const protocols = Array.isArray(a.supported_protocols)
    ? (a.supported_protocols as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  if (!name) return { reject: 'blank' };
  // Their filler: a synthesized name with nothing behind it.
  if (PLACEHOLDER.test(name) && (description === '' || completeness === 0)) return { reject: 'placeholder' };
  // A name that is only ever their id pattern is refused by the DB anyway.
  if (PLACEHOLDER.test(name)) return { reject: 'placeholder' };
  // A real name with nothing else is still worth having; truly empty is not.
  if (!description && protocols.length === 0 && !a.agent_url && completeness === 0) {
    return { reject: 'nothing-useful' };
  }
  return {
    name,
    description: description || null,
    protocols,
    agent_url: (a.agent_url ?? '') || null,
    is_verified: typeof a.is_verified === 'boolean' ? a.is_verified : null,
  };
}

// ---- target set: agents WE could not resolve --------------------------------
const db = supabase();
const targets: number[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await withRetry('load anonymous agents', () =>
    db.from('agent_liveness_with_clients')
      .select('agent_id,metadata')
      .gt('client_count', 0)
      .range(from, from + 999));
  if (error) throw new Error(`load targets failed: ${error.message}`);
  const rows = (data ?? []) as { agent_id: number; metadata: { name?: unknown } | null }[];
  for (const r of rows) {
    const n = typeof r.metadata?.name === 'string' ? r.metadata.name.trim() : '';
    if (!n) targets.push(r.agent_id);
  }
  if (rows.length < 1000) break;
}
targets.sort((a, b) => a - b);
const work = targets.slice(0, LIMIT === Infinity ? targets.length : LIMIT);
console.log(`8004scan enrichment — ${targets.length} agents with clients but no metadata of their own`);
console.log(`  fetching ${work.length}${DRY ? ' (DRY RUN — nothing will be written)' : ''}\n`);

let accepted = 0, placeholder = 0, blank = 0, nothing = 0, notIndexed = 0, failed = 0;
const batch: Record<string, unknown>[] = [];
const examples: string[] = [];

for (const [i, id] of work.entries()) {
  const r = await fetchAgent(id);
  if (!r.ok) { r.why === 'not-indexed' ? notIndexed++ : failed++; }
  else {
    const v = accept(id, r.a);
    if ('reject' in v) {
      if (v.reject === 'placeholder') placeholder++;
      else if (v.reject === 'blank') blank++;
      else nothing++;
    } else {
      accepted++;
      if (examples.length < 6) examples.push(`${id}=${v.name.slice(0, 28)}`);
      batch.push({ agent_id: id, ...v, source: SOURCE, ingested_at: new Date().toISOString() });
    }
  }
  if (batch.length >= 200 && !DRY) {
    const { error } = await withRetry('upsert enrichment', () =>
      db.from('agent_enrichment').upsert(batch, { onConflict: 'agent_id' }));
    if (error) throw new Error(`upsert failed: ${error.message}`);
    batch.length = 0;
  }
  if ((i + 1) % 100 === 0) {
    console.log(`  ${i + 1}/${work.length}  accepted ${accepted}  placeholder ${placeholder}  other-reject ${blank + nothing}  miss ${notIndexed + failed}`);
  }
  await sleep(PACE_MS);
}
if (batch.length && !DRY) {
  const { error } = await withRetry('upsert enrichment (final)', () =>
    db.from('agent_enrichment').upsert(batch, { onConflict: 'agent_id' }));
  if (error) throw new Error(`upsert failed: ${error.message}`);
}

console.log(`\n8004SCAN ENRICHMENT COMPLETE${DRY ? ' (dry run)' : ''}`);
console.log(`  agents attempted           : ${work.length}`);
console.log(`  ACCEPTED and stored        : ${accepted}`);
console.log(`  REJECTED as placeholder    : ${placeholder}   ("Agent #<id>" with nothing behind it)`);
console.log(`  rejected, blank name       : ${blank}`);
console.log(`  rejected, nothing useful   : ${nothing}`);
console.log(`  not indexed by them        : ${notIndexed}`);
console.log(`  request failures           : ${failed}`);
if (examples.length) console.log(`  examples recovered         : ${examples.join(', ')}`);
