// B402 Bazaar -> Supabase ingest.
//
// Pages the whole catalogue, upserts bazaar_resources, and replaces
// bazaar_accepts per resource. Server-side only; makes no RPC/chain calls.
import { fetchPage, type NormalizedItem } from './client.ts';
import { supabase, describeTarget, withRetry } from '../env.ts';
import process from 'node:process';

const PAGE_LIMIT = 100;
const ACCEPTS_INSERT_CHUNK = 500;

interface Skip {
  resource: string;
  reason: string;
  detail?: string;
}

const log = (s: string) => process.stdout.write(s + '\n');

function toIso(epochMs: number | null): string | null {
  if (epochMs == null || !Number.isFinite(epochMs)) return null;
  const d = new Date(epochMs);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main(): Promise<void> {
  const db = supabase();
  log(`B402 Bazaar ingest`);
  log(`  target        : ${describeTarget()} (service key never printed)`);
  log(`  page limit    : ${PAGE_LIMIT}`);
  log('');

  // --- first page establishes the total; 976 is NOT hardcoded ---------------
  const first = await fetchPage(PAGE_LIMIT, 0);
  const totalReported = first.pagination.total;
  log(`  pagination.total reported on first page: ${totalReported}`);
  if (totalReported <= 0) throw new Error(`FATAL: API reported total=${totalReported}; nothing to ingest.`);

  const plannedPages = Math.ceil(totalReported / PAGE_LIMIT);
  log(`  planned pages : ${plannedPages}`);
  log('');

  const skips: Skip[] = [];
  const seenResource = new Set<string>();
  const driftObserved: { page: number; offset: number; total: number }[] = [];

  let pagesFetched = 0;
  let itemsSeen = 0;
  let resourcesUpserted = 0;
  let acceptsInserted = 0;
  let acceptsDeleted = 0;
  let quality = 0;
  let droppedNoResource = first.droppedNoResource;

  for (let page = 0; page < plannedPages; page++) {
    const offset = page * PAGE_LIMIT;
    const pageData = page === 0 ? first : await fetchPage(PAGE_LIMIT, offset);
    pagesFetched++;

    if (page > 0) droppedNoResource += pageData.droppedNoResource;

    // Drift: record it, but do not change the plan mid-sweep.
    if (pageData.pagination.total !== totalReported) {
      driftObserved.push({ page: page + 1, offset, total: pageData.pagination.total });
    }

    if (pageData.items.length === 0) {
      log(`  page ${page + 1}/${plannedPages} offset=${offset} -> 0 items, ending sweep early`);
      break;
    }

    // Deduplicate resource_url across the sweep. Paging a live catalogue can
    // return the same item twice if the underlying order shifts.
    const fresh: NormalizedItem[] = [];
    for (const it of pageData.items) {
      itemsSeen++;
      if (it.hasQuality) quality++;
      if (seenResource.has(it.resource)) {
        skips.push({ resource: it.resource, reason: 'duplicate_resource_url_in_sweep' });
        continue;
      }
      seenResource.add(it.resource);
      fresh.push(it);
    }

    if (fresh.length > 0) {
      // --- resources ---------------------------------------------------------
      // first_seen_at is deliberately absent from the payload: ON CONFLICT only
      // updates the columns present, so an existing row keeps its original value
      // while last_synced_at and raw are always refreshed.
      const rows = fresh.map((it) => ({
        resource_url: it.resource,
        resource_type: it.type,
        x402_version: it.x402Version,
        description: it.description,
        last_updated: toIso(it.lastUpdated),
        last_synced_at: new Date().toISOString(),
        raw: it.raw,
      }));

      const { error: upErr } = await withRetry(`upsert resources page ${page + 1}`, () =>
        db.from('bazaar_resources').upsert(rows, { onConflict: 'resource_url' }),
      );
      if (upErr) throw new Error(`upsert bazaar_resources failed (page ${page + 1}): ${upErr.message}`);
      resourcesUpserted += rows.length;

      // --- accepts: replace (delete then insert) ------------------------------
      const urls = fresh.map((it) => it.resource);
      const { error: delErr, count: delCount } = await withRetry(
        `delete accepts page ${page + 1}`,
        () => db.from('bazaar_accepts').delete({ count: 'exact' }).in('resource_url', urls),
      );
      if (delErr) throw new Error(`delete bazaar_accepts failed (page ${page + 1}): ${delErr.message}`);
      acceptsDeleted += delCount ?? 0;

      // The unique key is (resource_url, scheme, network, asset) and asset is
      // lowercased on the way in, so two upstream casings of one asset collapse
      // to the same key. Collapse them here and count it, rather than letting
      // the insert abort the whole sweep.
      const acceptRows: Record<string, unknown>[] = [];
      for (const it of fresh) {
        const keys = new Set<string>();
        for (const a of it.accepts) {
          const key = `${a.scheme}|${a.network}|${a.asset}`;
          if (keys.has(key)) {
            skips.push({
              resource: it.resource,
              reason: 'duplicate_accept_key_after_lowercasing',
              detail: key,
            });
            continue;
          }
          keys.add(key);
          acceptRows.push({
            resource_url: it.resource,
            scheme: a.scheme,
            network: a.network,
            asset: a.asset,
            // string, not number: wei-scale values exceed Number.MAX_SAFE_INTEGER
            max_amount_required: a.maxAmountRequired,
            pay_to: a.payTo,
          });
        }
      }

      for (const part of chunk(acceptRows, ACCEPTS_INSERT_CHUNK)) {
        const { error: insErr } = await withRetry(`insert accepts page ${page + 1}`, () =>
          db.from('bazaar_accepts').insert(part),
        );
        if (insErr) throw new Error(`insert bazaar_accepts failed (page ${page + 1}): ${insErr.message}`);
        acceptsInserted += part.length;
      }
    }

    log(
      `  page ${page + 1}/${plannedPages} offset=${offset} -> ${pageData.items.length} items, ` +
        `${fresh.length} upserted (total.reported=${pageData.pagination.total})`,
    );
  }

  // --- summary ---------------------------------------------------------------
  log('');
  log('ingest summary');
  log(`  total reported by API   : ${totalReported}`);
  log(`  pages fetched           : ${pagesFetched}`);
  log(`  items seen              : ${itemsSeen}`);
  log(`  resources upserted      : ${resourcesUpserted}`);
  log(`  accepts deleted         : ${acceptsDeleted}`);
  log(`  accepts inserted        : ${acceptsInserted}`);
  log(`  items with quality field: ${quality}`);
  log(`  rows skipped            : ${skips.length + droppedNoResource}`);

  if (droppedNoResource > 0) {
    log(`    - no_resource_url: ${droppedNoResource} (item had no \`resource\`, cannot be keyed)`);
  }
  const byReason = new Map<string, Skip[]>();
  for (const s of skips) {
    const list = byReason.get(s.reason) ?? [];
    list.push(s);
    byReason.set(s.reason, list);
  }
  for (const [reason, list] of byReason) {
    log(`    - ${reason}: ${list.length}`);
    for (const s of list.slice(0, 5)) {
      log(`        ${s.resource}${s.detail ? `  [${s.detail}]` : ''}`);
    }
    if (list.length > 5) log(`        ... and ${list.length - 5} more`);
  }
  if (skips.length === 0 && droppedNoResource === 0) log(`    (none)`);

  if (driftObserved.length > 0) {
    log('');
    log(`  DRIFT: pagination.total changed mid-sweep (started at ${totalReported}).`);
    log(`         The sweep was completed against the original plan, as specified.`);
    for (const d of driftObserved.slice(0, 10)) {
      log(`         page ${d.page} (offset ${d.offset}) reported total=${d.total}`);
    }
    if (driftObserved.length > 10) log(`         ... and ${driftObserved.length - 10} more pages`);
  }

  // --- verify against the DB, not against our own counters -------------------
  const { count: dbCount, error: cErr } = await withRetry('count resources', () =>
    db.from('bazaar_resources').select('resource_url', { count: 'exact', head: true }),
  );
  if (cErr) throw new Error(`count bazaar_resources failed: ${cErr.message}`);
  const drift = Math.abs((dbCount ?? 0) - totalReported);
  const pct = totalReported > 0 ? (100 * drift) / totalReported : 100;
  log('');
  log(`  bazaar_resources row count: ${dbCount}`);
  log(`  vs API total ${totalReported}: delta ${drift} (${pct.toFixed(2)}%)`);
  log(pct <= 1 ? '  PASS: row count within 1% of pagination.total' : '  FAIL: row count differs from pagination.total by more than 1%');
}

main().catch((err) => {
  process.stderr.write(`\nINGEST FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
