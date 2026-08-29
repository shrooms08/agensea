/**
 * Venus Protocol addresses, per chain.
 *
 * Sourced from VenusProtocol/venus-protocol `deployments/{bscmainnet,bsctestnet}_addresses.json`
 * and every one verified with `cast code` before use. Do not add an address here
 * that has not been checked for bytecode on its chain.
 *
 * NOTE: the Comptroller is a DIAMOND on BOTH chains. `liquidationIncentiveMantissa()`
 * is not served by any facet on either (checked via facetAddress() and by scanning
 * all facet bytecode). The per-market `collateralFactorMantissa` from
 * `markets(vToken)` IS the liquidation threshold in Compound-style protocols;
 * the liquidation *incentive* is a separate, unexposed number.
 */
export type VenusChain = 56 | 97;

export interface VenusDeployment {
  chainId: VenusChain;
  label: string;
  comptroller: `0x${string}`;
  venusLens: `0x${string}`;
  /** Read-only RPC. Signing NEVER happens against these. */
  rpcEnv: 'ALCHEMY_BSC' | 'BSC_TESTNET_RPC';
  fallbackRpc: string;
}

export const VENUS: Record<VenusChain, VenusDeployment> = {
  56: {
    chainId: 56,
    label: 'BNB Smart Chain mainnet',
    comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
    venusLens: '0xe797804c5d4410777c70EF8769c4eB9C39BEF662',
    rpcEnv: 'ALCHEMY_BSC',
    fallbackRpc: 'https://bsc-rpc.publicnode.com',
  },
  97: {
    chainId: 97,
    label: 'BNB Smart Chain testnet',
    comptroller: '0x94d1820b2D1c7c7452A163983Dc888CEC546b77D',
    venusLens: '0x17A6222fB8b4b6D852cA54f5bc376a6A2c6224Bd',
    rpcEnv: 'BSC_TESTNET_RPC',
    fallbackRpc: 'https://bsc-testnet-rpc.publicnode.com',
  },
};

/** Markets useful for locating borrowers by scanning Borrow events. */
export const SCAN_MARKETS: Record<VenusChain, `0x${string}`[]> = {
  56: [
    '0xfD5840Cd36d94D7229439859C0112a4185BC0255', // vUSDT
    '0xA07c5b74C9B40447a954e1466938b865b6BBea36', // vBNB
    '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B', // vBTC
    '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8', // vETH
    '0x95c78222B3D6e262426483D42CfA53685A67Ab9D', // vBUSD
  ],
  97: [
    '0xb7526572FFE56AB9D7489838Bf2E18e3323b441A', // vUSDT
    '0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c', // vBNB
    '0x08e0A5575De71037aE36AbfAfb516595fE68e5e4', // vBUSD
  ],
};

/** Compound-style Borrow(address,uint256,uint256,uint256) — borrower is NOT indexed. */
export const BORROW_TOPIC = '0x13ed6866d4e1ee6da46f845c46d7e54120883d75c5ea9a2dacc1c4ca8984ab80';
