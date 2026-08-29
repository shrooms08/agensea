// Verify the getSummary encode/decode against agentId 1, whose values were
// confirmed with `cast` in Step 1: count=2, summaryValue=100, decimals=0.
import { ethCall } from './rpc.ts';
import { MULTICALL3, SEL, callUint, callGetSummary, encodeAggregate3, decodeAggregate3,
         decodeAddressArray, decodeSummary, decodeString } from './multicall.ts';

const IDENTITY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const REPUTATION = '0x8004baa17c55a88189ae136b182e5fda19de9b63';

const c = await ethCall(REPUTATION, '0x' + callUint(SEL.getClients, 1));
const clients = decodeAddressArray(c.result!.slice(2));
console.log('getClients(1) =', clients);

const calls = [
  { target: REPUTATION, allowFailure: true, callData: callGetSummary(1, clients) },
  { target: IDENTITY,   allowFailure: true, callData: callUint(SEL.tokenURI, 1) },
];
const r = await ethCall(MULTICALL3, encodeAggregate3(calls));
if (r.error) throw new Error(`multicall error: ${r.error.message}`);
const out = decodeAggregate3(r.result!);

const s = out[0]!.success ? decodeSummary(out[0]!.returnData) : null;
console.log('getSummary(1) success=%s ->', out[0]!.success, s);
const uri = out[1]!.success ? decodeString(out[1]!.returnData) : '';
console.log('tokenURI(1) =', uri.slice(0, 90));

const ok = s !== null && s.count === 2n && s.value === 100n && s.decimals === 0;
console.log(ok ? '\nVERIFIED: count=2 value=100 decimals=0 — codec matches cast'
              : `\nMISMATCH: expected count=2 value=100 decimals=0, got ${JSON.stringify(s, (_k,v)=>typeof v==='bigint'?v.toString():v)}`);
if (!ok) process.exit(1);
