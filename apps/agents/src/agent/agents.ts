/** The three Phase 3b agents. Same pattern as Agent 1 — identity, session, analysis. */
export interface AgentDef {
  key: 'agent2' | 'agent3' | 'agent4';
  name: string; category: string; description: string;
  skill: string;
}

export const AGENTS: AgentDef[] = [
  { key: 'agent2', name: 'PancakeSwap V3 Rebalancing Monitor', category: 'rebalancing',
    skill: 'pancakeswap-v3-rebalance',
    description:
      'Analyses a PancakeSwap V3 concentrated-liquidity position: whether price is in or out of range, ' +
      'position composition, uncollected fees, range width and headroom to the nearest edge, and a ' +
      'recommended re-centred range with reasoning. Reads V3 contracts directly — the Altana ' +
      'PancakeSwap Liquidity skill is V2-only and explicitly excludes concentrated liquidity.' },
  { key: 'agent3', name: 'Grid Trading Parameter Advisor', category: 'grid-trading',
    skill: 'grid-parameters',
    description:
      'Measures realised volatility and liquidity for a PancakeSwap V3 pair from the pool\'s own TWAP ' +
      'oracle, then recommends grid bounds, level count, capital per level and expected fill frequency. ' +
      'States the data window and every assumption; makes no backtest claim.' },
  { key: 'agent4', name: 'BSC Yield Route Optimiser', category: 'yield-optimisation',
    skill: 'yield-route',
    description:
      'Compares live supply APR for an asset across Venus, Aave V3 and Lista on BNB Chain, reading rates ' +
      'on-chain rather than from cached figures, and recommends the best route including gas cost to ' +
      'switch and the break-even holding period.' },
];

export function recordFor(a: AgentDef) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: a.name,
    description: a.description,
    category: a.category,
    services: [
      { name: 'x402', endpoint: `https://agensea-${a.category}.vercel.app/x402` },
      { name: 'erc8183', endpoint: 'onchain:AgenticCommerce.submit' },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ['reputation'],
    registrations: [] as { agentId: number; agentRegistry: string }[],
  };
}
