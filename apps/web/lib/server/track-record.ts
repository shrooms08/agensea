/**
 * Provider track record — SERVER ONLY, read from chain 97 at ISR time.
 *
 * Every figure is counted from ERC-8183 jobs whose provider is our agents'
 * wallet: completed jobs, distinct buyer wallets, disputes, and the median
 * funded->deliverable time. Nothing is stored or remembered; if the scan
 * fails the caller renders no bar rather than a stale one.
 *
 * Time to deliverable is derivable on chain because every job we create — both
 * paths — writes a JSON description carrying `at`, the client-side millisecond
 * timestamp taken immediately before createJob. submittedAt (seconds, on the
 * job record) minus that is the wall-clock the buyer experienced.
 *
 * Reads are batched JSON-RPC (one request per 100 jobs), not one call per job.
 */
import 'server-only';
import { decodeFunctionResult, encodeFunctionData } from 'viem';
import { BNB_TESTNET } from '@altananetwork/sdk';
import { COMMERCE_ABI } from '@/lib/wallet/erc8183';
import { AGENTS_WALLET, ERC8183 } from '@/data/first-party-agents';

const FIRST_JOB = 740;      // our first job was 748; start below it
const MAX_SCAN = 600;       // hard ceiling on the window
const BATCH = 100;
const STATUS = ['OPEN', 'FUNDED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'EXPIRED'] as const;

export interface TrackRecord {
  completed: number;
  distinctBuyers: number;
  disputes: number;
  medianTtdMs: number | null;
  scannedTo: number;
}

async function rpcBatch(calls: { id: number; data: string }[]): Promise<Map<number, string>> {
  const res = await fetch(BNB_TESTNET.publicRpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000), next: { revalidate: 3600 },
    body: JSON.stringify(calls.map((c) => ({
      jsonrpc: '2.0', id: c.id, method: 'eth_call',
      params: [{ to: ERC8183.commerce, data: c.data }, 'latest'],
    }))),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const rows = (await res.json()) as { id: number; result?: string; error?: unknown }[];
  const out = new Map<number, string>();
  for (const r of Array.isArray(rows) ? rows : []) if (r.result) out.set(r.id, r.result);
  return out;
}

export async function readTrackRecord(): Promise<TrackRecord | null> {
  try {
    const headRes = await fetch(BNB_TESTNET.publicRpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(12_000), next: { revalidate: 3600 },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: ERC8183.commerce, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'jobCounter' }) }, 'latest'] }),
    });
    const head = Number(BigInt(((await headRes.json()) as { result?: string }).result ?? '0x0'));
    if (!head) return null;

    const from = Math.max(FIRST_JOB, head - MAX_SCAN);
    const ids: number[] = [];
    for (let id = from; id <= head; id++) ids.push(id);

    const buyers = new Set<string>();
    const ttds: number[] = [];
    let completed = 0, disputes = 0;

    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const results = await rpcBatch(slice.map((id) => ({
        id, data: encodeFunctionData({ abi: COMMERCE_ABI, functionName: 'getJob', args: [BigInt(id)] }),
      })));
      for (const id of slice) {
        const raw = results.get(id);
        if (!raw || raw === '0x') continue;
        let job: { client: string; provider: string; description: string; status: number; submittedAt: bigint };
        try {
          job = decodeFunctionResult({ abi: COMMERCE_ABI, functionName: 'getJob', data: raw as `0x${string}` }) as typeof job;
        } catch { continue; }
        if (String(job.provider).toLowerCase() !== AGENTS_WALLET.toLowerCase()) continue;
        const status = STATUS[job.status];
        if (status === 'REJECTED') disputes++;
        if (status !== 'COMPLETED') continue;
        completed++;
        buyers.add(String(job.client).toLowerCase());
        try {
          const at = Number((JSON.parse(job.description) as { at?: unknown }).at);
          const submitted = Number(job.submittedAt) * 1000;
          if (Number.isFinite(at) && at > 0 && submitted > at) ttds.push(submitted - at);
        } catch { /* description without a timestamp contributes no TTD */ }
      }
    }

    const sorted = ttds.sort((a, b) => a - b);
    const median = sorted.length
      ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]!
        : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2))
      : null;

    return { completed, distinctBuyers: buyers.size, disputes, medianTtdMs: median, scannedTo: head };
  } catch {
    return null;
  }
}
