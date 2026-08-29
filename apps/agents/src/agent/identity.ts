/**
 * Agent 1 identity record (ERC-8004).
 *
 * We use a `data:application/json;base64,…` URI rather than hosting JSON.
 * Reasons: (1) the SDK's registerErc8004Agent is built around a data: URI;
 * (2) no hosting dependency — Phase 1b measured 59/59 build4.io agent URIs
 * returning 404, i.e. hosted metadata rots; (3) it always resolves and is
 * verifiable offline; (4) 55% of live chain-56 agents already use data: URIs.
 */
export const AGENT_RECORD = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Venus Health Factor Monitor',
  description:
    'Reads any wallet\'s Venus Protocol lending position and returns its health factor, ' +
    'collateral, borrowings, per-market liquidation thresholds, and a plain-language risk ' +
    'recommendation. Read-only analysis over eth_call; supports BNB Chain mainnet (56) and testnet (97).',
  image: 'https://raw.githubusercontent.com/VenusProtocol/venus-protocol/main/logo.png',
  category: 'health-factor-monitoring',
  services: [
    { name: 'x402', endpoint: 'https://agensea-health-factor.vercel.app/x402' },
    { name: 'erc8183', endpoint: 'onchain:AgenticCommerce.submit' },
  ],
  x402Support: true,
  active: true,
  supportedTrust: ['reputation'],
  registrations: [] as { agentId: number; agentRegistry: string }[],
};

export type AgentRecord = typeof AGENT_RECORD;

/** data:application/json;base64,… — built here so our extra fields survive verbatim. */
export function toAgentUri(record: unknown): string {
  return 'data:application/json;base64,' + Buffer.from(JSON.stringify(record), 'utf8').toString('base64');
}

export function fromAgentUri(uri: string): unknown {
  const i = uri.indexOf(',');
  return JSON.parse(Buffer.from(uri.slice(i + 1), 'base64').toString('utf8'));
}
