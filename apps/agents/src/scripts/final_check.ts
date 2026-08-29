import process from 'node:process';
import { resolve } from 'node:path';
import { BNB_TESTNET, getErc8183Job, getErc8004Agent } from '@altananetwork/sdk';
import { ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
for (const id of [748n,753n,754n,757n,765n]) {
  const j = await getErc8183Job(BNB_TESTNET, id);
  console.log(`  job ${id}: ${j.statusName}`);
}
console.log('  --- identities ---');
for (const id of [2012n,2013n,2014n,2015n]) {
  const a = await getErc8004Agent(BNB_TESTNET, id);
  const rec = JSON.parse(Buffer.from(String(a.agentUri).split(',')[1]!, 'base64').toString());
  console.log(`  agentId ${id}: ${rec.category.padEnd(24)} owner ${a.owner.slice(0,10)} uri ${String(a.agentUri).length}B`);
}
