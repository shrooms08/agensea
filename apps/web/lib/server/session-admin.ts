/**
 * Session authority admin — SERVER ONLY. Admin key from env, never logged.
 *
 * AUTHORITY IS READ FROM THE ACCOUNT, NOT THE KEYSTORE. Measured finding:
 * KeyStore.isValidKey reflects only the ORIGINAL registered sessions (expired
 * 29 Aug) and reads false while renewed account-level sessions transact fine.
 * The EIP-7702 account's getKeys() (selector 0x2150c518, porto layout:
 * (Key(expiry,keyType,isSuperAdmin,publicKey)[], bytes32[])) is authoritative:
 * a session holds authority iff its ADDRESS appears (keyType 2 stores the
 * 20-byte address) with an unexpired expiry. Revocation removes it; healing is
 * an account-level grant with register:false to the same persisted signer —
 * register:true would revert "KeyStore: key already registered" (tombstone).
 */
import 'server-only';
import { decodeAbiParameters } from 'viem';
import { createClient, signerFromPrivateKey, BNB_TESTNET } from '@altananetwork/sdk';
import SESSIONS from '@/data/demo-sessions.json';

const GETKEYS = '0x2150c518';

export function sessionMeta(agentId: number) {
  return (SESSIONS as { sessions: { agentId: number; address: string; publicKey: string; expiry: number; capWei: string; calls: { signature: string; to: string }[]; walletAddress: string }[] })
    .sessions.find((s) => s.agentId === agentId) ?? null;
}

export async function readAuthority(agentId: number): Promise<{ active: boolean; expiry: number | null } | null> {
  const meta = sessionMeta(agentId);
  if (!meta) return null;
  try {
    const r = await fetch(BNB_TESTNET.publicRpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: meta.walletAddress, data: GETKEYS }, 'latest'] }),
      cache: 'no-store', signal: AbortSignal.timeout(12_000),
    });
    const h = ((await r.json()) as { result?: string }).result;
    if (!h) return null;
    const [keys] = decodeAbiParameters(
      [{ type: 'tuple[]', components: [{ name: 'expiry', type: 'uint40' }, { name: 'keyType', type: 'uint8' }, { name: 'isSuperAdmin', type: 'bool' }, { name: 'publicKey', type: 'bytes' }] },
       { type: 'bytes32[]' }] as const, h as `0x${string}`);
    const addr = meta.address.toLowerCase().replace(/^0x/, '');
    const k = (keys as readonly { expiry: number | bigint; publicKey: string }[])
      .find((x) => x.publicKey.toLowerCase().endsWith(addr));
    if (!k) return { active: false, expiry: null };
    const exp = Number(k.expiry);
    return { active: exp === 0 || exp > Math.floor(Date.now() / 1000), expiry: exp || null };
  } catch { return null; }
}

const adminWallet = async () => {
  const key = process.env.DEMO_ADMIN_KEY?.trim();
  if (!key) throw new Error('admin signing not configured');
  const client = createClient({ chains: [BNB_TESTNET] });
  const signer = signerFromPrivateKey(key as `0x${string}`);
  return { client, signer, wallet: await client.createWallet({ signer }) };
};

export async function revokeAgentSession(agentId: number): Promise<{ tx: string | null }> {
  const meta = sessionMeta(agentId);
  if (!meta) throw new Error('unknown agent');
  const { client, signer, wallet } = await adminWallet();
  const r = await client.revokeSession({ wallet, signer, session: meta.publicKey as `0x${string}` });
  return { tx: r.transactionHash ?? null };
}

/** Tombstone-safe heal: account-level grant to the SAME persisted signer. */
export async function healAgentSession(agentId: number): Promise<{ tx: string | null }> {
  const meta = sessionMeta(agentId);
  const sessionKey = process.env[`DEMO_SESSION_KEY_${agentId}`]?.trim();
  if (!meta || !sessionKey) throw new Error('heal not configured');
  const { client, signer, wallet } = await adminWallet();
  const ss = signerFromPrivateKey(sessionKey as `0x${string}`);
  const g = await client.grantSession({
    wallet, signer, sessionSigner: ss,
    permissions: { calls: meta.calls as never, spend: [{ limit: BigInt(meta.capWei), period: 'hour' as const }] },
    expiry: meta.expiry, register: false,
  });
  return { tx: (g as { transactionHash?: string }).transactionHash ?? null };
}
