/**
 * /agents/[id] — REGISTRY agent detail, BSC MAINNET (chain 56).
 *
 * This namespace is the indexed registry only. AgenSea's own four agents live
 * on TESTNET 97 and are at /marketplace/[id]; the numeric ids overlap (mainnet
 * agent 2012 is a different entity from our chain-97 agent 2012), so the two
 * are deliberately not merged under one route.
 *
 * Rendering: ISR, not dynamic. Supabase is on the free plan and pauses after 7
 * days of low activity; a static page keeps serving from the CDN while the
 * database is down, whereas a dynamic one would 500.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAgent, getOverlapAgent, getBareAgent, getAgentEnrichment } from '@/lib/queries';
import { byMainnetId, AGENTS_WALLET } from '@/data/first-party-agents';
import { FirstPartyBadge } from '@/components/CategoryChip';
import { int, shortAddr, measuredOn, livenessToken } from '@/lib/format';

export const revalidate = 86400;   // 24h; push updates via POST /api/revalidate
export const dynamicParams = true; // ids outside the prerendered set render on demand

/** A bounded, interesting subset — NOT the whole live set, which tracks
 *  registry_stats.agents_with_client (4,353 as of 29 Aug 2026).
 *  The rest are ISR on first hit. */
export async function generateStaticParams() {
  const TOP_BY_FANOUT = [
    2658, 2862, 2140, 2517, 2532, 2536, 2554, 2586, 2385, 2410, 2430, 2432,
    2522, 2531, 2540, 2877, 2397, 2418, 2543, 2882, 2394, 2416, 2417, 2520,
  ];
  const OVERLAP = [127417];
  return [...TOP_BY_FANOUT, ...OVERLAP].map((id) => ({ id: String(id) }));
}

const Field = ({ k, v, tone }: { k: string; v: string; tone?: string }) => (
  <div>
    <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{k}</div>
    <div style={{ font: "400 12px/1.4 var(--mono)", color: tone ?? 'var(--text)', marginTop: 6, wordBreak: 'break-all' }}>{v}</div>
  </div>
);

export default async function AgentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isInteger(agentId) || agentId < 1) notFound();

  const agent = await getAgent(agentId);
  const overlap = agent ? null : await getOverlapAgent(agentId);
  const bare = agent || overlap ? null : await getBareAgent(agentId);
  // Third-party metadata for agents our own sweep could not resolve. Read from
  // our table; their API is never called at runtime.
  const enrichment = await getAgentEnrichment(agentId);
  if (!agent && !overlap && !bare) notFound();

  const a = (agent ?? overlap ?? bare)!;
  const isOverlap = !agent;
  const tone = `var(${livenessToken(a.client_count)})`;
  // First-party cross-link: presentation only. The row is untouched sweep
  // output — client_count, liveness filters, ordering and Pass 2 selection
  // treat this id exactly like every other zero-client agent.
  const firstParty = byMainnetId(a.agent_id);
  const ownerIsOurs = a.owner?.toLowerCase() === AGENTS_WALLET.toLowerCase();

  return (
    <>
      <section className="sec-lead">
        <div className="label">ERC-8004 registry · BNB Smart Chain mainnet (56)</div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 14 }}>Agent #{a.agent_id}</h1>

        {firstParty && (
          <div style={{ marginTop: 18, padding: '14px 18px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--accent)' }}>
            <FirstPartyBadge />
            <p className="prose-sm prose-muted" style={{ marginTop: 10, fontSize: 13 }}>
              AgenSea&apos;s own agent —{' '}
              <Link href={`/marketplace/${firstParty.agentId}`} style={{ color: 'var(--live)' }}>{firstParty.name}, hireable on testnet 97</Link>.
              {ownerIsOurs
                ? <> Verifiable from the row itself: the owner above is {AGENTS_WALLET.slice(0, 10)}…, AgenSea&apos;s published agents wallet — the same address that provides every chain-97 job.</>
                : <> (Owner check did not match the published agents wallet — treat the claim with suspicion.)</>}
            </p>
          </div>
        )}

        {isOverlap && (
          <div style={{ marginTop: 18, padding: '14px 18px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
            <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--warn)', textTransform: 'uppercase' }}>
              Not in the liveness set
            </div>
            <p className="prose-sm prose-muted" style={{ marginTop: 8, fontSize: 13 }}>
              This agent has zero clients, so it is absent from the fan-out curve and from every
              agent count on this site. It is here because it is the only B402 Bazaar payee that
              also holds an ERC-8004 identity — revenue without reputation.
            </p>
          </div>
        )}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20, padding: '20px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <Field k="clients" v={int(a.client_count)} tone={tone} />
        <Field k="feedback entries" v={a.feedback_count ? int(a.feedback_count) : '0'} />
        <Field k="owner" v={shortAddr(a.owner)} />
        <Field k="agent wallet" v={shortAddr(a.agent_wallet)} />
      </section>

      <section className="sec">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
          <Field k="tokenURI kind" v={a.token_uri_kind ?? '—'} />
          <Field k="metadata host" v={a.token_uri_host ?? (a.token_uri_kind === 'data' ? 'inline data: URI' : '—')} />
        </div>
        {a.token_uri && (
          <div style={{ marginTop: 24 }}>
            <Field k="tokenURI" v={a.token_uri.length > 160 ? a.token_uri.slice(0, 160) + '…' : a.token_uri} />
          </div>
        )}
        {overlap && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24, marginTop: 24 }}>
            <Field k="B402 resources" v={int(overlap.bazaar_resources)} />
            <Field k="share of catalogue" v={`${overlap.bazaar_pct}%`} />
          </div>
        )}
        <div className="meta" style={{ marginTop: 22 }}>measured {measuredOn(a.checked_at)}</div>
      </section>

      {enrichment && (
        <section className="sec">
          <div className="enrich-block">
            <div className="enrich-head">
              <span className="label" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                third-party metadata — not our measurement
              </span>
              <span className="meta" style={{ color: 'var(--text-faint)' }}>
                Enriched from {enrichment.source}, ingested {measuredOn(enrichment.ingested_at)}
              </span>
            </div>
            <div style={{ font: "500 15px/1.3 var(--display)", color: 'var(--text)', marginTop: 14 }}>{enrichment.name}</div>
            {enrichment.description && (
              <p className="prose-sm prose-muted" style={{ marginTop: 10, fontSize: 13 }}>{enrichment.description}</p>
            )}
            <div className="enrich-rows">
              {enrichment.protocols && enrichment.protocols.length > 0 && (
                <div><span className="label" style={{ fontSize: 9 }}>protocols</span>
                  <div className="data" style={{ marginTop: 6 }}>{enrichment.protocols.join(' · ')}</div></div>
              )}
              {enrichment.agent_url && (
                <div><span className="label" style={{ fontSize: 9 }}>endpoint</span>
                  <div className="data" style={{ marginTop: 6, wordBreak: 'break-all' }}>{enrichment.agent_url}</div></div>
              )}
              {enrichment.is_verified !== null && (
                <div><span className="label" style={{ fontSize: 9 }}>verified by them</span>
                  <div className="data" style={{ marginTop: 6, color: 'var(--text-muted)' }}>{enrichment.is_verified ? 'yes' : 'no'}</div></div>
              )}
            </div>
            <p className="meta" style={{ marginTop: 16, color: 'var(--text-faint)' }}>
              Our own sweep found no usable metadata for this agent. The above is what 8004scan
              held when we ingested it, shown as received and stored once — we do not call their
              API at page load, and none of it feeds the client or liveness figures above.
            </p>
          </div>
        </section>
      )}

      <section className="sec sec-rule">
        <p className="prose-sm prose-muted" style={{ fontSize: 13 }}>
          Registry agents are indexed from chain 56 and are not hireable here. AgenSea&apos;s own
          hireable agents run on testnet 97 — see <Link href="/marketplace" style={{ color: 'var(--live)' }}>the marketplace</Link>.
        </p>
      </section>
    </>
  );
}
