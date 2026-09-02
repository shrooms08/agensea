'use client';
/**
 * Operator claim and listing.
 *
 * Connect -> we look up which agents that address owns from our own sweep ->
 * pick one -> sign a message naming that agentId -> the server recovers the
 * signer and requires it to equal ownerOf(agentId) read live from the registry.
 * Only then does a listing form appear.
 *
 * The signature authorises nothing on chain: it is a plain personal_sign, and
 * the message says so.
 */
import Link from 'next/link';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { useEffect, useState } from 'react';
import { CAT_LABEL } from '@/components/CategoryChip';
import type { CategorySlug } from '@/data/first-party-agents';

type Owned = { agent_id: number; client_count: number; checked_at: string };
type Step = 'connect' | 'choose' | 'claimed';
const CATEGORIES: CategorySlug[] = ['health-factor-monitoring', 'rebalancing', 'grid-trading', 'yield-optimisation'];

/**
 * EIP-6963 surfaces every injected wallet the browser has. Phantom advertises
 * EVM support and shows up here, but we could not verify it on chain 56 from
 * this environment — so it is not offered rather than shipped unverified on a
 * path an operator is asked to trust. Injected, Rabby, MetaMask and OKX remain.
 */
const OFFERED_CONNECTOR = (c: { id: string; name: string }) =>
  !/phantom/i.test(c.id) && !/phantom/i.test(c.name);

export function ClaimFlow() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [owned, setOwned] = useState<Owned[] | null>(null);
  const [step, setStep] = useState<Step>('connect');
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<CategorySlug>('rebalancing');
  const [delivers, setDelivers] = useState('');
  const [inputLabel, setInputLabel] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [priceU, setPriceU] = useState('1');

  useEffect(() => {
    if (!address) { setOwned(null); setStep('connect'); return; }
    void (async () => {
      try {
        const r = await fetch(`/api/claim?owner=${address}`);
        const j = (await r.json()) as { agents?: Owned[] };
        setOwned(j.agents ?? []);
        setStep('choose');
      } catch { setOwned([]); setStep('choose'); }
    })();
  }, [address]);

  /** Fetch a nonce bound to this agentId, sign it, return the proof envelope. */
  async function prove(agentId: number) {
    const n = (await (await fetch(`/api/claim?agentId=${agentId}`)).json()) as
      { nonce: string; exp: number; mac: string; message: string };
    const signature = await signMessageAsync({ message: n.message });
    return { agentId, nonce: n.nonce, exp: n.exp, mac: n.mac, signature };
  }

  async function claim(agentId: number) {
    setBusy(true); setError(null);
    try {
      const proof = await prove(agentId);
      const r = await fetch('/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proof) });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) setError(j.error ?? `claim failed (${r.status})`);
      else { setChosen(agentId); setStep('claimed'); setName(`Agent ${agentId}`); }
    } catch { setError('signature cancelled — nothing was claimed'); }
    setBusy(false);
  }

  async function publish() {
    if (chosen === null) return;
    setBusy(true); setError(null);
    try {
      const proof = await prove(chosen);
      const r = await fetch('/api/listing', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...proof, name, description, category,
          delivers: delivers.split('\n').map((d) => d.trim()).filter(Boolean),
          inputSchema: inputLabel.trim() ? { target: inputLabel.trim() } : {},
          endpointUrl, priceU: priceU === '' ? undefined : Number(priceU),
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) setError(j.error ?? `listing failed (${r.status})`);
      else setDone(`/listing/${chosen}`);
    } catch { setError('signature cancelled — nothing was published'); }
    setBusy(false);
  }

  if (!isConnected) {
    return (
      <div className="hire-connect">
        <div className="data">Connect the wallet that owns your agent</div>
        <p className="meta" style={{ marginTop: 10, color: 'var(--text-faint)' }}>
          We look up what it owns from our own sweep of chain 56, then verify against the registry
          when you sign. Signing authorises no transaction.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          {connectors.filter(OFFERED_CONNECTOR).map((c) => (
            <button key={c.uid} className="wallet-connect" disabled={isPending} onClick={() => connect({ connector: c })}>
              {isPending ? 'Connecting…' : `Connect ${c.name}`}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="claim-panel" style={{ boxShadow: 'inset 2px 0 0 var(--live)' }}>
        <div className="label" style={{ fontSize: 9, color: 'var(--live)' }}>listed</div>
        <p className="prose-sm" style={{ marginTop: 10 }}>
          Agent {chosen} is listed. It appears on the marketplace and its category page, marked as
          not yet hireable through AgenSea.
        </p>
        <Link href={done} className="wallet-connect" style={{ display: 'inline-block', marginTop: 14 }}>View the listing →</Link>
      </div>
    );
  }

  if (step === 'claimed' && chosen !== null) {
    return (
      <div className="claim-panel">
        <div className="label" style={{ fontSize: 9, color: 'var(--live)' }}>ownership proven for agent {chosen}</div>
        <p className="meta" style={{ marginTop: 8 }}>
          Describe what it does. You will sign once more to publish. The endpoint is stored and
          displayed — we never call it in this build.
        </p>
        <div className="claim-form">
          <label className="claim-field"><span className="label" style={{ fontSize: 9 }}>name</span>
            <input className="target-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></label>
          <label className="claim-field"><span className="label" style={{ fontSize: 9 }}>category</span>
            <select className="target-input" value={category} onChange={(e) => setCategory(e.target.value as CategorySlug)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select></label>
          <label className="claim-field claim-wide"><span className="label" style={{ fontSize: 9 }}>description</span>
            <textarea className="target-input" rows={3} value={description} maxLength={2000}
              onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="claim-field claim-wide"><span className="label" style={{ fontSize: 9 }}>what it delivers — one per line</span>
            <textarea className="target-input" rows={4} value={delivers} onChange={(e) => setDelivers(e.target.value)}
              placeholder={'health factor\ncollateral (USD)\nrisk recommendation'} /></label>
          <label className="claim-field"><span className="label" style={{ fontSize: 9 }}>what input it takes</span>
            <input className="target-input" value={inputLabel} onChange={(e) => setInputLabel(e.target.value)}
              placeholder="a BSC wallet address" /></label>
          <label className="claim-field"><span className="label" style={{ fontSize: 9 }}>price in $U</span>
            <input className="target-input" value={priceU} inputMode="decimal" onChange={(e) => setPriceU(e.target.value)} /></label>
          <label className="claim-field claim-wide"><span className="label" style={{ fontSize: 9 }}>endpoint url (https, optional)</span>
            <input className="target-input" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://your-agent.example/run" spellCheck={false} /></label>
        </div>
        {error && <div className="data" style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
        <button className="hire-cta" disabled={busy || !name.trim() || !description.trim()}
          style={{ background: busy ? 'var(--surface-raised)' : 'var(--live-dim)', color: busy ? 'var(--text-faint)' : 'var(--bg)', marginTop: 16 }}
          onClick={publish}>
          {busy ? 'Sign in your wallet…' : 'Publish listing — sign to confirm'}
        </button>
      </div>
    );
  }

  return (
    <div className="claim-panel">
      <div className="label" style={{ fontSize: 9 }}>agents owned by {address?.slice(0, 6)}…{address?.slice(-4)}</div>
      {owned === null && <p className="data" style={{ color: 'var(--text-faint)', marginTop: 12 }}>looking up your agents…</p>}
      {owned?.length === 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="prose-sm prose-muted" style={{ fontSize: 13 }}>
            Our sweep of chain 56 shows no ERC-8004 agents owned by this address. To list here you
            need an agent minted in the IdentityRegistry on BNB Smart Chain mainnet, owned by the
            wallet you just connected. If you minted one after our last sweep, it will appear once
            the next sweep runs.
          </p>
          <p className="prose-sm prose-muted" style={{ fontSize: 13, marginTop: 12 }}>
            If you do not have one yet, there are two routes to registering one:
          </p>
          <p className="prose-sm prose-muted" style={{ fontSize: 13, marginTop: 10 }}>
            <a href="https://www.bnbchain.org/en/bnb-agent-studio" target="_blank" rel="noreferrer" style={{ color: 'var(--live)' }}>
              BNB Agent Studio — the supported path to scaffolding and registering an agent →
            </a>
          </p>
          <p className="prose-sm prose-muted" style={{ fontSize: 13, marginTop: 6 }}>
            <a href="https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" target="_blank" rel="noreferrer" style={{ color: 'var(--live)' }}>
              The IdentityRegistry on BscScan — for registering directly →
            </a>
          </p>
          <p className="prose-sm prose-muted" style={{ fontSize: 13, marginTop: 10 }}>
            <Link href="/docs#how-we-measure" style={{ color: 'var(--live)' }}>How we measure the registry →</Link>
          </p>
        </div>
      )}
      {owned && owned.length > 0 && (
        <>
          <div className="claim-list">
            {owned.map((a) => (
              <div key={a.agent_id} className="claim-row">
                <span className="data">agent #{a.agent_id}</span>
                <span className="data" style={{ color: 'var(--text-muted)' }}>{a.client_count} client{a.client_count === 1 ? '' : 's'}</span>
                <button className="wallet-connect" disabled={busy} onClick={() => claim(a.agent_id)}>
                  {busy ? 'Signing…' : 'Claim — sign to prove'}
                </button>
              </div>
            ))}
          </div>
          <p className="meta" style={{ marginTop: 12, color: 'var(--text-faint)' }}>
            Candidates come from our sweep; the claim itself is checked against{' '}
            <span className="data">ownerOf()</span> on the registry when you sign, so a stale row
            cannot authorise anything.
          </p>
        </>
      )}
      {error && <div className="data" style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
    </div>
  );
}
