import { updateAgent, readState } from '../agent/state.ts';
const who = process.argv[2]!;
for (let i = 0; i < 20; i++) await updateAgent(`lock_${who}`, { [`k${i}`]: i });
console.log(`${who} done`);
