'use client';
/**
 * Preflight for wallet-native hiring, on /marketplace/[id].
 *
 * Reads the CONNECTED wallet's $U and tBNB. If either is short of what one
 * hire needs (1 $U + gas), shows a "Get testnet funds" box:
 *   - tBNB: our dispenser. Sign a server nonce with the receiving wallet
 *     (ownership proof — the server sends only to the recovered signer),
 *     then POST. Fixed 0.005, one-time per address, capped daily.
 *   - $U: requestTokens() on the public faucet, sent from THEIR wallet
 *     (10 $U / address / 30 min). Cooldown read from allowedToWithdraw.
 * The box is the gate: the wallet hire CTA stays disabled until this
 * reports ready (wired in the buyer-flow step).
 */
import { useAccount, useBalance, useReadContract, useSignMessage, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseAbi, parseEther } from 'viem';
import { useState } from 'react';
import { bscTestnet97, U_TOKEN, U_FAUCET } from '@/lib/wallet/config';

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const FAUCET_ABI = parseAbi(['function requestTokens()', 'function allowedToWithdraw(address) view returns (bool)']);
const NEED_U = parseEther('1');          // price of one hire
const NEED_GAS = parseEther('0.0005');   // approve+create+fund at testnet gas, with slack
const DISPENSE_BELOW = parseEther('0.003');

export function useWalletFunding() {
  const { address, isConnected, chainId } = useAccount();
  const { data: bnb, refetch: refetchBnb } = useBalance({ address, chainId: bscTestnet97.id, query: { enabled: !!address, refetchInterval: 12_000 } });
  const { data: u, refetch: refetchU } = useReadContract({ address: U_TOKEN, abi: ERC20, functionName: 'balanceOf',
    args: address ? [address] : undefined, chainId: bscTestnet97.id, query: { enabled: !!address, refetchInterval: 12_000 } });
  const uBal = (u as bigint | undefined) ?? undefined;
  return {
    address, isConnected, onChain97: chainId === bscTestnet97.id,
    bnb: bnb?.value, u: uBal,
    shortGas: bnb !== undefined && bnb.value < NEED_GAS,
    shortU: uBal !== undefined && uBal < NEED_U,
    canDispense: bnb !== undefined && bnb.value < DISPENSE_BELOW,
    ready: bnb !== undefined && uBal !== undefined && bnb.value >= NEED_GAS && uBal >= NEED_U,
    refetch: () => { void refetchBnb(); void refetchU(); },
  };
}

export function HirePreflight() {
  const f = useWalletFunding();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<'gas' | 'u' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [claimTx, setClaimTx] = useState<`0x${string}` | undefined>();
  const { isSuccess: claimed } = useWaitForTransactionReceipt({ hash: claimTx, chainId: bscTestnet97.id });
  const { data: faucetOpen } = useReadContract({ address: U_FAUCET, abi: FAUCET_ABI, functionName: 'allowedToWithdraw',
    args: f.address ? [f.address] : undefined, chainId: bscTestnet97.id, query: { enabled: !!f.address && f.shortU, refetchInterval: 30_000 } });

  if (!f.isConnected) {
    return (
      <div className="preflight">
        <span className="data" style={{ color: 'var(--text-muted)' }}>
          Connect a wallet (top right) to hire this agent with your own funds — BNB Smart Chain Testnet (97), real transactions, ~1 minute from empty wallet to settled job.
        </span>
      </div>
    );
  }
  if (f.ready) {
    return (
      <div className="preflight">
        <span className="data" style={{ color: 'var(--live)' }}>
          Wallet funded — {Number(formatEther(f.u!)).toFixed(1)} $U and {Number(formatEther(f.bnb!)).toFixed(4)} tBNB. Ready to hire.
        </span>
      </div>
    );
  }
  if (f.bnb === undefined || f.u === undefined) {
    return <div className="preflight"><span className="data" style={{ color: 'var(--text-faint)' }}>reading wallet balances…</span></div>;
  }

  async function getGas() {
    setBusy('gas'); setNote(null);
    try {
      const n = await (await fetch('/api/gas-dispense')).json() as { nonce: string; exp: number; mac: string; message: string };
      const signature = await signMessageAsync({ message: n.message });
      const r = await fetch('/api/gas-dispense', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonce: n.nonce, exp: n.exp, mac: n.mac, signature }) });
      const j = await r.json() as { ok?: boolean; tx?: string; error?: string };
      setNote(r.ok ? `0.005 tBNB sent — tx ${j.tx?.slice(0, 14)}…` : j.error ?? `HTTP ${r.status}`);
      f.refetch();
    } catch { setNote('signature request cancelled — nothing sent'); }
    setBusy(null);
  }
  async function getU() {
    setBusy('u'); setNote(null);
    try {
      const tx = await writeContractAsync({ address: U_FAUCET, abi: FAUCET_ABI, functionName: 'requestTokens', chainId: bscTestnet97.id });
      setClaimTx(tx);
      setNote(`faucet claim submitted — tx ${tx.slice(0, 14)}…`);
    } catch { setNote('transaction cancelled — nothing sent'); }
    setBusy(null);
  }
  if (claimed) f.refetch();

  return (
    <div className="preflight preflight-short">
      <div className="label" style={{ fontSize: 9 }}>get testnet funds — one hire needs 1 $U + a little gas</div>
      <div className="preflight-rows">
        {f.shortGas && (
          f.canDispense ? (
            <button className="wallet-connect" disabled={busy !== null} onClick={getGas}>
              {busy === 'gas' ? 'Sign in your wallet…' : 'Get 0.005 tBNB for gas'}
            </button>
          ) : <span className="data" style={{ color: 'var(--text-muted)' }}>gas: {Number(formatEther(f.bnb)).toFixed(4)} tBNB — enough is on the way once pending transactions land</span>
        )}
        {!f.shortGas && f.shortU && (
          faucetOpen === false ? (
            <span className="data" style={{ color: 'var(--warn)' }}>$U faucet cooldown — 10 $U per address per 30 minutes; try again shortly</span>
          ) : (
            <button className="wallet-connect" disabled={busy !== null} onClick={getU}>
              {busy === 'u' ? 'Confirm in your wallet…' : 'Get 10 $U (faucet, from your wallet)'}
            </button>
          )
        )}
        {f.shortGas && f.shortU && <span className="data" style={{ color: 'var(--text-muted)' }}>gas first — the $U faucet claim is a transaction and needs it</span>}
      </div>
      {note && <div className="data" style={{ marginTop: 10, color: 'var(--warn)' }}>{note}</div>}
    </div>
  );
}
