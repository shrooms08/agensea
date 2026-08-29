/**
 * /bazaar — the B402 Bazaar catalogue and its concentration.
 *
 * Every figure carries its measured_at. All reads are server-side: the Binance
 * B402 API is never called from the browser (binance.com is DNS-blocked for
 * some ISPs, so a client fetch would fail silently for those users). What the
 * browser receives is the aggregate, not the 976 rows.
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
      <section style={{ padding: '72px 0 40px' }}>
        <div style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.14em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
          B402 Bazaar
        </div>
        <h1 style={{ font: "500 36px/1.15 var(--display)", marginTop: 16, maxWidth: 720 }}>
          A marketplace&apos;s depth is one operator&apos;s uptime
        </h1>
        <p style={{ font: "400 14px/1.6 var(--mono)", color: 'var(--text-muted)', maxWidth: 640, marginTop: 18 }}>
          {int(resources.length)} paid resources are listed across {payees.length} distinct payees.
          One address holds {top ? pct(top.pct_of_catalogue) : '—'} of them. Read server-side from our
          own sweep — the Bazaar API is never called from your browser.
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
        <Stat label="Resources" value={resources.length} measuredAt={s('bazaar_resources').measured_at} />
        <Stat label="Distinct payees" value={payees.length} measuredAt={s('bazaar_payees').measured_at} />
        <Stat label="Top payee share" value={top ? pct(top.pct_of_catalogue) : '—'}
              measuredAt={s('bazaar_top_payee_pct').measured_at} tone="var(--warn)" note={shortAddr(top?.pay_to)} />
        <Stat label="Distinct hosts" value={hosts.length} measuredAt={s('bazaar_resources').measured_at} />
      </section>

      <section style={{ padding: '56px 0' }}>
        <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Payee concentration</h2>
        <div style={{ marginTop: 20, border: '1px solid var(--border)' }}>
          {payees.map((p, i) => (
            <div key={p.pay_to} style={{
              display: 'grid', gridTemplateColumns: '1.4fr 96px 92px 1fr', gap: 0, alignItems: 'center',
              padding: '14px 18px', borderBottom: i < payees.length - 1 ? '1px solid var(--border)' : 'none',
              background: i === 0 ? 'var(--surface-raised)' : 'var(--surface)',
            }}>
              <div style={{ font: "400 12px/1 var(--mono)", color: 'var(--text)' }}>{p.pay_to}</div>
              <div style={{ font: "500 13px/1 var(--mono)", color: 'var(--text)', textAlign: 'right' }}>{int(p.resources)}</div>
              <div style={{ font: "400 12px/1 var(--mono)", color: i === 0 ? 'var(--warn)' : 'var(--text-muted)', textAlign: 'right' }}>
                {pct(p.pct_of_catalogue)}
              </div>
              <div style={{ paddingLeft: 18 }}>
                <div style={{ height: 6, background: i === 0 ? 'var(--warn)' : 'var(--live-dim)', width: `${p.pct_of_catalogue}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ font: "400 10px/1.4 var(--mono)", color: 'var(--text-muted)', marginTop: 10 }}>
          measured {measuredOn(s('bazaar_resources').measured_at)}
        </div>
      </section>

      {overlaps.length > 0 && (
        <section style={{ padding: '56px 0', borderTop: '1px solid var(--border)' }}>
          <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Overlap with the ERC-8004 registry</h2>
          <p style={{ font: "400 13px/1.6 var(--mono)", color: 'var(--text-muted)', maxWidth: 660, marginTop: 12 }}>
            Of {payees.length} payees earning on B402, exactly {overlaps.length} holds an on-chain agent
            identity. It has zero clients and zero feedback — revenue without reputation. The two
            surfaces are almost entirely disjoint.
          </p>
          {overlaps.map((o) => (
            <a key={o.agent_id} href={`/agents/${o.agent_id}`}
               style={{ display: 'block', marginTop: 20, padding: '20px 22px', background: 'var(--surface)', border: '1px solid var(--border-strong)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ font: "500 15px/1 var(--display)", color: 'var(--text)' }}>Agent #{o.agent_id}</div>
                <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--dead)', textTransform: 'uppercase' }}>
                  0 clients
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20, marginTop: 16 }}>
                {[['host', o.token_uri_host ?? '—'], ['B402 resources', int(o.bazaar_resources)], ['share of catalogue', pct(o.bazaar_pct)]].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{k}</div>
                    <div style={{ font: "400 12px/1 var(--mono)", color: 'var(--text)', marginTop: 6 }}>{v}</div>
                  </div>
                ))}
              </div>
            </a>
          ))}
        </section>
      )}

      <section style={{ padding: '56px 0 80px', borderTop: '1px solid var(--border)' }}>
        <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Hosts</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', marginTop: 20 }}>
          {hosts.slice(0, 12).map(([h, n]) => (
            <div key={h} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--surface)' }}>
              <span style={{ font: "400 12px/1 var(--mono)", color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h}</span>
              <span style={{ font: "500 12px/1 var(--mono)", color: 'var(--text)', paddingLeft: 12 }}>{int(n)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
