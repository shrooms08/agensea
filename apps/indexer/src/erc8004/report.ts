// Pass 2 reporting. Reads Supabase only.
import { supabase, withRetry } from '../env.ts';
import process from 'node:process';
const log = (s: string) => process.stdout.write(s + '\n');
const db = supabase();

async function all<T>(table: string, select: string, mod?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q: any = db.from(table).select(select).order('agent_id', { ascending: true }).range(from, from + 999);
    if (mod) q = mod(q);
    const { data, error } = await withRetry(`${table} ${from}`, () => q);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

interface A { agent_id: number; owner: string | null; agent_wallet: string | null; token_uri: string | null;
  token_uri_kind: string | null; token_uri_host: string | null; client_count: number;
  feedback_count: string | null; summary_value: string | null; summary_decimals: number | null }
interface L { agent_id: number; clients: string[] }

const agents = await all<A>('agents', 'agent_id,owner,agent_wallet,token_uri,token_uri_kind,token_uri_host,client_count,feedback_count,summary_value,summary_decimals');
const live = await all<L>('agent_liveness', 'agent_id,clients', (q) => q.gt('client_count', 0));
const clientsById = new Map(live.map((l) => [l.agent_id, (l.clients ?? []).map((c) => String(c).toLowerCase())]));

log(`enriched rows: ${agents.length}`);
log('');

// --- token_uri_kind ---------------------------------------------------------
const kinds = new Map<string, number>();
for (const a of agents) kinds.set(a.token_uri_kind ?? 'null', (kinds.get(a.token_uri_kind ?? 'null') ?? 0) + 1);
log('token_uri_kind distribution (enriched set):');
for (const [k, v] of [...kinds].sort((x, y) => y[1] - x[1])) {
  log(`  ${k.padEnd(8)} ${String(v).padStart(5)}  ${(100 * v / agents.length).toFixed(1)}%`);
}
log('');
const hosts = new Map<string, number>();
for (const a of agents) if (a.token_uri_host) hosts.set(a.token_uri_host, (hosts.get(a.token_uri_host) ?? 0) + 1);
log(`distinct http hosts: ${hosts.size}`);
for (const [h, v] of [...hosts].sort((x, y) => y[1] - x[1]).slice(0, 10)) log(`  ${String(v).padStart(4)}  ${h}`);
log('');

// --- SELF-ONLY vs GENUINE ---------------------------------------------------
// An agent whose every client equals its own owner is the owner calling their
// own agent - not third-party usage.
let selfOnly = 0, hasDistinct = 0, noClients = 0, unknownOwner = 0;
const distinctAgents: A[] = [];
for (const a of agents) {
  const cl = clientsById.get(a.agent_id) ?? [];
  if (cl.length === 0) { noClients++; continue; }
  if (!a.owner) { unknownOwner++; continue; }
  const owner = a.owner.toLowerCase();
  if (cl.every((c) => c === owner)) selfOnly++;
  else { hasDistinct++; distinctAgents.push(a); }
}
const withClients = selfOnly + hasDistinct + unknownOwner;
log('SELF-ONLY ANALYSIS (agents with >=1 client):');
log(`  total with clients          : ${withClients}`);
log(`  self-only (all clients==owner): ${selfOnly}  (${(100 * selfOnly / withClients).toFixed(1)}% of live)`);
log(`  >=1 DISTINCT client          : ${hasDistinct}  (${(100 * hasDistinct / withClients).toFixed(1)}% of live)`);
log(`  owner unknown                : ${unknownOwner}`);
log(`  in enriched set w/ 0 clients : ${noClients}  (payee-overlap inclusion)`);
log('');
const TOTAL_AGENTS = 301992;
log(`  "live" headline  : ${withClients}/${TOTAL_AGENTS} = ${(100 * withClients / TOTAL_AGENTS).toFixed(4)}%`);
log(`  GENUINE usage    : ${hasDistinct}/${TOTAL_AGENTS} = ${(100 * hasDistinct / TOTAL_AGENTS).toFixed(4)}%`);
log('');

// client_count distribution among genuinely-used agents
const dd = new Map<number, number>();
for (const a of distinctAgents) dd.set(a.client_count, (dd.get(a.client_count) ?? 0) + 1);
log('client_count among agents with >=1 distinct client:');
for (const [k, v] of [...dd].sort((x, y) => x[0] - y[0]).slice(0, 15)) log(`  ${String(k).padStart(3)} clients -> ${v} agents`);
log('');
log('top genuinely-used agents by client_count:');
for (const a of [...distinctAgents].sort((x, y) => y.client_count - x.client_count).slice(0, 10)) {
  log(`  id=${String(a.agent_id).padStart(7)} clients=${String(a.client_count).padStart(3)} feedback=${a.feedback_count} value=${a.summary_value} host=${a.token_uri_host ?? a.token_uri_kind}`);
}
log('');

// --- overlap ----------------------------------------------------------------
const { data: ov } = await withRetry('overlap view', () => db.from('agent_bazaar_overlap').select('*'));
log(`agent_bazaar_overlap rows: ${(ov ?? []).length}`);
for (const r of ov ?? []) log('  ' + JSON.stringify(r));
