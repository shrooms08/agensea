'use client';
/**
 * Wallet-native hire — the PRIMARY path on /marketplace/[id]. This component
 * owns the whole interactive region: what the buyer provides, the transaction
 * preview, and the hire itself. The static "what the agent delivers" column and
 * the provider track record are rendered on the server and passed in, so every
 * figure on this page comes from data rather than from the client.
 *
 * The buyer is the connected wallet, not the platform: approve -> create
 * (createJob + registerJob + setBudget) -> fund, as sequential wallet
 * transactions with a stage indicator, then POST /api/agent-work so the
 * agent analyses and submits through its session key. jobId is claimed by
 * reading jobCounter first and verified after createJob by matching our
 * unique description nonce (walking ±3 if a race lost the slot).
 *
 * The buyer's target is validated for format in the browser and against chain
 * state on the server BEFORE any transaction is offered, then written into the
 * job description — so it is bound on chain and echoed in the manifest.
 *
 * Stuck-funded recovery: on mount we scan chain state for FUNDED jobs from
 * this wallet against our provider — tab closed after funding, network drop —
 * and offer Resume (agent-work) or, past expiry, Reclaim (claimRefund from
 * their wallet). A judge's escrow must never sit silently stuck.
 */
import Link from 'next/link';
import { useAccount, useConnect, useWriteContract, usePublicClient } from 'wagmi';
import { formatEther, keccak256, stringToHex } from 'viem';
import { useEffect, useRef, useState } from 'react';
import { bscTestnet97, U_TOKEN } from '@/lib/wallet/config';
import { COMMERCE_ABI, ROUTER_ABI, ERC20_APPROVE_ABI, ERC8183 } from '@/lib/wallet/erc8183';
import { HirePreflight, useWalletFunding } from '@/components/HirePreflight';
import { GRID_POOLS, MEASURED_GAS, validateTarget, type DeliversRow, type TargetSpec } from '@/data/hire-spec';
import { DISPUTE_WINDOW_SECONDS } from '@/data/first-party-agents';

const PRICE = 10n ** 18n;
const EXPLORER = 'https://testnet.bscscan.com/tx/';
type Ev = { stage: string; [k: string]: unknown };
type TxStep = { id: number; label: string; tx?: string; state: 'waiting' | 'signing' | 'confirming' | 'done' | 'failed' };

/**
 * The five calls, seeded before the first prompt so a buyer at prompt 3 can see
 * what is done, what is open, and what is left. They are numbered because the
 * count is the friction: without it the only way to know how far along you are
 * is to count wallet prompts yourself.
 */
const HIRE_STEPS = [
  '1/5  Approve 1 $U',
  '2/5  Create job',
  '3/5  Register dispute policy',
  '4/5  Set budget',
  '5/5  Fund escrow (1 $U)',
] as const;
type Funded = { jobId: string; agentId: number; expiredAt: number; expired: boolean };

export interface WalletHireProps {
  agentId: number;
  agentName: string;
  delivers: DeliversRow[];
  targetSpec: TargetSpec;
  session: { capTBnb: string; signature: string; commerce: string; expiryLabel: string };
  priceLabel: string;
  /** 'listing' renders /marketplace/[id]; 'hire' renders /marketplace/[id]/hire.
   *  ONE component so the hire machinery has one home — the JSX below is moved
   *  between the two surfaces, never duplicated or rewritten. */
  mode: 'listing' | 'hire';
  /** The hire route's ?target=, so a shared or reloaded URL analyses the same
   *  thing. Falls back to the spec's prefill. */
  initialTarget?: string;
  /** Rendered under the confirm action on the hire route. */
  sponsored?: React.ReactNode;
  trackRecord?: React.ReactNode;
  /** Left-column content the page owns; the rail and the hire surface are ours.
   *  Passed as slots so the two-column order is defined in exactly one place. */
  header?: React.ReactNode;
  /** The stat row. Below the rail on mobile, so price and Hire follow the
   *  description directly rather than sitting under five more figures. */
  stats?: React.ReactNode;
  sessionPanel?: React.ReactNode;
  completedWork?: React.ReactNode;
}

const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
  <div className="tx-row">
    <span className="tx-key">{k}</span>
    <span className="tx-val" style={tone ? { color: tone } : undefined}>{v}</span>
  </div>
);

export function WalletHire({ agentId, agentName, priceLabel, mode, initialTarget, sponsored, delivers, targetSpec, session, trackRecord, header, stats, sessionPanel, completedWork }: WalletHireProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const f = useWalletFunding();
  const pub = usePublicClient({ chainId: bscTestnet97.id });
  const { writeContractAsync } = useWriteContract();
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stuck, setStuck] = useState<Funded[]>([]);
  const doneRef = useRef(false);

  // ---- the buyer's target ---------------------------------------------------
  const [target, setTarget] = useState(initialTarget?.trim() || targetSpec.prefill);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const fmt = validateTarget(agentId, target);
  useEffect(() => {
    if (!fmt.ok) { setTargetError(fmt.error); setChecking(false); return; }
    setTargetError(null); setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/agent-work', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ validate: { agentId, target } }) });
        const j = (await r.json()) as { ok?: boolean; error?: string };
        setTargetError(r.ok ? null : (j.error ?? 'that target could not be checked'));
      } catch { setTargetError(null); /* network flake: the server re-checks before any work */ }
      setChecking(false);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, agentId]);

  // ---- live numbers for the preview ----------------------------------------
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);
  const [authority, setAuthority] = useState<{ active: boolean; expiry: number | null } | null>(null);
  useEffect(() => {
    void (async () => { try { setGasPrice(await pub!.getGasPrice()); } catch { /* preview shows measured gas only */ } })();
    void (async () => {
      try {
        const r = await fetch(`/api/revoke/${agentId}`, { cache: 'no-store' });
        setAuthority(((await r.json()) as { authority: { active: boolean; expiry: number | null } | null }).authority);
      } catch { /* falls back to the granted expiry */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useEffect(() => {
    if (!address) { setStuck([]); return; }
    void (async () => {
      try {
        const r = await fetch(`/api/agent-work?address=${address}`);
        const j = (await r.json()) as { jobs?: Funded[] };
        setStuck((j.jobs ?? []).filter((x) => x.agentId === agentId));
      } catch { /* recovery scan is best-effort */ }
    })();
  }, [address, agentId, jobId]);

  const stepId = useRef(0);
  const push = (label: string): number => { const id = stepId.current++; setSteps((p) => [...p, { id, label, state: 'waiting' }]); return id; };
  /** Seed the five up front. Ids are the array index, so sendStep marks in
   *  place; stepId continues past them for ad-hoc rows like the reclaim. */
  const seedSteps = () => {
    stepId.current = HIRE_STEPS.length;
    setSteps(HIRE_STEPS.map((label, id) => ({ id, label, state: 'waiting' as const })));
  };
  const mark = (id: number, patch: Partial<TxStep>) => setSteps((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  async function sendStep(label: string, fn: () => Promise<`0x${string}`>): Promise<void> {
    // A seeded row is marked in place; anything else (the reclaim) still appends.
    const seeded = (HIRE_STEPS as readonly string[]).indexOf(label);
    const i = seeded >= 0 ? seeded : push(label);
    mark(i, { state: 'signing' });
    try {
      const tx = await fn();
      mark(i, { tx, state: 'confirming' });
      await pub!.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
      mark(i, { state: 'done' });
    } catch (e) {
      const rejected = /reject|denied|4001/i.test(String((e as Error).message));
      mark(i, { state: 'failed' });
      // The step number belongs in the indicator, not in a sentence.
      const name = label.replace(/^\d\/\d\s+/, '');
      throw new Error(rejected ? `${name} was rejected in your wallet — nothing further was sent` : `${name} failed: ${String((e as Error).message).slice(0, 90)}`);
    }
  }

  async function streamWork(id: string) {
    let res: Response;
    try {
      res = await fetch('/api/agent-work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: id }) });
    } catch {
      setFatal(`the agent could not be reached — your 1 $U is safely escrowed in job ${id}; reload this page to resume, or reclaim after expiry`);
      return;
    }
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setFatal((j as { error?: string }).error ?? 'the agent endpoint did not answer — your escrow is safe, reload to resume');
      return;
    }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const l of lines) {
        if (!l.trim()) continue;
        const e = JSON.parse(l) as Ev;
        setEvents((p) => [...p, e]);
        if (e.stage === 'error') setFatal(String(e.message));
        if (e.stage === 'settlement-pending') doneRef.current = true;
      }
    }
  }

  async function hire() {
    if (running || doneRef.current || !pub || !address) return;
    const check = validateTarget(agentId, target);
    if (!check.ok) { setTargetError(check.error); return; }
    setRunning(true); setFatal(null); seedSteps(); setEvents([]); setJobId(null);
    try {
      // last word before any signature: the server checks the target on chain
      const vr = await fetch('/api/agent-work', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ validate: { agentId, target: check.value } }) });
      if (!vr.ok) {
        const j = (await vr.json()) as { error?: string };
        setTargetError(j.error ?? 'that target could not be checked');
        setRunning(false);
        return;
      }
      // stage 1: approve
      await sendStep(HIRE_STEPS[0], () => writeContractAsync({
        address: U_TOKEN, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [ERC8183.commerce, PRICE], chainId: bscTestnet97.id }));
      // stage 2: create (createJob + registerJob + setBudget)
      const nonce = crypto.randomUUID();
      const description = JSON.stringify({ wallet: true, agentId, target: check.value, nonce, at: Date.now() });
      const counter = (await pub.readContract({ address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'jobCounter' })) as bigint;
      let expected = counter + 1n;
      await sendStep(HIRE_STEPS[1], () => writeContractAsync({
        address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'createJob',
        args: [ERC8183.registryProvider, ERC8183.router, BigInt(Math.floor(Date.now() / 1000) + 3600), description, ERC8183.router], chainId: bscTestnet97.id }));
      // confirm which id is ours (jobId race): match the nonce
      let found: bigint | null = null;
      for (const cand of [expected, expected + 1n, expected + 2n, expected + 3n, expected - 1n]) {
        if (cand <= 0n) continue;
        try {
          const j = (await pub.readContract({ address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'getJob', args: [cand] })) as { description: string; client: string };
          if (j.description === description && j.client.toLowerCase() === address.toLowerCase()) { found = cand; break; }
        } catch { /* keep walking */ }
      }
      if (!found) throw new Error('could not locate the created job on chain — nothing was funded; it is safe to retry');
      expected = found;
      setJobId(String(expected));
      await sendStep(HIRE_STEPS[2], () => writeContractAsync({
        address: ERC8183.router, abi: ROUTER_ABI, functionName: 'registerJob', args: [expected, ERC8183.policy], chainId: bscTestnet97.id }));
      await sendStep(HIRE_STEPS[3], () => writeContractAsync({
        address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'setBudget', args: [expected, PRICE, '0x'], chainId: bscTestnet97.id }));
      // stage 3: fund
      await sendStep(HIRE_STEPS[4], () => writeContractAsync({
        address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'fund', args: [expected, PRICE, '0x'], chainId: bscTestnet97.id }));
      f.refetch();
      // agent side
      await streamWork(String(expected));
    } catch (e) {
      setFatal(String((e as Error).message));
    }
    setRunning(false);
  }

  async function resume(id: string) {
    if (running) return;
    setRunning(true); setFatal(null); setEvents([]); setJobId(id);
    await streamWork(id);
    setRunning(false); setStuck((p) => p.filter((x) => x.jobId !== id));
  }
  async function reclaim(id: string) {
    if (running) return;
    setRunning(true); setFatal(null);
    try {
      const i = push(`Reclaim escrow — job ${id}`);
      try {
        const tx = await writeContractAsync({ address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'claimRefund', args: [BigInt(id)], chainId: bscTestnet97.id });
        mark(i, { tx, state: 'confirming' });
        await pub!.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
        mark(i, { state: 'done' });
        setStuck((p) => p.filter((x) => x.jobId !== id));
        f.refetch();
      } catch (e) { mark(i, { state: 'failed' }); throw e; }
    } catch (e) { setFatal(`reclaim failed: ${String((e as Error).message).slice(0, 90)}`); }
    setRunning(false);
  }

  const ev = (stage: string) => events.find((e) => e.stage === stage);

  // Settlement countdown: when it reaches zero with the tab open, OUR keeper
  // settles the job so the judge watches SUBMITTED become COMPLETED.
  const pending = ev('settlement-pending') as { eligibleAt?: number } | undefined;
  const settled = ev('settled');
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));
  const settleFired = useRef(false);
  useEffect(() => {
    if (!pending || settled) return;
    const t = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending, settled]);
  const remaining = pending?.eligibleAt ? Math.max(0, pending.eligibleAt - nowS) : null;
  useEffect(() => {
    if (!pending || settled || remaining === null || remaining > 0 || settleFired.current || !jobId) return;
    settleFired.current = true;
    void (async () => {
      try {
        const r = await fetch('/api/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
        const j = (await r.json()) as { ok?: boolean; tx?: string; status?: string; error?: string };
        if (r.ok && j.status === 'COMPLETED') setEvents((p) => [...p, { stage: 'settled', tx: j.tx ?? '' }]);
        else setEvents((p) => [...p, { stage: 'settle-note', message: j.error ?? 'the keepalive sweep will settle it shortly' }]);
      } catch { setEvents((p) => [...p, { stage: 'settle-note', message: 'the keepalive sweep will settle it shortly' }]); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, pending, settled, jobId]);

  // Buyer-side VERIFY: recompute keccak256 of the canonical manifest IN THE
  // BROWSER and compare against the hash the chain stores. Same rules as the
  // server: sorted keys, no whitespace, non-ASCII escaped as \uXXXX.
  const verifiedEv = ev('verified') as { manifest?: unknown; onChain?: string } | undefined;
  let verifyState: 'match' | 'mismatch' | null = null;
  let localHash = '';
  if (verifiedEv?.manifest && verifiedEv.onChain) {
    const sortStringify = (v: unknown): string => {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(sortStringify).join(',') + ']';
      return '{' + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + sortStringify((v as Record<string, unknown>)[k])).join(',') + '}';
    };
    let canon = '';
    for (const ch of sortStringify(verifiedEv.manifest)) {
      if (ch.codePointAt(0)! < 0x80) { canon += ch; continue; }
      for (let i = 0; i < ch.length; i++) canon += '\\u' + ch.charCodeAt(i).toString(16).padStart(4, '0');
    }
    localHash = keccak256(stringToHex(canon));
    verifyState = localHash.toLowerCase() === verifiedEv.onChain.toLowerCase() ? 'match' : 'mismatch';
  }

  const estGas = gasPrice ? Number(BigInt(MEASURED_GAS.total) * gasPrice) / 1e18 : null;
  const shortOfFunds = f.isConnected && !f.ready && f.bnb !== undefined && f.u !== undefined;
  const canHire = f.ready && !targetError && !checking && !running && !doneRef.current;
  const sessionExpiry = authority?.expiry ? new Date(authority.expiry * 1000).toISOString().slice(0, 10) : session.expiryLabel;

  /* The Hire action on the listing is a LINK, not a submit. The hire route has
     to be shareable and the back button has to return here, so the target rides
     in the query string: a form POST is neither shareable nor re-enterable, and
     back would re-post it. A hand-typed ?target= is not trusted — the hire route
     runs the same on-chain check and Confirm stays disabled until it passes. */
  const hireHref = `/marketplace/${agentId}/hire?target=${encodeURIComponent(target)}`;
  const targetReady = !targetError && !checking && target.trim().length > 0;

  /* RIGHT RAIL — price, the one sanctioned lime action, and what the buyer is
     actually agreeing to. Sticky on desktop; on mobile it moves above the left
     column so these stay the first thing after the header. */
  const rail = (
    <aside className="detail-rail">
      <div className="rail-card">
        <div className="label" style={{ fontSize: 9 }}>price per hire</div>
        <div className="rail-price">{priceLabel}<span>per hire</span></div>
        {isConnected ? (
          targetReady ? (
            <Link href={hireHref} className="hire-cta"
               style={{ background: 'var(--live-dim)', color: 'var(--bg)', display: 'block', textAlign: 'center' }}>
              Hire — escrow {priceLabel}
            </Link>
          ) : (
            <button className="hire-cta" disabled
              style={{ background: 'var(--surface-raised)', color: 'var(--text-faint)', cursor: 'not-allowed' }}>
              {checking ? 'Checking the target…' : 'Enter a valid target'}
            </button>
          )
        ) : (
          <div className="hire-connect" style={{ marginTop: 16 }}>
            <div className="data">Connect a wallet to hire {agentName} for {priceLabel}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              {connectors.map((c) => (
                <button key={c.uid} className="wallet-connect" disabled={connecting}
                  onClick={() => connect({ connector: c })}>
                  {connecting ? 'Connecting…' : `Connect ${c.name}`}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="meta" style={{ marginTop: 14, color: 'var(--text-faint)' }}>
          Your {priceLabel} sits in escrow and releases only after you can verify the work —
          the hash is recomputed in your browser against the chain.
        </p>
      </div>
      {f.isConnected && <HirePreflight />}
    </aside>
  );

  // ---- THE HIRE ROUTE: what you are about to sign, then the run view -------
  if (mode === 'hire') {
    return (
      <>
        <section className="sec-lead">
          <Link href={`/marketplace/${agentId}`} className="label" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
            ← {agentName}
          </Link>
          <h1 style={{ font: "500 30px/1.15 var(--display)", marginTop: 14 }}>Hire {agentName}</h1>
          <div className="hire-target">
            <div className="label" style={{ fontSize: 9 }}>{targetSpec.label}</div>
            <div className="data hire-target-value">{target}</div>
            <div className="data" style={{ marginTop: 8, color: targetError ? 'var(--danger)' : 'var(--live)' }}>
              {targetError ? targetError : checking ? <span style={{ color: 'var(--text-faint)' }}>checking on chain…</span> : 'checked on chain ✓'}
            </div>
          </div>
        </section>

        <section className="sec">
          <div className="tx-preview">
          <div className="label" style={{ fontSize: 9, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
          transaction preview · BNB Smart Chain Testnet (97)
          </div>
          <Row k="service" v={agentName} />
          <Row k="target" v={<span style={{ wordBreak: 'break-all' }}>{target}</span>} />
          <Row k="escrow" v="1 $U" />
          <Row k="platform fee" v="0 — measured: the provider receives exactly 1.0 $U" />
          <Row k="wallet transactions" v="5 — approve, createJob, registerJob, setBudget, fund" />
          <Row k="estimated gas" v={estGas !== null
          ? `${estGas.toFixed(6)} tBNB — ${MEASURED_GAS.total.toLocaleString('en-GB')} gas at ${(Number(gasPrice) / 1e9).toFixed(2)} gwei`
          : `${MEASURED_GAS.total.toLocaleString('en-GB')} gas (${MEASURED_GAS.source})`} />
          <Row k="your balance"
          v={f.isConnected
          ? (f.bnb !== undefined && f.u !== undefined
          ? `${Number(formatEther(f.u)).toFixed(1)} $U / ${Number(formatEther(f.bnb)).toFixed(4)} tBNB`
          : 'reading…')
          : 'connect a wallet'}
          tone={shortOfFunds ? 'var(--danger)' : undefined} />
          <Row k="dispute policy" v="optimistic — escrow releases after the 900 s window, or you can dispute inside it" />
          <Row k="session key" v={`the agent submits through a key scoped to ${session.signature} only, cap ${session.capTBnb} tBNB/hour, expires ${sessionExpiry}${authority && !authority.active ? ' — currently revoked, re-granted on the next hire' : ''}`} />
          <Row k="settlement" v="automatic after the window, by our keeper" />
          <Row k="provider net" v="1 $U (100%)" />
          </div>

          <p className="prose-sm prose-muted" style={{ marginTop: 18, fontSize: 13 }}>
          Five signatures — one per call to the escrow contract, because your wallet signs one at
          a time.
          </p>
          <p className="prose-sm prose-muted" style={{ marginTop: 10 }}>
          Once the escrow is funded the agent reads live BNB Chain state, submits its work, and the
          hash is recomputed in your browser. Escrow settles automatically after the{' '}
          {DISPUTE_WINDOW_SECONDS}-second dispute window.
          </p>


          {f.isConnected && <HirePreflight />}

          {/* On mobile the preview is 13 rows plus a paragraph, which put Confirm
              1,583px down — you would scroll past everything to reach it, then
              scroll back to read it. Pinned to the viewport bottom instead, so
              the action stays in reach while the preview is read. Desktop is
              unchanged: it sits in flow under the paragraph. */}
          <div className="hire-confirm-bar">
          {isConnected ? (
            <button onClick={hire} disabled={!canHire} className="hire-cta"
              style={{ background: canHire ? 'var(--live-dim)' : 'var(--surface-raised)',
                       color: canHire ? 'var(--bg)' : 'var(--text-faint)',
                       cursor: canHire ? 'pointer' : 'not-allowed' }}>
              {doneRef.current ? 'Job complete' : running ? 'In progress…' : `Confirm — escrow ${priceLabel}`}
            </button>
          ) : (
            <div className="hire-connect">
              <div className="data">Connect a wallet to hire {agentName} for {priceLabel}</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                {connectors.map((c) => (
                  <button key={c.uid} className="wallet-connect" disabled={connecting}
                    onClick={() => connect({ connector: c })}>
                    {connecting ? 'Connecting…' : `Connect ${c.name}`}
                  </button>
                ))}
              </div>
            </div>
          )}
          </div>

          {stuck.length > 0 && !running && !doneRef.current && (
          <div className="hd-enter" style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
          {stuck.map((s) => (
          <div key={s.jobId} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="data" style={{ color: 'var(--warn)' }}>
          Your 1 $U is escrowed in job {s.jobId} and the agent has not picked it up{s.expired ? ' — the job has expired' : ''}.
          </span>
          {!s.expired && <button className="wallet-connect" onClick={() => resume(s.jobId)}>Resume — run the agent</button>}
          {s.expired && <button className="wallet-connect" onClick={() => reclaim(s.jobId)}>Reclaim 1 $U</button>}
          </div>
          ))}
          </div>
          )}

          {steps.length > 0 && (
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
          {steps.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="data" style={{ width: 14, color: s.state === 'done' ? 'var(--live)' : s.state === 'failed' ? 'var(--danger)' : s.state === 'waiting' ? 'var(--text-faint)' : 'var(--text)' }}>
          {s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : '·'}
          </span>
          {/* A row not yet reached stays --text-faint, so the open one reads as
              the current position rather than one of five identical lines. */}
          <span className="data" style={{ color: s.state === 'failed' ? 'var(--danger)' : s.state === 'waiting' ? 'var(--text-faint)' : 'var(--text)' }}>{s.label}</span>
          {s.state === 'signing' && <span className="meta">sign in your wallet…</span>}
          {s.state === 'confirming' && <span className="meta">confirming…</span>}
          {s.tx && <a className="meta" style={{ color: 'var(--live-dim)' }} href={EXPLORER + s.tx} target="_blank" rel="noreferrer">tx ↗</a>}
          </div>
          ))}
          </div>
          )}

          {events.length > 0 && (
          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          {[['job-verified', 'Job verified on chain — provider is this agent'],
          ['analysing', 'Analysis running (BSC mainnet reads)'],
          ['analysed', 'Analysis complete'],
          ['submitted', 'Deliverable submitted via session key'],
          ['verified', 'Hash verified on chain'],
          ['settlement-pending', 'Escrow releases after the 900-second dispute window and settles automatically'],
          ].map(([k, label]) => {
          const e = ev(k);
          if (!e && k !== 'analysing') return null;
          return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="data" style={{ width: 14, color: e ? 'var(--live)' : 'var(--text-faint)' }}>{e ? '✓' : '·'}</span>
          <span className="data">{label}{k === 'analysed' && e ? ` — ${((e.ms as number) / 1000).toFixed(1)}s` : ''}</span>
          {k === 'submitted' && e?.tx ? <a className="meta" style={{ color: 'var(--live-dim)' }} href={EXPLORER + String(e.tx)} target="_blank" rel="noreferrer">tx ↗</a> : null}
          </div>
          );
          })}
          {ev('session-restored') && <div className="data" style={{ color: 'var(--live)' }}>Session re-granted before submit — <a className="meta" style={{ color: 'var(--live-dim)' }} href={EXPLORER + String(ev('session-restored')!.tx)} target="_blank" rel="noreferrer">tx ↗</a></div>}
          {verifyState && (
          <div className="hd-enter" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-raised)', boxShadow: `inset 2px 0 0 var(${verifyState === 'match' ? '--verified' : '--danger'})` }}>
          <span className="label" style={{ fontSize: 9, color: verifyState === 'match' ? 'var(--verified)' : 'var(--danger)' }}>verify</span>
          <span className="data">
          {verifyState === 'match'
          ? `keccak256 recomputed in your browser matches the chain — ${localHash.slice(0, 14)}…`
          : 'recomputed hash does NOT match the chain — do not trust this deliverable'}
          </span>
          </div>
          )}
          {pending && !settled && remaining !== null && remaining > 0 && (
          <div className="data" style={{ color: 'var(--text-muted)' }}>settles in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} — keep the tab open to watch it complete</div>
          )}
          {settled && (
          <div className="hd-enter data" style={{ color: 'var(--live)' }}>
          COMPLETED — escrow settled by our keeper{settled.tx ? <> — <a className="meta" style={{ color: 'var(--live-dim)' }} href={EXPLORER + String(settled.tx)} target="_blank" rel="noreferrer">settle tx ↗</a></> : null}
          </div>
          )}
          {ev('settle-note') && <div className="data" style={{ color: 'var(--text-muted)' }}>{String((ev('settle-note') as { message?: string }).message)}</div>}
          </div>
          )}

          {fatal && (
          <div className="hd-enter" style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--danger)' }}>
          <span className="data" style={{ color: 'var(--danger)' }}>{fatal}</span>
          </div>
          )}
          {jobId && <div className="meta" style={{ marginTop: 12 }}>job {jobId}</div>}
        </section>
        {sponsored}
      </>
    );
  }

  // ---- THE LISTING: what the service is. No preview, no five-signature note.
  return (
    <div className="detail-grid">
      <div className="detail-head">{header}</div>
      <div className="detail-main">
        {stats}
        <section className="sec hire-cols">
        <div>
        <div className="label" style={{ fontSize: 9 }}>what the agent delivers</div>
        <div className="delivers">
        {delivers.map((d) => (
        <div key={d.key} className="delivers-row">
        <span className="data">{d.label}</span>
        <span className="meta" style={{ color: 'var(--text-faint)' }}>{d.key}</span>
        </div>
        ))}
        </div>
        <p className="meta" style={{ marginTop: 12, color: 'var(--text-faint)' }}>
        Field names are the deliverable&apos;s own keys, as submitted on chain.
        </p>
        </div>
        <div>
        <div className="label" style={{ fontSize: 9 }}>what you provide</div>
        <label className="data" style={{ display: 'block', marginTop: 14, color: 'var(--text-muted)' }}>{targetSpec.label}</label>
        {targetSpec.kind === 'pool' ? (
        <select className="target-input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={running}>
        {Object.keys(GRID_POOLS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        ) : (
        <input className="target-input" value={target} spellCheck={false} disabled={running}
        onChange={(e) => setTarget(e.target.value)} aria-label={targetSpec.label} />
        )}
        <p className="meta" style={{ marginTop: 10 }}>{targetSpec.hint}</p>
        {targetSpec.fixed && <p className="meta" style={{ marginTop: 6, color: 'var(--text-faint)' }}>fixed for this agent: {targetSpec.fixed}</p>}
        <div className="data" style={{ marginTop: 10, color: targetError ? 'var(--danger)' : 'var(--live)' }}>
        {targetError ? targetError : checking ? <span style={{ color: 'var(--text-faint)' }}>checking on chain…</span> : 'checked on chain ✓'}
        </div>
        </div>
        </section>

        {trackRecord}
        {sessionPanel}
        {completedWork}
      </div>
      {rail}
    </div>
  );
}
