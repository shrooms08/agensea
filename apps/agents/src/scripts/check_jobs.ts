import process from 'node:process';
import { resolve } from 'node:path';
import { BNB_TESTNET, getErc8183Job } from '@altananetwork/sdk';
import { ROOT } from '../agent/state.ts';
process.loadEnvFile(resolve(ROOT, '.env'));
for (const id of [750n,751n,752n,753n,754n,755n,756n]) {
  try {
    const j = await getErc8183Job(BNB_TESTNET, id);
    console.log(`job ${id}: ${j.statusName.padEnd(10)} budget=${j.budget} provider=${j.provider.slice(0,10)} client=${j.client.slice(0,10)}`);
    console.log(`   desc: ${j.description.slice(0,110)}`);
  } catch (e) { console.log(`job ${id}: ${(e as Error).message.slice(0,60)}`); }
}
