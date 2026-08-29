/**
 * DELTA SWEEP — extend Pass 1 from the stored ceiling to the current head.
 *
 * pass1.ts only resumes a sweep that has not completed; re-running it would
 * restart at id 1 and re-read 301,992 agents. This walks the NEW ids only:
 * stored ceiling_used + 1 .. freshly measured ceiling. Same Multicall3
 * batching, same cursor discipline (advance only after a confirmed write), so
 * an interrupted delta resumes rather than restarting.
 */
import { ethCall, stats, describeError } from './rpc.ts';
import {
  MULTICALL3, SEL, callUint, encodeAggregate3, decodeAggregate3,
  decodeAddress, decodeAddressArray,
} from './multicall.ts';
import { supabase, withRetry } from '../env.ts';
import process from 'node:process';

const IDENTITY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const REPUTATION = '0x8004baa17c55a88189ae136b182e5fda19de9b63';
const SWEEP = 'pass1_liveness';
const BATCH_CALLS = 200;
const SEARCH_HI = 2_000_000;
const log = (s: string) => process.stdout.write(s + '\n');

async function findCeiling(): Promise<[number, number]> {
  let calls = 0;
  const minted = async (id: number) => {
    calls++;
    const r = await ethCall(IDENTITY, '0x' + callUint(SEL.ownerOf, id));
    return !r.error && !!r.result && r.result !== '0x';
  };
  let lo = 1, hi = SEARCH_HI;
  if (await minted(hi)) return [hi, calls];
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await minted(mid)) lo = mid; else hi = mid;
  }
  return [lo, calls];
}

async function main() {
  const db = supabase();
  const t0 = Date.now();
  log('DELTA SWEEP — Pass 1 extension\n');

  const { data: cur } = await withRetry('read cursor', () =>
    db.from('sweep_cursor').select('*').eq('sweep_name', SWEEP).maybeSingle());
  if (!cur) throw new Error('no pass1_liveness cursor — run the full sweep first');

  const prevCeiling = Number(cur.ceiling_used);
  // If a previous delta was interrupted, next_id sits inside the new range.
  const resumeAt = Number(cur.next_id) > prevCeiling ? Number(cur.next_id) : prevCeiling + 1;

  log('  measuring current ceiling...');
  const [ceiling, ceilCalls] = await findCeiling();
  log(`  stored ceiling : ${prevCeiling}`);
  log(`  current ceiling: ${ceiling}  (binary search, ${ceilCalls} eth_calls)`);
  log(`  new ids        : ${Math.max(0, ceiling - prevCeiling)}`);
  log(`  starting at    : ${resumeAt}\n`);

  if (ceiling <= prevCeiling) { log('  nothing new. done.'); return; }

  await withRetry('open cursor', () =>
    db.from('sweep_cursor').update({
      next_id: resumeAt, ceiling_used: ceiling, completed_at: null,
      updated_at: new Date().toISOString(),
    }).eq('sweep_name', SWEEP));

  let id = resumeAt, stored = 0, missing = 0, live = 0, batches = 0;
  while (id <= ceiling) {
    const n = Math.min(BATCH_CALLS / 2, ceiling - id + 1);
    const ids = Array.from({ length: n }, (_, i) => id + i);
    const calls = [
      ...ids.map((x) => ({ target: IDENTITY, allowFailure: true, callData: callUint(SEL.ownerOf, x) })),
      ...ids.map((x) => ({ target: REPUTATION, allowFailure: true, callData: callUint(SEL.getClients, x) })),
    ];
    const res = await ethCall(MULTICALL3, encodeAggregate3(calls));
    if (res.error) throw new Error(`multicall ${res.error.code}: ${res.error.message}`);
    const out = decodeAggregate3(res.result!);
    if (out.length !== calls.length) throw new Error(`decoded ${out.length} != ${calls.length}`);

    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    ids.forEach((x, i) => {
      const o = out[i]!;
      if (!o.success) { missing++; return; }
      const owner = decodeAddress(o.returnData);
      if (!owner) { missing++; return; }
      const c = out[ids.length + i]!;
      const clients = c.success ? decodeAddressArray(c.returnData) : [];
      if (clients.length > 0) live++;
      rows.push({ agent_id: x, owner, client_count: clients.length, clients, checked_at: now });
    });

    if (rows.length) {
      const { error } = await withRetry(`upsert ${id}`, () =>
        db.from('agent_liveness').upsert(rows, { onConflict: 'agent_id' }));
      if (error) throw new Error(`upsert failed at ${id}: ${error.message}`);
      stored += rows.length;
    }
    id += n; batches++;
    await withRetry('advance', () =>
      db.from('sweep_cursor').update({ next_id: id, updated_at: new Date().toISOString() }).eq('sweep_name', SWEEP));
  }

  const [endCeiling] = await findCeiling();
  await withRetry('complete', () =>
    db.from('sweep_cursor').update({
      completed_at: new Date().toISOString(), requests: Number(cur.requests ?? 0) + stats.requests,
      updated_at: new Date().toISOString(),
    }).eq('sweep_name', SWEEP));

  const mins = (Date.now() - t0) / 60000;
  log('\nDELTA COMPLETE');
  log(`  new agents stored      : ${stored}`);
  log(`  of which have clients  : ${live}`);
  log(`  unminted ids skipped   : ${missing}`);
  log(`  batches                : ${batches}`);
  log(`  rpc requests           : ${stats.requests}`);
  log(`  elapsed                : ${mins.toFixed(2)} min`);
  log(`  ceiling drift during   : ${endCeiling - ceiling}`);
}

main().catch((e) => { process.stderr.write(`\nDELTA FAILED: ${describeError(e)}\n`); process.exit(1); });
