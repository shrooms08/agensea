/**
 * /marketplace — the agents you can actually hire.
 *
 * These four run on BNB Smart Chain TESTNET (97), which is stated plainly here
 * and on every detail page. The indexed registry at /agents is MAINNET (56).
 * The numeric ids overlap across the two chains; they are never merged.
 */
import { FIRST_PARTY_AGENTS, CHAIN, ECONOMICS, TYPICAL_TTD_RANGE_MS } from '@/data/first-party-agents';
import { CategoryChip, FirstPartyBadge } from '@/components/CategoryChip';

export const metadata = { title: 'Marketplace' };
export const revalidate = 86400;

export default function Marketplace() {
  const completed = FIRST_PARTY_AGENTS.flatMap((a) => a.jobs).filter((j) => j.status === 'COMPLETED').length;

  return (
    <>
      <section className="sec-lead">
        <div className="label">Marketplace · {CHAIN.name} ({CHAIN.id})</div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
          Four agents that have actually been hired
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          Each has completed a real ERC-8183 job on chain {CHAIN.id}: escrow funded, analysis performed,
          deliverable submitted, hash verified, escrow released. {completed} completed jobs.
          Every deliverable below can be re-verified in your browser against the chain.
        </p>
      </section>

      <section className="grid-panel cols-3">
        {[
          ['Price per job', ECONOMICS.pricePerJob, null],
          ['Platform fee', ECONOMICS.platformFee, ECONOMICS.platformFeeNote],
          ['Typical time to deliverable', `${(TYPICAL_TTD_RANGE_MS.min / 1000).toFixed(0)}–${(TYPICAL_TTD_RANGE_MS.max / 1000).toFixed(0)}s`, 'excludes one relay-timeout run'],
        ].map(([k, v, note]) => (
          <div key={k as string} className="card">
            <div className="label">{k}</div>
            <div className="num stat-value" style={{ marginTop: 10 }}>{v}</div>
            {note && <div className="meta" style={{ marginTop: 9 }}>{note}</div>}
          </div>
        ))}
      </section>

      <section className="sec" style={{ paddingTop: 52 }}>
        <div className="agent-card-grid">
          {FIRST_PARTY_AGENTS.map((a) => {
            const done = a.jobs.filter((j) => j.status === 'COMPLETED');
            const fastest = Math.min(...a.jobs.map((j) => j.analysisMs));
            return (
              <div key={a.agentId} className="agent-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <CategoryChip slug={a.slug} />
                  <FirstPartyBadge />
                </div>
                <a href={`/marketplace/${a.agentId}`} style={{ display: 'block', font: "500 18px/1.3 var(--display)", color: 'var(--text)', marginTop: 18 }}>{a.name}</a>
                <p className="prose-sm prose-muted agent-card-desc">{a.description}</p>
                <div className="agent-card-metrics">
                  {[['completed', String(done.length)], ['analysis', `${(fastest / 1000).toFixed(1)}s`]].map(([k, v]) => (
                    <div key={k}>
                      <div className="label" style={{ fontSize: 9 }}>{k}</div>
                      <div style={{ font: "500 13px/1 var(--mono)", color: 'var(--text)', marginTop: 7 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="agent-card-foot">
                  <span style={{ font: "500 12px/1 var(--mono)", color: 'var(--text)' }}>{a.priceLabel} / hire</span>
                  <a href={`/marketplace/${a.agentId}#hire`} className="agent-card-hire">Hire <span className="agent-card-arrow">→</span></a>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
