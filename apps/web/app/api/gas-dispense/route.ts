/**
 * tBNB dispenser — testnet gas for judges. Treated as a drain target from the
 * first line:
 *
 *  - The recipient is NEVER taken from the request body. GET issues an
 *    HMAC-signed nonce; the caller signs the canonical message with the
 *    RECEIVING wallet; POST recovers the signer and that recovered address is
 *    the only possible recipient. curl without the key gets nothing.
 *  - Eligibility, all server-side, in order: signature + nonce freshness,
 *    recovered address balance < 0.003 tBNB (read from OUR rpc at request
 *    time), then the hard floor — refuse when the platform wallet would drop
 *    below 0.03 tBNB — and only then the permit: never-dispensed-before
 *    (permanent, demo_gas_permit), 1/IP/day, 8/global/day. The floor comes
 *    BEFORE the permit deliberately: the permit WRITES the grant row, and a
 *    floor refusal after it would consume a one-time grant and a daily slot
 *    while sending nothing.
 *  - Fixed amount: 0.005 tBNB. Every dispense is logged (address, ip hash,
 *    tx) to the runtime log; the permit row is the durable ledger.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverMessageAddress } from 'viem';
import { bscTestnet97 } from '@/lib/wallet/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const AMOUNT = parseEther('0.005');
const NEEDY_BELOW = parseEther('0.003');
const FLOOR = parseEther('0.03');
const NONCE_TTL_MS = 5 * 60_000;
const RPC = 'https://bsc-testnet-rpc.publicnode.com';

const hmacKey = () => {
  const s = process.env.REVALIDATE_SECRET;
  if (!s) throw new Error('secret not configured');
  return createHash('sha256').update('agensea-gas-dispense:' + s).digest();
};
const signNonce = (nonce: string, exp: number) =>
  createHmac('sha256', hmacKey()).update(`${nonce}.${exp}`).digest('hex');
const messageFor = (nonce: string, exp: number) =>
  `AgenSea testnet gas dispenser\n\nSigning proves you control the receiving wallet.\nNo transaction is authorised by this signature.\n\nnonce: ${nonce}\nexpires: ${exp}`;

export async function GET() {
  const nonce = randomBytes(16).toString('hex');
  const exp = Date.now() + NONCE_TTL_MS;
  return Response.json({ nonce, exp, mac: signNonce(nonce, exp), message: messageFor(nonce, exp) });
}

export async function POST(req: Request) {
  let body: { nonce?: string; exp?: number; mac?: string; signature?: string };
  try { body = await req.json(); } catch { return Response.json({ error: 'bad request' }, { status: 400 }); }
  const { nonce, exp, mac, signature } = body;
  if (!nonce || !exp || !mac || !signature) return Response.json({ error: 'bad request' }, { status: 400 });
  // nonce must be OURS and fresh
  const expect = signNonce(nonce, exp);
  if (mac.length !== expect.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) {
    return Response.json({ error: 'invalid nonce' }, { status: 401 });
  }
  if (Date.now() > exp) return Response.json({ error: 'nonce expired — request a fresh one' }, { status: 401 });

  // recover the signer: THIS is the only address funds can go to
  let recipient: `0x${string}`;
  try {
    recipient = await recoverMessageAddress({ message: messageFor(nonce, exp), signature: signature as `0x${string}` });
  } catch { return Response.json({ error: 'signature does not verify' }, { status: 401 }); }

  const pub = createPublicClient({ chain: bscTestnet97, transport: http(RPC) });

  // on-chain need check, from OUR rpc, at request time
  const bal = await pub.getBalance({ address: recipient });
  if (bal >= NEEDY_BELOW) {
    return Response.json({ error: `this wallet already holds ${Number(formatEther(bal)).toFixed(4)} tBNB — the dispenser is for empty wallets (below 0.003)`, reason: 'not-needy' }, { status: 409 });
  }

  // HARD FLOOR ON THE PLATFORM WALLET — CHECKED BEFORE THE PERMIT IS TAKEN.
  // The permit row is the durable ledger and is written by demo_gas_permit
  // itself, so taking it first would mean a floor refusal burned the address's
  // PERMANENT one-time grant and a global slot while sending nothing. The floor
  // exists for exactly the moment the wallet runs low, which is when a wasted
  // grant costs most. Nothing below this point can refuse for a reason we could
  // have known before spending the grant.
  const key = process.env.DEMO_ADMIN_KEY?.trim();
  if (!key) return Response.json({ error: 'dispenser not configured' }, { status: 503 });
  const platform = privateKeyToAccount(key as `0x${string}`);
  const platformBal = await pub.getBalance({ address: platform.address });
  if (platformBal - AMOUNT < FLOOR) {
    return Response.json({ error: 'the gas dispenser is exhausted — it refuses to drop below its reserve; ask us to top it up', reason: 'floor' }, { status: 503 });
  }

  // permanent + daily limits, atomically. This WRITES the grant row, so it is
  // the last thing that can fail before the transfer is attempted.
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
  const ipHash = createHash('sha256').update('agensea-demo:' + ip).digest('hex');
  const base = process.env.SUPABASE_URL!.replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY!;
  let permit: { allowed: boolean; reason: string } | null = null;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/demo_gas_permit`, {
      method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_ip_hash: ipHash, p_address: recipient }),
      cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    permit = ((await r.json()) as { allowed: boolean; reason: string }[])?.[0] ?? null;
  } catch { /* fail closed below */ }
  if (!permit) return Response.json({ error: 'dispenser limiter unavailable — disabled rather than unmetered' }, { status: 503 });
  if (!permit.allowed) {
    const msg = permit.reason === 'address-already-dispensed'
      ? 'this wallet has already received its one-time gas grant'
      : permit.reason === 'ip' ? 'gas grant limit reached for your connection (1 per day) — try again tomorrow'
      : permit.reason === 'global' ? 'the gas dispenser is empty for today (8 grants per day) — try again tomorrow'
      : 'request refused';
    return Response.json({ error: msg, reason: permit.reason }, { status: 429 });
  }

  try {
    const wallet = createWalletClient({ account: platform, chain: bscTestnet97, transport: http(RPC) });
    const tx = await wallet.sendTransaction({ to: recipient, value: AMOUNT });
    await pub.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
    console.info(`[gas-dispense] 0.005 tBNB -> ${recipient} ip=${ipHash.slice(0, 12)} tx=${tx}`);
    return Response.json({ ok: true, tx, amount: '0.005' });
  } catch (e) {
    console.info(`[gas-dispense] SEND FAILED -> ${recipient} ip=${ipHash.slice(0, 12)}: ${String((e as Error).message).slice(0, 120)}`);
    return Response.json({ error: 'the transfer did not confirm — the grant was consumed; contact us if the tBNB never arrives' }, { status: 502 });
  }
}
