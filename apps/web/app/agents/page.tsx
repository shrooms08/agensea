/**
 * /agents — the registry index, BSC MAINNET (chain 56).
 *
 * The header nav and the landing CTA have always pointed here; until now the
 * route did not exist and 404'd. It lists the highest fan-out agents from our
 * own sweep — a deliberate slice, not the whole registry: the table shows the
 * top rows of the agents that have EVER had a client, and the count of those
 * is itself the finding. Every other agent is reachable by id.
 *
 * ISR, not dynamic: no searchParams, so this stays a static render that keeps
 * serving from the CDN while Supabase is paused (free plan).
 */
import Link from 'next/link';
import { getLiveAgents, getRegistryStats, getEnrichmentNames, getFleetShare } from '@/lib/queries';
import { Stat } from '@/components/Stat';
import { AgentJump } from '@/components/AgentJump';
import { int, pct, shortAddr, measuredOn, livenessToken } from '@/lib/format';

export const metadata = { title: 'Registry' };
export const revalidate = 86400;

const PER_PAGE = 100;

export default async function Agents() {
  const [{ rows, total }, stats, fleetShare] = await Promise.all([
    getLiveAgents({ page: 0, perPage: PER_PAGE }),
    getRegistryStats(),
    getFleetShare(3),
  ]);
  // Recovered names only for the rows actually rendered — one request, not 100.
  const recovered = await getEnrichmentNames(rows.map((a) => a.agent_id));
  const s = (k: string) => stats[k]!;
  const minted = Number(s('agents_minted').value);
  const withClient = Number(s('agents_with_client').value);

  return (
    <>
      <section className="sec-lead">
        <div className="label">ERC-8004 registry · BNB Smart Chain mainnet (56)</div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
          {int(withClient)} agents have ever had a client
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          Of {int(minted)} agents minted on chain {56}, {pct((100 * withClient) / minted, 2)} have
          ever been hired by anyone. The table below is the highest fan-out end of that set — the
          agents with the most distinct clients. Everything here comes from our own sweep of the
          registry; measured {measuredOn(s('agents_with_client').measured_at)}.
        </p>
      </section>

      <section className="grid-panel cols-4">
        <Stat label="Agents minted" value={minted} measuredAt={s('agents_minted').measured_at} note="chain 56" />
        <Stat label="Ever had a client" value={withClient} measuredAt={s('agents_with_client').measured_at}
              tone="var(--live)" note={pct((100 * withClient) / minted, 2)} />
        <Stat label="Client relationships" value={Number(s('client_edges').value)} measuredAt={s('client_edges').measured_at} />
        <Stat label="Distinct clients" value={Number(s('distinct_clients').value)} measuredAt={s('distinct_clients').measured_at}
              tone="var(--warn)" />
      </section>

      <section className="sec">
        <AgentJump max={minted} />
      </section>

      <section className="sec">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Highest fan-out</h2>
          <span className="meta">
            showing {int(rows.length)} of {total === null ? int(withClient) : int(total)} agents with at least one client
          </span>
        </div>

        {/* Concentration, derived at render from the same set the table pages
            through — never typed in, so it tracks the next sweep. */}
        {fleetShare.fleets.length > 0 && (
          <p className="prose-sm prose-muted" style={{ marginTop: 10, fontSize: 13, maxWidth: 720 }}>
            {int(fleetShare.fleets.length)} operators account for{' '}
            <span className="data" style={{ color: 'var(--text)' }}>
              {pct((100 * fleetShare.topN) / fleetShare.total, 0)}
            </span>{' '}
            of every agent that has ever had a client —{' '}
            {fleetShare.fleets.map((f, i) => (
              <span key={f.name}>
                {i > 0 ? ', ' : ''}{f.name} <span className="data">{int(f.count)}</span>
              </span>
            ))}
            , of {int(fleetShare.total)}.
          </p>
        )}

        <div className="agent-table">
          <div className="agent-table-head">
            <span>agent</span><span>clients</span><span>feedback</span><span>name</span><span>owner</span>
          </div>
          {rows.map((a) => {
            /* The column used to report the tokenURI transport, which is a
               data: URI for 79% of the set and has no host by construction —
               so it printed one identical string down the whole first page
               while the name that URI carries was thrown away. Own name, then
               the recovered one, then nothing to claim. */
            const own = a.metadata_name?.trim() || null;
            const name = own ?? recovered.get(a.agent_id) ?? null;
            return (
              <Link key={a.agent_id} href={`/agents/${a.agent_id}`} className="agent-table-row">
                <span className="data">#{a.agent_id}</span>
                <span className="data" style={{ color: `var(${livenessToken(a.client_count)})` }}>{int(a.client_count)}</span>
                <span className="data">{a.feedback_count ? int(a.feedback_count) : '0'}</span>
                <span className="data" style={{ color: name ? 'var(--text-muted)' : 'var(--text-faint)' }}>
                  {name ?? 'unnamed'}
                </span>
                <span className="data" style={{ color: 'var(--text-muted)' }}>{shortAddr(a.owner)}</span>
              </Link>
            );
          })}
        </div>

        <p className="prose-sm prose-muted" style={{ marginTop: 18, fontSize: 13 }}>
          Ordered by distinct clients, then by id. A client is an address that appears in the
          ReputationRegistry&apos;s <span className="data">getClients()</span> for that agent. The
          remaining {int(minted - withClient)} minted agents have never had one and are reachable
          by id above.
        </p>
      </section>
    </>
  );
}
