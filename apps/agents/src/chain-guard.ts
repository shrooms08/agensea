/**
 * Runtime chain assertion.
 *
 * Config drifts silently. The MCP server and the SDK BOTH fall back to BNB
 * MAINNET (chain 56) when the network is unset — @altananetwork/mcp resolves
 * `NETWORKS[requestedChain] ?? BNB`. A misconfigured run would therefore sign
 * real-value mainnet transactions while looking identical in the logs.
 *
 * So this does not trust config. It reads the chain id BACK off the wire from
 * the RPC the client is actually configured to use, and throws unless it is 97.
 * Called on boot, before any signer is constructed.
 */
import type { NetworkConfig } from '@altananetwork/sdk';

export const REQUIRED_CHAIN_ID = 97;

export class WrongChainError extends Error {
  constructor(message: string) { super(message); this.name = 'WrongChainError'; }
}

export async function assertChain97(network: NetworkConfig, clientChainIds: readonly number[]): Promise<void> {
  // 1. what the SDK thinks it is configured for
  if (network.chainId !== REQUIRED_CHAIN_ID) {
    throw new WrongChainError(`network config is chainId ${network.chainId}, refusing to run on anything but ${REQUIRED_CHAIN_ID}`);
  }
  for (const id of clientChainIds) {
    if (id !== REQUIRED_CHAIN_ID) {
      throw new WrongChainError(`client is configured with chainId ${id}; only ${REQUIRED_CHAIN_ID} is permitted`);
    }
  }
  // 2. what the endpoint actually reports - the check that catches a wrong URL
  const res = await fetch(network.publicRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new WrongChainError(`chain id read failed: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string };
  const live = body.result ? parseInt(body.result, 16) : NaN;
  if (live !== REQUIRED_CHAIN_ID) {
    throw new WrongChainError(`RPC ${network.publicRpcUrl} reports chainId ${live}, expected ${REQUIRED_CHAIN_ID}. REFUSING TO PROCEED.`);
  }
  // 3. the env var the MCP server keys off, so both paths agree
  const envChain = process.env.ALTANA_CHAIN;
  if (envChain !== undefined && envChain !== String(REQUIRED_CHAIN_ID)) {
    throw new WrongChainError(`ALTANA_CHAIN=${envChain} disagrees with required ${REQUIRED_CHAIN_ID}`);
  }
}
