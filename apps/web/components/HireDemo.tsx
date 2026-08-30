'use client';
/**
 * "Hire — run a live job" — streams the demo hire's real progression.
 * Each stage lands with its tx link as it confirms. Failure states are
 * first-class and distinct: limit-reached, relay, RPC, internal — a judge
 * pressing this during an outage sees "couldn't reach the chain", never an
 * eternal spinner or a fake success.
 */
import { useRef, useState } from 'react';
import { VerifyDeliverable } from './VerifyDeliverable';

const EXPLORER = 'https://testnet.bscscan.com/tx/';
type Ev = Record<string, unknown> & { stage: string };
const STAGES = [
  ['funded', 'Escrow funded (1 $U)'],
  ['analysed', 'Analysis run (BSC mainnet reads)'],
  ['submitted', 'Deliverable submitted via session key'],
  ['verified', 'Hash verified on chain'],
  ['settlement-pending', 'Escrow release'],
] as const;

export function HireDemo({ agentId }: { agentId: number }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const doneRef = useRef(false);

  const ev = (stage: string) => events.find((e) => e.stage === stage);
  const verified = ev('verified');

  async function press() {
    if (running || doneRef.current) return;
    setRunning(true); setFatal(null); setLimit(null); setEvents([]);
    try {
      const res = await fetch(`/api/hire/${agentId}`, { method: 'POST' });
      if (res.status === 429) { setLimit(((await res.json()) as { error: string }).error); setRunning(false); return; }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setFatal((j as { error?: string }).error ?? 'the demo endpoint did not answer'); setRunning(false); return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const l of lines) {
          if (!l.trim()) continue;
          const e = JSON.parse(l) as Ev;
          setEvents((prev) => [...prev, e]);
          if (e.stage === 'error') setFatal(String(e.message));
          if (e.stage === 'settlement-pending') doneRef.current = true;
        }
      }
    } catch {
      setFatal("couldn't reach the chain — the stream dropped mid-flight; the job may still complete on chain");
    }
    setRunning(false);
  }

  return (
    <div style={{ marginTop: 18, border: '1px solid var(--border-strong)', background: 'var(--surface)', padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="label">Platform-sponsored demo job (1 $U, BNB testnet)</div>
          <div className="prose-sm prose-muted" style={{ marginTop: 6, fontSize: 13 }}>
            Runs the full ERC-8183 escrow cycle with real transactions. Self-custodial hiring from
            your own wallet is the roadmap — session-scoped via Altana.
          </div>
        </div>
        <button onClick={press} disabled={running || doneRef.current}
          style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
                   color: running || doneRef.current ? 'var(--text-faint)' : 'var(--bg)',
                   background: running || doneRef.current ? 'var(--surface-raised)' : 'var(--live)',
                   border: 'none', padding: '12px 18px', cursor: running ? 'wait' : doneRef.current ? 'default' : 'pointer' }}>
          {running ? 'Running…' : doneRef.current ? 'Job complete' : 'Hire — run a live job'}
        </button>
      </div>

      {limit && (
        <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
          <span className="data" style={{ color: 'var(--warn)' }}>{limit}</span>
        </div>
      )}
      {fatal && !limit && (
        <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--danger)' }}>
          <span className="data" style={{ color: 'var(--danger)' }}>{fatal}</span>
        </div>
      )}

      {(events.length > 0 || running) && (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {STAGES.map(([key, label]) => {
            const e = ev(key);
            const active = !e && running && !fatal;
            const tx = e && typeof e.tx === 'string' && e.tx ? (e.tx as string) : null;
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span className="data" style={{ width: 14, color: e ? 'var(--live)' : active ? 'var(--stale)' : 'var(--text-faint)' }}>
                  {e ? '✓' : active ? '·' : '—'}
                </span>
                <span className="data" style={{ color: e ? 'var(--text)' : 'var(--text-muted)' }}>
                  {label}
                  {key === 'funded' && e ? ` — job ${e.jobId}` : ''}
                  {key === 'analysed' && e ? ` — ${((e.ms as number) / 1000).toFixed(1)}s` : ''}
                  {key === 'settlement-pending' && e ? ' — pending: releases after the 900s dispute window (protocol, not agent)' : ''}
                </span>
                {tx && <a className="meta" style={{ color: 'var(--live-dim)' }} href={EXPLORER + tx} target="_blank" rel="noreferrer">tx ↗</a>}
              </div>
            );
          })}
        </div>
      )}

      {verified != null && (
        <div style={{ marginTop: 18 }}>
          <div className="meta" style={{ marginBottom: 8 }}>
            completed count: +1 (this job; settles after the window)
          </div>
          <VerifyDeliverable jobId={String((ev('funded') as Ev).jobId)} manifest={verified.manifest} />
        </div>
      )}
    </div>
  );
}
