// PHASE 1b PASS 1 - liveness sweep.
// For every agentId in 1..ceiling: ownerOf + getClients, batched via Multicall3.
// eth_call only; this file contains no eth_getLogs.
//
// Resumable: the cursor in sweep_cursor advances ONLY after the DB write for
// that batch is confirmed, so an interrupted run never skips agents.
import { ethCall, stats, describeError, blockNumber } from './rpc.ts';
import {
  MULTICALL3, SEL, callUint, encodeAggregate3, decodeAggregate3,
  decodeAddress, decodeAddressArray,
} from './multicall.ts';
import { supabase, withRetry } from '../env.ts';
import process from 'node:process';

const IDENTITY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const REPUTATION = '0x8004baa17c55a88189ae136b182e5fda19de9b63';
const SWEEP = 'pass1_liveness';

let BATCH_CALLS = 200;      // calls per multicall; 2 calls per agent
const MIN_BATCH_CALLS = 20;
const SEARCH_HI = 2_000_000;

const log = (s: string) => process.stdout.write(s + '\n');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Highest minted agentId, by binary search on ownerOf. Returns [ceiling, calls]. */
async function findCeiling(): Promise<[number, number]> {
  let calls = 0;
  const minted = async (id: number): Promise<boolean> => {
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

interface Row {
  agent_id: number;
  owner: string | null;
  client_count: number;
  clients: string[];
  checked_at: string;
}

/** One batched read of `count` agents starting at `startId`. */
async function readBatch(startId: number, count: number): Promise<{ rows: Row[]; missing: number; clientErrors: number }> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(startId + i);

  const calls = [
    ...ids.map((id) => ({ target: IDENTITY, allowFailure: true, callData: callUint(SEL.ownerOf, id) })),
    ...ids.map((id) => ({ target: REPUTATION, allowFailure: true, callData: callUint(SEL.getClients, id) })),
  ];

  const res = await ethCall(MULTICALL3, encodeAggregate3(calls));
  if (res.error) throw new Error(`multicall error ${res.error.code}: ${res.error.message}`);
  if (!res.result) throw new Error('multicall returned no result');
  const out = decodeAggregate3(res.result);
  if (out.length !== calls.length) {
    throw new Error(`decoded ${out.length} results for ${calls.length} calls`);
  }

  const now = new Date().toISOString();
  const rows: Row[] = [];
  let missing = 0, clientErrors = 0;

  ids.forEach((id, i) => {
    const ownerRes = out[i]!;
    if (!ownerRes.success) { missing++; return; }   // unminted id: not an agent
    const owner = decodeAddress(ownerRes.returnData);
    if (!owner) { missing++; return; }

    const clientRes = out[ids.length + i]!;
    let clients: string[] = [];
    if (clientRes.success) clients = decodeAddressArray(clientRes.returnData);
    else clientErrors++;

    rows.push({ agent_id: id, owner, client_count: clients.length, clients, checked_at: now });
  });

  return { rows, missing, clientErrors };
}

async function main(): Promise<void> {
  const db = supabase();
  const t0 = Date.now();

  log('PHASE 1b PASS 1 - liveness sweep (ownerOf + getClients, Multicall3)');
  log('');

  // --- resume or start ------------------------------------------------------
  const { data: cur, error: curErr } = await withRetry('read cursor', () =>
    db.from('sweep_cursor').select('*').eq('sweep_name', SWEEP).maybeSingle(),
  );
  if (curErr) throw new Error(`read sweep_cursor failed: ${curErr.message}`);

  let ceiling: number;
  let nextId: number;
  let priorRequests = 0;

  if (cur && !cur.completed_at) {
    ceiling = Number(cur.ceiling_used);
    nextId = Number(cur.next_id);
    priorRequests = Number(cur.requests ?? 0);
    BATCH_CALLS = Number(cur.batch_size ?? BATCH_CALLS);
    log(`  RESUMING from cursor: next_id=${nextId} ceiling_used=${ceiling} prior_requests=${priorRequests}`);
  } else {
    log('  re-reading ceiling at sweep start...');
    const [c, calls] = await findCeiling();
    ceiling = c; nextId = 1;
    log(`  ceiling = ${ceiling}  (found in ${calls} eth_calls)`);
    const { error } = await withRetry('init cursor', () =>
      db.from('sweep_cursor').upsert(
        { sweep_name: SWEEP, next_id: 1, ceiling_used: ceiling, batch_size: BATCH_CALLS, requests: 0, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null },
        { onConflict: 'sweep_name' },
      ),
    );
    if (error) throw new Error(`init sweep_cursor failed: ${error.message}`);
  }

  const headStart = await blockNumber();
  log(`  ceiling used : ${ceiling}`);
  log(`  batch        : ${BATCH_CALLS} calls per multicall (${BATCH_CALLS / 2} agents)`);
  log(`  rate limit   : 5 req/s`);
  log('');

  let stored = 0, missing = 0, clientErrors = 0, batches = 0, batchRetries = 0;
  let nextPct = 5;

  while (nextId <= ceiling) {
    const agents = Math.min(BATCH_CALLS / 2, ceiling - nextId + 1);

    // --- per-batch retry with exponential backoff --------------------------
    let batch: Awaited<ReturnType<typeof readBatch>> | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        batch = await readBatch(nextId, agents);
        break;
      } catch (err) {
        batchRetries++;
        const backoff = 500 * 2 ** (attempt - 1);
        process.stderr.write(`  batch at ${nextId} attempt ${attempt} failed: ${describeError(err)} (waiting ${backoff}ms)\n`);
        await sleep(backoff);
        // Tune the batch down if the endpoint keeps rejecting this size.
        if (attempt >= 3 && BATCH_CALLS > MIN_BATCH_CALLS) {
          BATCH_CALLS = Math.max(MIN_BATCH_CALLS, Math.floor(BATCH_CALLS / 2));
          process.stderr.write(`  -> reducing batch size to ${BATCH_CALLS} calls\n`);
          break;
        }
      }
    }
    if (!batch) continue; // retry the same nextId at the smaller size

    if (batch.rows.length > 0) {
      const { error } = await withRetry(`upsert liveness at ${nextId}`, () =>
        db.from('agent_liveness').upsert(batch.rows, { onConflict: 'agent_id' }),
      );
      if (error) throw new Error(`upsert agent_liveness failed at ${nextId}: ${error.message}`);
      stored += batch.rows.length;
    }
    missing += batch.missing;
    clientErrors += batch.clientErrors;
    batches++;

    // Cursor advances ONLY now, after the write is confirmed.
    const advanced = nextId + agents;
    const { error: cErr } = await withRetry('advance cursor', () =>
      db.from('sweep_cursor').update({
        next_id: advanced,
        batch_size: BATCH_CALLS,
        requests: priorRequests + stats.requests,
        updated_at: new Date().toISOString(),
      }).eq('sweep_name', SWEEP),
    );
    if (cErr) throw new Error(`advance cursor failed: ${cErr.message}`);
    nextId = advanced;

    const pct = (100 * (nextId - 1)) / ceiling;
    if (pct >= nextPct) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (nextId - 1) / elapsed;
      const eta = rate > 0 ? (ceiling - nextId + 1) / rate : 0;
      log(
        `  ${pct.toFixed(0).padStart(3)}%  id=${nextId - 1}/${ceiling}  stored=${stored}  ` +
          `elapsed=${(elapsed / 60).toFixed(1)}m  eta=${(eta / 60).toFixed(1)}m  req=${stats.requests}`,
      );
      while (nextPct <= pct) nextPct += 5;
    }
  }

  // --- completion -----------------------------------------------------------
  const [ceilEnd] = await findCeiling();
  const headEnd = await blockNumber();
  const elapsed = (Date.now() - t0) / 1000;

  await withRetry('complete cursor', () =>
    db.from('sweep_cursor').update({
      completed_at: new Date().toISOString(),
      requests: priorRequests + stats.requests,
      updated_at: new Date().toISOString(),
    }).eq('sweep_name', SWEEP),
  );

  const { count: liveCount } = await withRetry('count live', () =>
    db.from('agent_liveness').select('agent_id', { count: 'exact', head: true }).gt('client_count', 0),
  );
  const { count: totalRows } = await withRetry('count rows', () =>
    db.from('agent_liveness').select('agent_id', { count: 'exact', head: true }),
  );

  log('');
  log('PASS 1 COMPLETE');
  log(`  ceiling used at start   : ${ceiling}`);
  log(`  ceiling re-read at end  : ${ceilEnd}   (drift +${ceilEnd - ceiling})`);
  log(`  head block start/end    : ${headStart} -> ${headEnd}`);
  log(`  agents stored           : ${stored}`);
  log(`  rows in agent_liveness  : ${totalRows}`);
  log(`  unminted ids skipped    : ${missing}`);
  log(`  getClients sub-failures : ${clientErrors}`);
  log(`  batches                 : ${batches}   final batch size: ${BATCH_CALLS} calls`);
  log(`  batch retries           : ${batchRetries}`);
  log(`  rpc requests            : ${stats.requests}   transport retries: ${stats.retries}`);
  log(`  wall clock              : ${(elapsed / 60).toFixed(1)} min`);
  log(`  agents with clients > 0 : ${liveCount}  (${(100 * (liveCount ?? 0) / Math.max(1, totalRows ?? 1)).toFixed(4)}%)`);
  log('');
  const cu = Object.keys(stats.cuHeaders).length ? JSON.stringify(stats.cuHeaders) : 'NONE EXPOSED';
  log(`  Alchemy compute-unit headers: ${cu}`);
}

main().catch((err) => {
  process.stderr.write(`\nPASS 1 FAILED: ${describeError(err)}\n`);
  process.stderr.write(`Cursor is preserved - re-run to resume from the last confirmed batch.\n`);
  process.exit(1);
});
