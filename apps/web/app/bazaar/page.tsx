/**
 * /bazaar — the B402 Bazaar catalogue and its concentration.
 *
 * Every figure carries its measured_at. All reads are server-side: the Binance
 * B402 API is never called from the browser (binance.com is DNS-blocked for
 * some ISPs, so a client fetch would fail silently for those users). What the
 * browser receives is the aggregate, not the ~978 rows.
 * (row count tracks registry_stats.bazaar_resources — 978 as of 29 Aug 2026)
 */
import { getBazaarResources, getPayees, getRegistryStats, getAllOverlapAgents, hostOf } from '@/lib/queries';
import { Stat } from '@/components/Stat';
import { int, pct, shortAddr, measuredOn } from '@/lib/format';

export const revalidate = 86400;   // see lib/queries.ts: long by design, free-tier Supabase pauses

export default async function Bazaar() {
  const [resources, payees, stats, overlaps] = await Promise.all([
    getBazaarResources(), getPayees(), getRegistryStats(), getAllOverlapAgents(),
  ]);
  const s = (k: string) => stats[k]!;

  const hostCounts = new Map<string, number>();
  for (const r of resources) hostCounts.set(hostOf(r.resource_url), (hostCounts.get(hostOf(r.resource_url)) ?? 0) + 1);
  const hosts = [...hostCounts.entries()].sort((a, b) => b[1] - a[1]);
  const top = payees[0];

  return (
    <>
      <section className="sec-lead">
        <div className="label">B402 Bazaar</div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
          A marketplace&apos;s depth is one operator&apos;s uptime
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          {int(resources.length)} paid resources are listed across {payees.length} distinct payees.
          One address holds {top ? pct(top.pct_of_catalogue) : '—'} of them. Read server-side from our
          own sweep — the Bazaar API is never called from your browser.
        </p>
        {/* Historical delta: cannot be derived from current data, which holds only
            the latest sweep. Both endpoints were measured by our own ingest —
            0x3c5f3a6c… (coinmarketcap.com) 14 resources on 24 Aug, 4 on 29 Aug;
            0x50ab2018… flat at 941 across both. Update if a later sweep moves either. */}
        <p className="prose prose-sm" style={{ color: 'var(--text-faint)', marginTop: 10, fontSize: 13 }}>
          Concentration is hardening, not easing: between 24 and 29 Aug 2026 the second-largest
          independent operator delisted 71% of its catalogue — 14 resources down to 4 — while the
          leader held flat at 941.
        </p>
      </section>

      <section className="grid-panel cols-4">
        <Stat label="Resources" value={resources.length} measuredAt={s('bazaar_resources').measured_at} />
        <Stat label="Distinct payees" value={payees.length} measuredAt={s('bazaar_payees').measured_at} />
        <Stat label="Top payee share" value={top ? pct(top.pct_of_catalogue) : '—'}
              measuredAt={s('bazaar_top_payee_pct').measured_at} tone="var(--warn)" note={shortAddr(top?.pay_to)} />
        <Stat label="Distinct hosts" value={hosts.length} measuredAt={s('bazaar_resources').measured_at} />
      </section>

      <section className="sec">
        <h2 style={{ font: "500 21px/1.2 var(--display)" }}>Payee concentration</h2>
        <div style={{ marginTop: 16, border: '1px solid var(--border)' }}>
          {payees.map((p, i) => (
            <div key={p.pay_to} className="payee-row" style={{
              padding: '13px 18px', borderBottom: i < payees.length - 1 ? '1px solid var(--border)' : 'none',
              background: 'var(--surface)',
            }}>
              <div className="data" style={{ color: 'var(--text)' }}>{p.pay_to}</div>
              <div style={{ font: "500 13px/1 var(--mono)", color: 'var(--text)', textAlign: 'right' }}>{int(p.resources)}</div>
              <div style={{ font: "400 12px/1 var(--mono)", color: i === 0 ? 'var(--warn)' : 'var(--text-muted)', textAlign: 'right' }}>
                {pct(p.pct_of_catalogue)}
              </div>
              <div style={{ paddingLeft: 18 }}>
                <div className="bar-track">
                  <div className={`bar-fill${i === 0 ? ' is-top' : ''}`} style={{ width: `${p.pct_of_catalogue}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="meta" style={{ marginTop: 10 }}>measured {measuredOn(s('bazaar_resources').measured_at)}</div>
      </section>

      {overlaps.length > 0 && (
        <section className="sec sec-rule">
          <h2 style={{ font: "500 21px/1.2 var(--display)" }}>Overlap with the ERC-8004 registry</h2>
          <p className="prose-sm prose-muted" style={{ marginTop: 10 }}>
            Of {payees.length} payees earning on B402, exactly {overlaps.length} holds an on-chain agent
            identity. It has zero clients and zero feedback — revenue without reputation. The two
            surfaces are almost entirely disjoint.
          </p>
          {overlaps.map((o) => (
            <a key={o.agent_id} href={`/agents/${o.agent_id}`}
               className="card-lg" style={{ display: 'block', marginTop: 16, border: '1px solid var(--border-strong)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ font: "500 15px/1 var(--display)", color: 'var(--text)' }}>Agent #{o.agent_id}</div>
                <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--dead)', textTransform: 'uppercase' }}>
                  0 clients
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginTop: 14 }}>
                {[['host', o.token_uri_host ?? '—'], ['B402 resources', int(o.bazaar_resources)], ['share of catalogue', pct(o.bazaar_pct)]].map(([k, v]) => (
                  <div key={k}>
                    <div className="label" style={{ fontSize: 9 }}>{k}</div>
                    <div className="data" style={{ color: 'var(--text)', marginTop: 6 }}>{v}</div>
                  </div>
                ))}
              </div>
            </a>
          ))}
        </section>
      )}

      <section className="sec sec-rule">
        <h2 style={{ font: "500 21px/1.2 var(--display)" }}>Hosts</h2>
        <div className="grid-panel cols-2" style={{ marginTop: 16 }}>
          {hosts.slice(0, 12).map(([h, n]) => (
            <div key={h} className="card" style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px' }}>
              <span className="data" style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h}</span>
              <span className="data" style={{ color: 'var(--text)', paddingLeft: 12, fontWeight: 500 }}>{int(n)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
