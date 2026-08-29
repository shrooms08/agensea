// B402 Bazaar stats. Reads Supabase only - no API calls, no RPC.
import { supabase, describeTarget } from '../env.ts';
import process from 'node:process';

const log = (s: string) => process.stdout.write(s + '\n');
const PAGE = 1000;

/** Pull one column across all rows, paging past PostgREST's default cap. */
async function allValues(
  db: ReturnType<typeof supabase>,
  table: string,
  column: string,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(column).range(from, from + PAGE - 1);
    if (error) throw new Error(`select ${column} from ${table} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out.push((row as unknown as Record<string, unknown>)[column]);
    if (data.length < PAGE) break;
  }
  return out;
}

/** host, matching the idx_resources_host index: split_part(resource_url,'/',3) */
function host(url: string): string {
  const parts = url.split('/');
  return (parts[2] ?? '').toLowerCase();
}

/** naive registrable domain: last two labels of the host */
function rootDomain(h: string): string {
  const labels = h.split('.').filter(Boolean);
  return labels.length <= 2 ? h : labels.slice(-2).join('.');
}

async function main(): Promise<void> {
  const db = supabase();
  log(`B402 Bazaar stats`);
  log(`  source: ${describeTarget()} (service key never printed)`);
  log('');

  // --- totals ---------------------------------------------------------------
  const { count: totalResources, error: tErr } = await db
    .from('bazaar_resources')
    .select('resource_url', { count: 'exact', head: true });
  if (tErr) throw new Error(`count bazaar_resources failed: ${tErr.message}`);

  const payTos = (await allValues(db, 'bazaar_accepts', 'pay_to')).filter(
    (v): v is string => typeof v === 'string',
  );
  const distinctPayTo = new Set(payTos);

  const urls = (await allValues(db, 'bazaar_resources', 'resource_url')).filter(
    (v): v is string => typeof v === 'string',
  );
  const hosts = new Set(urls.map(host).filter(Boolean));
  const roots = new Set([...hosts].map(rootDomain));

  log(`  total resources        : ${totalResources}`);
  log(`  distinct payTo         : ${distinctPayTo.size}`);
  log(`  distinct hosts         : ${hosts.size}   (split_part(resource_url,'/',3))`);
  log(`  distinct root domains  : ${roots.size}   (last two labels of host)`);
  log('');

  // --- payee concentration --------------------------------------------------
  const { data: conc, error: cErr } = await db
    .from('bazaar_payee_concentration')
    .select('*')
    .order('resources', { ascending: false })
    .limit(10);
  if (cErr) throw new Error(`select bazaar_payee_concentration failed: ${cErr.message}`);

  log(`  top ${Math.min(10, conc?.length ?? 0)} payees by resource count:`);
  log(`    ${'pay_to'.padEnd(44)} ${'resources'.padStart(9)}  ${'pct_of_catalogue'.padStart(16)}`);
  for (const r of conc ?? []) {
    const row = r as { pay_to: string | null; resources: number; pct_of_catalogue: number | null };
    log(
      `    ${String(row.pay_to).padEnd(44)} ${String(row.resources).padStart(9)}  ${String(row.pct_of_catalogue).padStart(16)}`,
    );
  }
  log('');

  // --- casing guard ---------------------------------------------------------
  // Everything is lowercased on ingest; if an uppercase character ever appears
  // here, normalisation has regressed and every grouping above is suspect.
  const assets = (await allValues(db, 'bazaar_accepts', 'asset')).filter(
    (v): v is string => typeof v === 'string',
  );
  const badCase = [...new Set([...assets, ...payTos])].filter((a) => a !== a.toLowerCase());
  if (badCase.length > 0) {
    log(`  !! NORMALISATION REGRESSION: ${badCase.length} stored address(es) are not lowercase:`);
    for (const b of badCase.slice(0, 5)) log(`     ${b}`);
  } else {
    log(`  address casing check   : all stored assets and payees are lowercase`);
  }
  log(`  distinct assets        : ${new Set(assets).size}`);
  log('');

  // --- quality field --------------------------------------------------------
  // Binance documents quality.{l30DaysTotalCalls,l30DaysUniquePayers,lastCalledAt}
  // but ships nothing today. If that changes it alters our architecture, so it
  // is checked on every stats run rather than assumed.
  let withQuality = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('bazaar_resources').select('raw').range(from, from + PAGE - 1);
    if (error) throw new Error(`select raw failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const raw = (row as { raw?: unknown }).raw;
      if (raw && typeof raw === 'object' && 'quality' in raw && (raw as Record<string, unknown>).quality != null) {
        withQuality++;
      }
    }
    if (data.length < PAGE) break;
  }

  if (withQuality > 0) {
    log('  ' + '*'.repeat(72));
    log(`  ** NOTICE: ${withQuality} resource(s) NOW CARRY A \`quality\` FIELD.`);
    log(`  ** Binance has shipped the quality data (l30DaysTotalCalls,`);
    log(`  ** l30DaysUniquePayers, lastCalledAt). This CHANGES OUR ARCHITECTURE:`);
    log(`  ** real usage signal is available and should drive ranking instead of`);
    log(`  ** the payee-concentration proxy. Revisit the schema before building on it.`);
    log('  ' + '*'.repeat(72));
  } else {
    log(`  items carrying \`quality\`: 0  (as expected - Binance documents it but ships none)`);
  }
}

main().catch((err) => {
  process.stderr.write(`\nSTATS FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
