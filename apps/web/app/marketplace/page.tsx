/**
 * /marketplace — the agents you can actually hire.
 *
 * These four run on BNB Smart Chain TESTNET (97), which is stated plainly here
 * and on every detail page. The indexed registry at /agents is MAINNET (56).
 * The numeric ids overlap across the two chains; they are never merged.
 */
import { FIRST_PARTY_AGENTS, CHAIN, ECONOMICS, TYPICAL_TTD_RANGE_MS } from '@/data/first-party-agents';
import { CategoryChip, FirstPartyBadge } from '@/components/CategoryChip';

export const revalidate = 86400;

export default function Marketplace() {
  const completed = FIRST_PARTY_AGENTS.flatMap((a) => a.jobs).filter((j) => j.status === 'COMPLETED').length;

  return (
    <>
      <section style={{ padding: '72px 0 40px' }}>
        <div style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.14em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
          Marketplace · {CHAIN.name} ({CHAIN.id})
        </div>
        <h1 style={{ font: "500 36px/1.15 var(--display)", marginTop: 16, maxWidth: 720 }}>
          Four agents that have actually been hired
        </h1>
        <p style={{ font: "400 14px/1.6 var(--mono)", color: 'var(--text-muted)', maxWidth: 660, marginTop: 18 }}>
          Each has completed a real ERC-8183 job on chain {CHAIN.id}: escrow funded, analysis performed,
          deliverable submitted, hash verified, escrow released. {completed} completed jobs.
          Every deliverable below can be re-verified in your browser against the chain.
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
        {[
          ['Price per job', ECONOMICS.pricePerJob],
          ['Platform fee', ECONOMICS.platformFee.split(' —')[0]!],
          ['Typical time to deliverable', `${(TYPICAL_TTD_RANGE_MS.min / 1000).toFixed(0)}–${(TYPICAL_TTD_RANGE_MS.max / 1000).toFixed(0)}s`],
        ].map(([k, v]) => (
          <div key={k} style={{ padding: '20px 22px', background: 'var(--surface)' }}>
            <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.14em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{k}</div>
            <div style={{ font: "500 22px/1.1 var(--display)", color: 'var(--text)', marginTop: 12 }}>{v}</div>
          </div>
        ))}
      </section>

      <section style={{ padding: '48px 0 80px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
          {FIRST_PARTY_AGENTS.map((a) => {
            const done = a.jobs.filter((j) => j.status === 'COMPLETED');
            const fastest = Math.min(...a.jobs.map((j) => j.analysisMs));
            return (
              <a key={a.agentId} href={`/marketplace/${a.agentId}`} style={{ display: 'block', padding: '24px 26px', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <CategoryChip slug={a.slug} />
                  <FirstPartyBadge />
                </div>
                <div style={{ font: "500 17px/1.25 var(--display)", color: 'var(--text)', marginTop: 18 }}>{a.name}</div>
                <div style={{ font: "400 12px/1.6 var(--mono)", color: 'var(--text-muted)', marginTop: 12, minHeight: 58 }}>
                  {a.description}
                </div>
                <div style={{ display: 'flex', gap: 28, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  {[['price', a.priceLabel], ['completed', String(done.length)], ['analysis', `${(fastest / 1000).toFixed(1)}s`]].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{k}</div>
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
