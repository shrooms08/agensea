/**
 * /compare — all four first-party agents side by side, TESTNET 97.
 *
 * NO SELECTION STEP. With four agents a checkbox flow is friction that buys
 * nothing; the comparison is the page.
 *
 * EVERY CELL COMES FROM THE SAME SOURCE THE AGENT PAGE USES, so the two cannot
 * disagree:
 *   category / price / completed / fastest / mainnet id  -> FIRST_PARTY_AGENTS
 *   what it reads                                        -> agent.reads
 *   what you provide                                     -> TARGETS[id].label
 *   delivers                                             -> DELIVERS[id]
 * Nothing here is typed in, and no figure is computed differently from
 * /marketplace/[id]'s stat row.
 *
 * A row with nothing for an agent renders empty — never a dash, never "none".
 */
import Link from 'next/link';
import { FIRST_PARTY_AGENTS, CHAIN } from '@/data/first-party-agents';
import { DELIVERS, TARGETS } from '@/data/hire-spec';
import { CAT_LABEL, CAT_TOKEN } from '@/components/CategoryChip';

export const metadata = { title: 'Compare' };
export const revalidate = 86400;

interface Row {
  label: string;
  /** null renders an empty cell. */
  cell: (a: (typeof FIRST_PARTY_AGENTS)[number]) => React.ReactNode | null;
}

const completed = (a: (typeof FIRST_PARTY_AGENTS)[number]) =>
  a.jobs.filter((j) => j.status === 'COMPLETED').length;
const fastestS = (a: (typeof FIRST_PARTY_AGENTS)[number]) =>
  (Math.min(...a.jobs.map((j) => j.analysisMs)) / 1000).toFixed(1);

const ROWS: Row[] = [
  {
    label: 'category',
    cell: (a) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 8, height: 8, background: CAT_TOKEN[a.slug], flex: 'none' }} />
        <span className="label" style={{ color: CAT_TOKEN[a.slug], fontSize: 10 }}>{CAT_LABEL[a.slug]}</span>
      </span>
    ),
  },
  { label: 'what it reads', cell: (a) => <span className="data">{a.reads}</span> },
  { label: 'what you provide', cell: (a) => <span className="data">{TARGETS[a.agentId]?.label}</span> },
  {
    label: 'delivers',
    cell: (a) => {
      const rows = DELIVERS[a.agentId] ?? [];
      if (rows.length === 0) return null;
      return (
        <ul className="cmp-delivers">
          {rows.map((d) => <li key={d.key} className="data">{d.label}</li>)}
        </ul>
      );
    },
  },
  { label: 'price', cell: (a) => <span className="data" style={{ color: 'var(--text)' }}>{a.priceLabel}</span> },
  { label: 'completed', cell: (a) => <span className="data" style={{ color: 'var(--text)' }}>{completed(a)}</span> },
  { label: 'fastest analysis', cell: (a) => <span className="data" style={{ color: 'var(--text)' }}>{fastestS(a)}s</span> },
  {
    label: 'mainnet identity',
    // Only agent 2012 is registered on chain 56. The others render EMPTY —
    // a dash or "none" would read as a measured absence rather than a blank.
    cell: (a) => a.mainnetAgentId
      ? <Link className="data" style={{ color: 'var(--live-dim)' }} href={`/agents/${a.mainnetAgentId}`}>{a.mainnetAgentId} →</Link>
      : null,
  },
  {
    label: '',
    cell: (a) => <Link href={`/marketplace/${a.agentId}`} className="cmp-hire">Hire →</Link>,
  },
];

export default function Compare() {
  return (
    <>
      <section className="sec-lead">
        <div className="label">Compare · {CHAIN.name} ({CHAIN.id}) · {FIRST_PARTY_AGENTS.length} agents</div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
          All four, side by side
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          The same figures each agent&apos;s own page shows, read from one source so the two cannot
          disagree. Every agent costs {FIRST_PARTY_AGENTS[0]!.priceLabel} and settles the same way;
          what differs is what it reads, what you hand it, and what comes back.
        </p>
      </section>

      <section className="sec">
        <div className="cmp-scroll">
          <table className="cmp-table">
            <caption className="sr-only">
              The four AgenSea agents compared by category, data source, input, deliverable fields,
              price, completed jobs, fastest analysis and mainnet identity.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="cmp-rowhead cmp-corner"><span className="sr-only">Attribute</span></th>
                {FIRST_PARTY_AGENTS.map((a) => (
                  <th key={a.agentId} scope="col" className="cmp-agent">
                    <Link href={`/marketplace/${a.agentId}`}>{a.name}</Link>
                    <span className="meta">#{a.agentId}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={r.label || `row-${i}`}>
                  <th scope="row" className="cmp-rowhead">
                    <span className="label" style={{ fontSize: 9 }}>{r.label}</span>
                  </th>
                  {FIRST_PARTY_AGENTS.map((a) => <td key={a.agentId}>{r.cell(a)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta cmp-hint" style={{ marginTop: 12, color: 'var(--text-faint)' }}>
          Scroll the table sideways to reach the other agents — the row labels stay put.
        </p>
      </section>
    </>
  );
}
