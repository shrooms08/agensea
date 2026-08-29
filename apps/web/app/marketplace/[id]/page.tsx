/**
 * /marketplace/[id] — first-party agent detail, TESTNET 97.
 *
 * Distinct namespace from /agents/[id] (registry, mainnet 56) on purpose: the
 * numeric ids collide across chains and merging them would misrepresent both.
 */
import { notFound } from 'next/navigation';
import { FIRST_PARTY_AGENTS, byId, CHAIN, ERC8183, DISPUTE_WINDOW_SECONDS } from '@/data/first-party-agents';
import { deliverableFor } from '@/data/deliverables';
import { CategoryChip, FirstPartyBadge, CAT_TOKEN } from '@/components/CategoryChip';
import { VerifyDeliverable } from '@/components/VerifyDeliverable';

export const revalidate = 86400;
export const dynamicParams = false;   // exactly four, all known at build

export function generateStaticParams() {
  return FIRST_PARTY_AGENTS.map((a) => ({ id: String(a.agentId) }));
}

const Field = ({ k, v, tone, mono = true }: { k: string; v: string; tone?: string; mono?: boolean }) => (
  <div>
    <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{k}</div>
    <div style={{ font: mono ? "400 12px/1.5 var(--mono)" : "400 13px/1.5 var(--display)", color: tone ?? 'var(--text)', marginTop: 6, wordBreak: 'break-all' }}>{v}</div>
  </div>
);

export default async function FirstPartyAgent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = byId(Number(id));
  if (!agent) notFound();

  const s = agent.session;
  const expiry = new Date(s.expiryUnix * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return (
    <>
      <section className="sec-lead">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CategoryChip slug={agent.slug} />
          <FirstPartyBadge />
        </div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 18 }}>{agent.name}</h1>
        <div className="label" style={{ marginTop: 10 }}>Agent #{agent.agentId} · {CHAIN.name} ({CHAIN.id})</div>
        <p className="prose prose-muted" style={{ marginTop: 16 }}>{agent.description}</p>
        <p className="prose-sm" style={{ color: 'var(--text-faint)', marginTop: 10, fontSize: 13 }}>
          Settles on testnet {CHAIN.id}; reads live data from BNB Smart Chain mainnet ({agent.analysisChainId}) to do the analysis.
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20, padding: '20px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <Field k="price" v={agent.priceLabel} tone={CAT_TOKEN[agent.slug]} />
        <Field k="completed jobs" v={String(agent.jobs.filter((j) => j.status === 'COMPLETED').length)} />
        <Field k="fastest analysis" v={`${(Math.min(...agent.jobs.map((j) => j.analysisMs)) / 1000).toFixed(1)}s`} />
        <Field k="dispute window" v={`${DISPUTE_WINDOW_SECONDS}s`} />
      </section>

      <section className="sec">
        <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Session permissions</h2>
        <p className="prose-sm prose-muted" style={{ marginTop: 10 }}>
          This agent acts through an Altana session key whose permissions are enforced on-chain.
          It can call exactly one function on one contract, under a spending cap, until expiry.
        </p>
        <div className="card-lg" style={{ marginTop: 16, border: '1px solid var(--border)', display: 'grid', gap: 16 }}>
          <Field k="session key" v={s.address} />
          <div>
            <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>call allowlist</div>
            {s.calls.map((c) => (
              <div key={c.signature} style={{ font: "400 12px/1.6 var(--mono)", color: 'var(--live)', marginTop: 8 }}>
                {c.signature}<span style={{ color: 'var(--text-muted)' }}> on </span>{c.to}
              </div>
            ))}
            <div style={{ font: "400 11px/1.5 var(--mono)", color: 'var(--text-faint)', marginTop: 8 }}>
              Anything else reverts at validation time.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
            <Field k="spend cap" v={`${s.spendCapLabel}  (${s.spendCapWei} wei)`} />
            <Field k="expires" v={expiry} />
          </div>
        </div>
        <div style={{ marginTop: 14, padding: '14px 18px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
          <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--warn)', textTransform: 'uppercase' }}>Sizing a cap</div>
          <p className="prose-sm prose-muted" style={{ marginTop: 8, fontSize: 13 }}>
            The cap must cover the <strong style={{ color: 'var(--text)' }}>relay fee</strong>, not just value transferred —
            a read-only agent that moves no funds still spends on every submit. Measured fees varied
            about 11% run to run, so size at <strong style={{ color: 'var(--text)' }}>2× a measurement</strong>, never 1×.
            A cap of exactly one observed fee will fail intermittently.
          </p>
        </div>
      </section>

      <section className="sec sec-rule">
        <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Completed work</h2>
        <p className="prose-sm prose-muted" style={{ marginTop: 10 }}>
          Each deliverable is a JSON manifest whose keccak256 is stored on chain. Verify recomputes
          the hash in your browser and compares it to the chain — nothing here is taken on trust.
        </p>
        <div style={{ display: 'grid', gap: 18, marginTop: 22 }}>
          {agent.jobs.map((job) => {
            const d = deliverableFor(job.jobId);
            return (
              <div key={job.jobId}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <div style={{ font: "500 13px/1 var(--mono)", color: 'var(--text)' }}>
                    Job {job.jobId}
                    <span style={{ color: job.status === 'COMPLETED' ? 'var(--live)' : 'var(--stale)', marginLeft: 10 }}>{job.status}</span>
                  </div>
                  <a href={`${CHAIN.explorer}/tx`} style={{ font: "400 10px/1 var(--mono)", color: 'var(--text-faint)' }}>
                    analysis {(job.analysisMs / 1000).toFixed(1)}s
                  </a>
                </div>
                {job.transportAnomaly && (
                  <div style={{ font: "400 11px/1.5 var(--mono)", color: 'var(--warn)', marginBottom: 10 }}>
                    {job.transportAnomaly}
                  </div>
                )}
                {d ? <VerifyDeliverable jobId={job.jobId} manifest={d.manifest} />
                   : <div style={{ font: "400 11px/1 var(--mono)", color: 'var(--text-faint)' }}>manifest not published</div>}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
