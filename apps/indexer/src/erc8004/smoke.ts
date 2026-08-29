// Verify the hand-rolled aggregate3 codec against values confirmed with `cast`.
import { ethCall, stats } from './rpc.ts';
import {
  MULTICALL3, SEL, callUint, encodeAggregate3, decodeAggregate3,
  decodeAddress, decodeAddressArray,
} from './multicall.ts';

const IDENTITY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const REPUTATION = '0x8004baa17c55a88189ae136b182e5fda19de9b63';

const EXPECT: Record<string, string> = {
  'owner:1': '0x89e9e1ab11dd1b138b1dce6d6a4a0926aafd5029',
  'owner:297307': '0x0dff9d1fff7aed643137e7d7a3ac62b08063cc79',
  'owner:297306': '0x05dd3f0e338c555ea887cebec17d622a2f7b19a7',
  'clients:1': '0x397558e5d63a894934362e5c3c33ab5d0170c228',
  'clients:297307': '',
  'clients:297306': '',
};

const ids = [1, 297307, 297306];
const calls = [
  ...ids.map((id) => ({ target: IDENTITY, allowFailure: true, callData: callUint(SEL.ownerOf, id) })),
  ...ids.map((id) => ({ target: REPUTATION, allowFailure: true, callData: callUint(SEL.getClients, id) })),
  // a deliberately unminted id: allowFailure must yield success=false, not a throw
  { target: IDENTITY, allowFailure: true, callData: callUint(SEL.ownerOf, 1_999_999) },
];

const res = await ethCall(MULTICALL3, encodeAggregate3(calls));
if (res.error) throw new Error(`multicall reverted: ${res.error.code} ${res.error.message}`);
const decoded = decodeAggregate3(res.result!);

console.log(`calls sent: ${calls.length}  results decoded: ${decoded.length}`);
if (decoded.length !== calls.length) throw new Error('MISMATCH: result count != call count');

let pass = 0, fail = 0;
ids.forEach((id, i) => {
  const got = decoded[i]!.success ? decodeAddress(decoded[i]!.returnData) : null;
  const want = EXPECT[`owner:${id}`];
  const ok = got === want;
  console.log(`  ownerOf(${id}) -> ${got} ${ok ? 'OK' : `MISMATCH want ${want}`}`);
  ok ? pass++ : fail++;
});
ids.forEach((id, i) => {
  const r = decoded[ids.length + i]!;
  const got = r.success ? decodeAddressArray(r.returnData) : null;
  const want = EXPECT[`clients:${id}`];
  const ok = (got ?? []).join(',') === want;
  console.log(`  getClients(${id}) -> [${(got ?? []).join(', ')}] ${ok ? 'OK' : `MISMATCH want [${want}]`}`);
  ok ? pass++ : fail++;
});
const unminted = decoded[decoded.length - 1]!;
const uok = unminted.success === false;
console.log(`  ownerOf(1999999) success=${unminted.success} ${uok ? 'OK (allowFailure worked)' : 'MISMATCH expected false'}`);
uok ? pass++ : fail++;

console.log(`\npass=${pass} fail=${fail}  requests=${stats.requests}`);
console.log('CU headers seen:', Object.keys(stats.cuHeaders).length ? stats.cuHeaders : '(none exposed)');
if (fail > 0) process.exit(1);
