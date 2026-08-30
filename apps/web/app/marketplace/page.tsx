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

      <section className="sec">
        <div className="grid-panel cols-2">
          {FIRST_PARTY_AGENTS.map((a) => {
            const done = a.jobs.filter((j) => j.status === 'COMPLETED');
            const fastest = Math.min(...a.jobs.map((j) => j.analysisMs));
            return (
              <a key={a.agentId} href={`/marketplace/${a.agentId}`} className="card-lg" style={{ display: 'block' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <CategoryChip slug={a.slug} />
                  <FirstPartyBadge />
                </div>
                <div style={{ font: "500 17px/1.25 var(--display)", color: 'var(--text)', marginTop: 16 }}>{a.name}</div>
                <p className="prose-sm prose-muted" style={{ marginTop: 10, minHeight: 72 }}>{a.description}</p>
                <div style={{ display: 'flex', gap: 28, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  {[['price', a.priceLabel], ['completed', String(done.length)], ['analysis', `${(fastest / 1000).toFixed(1)}s`]].map(([k, v]) => (
                    <div key={k}>
                      <div className="label" style={{ fontSize: 9 }}>{k}</div>
                      <div style={{ font: "500 13px/1 var(--mono)", color: 'var(--text)', marginTop: 6 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </a>
            );
          })}
        </div>
      </section>
    </>
  );
}
