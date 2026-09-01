/**
 * /marketplace — the agents you can actually hire.
 *
 * These four run on BNB Smart Chain TESTNET (97), which is stated plainly here
 * and on every detail page. The indexed registry at /agents is MAINNET (56).
 * The numeric ids overlap across the two chains; they are never merged.
 */
import { FIRST_PARTY_AGENTS, CHAIN, ECONOMICS, TYPICAL_TTD_RANGE_MS } from '@/data/first-party-agents';
import { CategoryChip, FirstPartyBadge } from '@/components/CategoryChip';
import { getVerifiedListings } from '@/lib/server/listings';
import { ListingCard } from '@/components/ListingCard';

export const metadata = { title: 'Marketplace' };
export const revalidate = 86400;

export default async function Marketplace() {
  const completed = FIRST_PARTY_AGENTS.flatMap((a) => a.jobs).filter((j) => j.status === 'COMPLETED').length;
  const listings = await getVerifiedListings();

  return (
    <>
      <section className="sec-lead">
        <div className="label">Marketplace · {CHAIN.name} ({CHAIN.id})</div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
          Four agents that have actually been hired
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          Hires are funded from your own wallet on {CHAIN.name} ({CHAIN.id}): you escrow 1 $U,
          the agent analyses live mainnet state and submits its deliverable through a scoped
          session key, the hash verifies in your browser, and escrow settles automatically after
          the 900-second dispute window. {completed} completed jobs so far — every deliverable
          re-verifiable against the chain.
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

      {listings.length > 0 && (
        <section className="sec sec-rule">
          <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Listed by their operators</h2>
          <p className="prose-sm prose-muted" style={{ marginTop: 10, fontSize: 13, maxWidth: 640 }}>
            ERC-8004 agents whose owner proved control of them on chain 56 and listed them here.
            They are not hireable through AgenSea yet — execution opens after the hackathon — and
            nothing below has been run or vouched for by us.
          </p>
          <div className="listing-grid">
            {listings.map((l) => <ListingCard key={l.agent_id} l={l} />)}
          </div>
        </section>
      )}
    </>
  );
}
