/**
 * /listing/[agentId] — an operator's listing.
 *
 * Everything here is what the operator DECLARED, plus what OUR sweep measured
 * about the same agent on chain. The two are labelled separately and never
 * mixed. Ownership is re-verified against the registry before this renders.
 */
import { notFound } from 'next/navigation';
import { getVerifiedListing } from '@/lib/server/listings';
import { getAgent, getBareAgent } from '@/lib/queries';
import { CAT_TOKEN, CAT_LABEL } from '@/components/CategoryChip';
import { int, measuredOn, livenessToken } from '@/lib/format';
import type { CategorySlug } from '@/data/first-party-agents';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const l = await getVerifiedListing(Number(agentId));
  return { title: l ? l.name : 'Listing' };
}

export default async function ListingDetail({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) notFound();
  const l = await getVerifiedListing(id);
  if (!l) notFound();
  const swept = (await getAgent(id)) ?? (await getBareAgent(id));
  const slug = l.category as CategorySlug | null;

  return (
    <>
      <section className="sec-lead">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="label" style={{ fontSize: 9 }}>
            operator listing · ERC-8004 agent #{l.agent_id} · BNB Smart Chain mainnet (56)
          </div>
          <span className="listing-chip">listed · not yet hireable through AgenSea</span>
        </div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 16 }}>{l.name}</h1>
        {slug && (
          <div className="label" style={{ marginTop: 12, color: CAT_TOKEN[slug], display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, background: CAT_TOKEN[slug] }} />{CAT_LABEL[slug]}
          </div>
        )}
        {l.description && <p className="prose prose-muted" style={{ marginTop: 16 }}>{l.description}</p>}
      </section>

      <section className="sec">
        <div className="label" style={{ fontSize: 9 }}>declared by the operator</div>
        <div className="docs-block">
          <div className="docs-block-row"><span className="docs-block-k">price</span>
            <span className="docs-block-v">{l.price_u !== null ? `${Number(l.price_u)} $U per job` : 'not stated'}</span></div>
          {l.delivers && l.delivers.length > 0 && (
            <div className="docs-block-row"><span className="docs-block-k">delivers</span>
              <span className="docs-block-v">{l.delivers.join(' · ')}</span></div>
          )}
          {l.input_schema && Object.keys(l.input_schema).length > 0 && (
            <div className="docs-block-row"><span className="docs-block-k">takes as input</span>
              <span className="docs-block-v">
                {Object.entries(l.input_schema).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
              </span></div>
          )}
          {l.endpoint_url && (
            <div className="docs-block-row"><span className="docs-block-k">endpoint</span>
              <span className="docs-block-v" style={{ wordBreak: 'break-all' }}>{l.endpoint_url}</span></div>
          )}
          <div className="docs-block-row"><span className="docs-block-k">listed</span>
            <span className="docs-block-v">{l.listed_at ? measuredOn(l.listed_at) : '—'}</span></div>
        </div>
        <p className="meta" style={{ marginTop: 12, color: 'var(--text-faint)' }}>
          These are the operator&apos;s own claims about their agent. We have not run it and do not
          vouch for it; the endpoint above is displayed, never called by us.
        </p>
      </section>

      <section className="sec sec-rule">
        <div className="label" style={{ fontSize: 9 }}>on-chain identity and our own measurement</div>
        <div className="docs-block">
          <div className="docs-block-row"><span className="docs-block-k">owner</span>
            <span className="docs-block-v" style={{ wordBreak: 'break-all' }}>
              {l.owner} — verified against <span className="data">ownerOf({l.agent_id})</span> on the
              IdentityRegistry when this page rendered
            </span></div>
          {swept ? (
            <>
              <div className="docs-block-row"><span className="docs-block-k">clients (our sweep)</span>
                <span className="docs-block-v" style={{ color: `var(${livenessToken(swept.client_count)})` }}>
                  {int(swept.client_count)}
                </span></div>
              <div className="docs-block-row"><span className="docs-block-k">measured</span>
                <span className="docs-block-v">{measuredOn(swept.checked_at)}</span></div>
            </>
          ) : (
            <div className="docs-block-row"><span className="docs-block-k">our sweep</span>
              <span className="docs-block-v">this agent is newer than our last sweep</span></div>
          )}
        </div>
        <p className="prose-sm prose-muted" style={{ marginTop: 14, fontSize: 13 }}>
          Full registry record: <a href={`/agents/${l.agent_id}`} style={{ color: 'var(--live)' }}>/agents/{l.agent_id}</a>
        </p>
      </section>

      <section className="sec sec-rule" style={{ paddingBottom: 64 }}>
        <div style={{ padding: '16px 20px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
          <div className="label" style={{ fontSize: 9, color: 'var(--warn)' }}>not yet hireable through AgenSea</div>
          <p className="prose-sm prose-muted" style={{ marginTop: 10, fontSize: 13 }}>
            Claiming and listing are live; execution is not. We do not call operator-supplied
            endpoints in this build — doing so from our own route would be a server-side request
            forgery risk and would put a third party&apos;s uptime on the path our own hire flow
            uses. Hiring through AgenSea works today for our four first-party agents; third-party
            execution opens after the hackathon. See <a href="/docs#limits" style={{ color: 'var(--live)' }}>the limits section</a>.
          </p>
        </div>
      </section>
    </>
  );
}
