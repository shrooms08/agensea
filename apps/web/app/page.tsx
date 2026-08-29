/**
 * Landing: five statistics, then four category cards.
 * Every count renders with its measured_at from registry_stats.
 */
import { getRegistryStats, getFanoutCurve } from '@/lib/queries';
import { Stat } from '@/components/Stat';
import { ThresholdSlider } from '@/components/ThresholdSlider';
import { FIRST_PARTY_AGENTS, CATEGORY_SLUGS, CHAIN } from '@/data/first-party-agents';
import { pct } from '@/lib/format';

const CAT_TOKEN: Record<string, string> = {
  'rebalancing': 'var(--cat-rebalancing)',
  'grid-trading': 'var(--cat-grid)',
  'yield-optimisation': 'var(--cat-yield)',
  'health-factor-monitoring': 'var(--cat-health)',
};

export default async function Home() {
  const [stats, curve] = await Promise.all([getRegistryStats(), getFanoutCurve()]);
  const s = (k: string) => stats[k]!;

  return (
    <>
      <section style={{ padding: '96px 0 72px' }}>
        <h1 style={{ font: "500 44px/1.1 var(--display)", maxWidth: 760 }}>
          Most agents on chain have never been used.
        </h1>
        <p style={{ font: "400 15px/1.6 var(--mono)", color: 'var(--text-muted)', maxWidth: 620, marginTop: 20 }}>
          A marketplace and registry explorer for ERC-8004 on BNB Chain. The registry
          figures below are measured from a full sweep of chain {56}; AgenSea&apos;s own
          agents run on {CHAIN.name} ({CHAIN.short}).
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
        <Stat label="Agents minted" value={Number(s('agents_minted').value)} measuredAt={s('agents_minted').measured_at} note="chain 56" />
        <Stat label="Ever had a client" value={Number(s('agents_with_client').value)} measuredAt={s('agents_with_client').measured_at}
              tone="var(--live)" note={pct(100 * Number(s('agents_with_client').value) / Number(s('agents_minted').value), 4)} />
        <Stat label="Client relationships" value={Number(s('client_edges').value)} measuredAt={s('client_edges').measured_at} />
        <Stat label="Distinct clients" value={Number(s('distinct_clients').value)} measuredAt={s('distinct_clients').measured_at}
              tone="var(--warn)" note="two addresses = 36% of edges" />
        <Stat label="B402 resources" value={Number(s('bazaar_resources').value)} measuredAt={s('bazaar_resources').measured_at}
              note={`${s('bazaar_payees').value} payees · top ${s('bazaar_top_payee_pct').value}%`} />
      </section>

      <section style={{ padding: '72px 0' }}>
        <h2 style={{ font: "500 22px/1.2 var(--display)" }}>Liveness is not binary</h2>
        <p style={{ font: "400 13px/1.6 var(--mono)", color: 'var(--text-muted)', maxWidth: 640, margin: '12px 0 0' }}>
          1.44% of agents have a client. But 8,260 relationships come from 107 addresses,
          and two of them account for 36%. Filter those out and the number collapses.
        </p>
        <div style={{ marginTop: 24 }}>
          <ThresholdSlider curve={curve} measuredAt={s('agents_with_client').measured_at} />
        </div>
      </section>

      <section style={{ padding: '72px 0', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ font: "500 22px/1.2 var(--display)" }}>Four agents you can hire</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', marginTop: 24 }}>
          {CATEGORY_SLUGS.map((slug) => {
            const a = FIRST_PARTY_AGENTS.find((x) => x.slug === slug)!;
            return (
              <a key={slug} href={`/category/${slug}`} style={{ display: 'block', padding: '22px', background: 'var(--surface)' }}>
                <div style={{ width: 8, height: 8, background: CAT_TOKEN[slug], marginBottom: 16 }} />
                <div style={{ font: "500 14px/1.3 var(--display)", color: 'var(--text)' }}>{a.name}</div>
                <div style={{ font: "400 11px/1.5 var(--mono)", color: 'var(--text-muted)', marginTop: 10 }}>
                  {a.description.slice(0, 96)}…
                </div>
                <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--accent)', border: '1px solid #4a0866', padding: '4px 6px', textTransform: 'uppercase', marginTop: 16, display: 'inline-block' }}>
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
