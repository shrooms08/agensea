// Minimal ABI codec for Multicall3.aggregate3, hand-rolled to avoid adding a
// web3 dependency. Only the shapes this sweep actually uses are supported.
//
// Selectors below were computed with `cast sig`, not assumed:
//   aggregate3((address,bool,bytes)[])  0x82ad56cb
//   ownerOf(uint256)                    0x6352211e
//   getClients(uint256)                 0x42dd519c
//   getAgentWallet(uint256)             0x00339509
//   tokenURI(uint256)                   0xc87b56dd

export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';

export const SEL = {
  aggregate3: '82ad56cb',
  ownerOf: '6352211e',
  getClients: '42dd519c',
  getAgentWallet: '00339509',
  tokenURI: 'c87b56dd',
  getSummary: '81bbba58',
} as const;

const strip = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);
const word = (hexNoPrefix: string) => hexNoPrefix.padStart(64, '0');
export const uintWord = (n: bigint | number) => word(BigInt(n).toString(16));
export const addrWord = (a: string) => word(strip(a).toLowerCase());

/** selector + a single uint256 argument -> 36-byte calldata */
export const callUint = (selector: string, id: bigint | number) => selector + uintWord(id);

export interface Call3 {
  target: string;
  allowFailure: boolean;
  callData: string; // hex, no 0x
}

/**
 * Encode aggregate3((address,bool,bytes)[]).
 * Layout: head offset -> length -> N element offsets -> N tuples.
 * Each tuple is target, allowFailure, offset-to-bytes(0x60), byte length, data.
 */
export function encodeAggregate3(calls: Call3[]): string {
  const tuples = calls.map((c) => {
    const data = strip(c.callData);
    const byteLen = data.length / 2;
    const padded = data.padEnd(Math.ceil(byteLen / 32) * 64, '0');
    return addrWord(c.target) + uintWord(c.allowFailure ? 1 : 0) + uintWord(96) + uintWord(byteLen) + padded;
  });

  // Element offsets are relative to the start of the element-data region,
  // i.e. the word immediately after the array length.
  let cursor = calls.length * 32;
  const offsets: string[] = [];
  for (const t of tuples) {
    offsets.push(uintWord(cursor));
    cursor += t.length / 2;
  }

  return '0x' + SEL.aggregate3 + uintWord(32) + uintWord(calls.length) + offsets.join('') + tuples.join('');
}

export interface Result3 {
  success: boolean;
  returnData: string; // hex, no 0x
}

/** Decode ((bool,bytes)[]) */
export function decodeAggregate3(hex: string): Result3[] {
  const d = strip(hex);
  const at = (byteOffset: number) => d.slice(byteOffset * 2, byteOffset * 2 + 64);
  const num = (w: string) => parseInt(w, 16);

  const arrayAt = num(at(0));
  const len = num(at(arrayAt));
  const base = arrayAt + 32; // start of element offsets / element data

  const out: Result3[] = [];
  for (let i = 0; i < len; i++) {
    const tupleAt = base + num(at(base + i * 32));
    const success = num(at(tupleAt)) === 1;
    const bytesAt = tupleAt + num(at(tupleAt + 32));
    const byteLen = num(at(bytesAt));
    out.push({ success, returnData: d.slice((bytesAt + 32) * 2, (bytesAt + 32) * 2 + byteLen * 2) });
  }
  return out;
}

/** returnData of a function returning a single address */
export function decodeAddress(returnData: string): string | null {
  if (!returnData || returnData.length < 64) return null;
  return '0x' + returnData.slice(24, 64).toLowerCase();
}

/** returnData of a function returning address[] */
export function decodeAddressArray(returnData: string): string[] {
  if (!returnData || returnData.length < 128) return [];
  const len = parseInt(returnData.slice(64, 128), 16);
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const w = returnData.slice(128 + i * 64, 128 + i * 64 + 64);
    if (w.length === 64) out.push('0x' + w.slice(24).toLowerCase());
  }
  return out;
}

// --- Pass 2 additions -------------------------------------------------------

/** getSummary(uint256,address[],string,string) -> calldata (no 0x) */
export function callGetSummary(agentId: bigint | number, clients: string[], tag1 = '', tag2 = ''): string {
  const HEAD = 4 * 32;
  const clientsBody = uintWord(clients.length) + clients.map(addrWord).join('');
  const clientsBytes = clientsBody.length / 2;
  const tag1Off = HEAD + clientsBytes;
  // Both tags are empty in this sweep: a bare length-0 word each.
  const tag1Body = uintWord(0);
  const tag2Off = tag1Off + tag1Body.length / 2;
  const tag2Body = uintWord(0);
  return (
    SEL.getSummary +
    uintWord(agentId) +
    uintWord(HEAD) +
    uintWord(tag1Off) +
    uintWord(tag2Off) +
    clientsBody +
    tag1Body +
    tag2Body
  );
}

/** ABI int128 is sign-extended into a full 32-byte word. */
export function decodeInt(word: string): bigint {
  if (!word || word.length < 64) return 0n;
  const v = BigInt('0x' + word.slice(0, 64));
  const TWO256 = 1n << 256n;
  return v >= TWO256 / 2n ? v - TWO256 : v;
}

export interface Summary {
  count: bigint;
  value: bigint;
  decimals: number;
}

/** returnData of getSummary -> (uint64 count, int128 value, uint8 decimals) */
export function decodeSummary(returnData: string): Summary | null {
  if (!returnData || returnData.length < 192) return null;
  return {
    count: BigInt('0x' + returnData.slice(0, 64)),
    value: decodeInt(returnData.slice(64, 128)),
    decimals: Number(BigInt('0x' + returnData.slice(128, 192))),
  };
}

/** returnData of a function returning a single string */
export function decodeString(returnData: string): string {
  if (!returnData || returnData.length < 128) return '';
  const len = parseInt(returnData.slice(64, 128), 16);
  if (!Number.isFinite(len) || len === 0) return '';
  const hex = returnData.slice(128, 128 + len * 2);
  let out = '';
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return Buffer.from(out, 'binary').toString('utf8');
}

/** Encoded byte length of one Call3 inside an aggregate3 payload. */
export function call3Bytes(callDataHexNoPrefix: string): number {
  const dataBytes = callDataHexNoPrefix.length / 2;
  return 32 /*offset word*/ + 32 * 3 /*target, allowFailure, bytes-offset*/ + 32 /*len*/ + Math.ceil(dataBytes / 32) * 32;
}
