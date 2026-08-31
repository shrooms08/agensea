/**
 * POST /api/faucet-claim — top up the demo buyer wallet from the testnet $U
 * faucet (10 $U per address per 30 minutes, requestTokens(), no gate).
 *
 * WHY: the buyer wallet only ever drains (each hire's 1 $U settles to the
 * provider), so without this the sponsored demo has a hard budget. Keepalive
 * calls this every 6 hours -> ~40 $U/day in against a 6/day spend cap.
 *
 * Auth: Authorization: Bearer $REVALIDATE_SECRET, the same constant-time
 * check as /api/revalidate. The buyer key stays in Vercel env (DEMO_BUYER_KEY,
 * already there for the hire route) — it is never put in GitHub secrets.
 *
 * The 30-minute cooldown is a normal state, not an error: allowedToWithdraw
 * is read first and a cooldown returns 200 {status:"cooldown"}.
 *
 * Selectors via cast sig: requestTokens() = 0x359cf2b7,
 * allowedToWithdraw(address) = 0x2d291cad.
 */
import { timingSafeEqual } from 'node:crypto';
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { ERC8183 } from '@/data/first-party-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const FAUCET = '0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3' as const;
const RPC = 'https://bsc-testnet-rpc.publicnode.com';
const FAUCET_ABI = parseAbi(['function requestTokens()', 'function allowedToWithdraw(address) view returns (bool)']);
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

function authorised(header: string | null): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false;                       // fail closed
  const presented = header?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(presented), b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorised(req.headers.get('authorization'))) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }
  const key = process.env.DEMO_BUYER_KEY?.trim();
  if (!key) return Response.json({ ok: false, error: 'buyer key not configured' }, { status: 503 });

  const account = privateKeyToAccount(key as `0x${string}`);
  const pub = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  const balances = async () => {
    const [u, tbnb] = await Promise.all([
      pub.readContract({ address: ERC8183.paymentToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
      pub.getBalance({ address: account.address }),
    ]);
    return { balanceU: Number(formatUnits(u, 18)), tbnb: Number(formatEther(tbnb)) };
  };

  try {
    const allowed = await pub.readContract({ address: FAUCET, abi: FAUCET_ABI, functionName: 'allowedToWithdraw', args: [account.address] });
    if (!allowed) {
      return Response.json({ ok: true, status: 'cooldown', address: account.address, ...(await balances()) });
    }
    const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(RPC) });
    const tx = await wallet.writeContract({ address: FAUCET, abi: FAUCET_ABI, functionName: 'requestTokens' });
    const receipt = await pub.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
    if (receipt.status !== 'success') {
      return Response.json({ ok: false, status: 'reverted', tx }, { status: 502 });
    }
    const costWei = receipt.gasUsed * receipt.effectiveGasPrice;
    return Response.json({
      ok: true, status: 'claimed', address: account.address, tx,
      gasUsed: Number(receipt.gasUsed), gasPriceGwei: Number(formatUnits(receipt.effectiveGasPrice, 9)),
      costTbnb: Number(formatEther(costWei)),
      ...(await balances()),
    });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
