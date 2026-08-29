// PHASE 1b PASS 2 - enrichment.
// Target set: agent_liveness where client_count > 0 OR owner is a B402 payee.
// The second condition matters: the one confirmed overlap agent (127417) has
// ZERO clients, so a client_count-only filter would make the overlap invisible
// to the very view built to measure it.
//
// eth_call only. Batches are sized by ENCODED BYTE LENGTH, not call count,
// because getSummary calldata grows with the client array (up to 30 clients).
import { ethCall, stats, describeError } from './rpc.ts';
import {
  MULTICALL3, SEL, callUint, callGetSummary, encodeAggregate3, decodeAggregate3,
  decodeAddress, decodeSummary, decodeString, call3Bytes,
} from './multicall.ts';
import { supabase, withRetry } from '../env.ts';
import process from 'node:process';

const IDENTITY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const REPUTATION = '0x8004baa17c55a88189ae136b182e5fda19de9b63';
const SWEEP = 'pass2_enrich';

const MAX_BATCH_BYTES = 120_000; // encoded calldata budget per multicall
const MAX_BATCH_CALLS = 400;
const HTTP_CONCURRENCY = 5;      // polite: most URIs share a handful of hosts
const HTTP_TIMEOUT_MS = 5_000;

const log = (s: string) => process.stdout.write(s + '\n');

interface Target { agent_id: number; owner: string | null; client_count: number; clients: string[] }
interface Unit { t: Target; calls: { target: string; allowFailure: boolean; callData: string }[]; bytes: number }

function buildUnit(t: Target): Unit {
  const calls = [
    { target: IDENTITY, allowFailure: true, callData: callUint(SEL.ownerOf, t.agent_id) },
    { target: IDENTITY, allowFailure: true, callData: callUint(SEL.getAgentWallet, t.agent_id) },
    { target: IDENTITY, allowFailure: true, callData: callUint(SEL.tokenURI, t.agent_id) },
  ];
  // Never call getSummary for a zero-client agent: it reverts with
  // "clientAddresses required". Those are recorded as count=0 directly.
  if (t.client_count > 0) {
    calls.push({ target: REPUTATION, allowFailure: true, callData: callGetSummary(t.agent_id, t.clients) });
  }
  return { t, calls, bytes: calls.reduce((n, c) => n + call3Bytes(c.callData), 0) };
}

type UriKind = 'http' | 'data' | 'empty' | 'other';
function classify(uri: string): { kind: UriKind; host: string | null } {
  if (!uri) return { kind: 'empty', host: null };
  const lower = uri.toLowerCase();
  if (lower.startsWith('data:')) return { kind: 'data', host: null };
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    const host = uri.replace(/^[a-zA-Z]+:\/\//, '').split('/')[0]?.toLowerCase() ?? null;
    return { kind: 'http', host };
  }
  return { kind: 'other', host: null };
}

function parseDataUri(uri: string): unknown {
  try {
    const comma = uri.indexOf(',');
    if (comma < 0) return null;
    const meta = uri.slice(0, comma);
    const body = uri.slice(comma + 1);
    const text = /;base64/i.test(meta)
      ? Buffer.from(body, 'base64').toString('utf8')
      : decodeURIComponent(body);
    return JSON.parse(text);
  } catch { return null; }
}

async function fetchJson(url: string): Promise<{ metadata: unknown; ok: boolean }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) return { metadata: null, ok: false };
    const text = await res.text();
    try { return { metadata: JSON.parse(text), ok: true }; }
    catch { return { metadata: null, ok: true }; } // reachable but not JSON
  } catch { return { metadata: null, ok: false }; } // timeout / DNS / reset - recorded, not retried
}

/** Resolve many http URIs with bounded concurrency. */
async function resolveAll(items: { i: number; url: string }[]): Promise<Map<number, { metadata: unknown; ok: boolean }>> {
  const out = new Map<number, { metadata: unknown; ok: boolean }>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const it = items[cursor++]!;
      out.set(it.i, await fetchJson(it.url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(HTTP_CONCURRENCY, items.length) }, worker));
  return out;
}

async function main(): Promise<void> {
  const db = supabase();
  const t0 = Date.now();
  log('PHASE 1b PASS 2 - enrichment');
  log('');

  // --- target set -----------------------------------------------------------
  const { data: payRows, error: pErr } = await withRetry('read payees', () =>
    db.from('bazaar_accepts').select('pay_to'),
  );
  if (pErr) throw new Error(`read payees failed: ${pErr.message}`);
  const payees = [...new Set((payRows ?? []).map((r) => String((r as { pay_to: string }).pay_to).toLowerCase()))]
    .filter((p) => /^0x[0-9a-f]{40}$/.test(p));
  log(`  B402 payees: ${payees.length}`);

  const targets: Target[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await withRetry(`load targets ${from}`, () =>
      db.from('agent_liveness')
        .select('agent_id,owner,client_count,clients')
        .or(`client_count.gt.0,owner.in.(${payees.join(',')})`)
        .order('agent_id', { ascending: true })
        .range(from, from + 999),
    );
    if (error) throw new Error(`load targets failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const row = r as { agent_id: number; owner: string | null; client_count: number; clients: unknown };
      targets.push({
        agent_id: Number(row.agent_id),
        owner: row.owner ? row.owner.toLowerCase() : null,
        client_count: Number(row.client_count),
        clients: Array.isArray(row.clients) ? (row.clients as string[]).map((c) => String(c).toLowerCase()) : [],
      });
    }
    if (data.length < 1000) break;
  }
  log(`  target set: ${targets.length} agents  (client_count>0 OR owner is a payee)`);

  // --- resume ---------------------------------------------------------------
  const { data: cur } = await withRetry('read cursor', () =>
    db.from('sweep_cursor').select('*').eq('sweep_name', SWEEP).maybeSingle(),
  );
  let startFrom = 0;
  if (cur && !cur.completed_at) {
    const nextId = Number(cur.next_id);
    startFrom = targets.findIndex((t) => t.agent_id >= nextId);
    if (startFrom < 0) startFrom = targets.length;
    log(`  RESUMING at agent_id >= ${nextId} (index ${startFrom})`);
  } else {
    await withRetry('init cursor', () =>
      db.from('sweep_cursor').upsert({
        sweep_name: SWEEP, next_id: targets[0]?.agent_id ?? 0,
        ceiling_used: targets[targets.length - 1]?.agent_id ?? 0,
        batch_size: MAX_BATCH_CALLS, requests: 0,
        started_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null,
      }, { onConflict: 'sweep_name' }),
    );
  }

  // --- sweep ----------------------------------------------------------------
  let done = 0, stored = 0, httpOk = 0, httpFail = 0, summaryFail = 0, batches = 0;
  let maxBatchBytes = 0, minBatchCalls = Infinity, maxBatchCalls = 0;
  let nextPct = 10;

  let i = startFrom;
  while (i < targets.length) {
    // Pack units into a batch by BYTE LENGTH, not call count.
    const units: Unit[] = [];
    let bytes = 0, calls = 0;
    while (i < targets.length) {
      const u = buildUnit(targets[i]!);
      if (units.length > 0 && (bytes + u.bytes > MAX_BATCH_BYTES || calls + u.calls.length > MAX_BATCH_CALLS)) break;
      units.push(u); bytes += u.bytes; calls += u.calls.length; i++;
    }
    maxBatchBytes = Math.max(maxBatchBytes, bytes);
    minBatchCalls = Math.min(minBatchCalls, calls);
    maxBatchCalls = Math.max(maxBatchCalls, calls);

    const flat = units.flatMap((u) => u.calls);
    let decoded;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const r = await ethCall(MULTICALL3, encodeAggregate3(flat));
        if (r.error) throw new Error(`multicall error ${r.error.code}: ${r.error.message}`);
        decoded = decodeAggregate3(r.result!);
        if (decoded.length !== flat.length) throw new Error(`decoded ${decoded.length} != ${flat.length}`);
        break;
      } catch (err) {
        if (attempt === 5) throw err;
        process.stderr.write(`  batch retry ${attempt}: ${describeError(err)}\n`);
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
    batches++;

    // --- decode ------------------------------------------------------------
    const rows: Record<string, unknown>[] = [];
    const httpJobs: { i: number; url: string }[] = [];
    let k = 0;
    const staged = units.map((u) => {
      const owner = decoded![k]!.success ? decodeAddress(decoded![k]!.returnData) : null; k++;
      const wallet = decoded![k]!.success ? decodeAddress(decoded![k]!.returnData) : null; k++;
      const uri = decoded![k]!.success ? decodeString(decoded![k]!.returnData) : ''; k++;
      let summary = null;
      if (u.t.client_count > 0) {
        const s = decoded![k]!; k++;
        if (s.success) summary = decodeSummary(s.returnData); else summaryFail++;
      }
      return { u, owner, wallet, uri, summary };
    });

    staged.forEach((s, idx) => {
      const { kind, host } = classify(s.uri);
      if (kind === 'http') httpJobs.push({ i: idx, url: s.uri });
    });
    const fetched = await resolveAll(httpJobs);

    const now = new Date().toISOString();
    staged.forEach((s, idx) => {
      const { kind, host } = classify(s.uri);
      let metadata: unknown = null;
      if (kind === 'data') metadata = parseDataUri(s.uri);
      else if (kind === 'http') {
        const f = fetched.get(idx);
        metadata = f?.metadata ?? null;
        if (f?.ok) httpOk++; else httpFail++;
      }
      rows.push({
        agent_id: s.u.t.agent_id,
        owner: s.owner ?? s.u.t.owner,
        agent_wallet: s.wallet,
        token_uri: s.uri || null,
        token_uri_kind: kind,
        token_uri_host: host,
        metadata,
        client_count: s.u.t.client_count,
        feedback_count: s.summary ? s.summary.count.toString() : '0',
        summary_value: s.summary ? s.summary.value.toString() : null,
        summary_decimals: s.summary ? s.summary.decimals : null,
        checked_at: now,
      });
    });

    const { error: upErr } = await withRetry(`upsert agents at ${units[0]!.t.agent_id}`, () =>
      db.from('agents').upsert(rows, { onConflict: 'agent_id' }),
    );
    if (upErr) throw new Error(`upsert agents failed: ${upErr.message}`);
    stored += rows.length;
    done += units.length;

    const advanceTo = (targets[i]?.agent_id ?? (units[units.length - 1]!.t.agent_id + 1));
    await withRetry('advance cursor', () =>
      db.from('sweep_cursor').update({
        next_id: advanceTo, requests: stats.requests, updated_at: new Date().toISOString(),
      }).eq('sweep_name', SWEEP),
    );

    const pct = (100 * done) / Math.max(1, targets.length - startFrom);
    if (pct >= nextPct) {
      const el = (Date.now() - t0) / 1000;
      log(`  ${pct.toFixed(0).padStart(3)}%  ${done}/${targets.length - startFrom}  elapsed=${(el / 60).toFixed(1)}m  req=${stats.requests}`);
      while (nextPct <= pct) nextPct += 10;
    }
  }

  await withRetry('complete cursor', () =>
    db.from('sweep_cursor').update({ completed_at: new Date().toISOString(), requests: stats.requests, updated_at: new Date().toISOString() }).eq('sweep_name', SWEEP),
  );

  const elapsed = (Date.now() - t0) / 1000;
  log('');
  log('PASS 2 COMPLETE');
  log(`  agents enriched     : ${stored}`);
  log(`  batches             : ${batches}  (calls/batch ${minBatchCalls}..${maxBatchCalls}, max ${maxBatchBytes} calldata bytes)`);
  log(`  http URIs resolved  : ${httpOk} ok, ${httpFail} failed`);
  log(`  getSummary failures : ${summaryFail}`);
  log(`  rpc requests        : ${stats.requests}   transport retries: ${stats.retries}`);
  log(`  wall clock          : ${(elapsed / 60).toFixed(1)} min`);
}

main().catch((err) => {
  process.stderr.write(`\nPASS 2 FAILED: ${describeError(err)}\nCursor preserved - re-run to resume.\n`);
  process.exit(1);
});
