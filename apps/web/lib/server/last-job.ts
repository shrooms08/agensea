/**
 * LAST JOB strip data — SERVER ONLY, read at ISR time.
 *
 * Candidates are the config jobs that are fully documented (analysisMs +
 * settleTx recorded by the settle scripts). The chain is the authority on
 * the claim: at render we re-read the job from chain 97 and only report it
 * when statusName is COMPLETED and the on-chain deliverable hash equals the
 * config hash — "hash verified" is that comparison, made now, not remembered.
 * Any failure returns null and the strip renders "last job: unavailable";
 * it never shows a stale or invented row.
 *
 * (Live demo hires can settle later than these jobs, but carry no measured
 * analysis time or recorded settle tx, so they are not renderable here.)
 */
import 'server-only';
import { BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { FIRST_PARTY_AGENTS } from '@/data/first-party-agents';

export interface LastJob {
  jobId: string;
  agentId: number;
  agentName: string;
  analysisMs: number;
  settleTx: string;
  measuredAt: string; // ISO, time of the chain read
}

export async function readLastJob(): Promise<LastJob | null> {
  try {
    const candidates = FIRST_PARTY_AGENTS.flatMap((a) =>
      a.jobs.filter((j) => j.settleTx && j.status === 'COMPLETED')
        .map((j) => ({ agent: a, job: j })));
    if (candidates.length === 0) return null;
    const top = candidates.sort((x, y) => Number(y.job.jobId) - Number(x.job.jobId))[0];

    const chainJob = (await Promise.race([
      getErc8183Job(BNB_TESTNET, BigInt(top.job.jobId)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('chain read timeout')), 8000)),
    ])) as { statusName: string; deliverable: string };

    if (chainJob.statusName !== 'COMPLETED') return null;
    if (chainJob.deliverable.toLowerCase() !== top.job.deliverableHash.toLowerCase()) return null;

    return {
      jobId: top.job.jobId,
      agentId: top.agent.agentId,
      agentName: top.agent.name,
      analysisMs: top.job.analysisMs,
      settleTx: top.job.settleTx!,
      measuredAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
