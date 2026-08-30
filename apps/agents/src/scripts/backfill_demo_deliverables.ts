/**
 * One-time backfill: persist the deliverable manifests of past DEMO hires
 * into demo_deliverables, so the footer's LAST JOB strip can verify them
 * with eth_call-only reads at ISR time.
 *
 * The manifest source is the chain itself: the policy's submit event embeds
 * optParams, which carries the manifest as a data: URL. The SDK's helper
 * can't find it (its default RPC rejects eth_getLogs), so this script
 * binary-searches the submit block by the job's submittedAt timestamp via
 * publicnode and scans a ±900-block window. Log scanning is fine HERE — an
 * offline dev script — but not in the ISR path, which is why the table
 * exists. Each manifest is verified (keccak256 of canonical JSON == on-chain
 * job.deliverable) BEFORE insert; writes go through the same anon-keyed
 * PostgREST RPC the hire route uses.
 */
import { BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { manifestHash, type DeliverableManifest } from '../erc8183/manifest.ts';

const PROVIDER = '0x85d32d525E1812FeE7001f34DD6dd86154619090'.toLowerCase();
const COMMERCE = '0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE';
const POLICY = '0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA';
const CONFIG_JOBS = new Set([748, 753, 754, 757, 765, 795, 796, 797]);
const RPC = 'https://bsc-testnet-rpc.publicnode.com';
const SB_URL = process.env.SUPABASE_URL!;
const SB_ANON = process.env.SUPABASE_ANON_KEY!;

const call = async (method: string, params: unknown[]) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = (await r.json()) as { result?: unknown; error?: unknown };
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
};
const blockTs = async (n: number) =>
  Number(((await call('eth_getBlockByNumber', ['0x' + n.toString(16), false])) as { timestamp: string }).timestamp);

const head = Number(((await call('eth_getBlockByNumber', ['latest', false])) as { number: string }).number);
const latest = Number(BigInt((await call('eth_call', [{ to: COMMERCE, data: '0x50355d76' }, 'latest'])) as string));
console.log('latest jobId:', latest, '| head block:', head);

for (let id = 798; id <= latest; id++) {
  if (CONFIG_JOBS.has(id)) continue;
  const j = await getErc8183Job(BNB_TESTNET, BigInt(id));
  if (String((j as { provider?: string }).provider ?? '').toLowerCase() !== PROVIDER) continue;
  if (j.statusName !== 'COMPLETED' && j.statusName !== 'SUBMITTED') { console.log(id, j.statusName, '- skip'); continue; }

  const target = Number(j.submittedAt);
  let lo = 100000000, hi = head;
  while (hi - lo > 2) { const mid = (lo + hi) >> 1; ((await blockTs(mid)) < target) ? (lo = mid) : (hi = mid); }
  const jobTopic = '0x' + id.toString(16).padStart(64, '0');
  const logs = (await call('eth_getLogs', [{ address: POLICY,
    fromBlock: '0x' + (lo - 900).toString(16), toBlock: '0x' + (lo + 900).toString(16) }])) as
    { topics: string[]; data: string }[];
  const hit = logs.find((l) => l.topics.includes(jobTopic) &&
    Buffer.from(l.data.slice(2), 'hex').toString('latin1').includes('data:application/json'));
  if (!hit) { console.log(id, j.statusName, '- submit event not found near block', lo); continue; }

  const raw = Buffer.from(hit.data.slice(2), 'hex').toString('latin1');
  const m = raw.match(/data:application\/json;base64,([A-Za-z0-9+/=]+)/);
  if (!m) { console.log(id, '- url not parseable'); continue; }
  const manifest = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as DeliverableManifest;
  const h = manifestHash(manifest);
  if (h.toLowerCase() !== j.deliverable.toLowerCase()) { console.log(id, '- HASH MISMATCH, not inserting'); continue; }

  const agentId = Number((manifest.metadata as { agent_id?: unknown }).agent_id);
  const res = await fetch(`${SB_URL}/rest/v1/rpc/demo_record_deliverable`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SB_ANON, authorization: `Bearer ${SB_ANON}` },
    body: JSON.stringify({ p_job_id: id, p_agent_id: agentId, p_manifest: manifest }),
  });
  console.log(id, j.statusName, 'agent', agentId, 'hash verified -> insert:', res.status, (await res.text()).slice(0, 40));
}
