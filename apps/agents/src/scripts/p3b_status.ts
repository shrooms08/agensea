import process from 'node:process';
import { resolve } from 'node:path';
import { BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { readState, ROOT } from '../agent/state.ts';
import { verifyManifest, type DeliverableManifest } from '../erc8183/manifest.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
const st = readState();
const now = Math.floor(Date.now()/1000);
for (const k of ['agent2','agent3','agent4']) {
  const a = st[k]; if (!a?.jobId) { console.log(`${k}: no job`); continue; }
  const j = await getErc8183Job(BNB_TESTNET, BigInt(a.jobId));
  const url: string = a.deliverableUrl ?? '';
  let verified = false;
  if (url) {
    const m = JSON.parse(Buffer.from(url.slice(url.indexOf(',')+1),'base64').toString('utf8')) as DeliverableManifest;
    verified = verifyManifest(m, j.deliverable);
  }
  const sub = Number(j.submittedAt);
  const eligible = sub > 0 ? sub + 900 : 0;
  console.log(`${k} (agentId ${a.agentId}, ${a.category})`);
  console.log(`   job ${a.jobId}  ${j.statusName}  buyer-verified=${verified}  ttd=${a.timeToDeliverableMs ? (a.timeToDeliverableMs/1000).toFixed(1)+'s' : 'n/a'} analysis=${a.analysisMs}ms`);
  console.log(`   settle eligible at ${eligible} (now ${now}, ${eligible>now ? (eligible-now)+'s to go' : 'READY'})`);
}
