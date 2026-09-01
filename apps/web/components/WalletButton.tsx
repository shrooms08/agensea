'use client';
/**
 * Header wallet control, all pages. Connect (injected only) -> enforce chain
 * 97 via switchChain (wagmi falls back to wallet_addEthereumChain with the
 * full testnet params from the chain definition). Wrong chain renders a
 * BLOCKING banner, never a silent failure. Connected: an inverse pill with the
 * truncated address (click to disconnect). Balances live in the agent page's
 * preflight box, where they are actionable — the header stays clean.
 */
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { useEffect, useState } from 'react';
import { bscTestnet97 } from '@/lib/wallet/config';


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
      <button className="wallet-pill" onClick={() => disconnect()} title={`${address} — click to disconnect`}>
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </button>
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
