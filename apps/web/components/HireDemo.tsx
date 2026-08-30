'use client';
/**
 * "Hire — run a live job" — streams the demo hire's real progression as a
 * vertical timeline. Each stage, on its REAL confirmation, slides in 8px with
 * a 200ms overshoot ease; its tx link fades in 150ms behind it; a 1px
 * connector grows down from the previous stage as it lands. The in-flight
 * stage pulses at reduced opacity — the only looping motion on the site,
 * justified as live-work signal; it stops the instant the state confirms or
 * fails. Failure states enter with the same motion and never pulse.
 * All motion is CSS behind prefers-reduced-motion; fallback is instant.
 */
import { useEffect, useRef, useState } from 'react';
import { VerifyDeliverable } from './VerifyDeliverable';
import { prefersReducedMotion, easeOut } from '@/lib/motion';

const EXPLORER = 'https://testnet.bscscan.com/tx/';
type Ev = Record<string, unknown> & { stage: string };
const STAGES = [
  ['funded', 'Escrow funded (1 $U)'],
  ['analysed', 'Analysis run (BSC mainnet reads)'],
  ['submitted', 'Deliverable submitted via session key'],
  ['verified', 'Hash verified on chain'],
  ['settlement-pending', 'Escrow release'],
] as const;

/** Count-up from `from` to `to` on mount — the existing CountUp idiom, local
 *  because the base value arrives as a prop rather than from scroll. */
function CountBump({ from, to }: { from: number; to: number }) {
  const [n, setN] = useState(prefersReducedMotion() ? to : from);
  useEffect(() => {
    if (prefersReducedMotion()) { setN(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 800);
      setN(Math.round(from + (to - from) * easeOut(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to]);
  return <span className="tnum">{n}</span>;
}

export function HireDemo({ agentId, completedCount }: { agentId: number; completedCount: number }) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const doneRef = useRef(false);

  const ev = (stage: string) => events.find((e) => e.stage === stage);
  const verified = ev('verified');
  // The in-flight stage: first unconfirmed one while running without error.
  const inFlightIdx = STAGES.findIndex(([k]) => !ev(k));

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
        <div className="hd-enter" style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
          <span className="data" style={{ color: 'var(--warn)' }}>{limit}</span>
        </div>
      )}
      {fatal && !limit && (
        <div className="hd-enter" style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--danger)' }}>
          <span className="data" style={{ color: 'var(--danger)' }}>{fatal}</span>
        </div>
      )}

      {ev('session-restored') != null && (
        <div className="hd-enter" style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--live-dim)' }}>
          <span className="data" style={{ color: 'var(--live)' }}>
            Session re-granted before submit (was revoked) —{' '}
            <a className="meta" style={{ color: 'var(--live-dim)' }} href={EXPLORER + String((ev('session-restored') as Ev).tx)} target="_blank" rel="noreferrer">tx ↗</a>
          </span>
        </div>
      )}

      {(events.length > 0 || running) && (
        <div style={{ marginTop: 18 }}>
          {STAGES.map(([key, label], i) => {
            const e = ev(key);
            const inFlight = i === inFlightIdx && running && !fatal;
            const settlementRow = key === 'settlement-pending' && !!e;
            const tx = e && typeof e.tx === 'string' && e.tx ? (e.tx as string) : null;
            return (
              <div key={key} style={{ display: 'flex', gap: 14 }}>
                {/* marker + growing connector */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14 }}>
                  {i > 0 && (
                    <div className={e ? 'hd-connector' : undefined}
                         style={{ width: 1, height: 14, background: e ? 'var(--live-dim)' : 'var(--border)' }} />
                  )}
                  <span className={`data${inFlight || settlementRow ? ' hd-pending hd-pulse' : ''}`}
                        style={{ color: e ? (settlementRow ? 'var(--stale)' : 'var(--live)') : inFlight ? 'var(--stale)' : 'var(--text-faint)', lineHeight: '20px' }}>
                    {e ? (settlementRow ? '·' : '✓') : inFlight ? '·' : '—'}
                  </span>
                </div>
                {/* row content: mounts (and animates) only on its real confirmation */}
                <div style={{ paddingBottom: 4, minHeight: i > 0 ? 34 : 20, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
                  {e ? (
                    <div className="hd-enter" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                      <span className={`data${settlementRow ? ' hd-pending hd-pulse' : ''}`} style={{ color: 'var(--text)' }}>
                        {label}
                        {key === 'funded' ? ` — job ${e.jobId}` : ''}
                        {key === 'analysed' ? ` — ${((e.ms as number) / 1000).toFixed(1)}s` : ''}
                        {settlementRow ? ' — pending: releases after the 900s dispute window (protocol, not agent)' : ''}
                      </span>
                      {tx && <a className="meta hd-tx" style={{ color: 'var(--live-dim)' }} href={EXPLORER + tx} target="_blank" rel="noreferrer">tx ↗</a>}
                    </div>
                  ) : (
                    <span className={`data${inFlight ? ' hd-pending hd-pulse' : ''}`}
                          style={{ color: inFlight ? 'var(--text-muted)' : 'var(--text-faint)' }}>{label}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {verified != null && (
        <div className="hd-enter" style={{ marginTop: 18 }}>
          <div className="meta" style={{ marginBottom: 8 }}>
            completed jobs: <CountBump from={completedCount} to={completedCount + 1} /> (this job settles after the window)
          </div>
          <VerifyDeliverable jobId={String((ev('funded') as Ev).jobId)} manifest={verified.manifest} />
        </div>
      )}
    </div>
  );
}
