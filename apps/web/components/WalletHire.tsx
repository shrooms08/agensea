'use client';
/**
 * Wallet-native hire — the PRIMARY path on /marketplace/[id].
 *
 * The buyer is the connected wallet, not the platform: approve -> create
 * (createJob + registerJob + setBudget) -> fund, as sequential wallet
 * transactions with a stage indicator, then POST /api/agent-work so the
 * agent analyses and submits through its session key. jobId is claimed by
 * reading jobCounter first and verified after createJob by matching our
 * unique description nonce (walking ±3 if a race lost the slot).
 *
 * Stuck-funded recovery: on mount we scan chain state for FUNDED jobs from
 * this wallet against our provider — tab closed after funding, network drop —
 * and offer Resume (agent-work) or, past expiry, Reclaim (claimRefund from
 * their wallet). A judge's escrow must never sit silently stuck.
 */
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import { useEffect, useRef, useState } from 'react';
import { keccak256, stringToHex } from 'viem';
import { bscTestnet97, U_TOKEN } from '@/lib/wallet/config';
import { COMMERCE_ABI, ROUTER_ABI, ERC20_APPROVE_ABI, ERC8183 } from '@/lib/wallet/erc8183';
import { useWalletFunding } from '@/components/HirePreflight';

const PRICE = 10n ** 18n;
const EXPLORER = 'https://testnet.bscscan.com/tx/';
type Ev = { stage: string; [k: string]: unknown };
type TxStep = { id: number; label: string; tx?: string; state: 'pending' | 'confirming' | 'done' | 'failed' };
type Funded = { jobId: string; agentId: number; expiredAt: number; expired: boolean };

export function WalletHire({ agentId }: { agentId: number }) {
  const { address } = useAccount();
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
  const push = (label: string): number => { const id = stepId.current++; setSteps((p) => [...p, { id, label, state: 'pending' }]); return id; };
  const mark = (id: number, patch: Partial<TxStep>) => setSteps((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  async function sendStep(label: string, fn: () => Promise<`0x${string}`>): Promise<void> {
    const i = push(label);
    try {
      const tx = await fn();
      mark(i, { tx, state: 'confirming' });
      await pub!.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
      mark(i, { state: 'done' });
    } catch (e) {
      const rejected = /reject|denied|4001/i.test(String((e as Error).message));
      mark(i, { state: 'failed' });
      throw new Error(rejected ? `${label} was rejected in your wallet — nothing further was sent` : `${label} failed: ${String((e as Error).message).slice(0, 90)}`);
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
    setRunning(true); setFatal(null); setSteps([]); setEvents([]); setJobId(null);
    try {
      // stage 1: approve
      await sendStep('Approve 1 $U', () => writeContractAsync({
        address: U_TOKEN, abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [ERC8183.commerce, PRICE], chainId: bscTestnet97.id }));
      // stage 2: create (createJob + registerJob + setBudget)
      const nonce = crypto.randomUUID();
      const description = JSON.stringify({ wallet: true, agentId, nonce, at: Date.now() });
      const counter = (await pub.readContract({ address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'jobCounter' })) as bigint;
      let expected = counter + 1n;
      await sendStep('Create job', () => writeContractAsync({
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
      await sendStep('Register policy', () => writeContractAsync({
        address: ERC8183.router, abi: ROUTER_ABI, functionName: 'registerJob', args: [expected, ERC8183.policy], chainId: bscTestnet97.id }));
      await sendStep('Set budget', () => writeContractAsync({
        address: ERC8183.commerce, abi: COMMERCE_ABI, functionName: 'setBudget', args: [expected, PRICE, '0x'], chainId: bscTestnet97.id }));
      // stage 3: fund
      await sendStep('Fund escrow (1 $U)', () => writeContractAsync({
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
      // one \uXXXX per UTF-16 code unit, matching the server's escapeNonAscii
      for (let i = 0; i < ch.length; i++) canon += '\\u' + ch.charCodeAt(i).toString(16).padStart(4, '0');
    }
    localHash = keccak256(stringToHex(canon));
    verifyState = localHash.toLowerCase() === verifiedEv.onChain.toLowerCase() ? 'match' : 'mismatch';
  }

  if (!f.isConnected) return null;

  return (
    <div style={{ marginTop: 14, border: '1px solid var(--border-strong)', background: 'var(--surface)', padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="label">Hire from your wallet — 1 $U, BNB Smart Chain Testnet (97)</div>
          <div className="prose-sm prose-muted" style={{ marginTop: 6, fontSize: 13 }}>
            You fund the escrow from your own wallet; the agent analyses live mainnet state and submits
            the deliverable through its scoped session key. Every step is a real transaction you sign.
          </div>
        </div>
        <button onClick={hire} disabled={!f.ready || running || doneRef.current}
          style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
                   color: f.ready && !running && !doneRef.current ? 'var(--bg)' : 'var(--text-faint)',
                   background: f.ready && !running && !doneRef.current ? 'var(--live-dim)' : 'var(--surface-raised)',
                   border: 'none', padding: '12px 20px', cursor: f.ready && !running ? 'pointer' : 'not-allowed' }}>
          {doneRef.current ? 'Job complete' : running ? 'In progress…' : 'Hire — sign in your wallet'}
        </button>
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
              <span className="data" style={{ width: 14, color: s.state === 'done' ? 'var(--live)' : s.state === 'failed' ? 'var(--danger)' : 'var(--text-faint)' }}>
                {s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : '·'}
              </span>
              <span className="data" style={{ color: s.state === 'failed' ? 'var(--danger)' : 'var(--text)' }}>{s.label}</span>
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
    </div>
  );
}
