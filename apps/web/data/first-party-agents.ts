/**
 * AgenSea first-party agents.
 *
 * These four live on BNB Smart Chain TESTNET (chain 97). They are deliberately
 * NOT in the Supabase tables, which hold BSC MAINNET (chain 56) registry data.
 * Never merge the two sets without labelling the chain — they are different
 * networks and conflating them would misrepresent both.
 *
 * Every value here is measured, not estimated. Sources:
 *   agentId / jobId / hashes  — on-chain, chain 97
 *   timeToDeliverableMs       — wall-clock funded -> submitted, Phase 3a/3b
 *   spendCapWei               — the session's actual granted cap
 * Four records that change rarely: a static committed config, not a table.
 */

export const CHAIN = {
  id: 97,
  name: 'BNB Smart Chain Testnet',
  short: 'testnet 97',
  explorer: 'https://testnet.bscscan.com',
} as const;

/** ERC-8183 stack on chain 97. The policy is the whitelisted one, not the
 *  address @altananetwork/sdk ships (see README footgun 4). */
export const ERC8183 = {
  commerce: '0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE',
  router: '0xD7d36D66d2F1B608A0F943f722D27e3744f66F25',
  policy: '0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA',
  paymentToken: '0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565',
  registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
} as const;

/** The published wallet all four agents act through (EIP-7702 smart account
 *  = admin signer EOA). Provider on every chain-97 job; owner of the mainnet
 *  identity 322885. */
export const AGENTS_WALLET = '0x85d32d525E1812FeE7001f34DD6dd86154619090';

/** Global on the OptimisticPolicy. A seller cannot shorten it. */
export const DISPUTE_WINDOW_SECONDS = 900;

export type CategorySlug =
  | 'health-factor-monitoring'
  | 'rebalancing'
  | 'grid-trading'
  | 'yield-optimisation';

export interface CallPermission {
  signature: string;
  to: string;
}

export interface CompletedJob {
  jobId: string;
  status: 'COMPLETED' | 'SUBMITTED';
  deliverableHash: string;
  /** Wall-clock funded -> deliverable submitted. */
  timeToDeliverableMs: number;
  /** Analysis alone, excluding transport. */
  analysisMs: number;
  /** True when timeToDeliverableMs is dominated by relay transport failure
   *  rather than agent work — must be disclosed wherever the number is shown. */
  transportAnomaly?: string;
  /** Settlement tx on chain 97, recorded by the settle scripts (hire-arm.json).
   *  Only jobs with this field can appear in the footer's LAST JOB strip. */
  settleTx?: string;
}

export interface FirstPartyAgent {
  agentId: number;
  /** ERC-8004 identity on BSC MAINNET (56), where registered. Only agent 2012
   *  carries one — the other three were deliberately not registered (one
   *  mainnet identity is sufficient; see mainnet_register_56.ts). */
  mainnetAgentId?: number;
  mainnetRegisterTx?: string;
  slug: CategorySlug;
  name: string;
  description: string;
  /** Price per hire, in $U raw units (18 decimals). */
  priceRaw: string;
  priceLabel: string;
  session: {
    address: string;
    calls: CallPermission[];
    spendCapWei: string;
    spendCapLabel: string;
    expiryUnix: number;
  };
  jobs: CompletedJob[];
  /** The protocol(s) this agent reads, in one clause. Lives here rather than in
   *  a page so /compare and the agent pages cannot describe it differently. */
  reads: string;
  /** What the agent reads. Analysis may target mainnet even though the agent
   *  itself settles on testnet — state both. */
  analysisChainId: 56 | 97;
}

const SUBMIT_ONLY: CallPermission[] = [
  { signature: 'submit(uint256,bytes32,bytes)', to: ERC8183.commerce },
];

export const FIRST_PARTY_AGENTS: FirstPartyAgent[] = [
  {
    agentId: 2012,
    reads: 'Venus Protocol',
    mainnetAgentId: 322885,
    mainnetRegisterTx: '0x381cff9788d7c6866f56609035a49fa9dca78ed01540884b0557beec4b377807',
    slug: 'health-factor-monitoring',
    name: 'Venus Health Factor Monitor',
    description:
      "Reads any wallet's Venus Protocol lending position and returns its health factor, collateral, " +
      'borrowings, per-market liquidation thresholds, and a plain-language risk recommendation.',
    priceRaw: '1000000000000000000',
    priceLabel: '1 $U',
    session: {
      address: '0x9eE5F336f25bD814f1625C9Ec959Cd4974055bf1',
      calls: SUBMIT_ONLY,
      spendCapWei: '1780070842932652',
      spendCapLabel: '0.00178 tBNB / hour',
      expiryUnix: 1790726400,
    },
    jobs: [{
      jobId: '748', status: 'COMPLETED',
      deliverableHash: '0xac4c18558a1c73251ecde27d77395bf4ed499a417980f15e984b31253fc43974',
      timeToDeliverableMs: 73444, analysisMs: 12787,
    },
    {
      jobId: '795', status: 'COMPLETED',
      settleTx: '0xe5a6f956da70cc90ac94029419b6a2cd8eb808b214398c7f67f4f24bc016a86a',
      deliverableHash: '0x91bf1d0f12b1273a5da70cf7ca22d9e4e54550fd7c1873df1c6cbf45adedf1e1',
      timeToDeliverableMs: 28976, analysisMs: 12952,
    }],
    analysisChainId: 56,
  },
  {
    agentId: 2013,
    reads: 'PancakeSwap V3',
    slug: 'rebalancing',
    name: 'PancakeSwap V3 Rebalancing Monitor',
    description:
      'Analyses a PancakeSwap V3 concentrated-liquidity position: in or out of range, composition, ' +
      'uncollected fees, range width and headroom, and a recommended re-centred range.',
    priceRaw: '1000000000000000000',
    priceLabel: '1 $U',
    session: {
      address: '0x74D56BB9349Af2c6CD980cBaA6dCe90ce4Df5894',
      calls: SUBMIT_ONLY,
      spendCapWei: '94210600000000',
      spendCapLabel: '0.0000942 tBNB / hour',
      expiryUnix: 1790726400,
    },
    jobs: [{
      jobId: '757', status: 'COMPLETED',
      deliverableHash: '0x9265db4ab38322fd1b76bd704b1cbfcd023356f0d154bc6ca909c0c9bd4bd5e9',
      timeToDeliverableMs: 248354, analysisMs: 3816,
      transportAnomaly:
        'Two relay timeouts of ~245s preceded the successful submit. Analysis itself took 3.8s. ' +
        'The 248s figure is transport, not agent latency.',
    },
    {
      jobId: '796', status: 'COMPLETED',
      settleTx: '0xc336e6d42ed28f10cc7edf26038a34d6d93de04c32023d24ffd71635c7e12a2e',
      deliverableHash: '0x4f873233aa4443e65a2507b9c8dcc3f00c6b6a2926530ebc2adb73c04b99d0ad',
      timeToDeliverableMs: 19977, analysisMs: 4154,
    }],
    analysisChainId: 56,
  },
  {
    agentId: 2014,
    reads: "PancakeSwap V3's own TWAP oracle",
    slug: 'grid-trading',
    name: 'Grid Trading Parameter Advisor',
    description:
      "Measures realised volatility and liquidity for a PancakeSwap V3 pair from the pool's own TWAP " +
      'oracle, then recommends grid bounds, level count, capital per level and expected fill frequency.',
    priceRaw: '1000000000000000000',
    priceLabel: '1 $U',
    session: {
      address: '0x9376991c8A0B93Bd9837dF2022a168b6bd6Ed9e8',
      calls: SUBMIT_ONLY,
      spendCapWei: '94210600000000',
      spendCapLabel: '0.0000942 tBNB / hour',
      expiryUnix: 1790726400,
    },
    jobs: [{
      jobId: '754', status: 'COMPLETED',
      deliverableHash: '0x7923d665c028295136f83593a8afef43b420ad81d8e69c3bef6eaaa9c1af9600',
      timeToDeliverableMs: 11751, analysisMs: 5227,
    }],
    analysisChainId: 56,
  },
  {
    agentId: 2015,
    reads: 'Venus, Aave V3 and Lista',
    slug: 'yield-optimisation',
    name: 'BSC Yield Route Optimiser',
    description:
      'Compares live supply APR for an asset across Venus, Aave V3 and Lista on BNB Chain, reading rates ' +
      'on-chain, and recommends the best route including gas cost to switch and break-even holding period.',
    priceRaw: '1000000000000000000',
    priceLabel: '1 $U',
    session: {
      address: '0x8fd56cb9dbD92EB48528c3446D9b427e130338dA',
      calls: SUBMIT_ONLY,
      spendCapWei: '94210600000000',
      spendCapLabel: '0.0000942 tBNB / hour',
      expiryUnix: 1790726400,
    },
    jobs: [
      {
        jobId: '753', status: 'COMPLETED',
        deliverableHash: '0x58bb1271cb01d9a061d23caacf5064c621c88f77fed2c634a2ce199d31195c97',
        timeToDeliverableMs: 8030, analysisMs: 2404,
      },
      {
        jobId: '765', status: 'COMPLETED',
        deliverableHash: '0xe5d51d1201cffcde729f931ac8f6680bcc4116618c3c21c421d71b2d5a4818bc',
        timeToDeliverableMs: 9532, analysisMs: 2404,
      },
      {
        jobId: '797', status: 'COMPLETED',
      settleTx: '0x92cbcc4bafdb895cc4645f862032af30c7cad211d498339c2474f155ffa9f4e7',
        deliverableHash: '0x0ee064d6b1ca9403f58daa793e7391c017279066a1594ab9f4dba8285368c654',
        timeToDeliverableMs: 18015, analysisMs: 2995,
      },
    ],
    analysisChainId: 56,
  },
];

/** Typical funded -> deliverable, excluding the one transport-anomalous run. */
export const TYPICAL_TTD_RANGE_MS = { min: 8030, max: 11751 } as const;

/** Measured, zero platform fee: the provider received exactly the budget. */
export const ECONOMICS = {
  pricePerJob: '1 $U',
  platformFee: '$0',
  /** Sub-label for the fee card. Kept OUT of the value so it cannot truncate. */
  platformFeeNote: 'measured across 5 jobs — provider received exactly 1.0 $U',
  submitFeeTBnb: '~0.000047',
  hireFeeTBnb: '~0.000957',
  settleFeeTBnb: '~0.000029',
  sessionGrantTBnb: '~0.00089',
} as const;

export const byId = (id: number) => FIRST_PARTY_AGENTS.find((a) => a.agentId === id);
export const bySlug = (slug: CategorySlug) => FIRST_PARTY_AGENTS.filter((a) => a.slug === slug);
export const CATEGORY_SLUGS: CategorySlug[] =
  ['rebalancing', 'grid-trading', 'yield-optimisation', 'health-factor-monitoring'];

export const byMainnetId = (mainnetAgentId: number): FirstPartyAgent | undefined =>
  FIRST_PARTY_AGENTS.find((a) => a.mainnetAgentId === mainnetAgentId);
