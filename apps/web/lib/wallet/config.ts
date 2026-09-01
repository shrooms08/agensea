/**
 * wagmi config — BNB Smart Chain Testnet (97) ONLY, injected connectors only
 * (MetaMask, Rabby). No WalletConnect cloud dependency. The chain definition
 * carries full add-chain params so wallet_switchEthereumChain can fall back
 * to wallet_addEthereumChain with everything a cold wallet needs.
 */
import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';

export const bscTestnet97 = defineChain({
  id: 97,
  name: 'BNB Smart Chain Testnet',
  nativeCurrency: { name: 'Testnet BNB', symbol: 'tBNB', decimals: 18 },
  rpcUrls: { default: { http: ['https://bsc-testnet-rpc.publicnode.com'] } },
  blockExplorers: { default: { name: 'BscScan Testnet', url: 'https://testnet.bscscan.com' } },
  testnet: true,
});

export const U_TOKEN = '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565' as const;
export const U_FAUCET = '0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3' as const;

export const wagmiConfig = createConfig({
  chains: [bscTestnet97],
  connectors: [injected()],
  transports: { [bscTestnet97.id]: http() },
  ssr: true,
});
