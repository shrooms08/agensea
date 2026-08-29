/**
 * ERC-8183 addresses with the chain-97 policy override.
 *
 * FOOTGUN 4: ERC8183_ADDRESSES[97].policy shipped by @altananetwork/sdk 0.8.0 is
 * 0x4F4678D4439feC812Ac7674Bb3Efb4C8f5Fb78A6, which is NOT whitelisted on the
 * EvaluatorRouter. Every hire reverts at registerJob with PolicyNotWhitelisted()
 * (0xc94463e3). Verified three ways:
 *   1. router.policyWhitelist(0x4F4678D4…) == false, (0xd6a42175…) == true
 *   2. bnb-chain/bnbagent-sdk networks/addresses.py lists 0xd6a42175… for 97
 *   3. altana-sdk issue #53
 *
 * We read the struct from the SDK as the source of truth, override .policy, and
 * ASSERT the override against the router at startup — so when upstream ships the
 * fix, the override becomes a no-op and the assert keeps protecting us either way.
 */
import { ERC8183_ADDRESSES, type Erc8183Addresses } from '@altananetwork/sdk';

export const POLICY_OVERRIDE_97 = '0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA' as const;
const POLICY_WHITELIST_SEL = '0x70be56b9'; // policyWhitelist(address)

export function erc8183For(chainId: number): Erc8183Addresses {
  const base = ERC8183_ADDRESSES[chainId];
  if (!base) throw new Error(`no ERC-8183 deployment for chain ${chainId}`);
  if (chainId !== 97) return base;
  return { ...base, policy: POLICY_OVERRIDE_97 };
}

/**
 * CRITICAL: hireErc8183Agent() and settleErc8183Job() resolve addresses through
 * the SDK's OWN internal erc8183Addresses(chainId) and IGNORE any override you
 * pass. Calling them on chain 97 sends the broken policy to registerJob and
 * reverts with 0xc94463e3 — we hit exactly this. Use buildHireCalls({addresses})
 * with the overridden struct and execute the calls yourself.
 */
export function sdkPolicyIsBroken(chainId: number): boolean {
  const raw = ERC8183_ADDRESSES[chainId];
  if (!raw || chainId !== 97) return false;
  return raw.policy.toLowerCase() !== POLICY_OVERRIDE_97.toLowerCase();
}

export class PolicyNotWhitelistedError extends Error {
  constructor(m: string) { super(m); this.name = 'PolicyNotWhitelistedError'; }
}

/** Throws unless router.policyWhitelist(policy) is true. Call before any hire. */
export async function assertPolicyWhitelisted(
  addresses: Erc8183Addresses, rpcUrl: string,
): Promise<void> {
  const data = POLICY_WHITELIST_SEL + addresses.policy.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: addresses.router, data }, 'latest'] }),
    signal: AbortSignal.timeout(20_000),
  });
  const b = (await r.json()) as { result?: string; error?: { message: string } };
  if (b.error) throw new PolicyNotWhitelistedError(`policyWhitelist read failed: ${b.error.message}`);
  const ok = BigInt(b.result || '0x0') === 1n;
  if (!ok) {
    throw new PolicyNotWhitelistedError(
      `policy ${addresses.policy} is NOT whitelisted on router ${addresses.router}. ` +
      `Every hire would revert with PolicyNotWhitelisted() (0xc94463e3). ` +
      `If upstream changed the deployment, re-derive the correct policy — do not guess.`,
    );
  }
}
