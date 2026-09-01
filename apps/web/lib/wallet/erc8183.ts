/**
 * Client-safe ERC-8183 ABI slice + addresses for the buyer-side wallet flow.
 * Transcribed from @altananetwork/sdk's COMMERCE_ABI/ROUTER_ABI (0.8.0) —
 * importing the SDK into the client bundle would drag porto with it.
 */
import { ERC8183 as BASE, AGENTS_WALLET } from '@/data/first-party-agents';
export const ERC8183 = { ...BASE, registryProvider: AGENTS_WALLET } as const;

export const COMMERCE_ABI = [
  { name: 'createJob', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'provider', type: 'address' }, { name: 'evaluator', type: 'address' }, { name: 'expiredAt', type: 'uint256' }, { name: 'description', type: 'string' }, { name: 'hook', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { name: 'setBudget', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { name: 'fund', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'expectedBudget', type: 'uint256' }, { name: 'optParams', type: 'bytes' }], outputs: [] },
  { name: 'claimRefund', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { name: 'jobCounter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getJob', type: 'function', stateMutability: 'view', inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'id', type: 'uint256' }, { name: 'client', type: 'address' }, { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' }, { name: 'description', type: 'string' }, { name: 'budget', type: 'uint256' },
      { name: 'expiredAt', type: 'uint256' }, { name: 'status', type: 'uint8' }, { name: 'hook', type: 'address' },
      { name: 'submittedAt', type: 'uint256' }, { name: 'deliverable', type: 'bytes32' }] }] },
] as const;

export const ROUTER_ABI = [
  { name: 'registerJob', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'policy', type: 'address' }], outputs: [] },
] as const;

export const ERC20_APPROVE_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
