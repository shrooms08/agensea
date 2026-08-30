/**
 * Landing: five statistics, then four category cards.
 * Every count renders with its measured_at from registry_stats.
 */
import { getRegistryStats, getFanoutCurve, getClientConcentration } from '@/lib/queries';
import { ParticleHero } from '@/components/ParticleHero';
import { Stat } from '@/components/Stat';
import { ThresholdSlider } from '@/components/ThresholdSlider';
import { FIRST_PARTY_AGENTS, CATEGORY_SLUGS, CHAIN } from '@/data/first-party-agents';
import { pct, int } from '@/lib/format';

const CAT_TOKEN: Record<string, string> = {
  'rebalancing': 'var(--cat-rebalancing)',
  'grid-trading': 'var(--cat-grid)',
  'yield-optimisation': 'var(--cat-yield)',
  'health-factor-monitoring': 'var(--cat-health)',
};

export default async function Home() {
  const [stats, curve, conc] = await Promise.all([getRegistryStats(), getFanoutCurve(), getClientConcentration()]);
  const s = (k: string) => stats[k]!;

  return (
    <>
      {/* Scroll-scrubbed particle hero. fallback="none": reduced-motion,
          no-WebGL and <768px visitors see exactly the page below, whose own
          hero IS the normal-height hero. Nothing below this line changed. */}
      <ParticleHero
        caption={`${int(Number(s('agents_minted').value))} agents minted. Signal assembles.`}
        sub="A marketplace and registry explorer for ERC-8004 on BNB Chain."
        fallback="none"
      />
      <section style={{ padding: '40px 0 26px' }}>
        <h1 style={{ font: "500 40px/1.08 var(--display)", maxWidth: 720 }}>
          Most agents on chain have never been used.
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          A marketplace and registry explorer for ERC-8004 on BNB Chain. The registry
          figures below are measured from a full sweep of chain {56}; AgenSea&apos;s own
          agents run on {CHAIN.name} ({CHAIN.short}).
        </p>
      </section>

      <section className="grid-panel cols-5">
        <Stat label="Agents minted" value={Number(s('agents_minted').value)} measuredAt={s('agents_minted').measured_at} note="chain 56" />
        <Stat label="Ever had a client" value={Number(s('agents_with_client').value)} measuredAt={s('agents_with_client').measured_at}
              tone="var(--live)" note={pct(100 * Number(s('agents_with_client').value) / Number(s('agents_minted').value), 4)} />
        <Stat label="Client relationships" value={Number(s('client_edges').value)} measuredAt={s('client_edges').measured_at} />
        <Stat label="Distinct clients" value={Number(s('distinct_clients').value)} measuredAt={s('distinct_clients').measured_at}
              tone="var(--warn)" note={`two addresses = ${pct(conc.top2Pct, 1)} of edges`} />
        <Stat label="B402 resources" value={Number(s('bazaar_resources').value)} measuredAt={s('bazaar_resources').measured_at}
              note={`${s('bazaar_payees').value} payees · top ${s('bazaar_top_payee_pct').value}%`} />
      </section>

      <section style={{ padding: '28px 0 36px' }}>
        <h2 style={{ font: "500 21px/1.2 var(--display)" }}>Liveness is not binary</h2>
        <p className="prose-sm prose-muted" style={{ marginTop: 8 }}>
          {pct(100 * Number(s('agents_with_client').value) / Number(s('agents_minted').value), 2)} of
          agents have a client. But {int(conc.totalEdges)} relationships come from{' '}
          {int(conc.distinctClients)} addresses, and two of them account for {pct(conc.top2Pct, 1)}.
          Filter those out and the number collapses.
        </p>
        <div style={{ marginTop: 14 }}>
          <ThresholdSlider curve={curve} measuredAt={s('agents_with_client').measured_at} />
        </div>
      </section>

      <section className="sec sec-rule">
        <h2 style={{ font: "500 21px/1.2 var(--display)" }}>Four agents you can hire</h2>
        <div className="grid-panel cols-4" style={{ marginTop: 18 }}>
          {CATEGORY_SLUGS.map((slug) => {
            const a = FIRST_PARTY_AGENTS.find((x) => x.slug === slug)!;
            return (
              <a key={slug} href={`/category/${slug}`} className="card-lg" style={{ display: 'block' }}>
                <div style={{ width: 8, height: 8, background: CAT_TOKEN[slug], marginBottom: 16 }} />
                <div style={{ font: "500 14px/1.3 var(--display)", color: 'var(--text)' }}>{a.name}</div>
                <p className="prose-sm prose-muted" style={{ marginTop: 8, fontSize: 13 }}>{a.description.slice(0, 96)}…</p>
                <div className="label" style={{ color: 'var(--accent)', border: '1px solid #4a0866', padding: '4px 6px', marginTop: 14, display: 'inline-block', fontSize: 9 }}>
                  First-party
                </div>
              </a>
            );
          })}
        </div>
      </section>
    </>
  );
}
