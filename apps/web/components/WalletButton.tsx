'use client';
/**
 * Header wallet control, all pages. Connect (injected only) -> enforce chain
 * 97 via switchChain (wagmi falls back to wallet_addEthereumChain with the
 * full testnet params from the chain definition). Wrong chain renders a
 * BLOCKING banner, never a silent failure. Connected: truncated address +
 * live tBNB and $U balances.
 */
import { useAccount, useBalance, useConnect, useDisconnect, useReadContract, useSwitchChain } from 'wagmi';
import { formatUnits, parseAbi } from 'viem';
import { useEffect, useState } from 'react';
import { bscTestnet97, U_TOKEN } from '@/lib/wallet/config';

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const fmt = (v: bigint | undefined, dp: number) => (v === undefined ? '…' : Number(formatUnits(v, 18)).toFixed(dp));

export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // chainId here is the WALLET's actual chain (undefined chain object when it
  // sits on a network we did not configure) — never the config default.
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  const wrongChain = isConnected && walletChainId !== bscTestnet97.id;
  const { data: bnb } = useBalance({ address, chainId: bscTestnet97.id, query: { enabled: !!address, refetchInterval: 15_000 } });
  const { data: u } = useReadContract({ address: U_TOKEN, abi: ERC20, functionName: 'balanceOf',
    args: address ? [address] : undefined, chainId: bscTestnet97.id, query: { enabled: !!address, refetchInterval: 15_000 } });

  // On connect, steer to 97 once, automatically; the banner covers refusal.
  useEffect(() => {
    if (isConnected && wrongChain && !switching) switchChain({ chainId: bscTestnet97.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, wrongChain]);

  if (!mounted) return <span className="wallet-slot" />;

  if (!isConnected) {
    return (
      <button className="wallet-connect" disabled={isPending}
        onClick={() => { const c = connectors[0]; if (c) connect({ connector: c }); }}>
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
    );
  }

  return (
    <>
      <div className="wallet-chip" title={address}>
        <span className="wallet-bal">{fmt(bnb?.value, 4)} tBNB</span>
        <span className="wallet-bal">{fmt(u as bigint | undefined, 1)} $U</span>
        <button className="wallet-addr" onClick={() => disconnect()} title="Disconnect">
          {address?.slice(0, 6)}…{address?.slice(-4)}
        </button>
      </div>
      {wrongChain && (
        <div className="chain-banner" role="alert">
          <span className="data">
            Wrong network — this site runs on BNB Smart Chain Testnet (97), your wallet is on chain {walletChainId ?? 'unknown'}.
          </span>
          <button className="wallet-connect" disabled={switching} onClick={() => switchChain({ chainId: bscTestnet97.id })}>
            {switching ? 'Switching…' : 'Switch to testnet 97'}
          </button>
        </div>
      )}
    </>
  );
}
