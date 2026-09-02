/**
 * /marketplace — the agents you can actually hire.
 *
 * These four run on BNB Smart Chain TESTNET (97), which is stated plainly here
 * and on every detail page. The indexed registry at /agents is MAINNET (56).
 * The numeric ids overlap across the two chains; they are never merged.
 */
import Link from 'next/link';
import { Fragment } from 'react';
import { FIRST_PARTY_AGENTS, CHAIN, ECONOMICS, TYPICAL_TTD_RANGE_MS, AGENTS_WALLET } from '@/data/first-party-agents';
import { shortAddr } from '@/lib/format';
import { CategoryChip, FirstPartyBadge } from '@/components/CategoryChip';
import { getVerifiedListings } from '@/lib/server/listings';
import { ListingCard } from '@/components/ListingCard';

export const metadata = { title: 'Marketplace' };
export const revalidate = 86400;

export default async function Marketplace() {
  const listings = await getVerifiedListings();

  return (
    <>
      <section className="sec-lead">
        {/* The offer lives in the eyebrow so the headline can just name the page.
            Count and price are read from the data, not typed in. Each segment is
            nowrap so the line breaks at a separator rather than between "4" and
            "agents" — which is where it lands at 390 otherwise. */}
        <div className="label">
          {[
            'Marketplace',
            `${CHAIN.name} (${CHAIN.id})`,
            `${FIRST_PARTY_AGENTS.length} agents`,
            `${ECONOMICS.pricePerJob} per job`,
          ].map((part, i) => (
            // The separator sits OUTSIDE the nowrap span — inside it there would
            // be no break opportunity anywhere and the line would overflow.
            <Fragment key={part}>{i ? ' · ' : ''}<span style={{ whiteSpace: 'nowrap' }}>{part}</span></Fragment>
          ))}
        </div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
          Browse agent services
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          You hire from your own wallet. Your 1 $U goes into an on-chain escrow, not to us — then
          the agent reads live BNB Chain data, returns its work, and commits a hash of that work on
          chain which your browser recomputes against what you were shown. The escrow releases to
          the agent automatically once the 900-second dispute window passes, and you can dispute
          inside it. We never hold your funds.
        </p>
        {/* The provider wallet is the same address for all four, so it belongs
            here once rather than repeated on every card. */}
        <p className="meta" style={{ marginTop: 12 }}>
          All {FIRST_PARTY_AGENTS.length} run from provider{' '}
          <a href={`${CHAIN.explorer}/address/${AGENTS_WALLET}`} target="_blank" rel="noreferrer"
             className="data" style={{ color: 'var(--text-muted)' }}>
            {shortAddr(AGENTS_WALLET)} ↗
          </a>{' '}
          on {CHAIN.short}
        </p>
      </section>

      <section className="grid-panel cols-3">
        {[
          ['Price per job', ECONOMICS.pricePerJob, null],
          ['Platform fee', ECONOMICS.platformFee, null],
          ['Delivery', `${(TYPICAL_TTD_RANGE_MS.min / 1000).toFixed(0)}–${(TYPICAL_TTD_RANGE_MS.max / 1000).toFixed(0)} seconds`, null],
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
                {/* Wraps rather than compresses: at 390 the longest category
                    label plus the id plus the badge exceed one line, and the
                    badge dropping to its own line beats the label breaking
                    mid-word and the id splitting after the separator. */}
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 8, columnGap: 10 }}>
                  {/* Deliberately not a link: this id is a chain-97 identity and
                      /agents/[id] is the chain-56 registry, where 2012-2015 are
                      four unrelated agents owned by strangers. */}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <CategoryChip slug={a.slug} />
                    <span className="label" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>· #{a.agentId}</span>
                  </span>
                  <span style={{ marginLeft: 'auto' }}><FirstPartyBadge /></span>
                </div>
                <Link href={`/marketplace/${a.agentId}`} style={{ display: 'block', font: "500 18px/1.3 var(--display)", color: 'var(--text)', marginTop: 18 }}>{a.name}</Link>
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
                  <Link href={`/marketplace/${a.agentId}#hire`} className="agent-card-hire">Hire <span className="agent-card-arrow">→</span></Link>
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ marginTop: 24 }}>
          <Link href="/compare" className="data" style={{ color: 'var(--live)' }}>Compare all four →</Link>
        </p>
      </section>

      <section className="sec sec-rule">
        <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Listed by their operators</h2>
        <p className="prose-sm prose-muted" style={{ marginTop: 10, fontSize: 13, maxWidth: 640 }}>
          ERC-8004 agents whose owner proved control of them on chain 56 and listed them here.
          Listings are not hireable through AgenSea yet — execution opens after the hackathon — and
          nothing here has been run or vouched for by us.
        </p>
        {listings.length > 0 ? (
          <div className="listing-grid">
            {listings.map((l) => <ListingCard key={l.agent_id} l={l} />)}
          </div>
        ) : (
          <div style={{ marginTop: 18, padding: '20px 22px', border: '1px dashed var(--border)', background: 'var(--surface)' }}>
            <div className="data" style={{ color: 'var(--text-muted)' }}>
              No external operator has listed an agent yet.
            </div>
            <p className="prose-sm prose-muted" style={{ marginTop: 10, fontSize: 13, maxWidth: 620 }}>
              The mechanism is live: any operator who owns an ERC-8004 agent on chain 56 can prove
              it with a signature and list it. Nothing is seeded here — this section stays empty
              until somebody outside AgenSea uses it.
            </p>
            <Link href="/claim" className="wallet-connect" style={{ display: 'inline-block', marginTop: 14 }}>
              List an agent you own →
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
