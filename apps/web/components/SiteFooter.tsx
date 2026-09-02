/**
 * Site footer — every page. Two parts:
 *  1. LAST JOB strip: the most recent fully-documented first-party job,
 *     chain-confirmed at ISR time (see lib/server/last-job.ts). Renders
 *     "last job: unavailable" on any read failure — never stale, never
 *     invented.
 *  2. Footer row: brand, nav, external links, facts line. Existing tokens
 *     only, no motion. On the landing page the creature layer (z-index -1)
 *     stays behind all of this.
 */
import Link from 'next/link';
import { Mark, Wordmark } from '@/components/Logo';
import { ERC8183, CHAIN } from '@/data/first-party-agents';
import { readLastJob } from '@/lib/server/last-job';
import { measuredOn } from '@/lib/format';

export async function SiteFooter() {
  const last = await readLastJob();

  return (
    <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', marginTop: 44 }}>
      <div className="container">
        <div className="lastjob-strip">
          {last ? (
            <>
              <span className="label" style={{ fontSize: 9 }}>last job</span>
              <span className="data">{last.jobId}</span>
              <span className="lastjob-sep">·</span>
              <Link href={`/marketplace/${last.agentId}`} className="data" style={{ color: 'var(--text)' }}>{last.agentName}</Link>
              <span className="lastjob-sep">·</span>
              {last.demo ? (
                <span className="data" style={{ color: 'var(--text-muted)' }}>demo hire</span>
              ) : (
                <span className="data">analysis {(last.analysisMs! / 1000).toFixed(1)}s</span>
              )}
              <span className="lastjob-sep">·</span>
              <span className="data" style={{ color: 'var(--live)' }}>hash verified</span>
              {!last.demo && (
                <>
                  <span className="lastjob-sep">·</span>
                  <a href={`${CHAIN.explorer}/tx/${last.settleTx}`} target="_blank" rel="noreferrer" className="data" style={{ color: 'var(--live-dim)' }}>settle tx ↗</a>
                </>
              )}
              <span className="lastjob-sep">·</span>
              <Link href={`/marketplace/${last.agentId}`} className="label" style={{ color: 'var(--verified)', fontSize: 9 }}>verify →</Link>
              <span className="meta" style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{measuredOn(last.measuredAt)}</span>
            </>
          ) : (
            <span className="data" style={{ color: 'var(--text-muted)' }}>last job: unavailable</span>
          )}
        </div>

        <div className="footer-row">
          <Link href="/" className="brand" aria-label="AgenSea home">
            <Mark size={18} />
            <Wordmark height={15} />
          </Link>
          <nav className="footer-nav">
            <Link href="/marketplace">Marketplace</Link>
            <Link href="/agents">Registry</Link>
            <Link href="/bazaar">Bazaar</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/claim">List your agent</Link>
            <a href="https://github.com/shrooms08/agensea" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://x.com/shroomsgotsol" target="_blank" rel="noreferrer">X</a>
          </nav>
        </div>
        <p className="footer-facts">
          Registry read from BSC mainnet (56) · agents settle on BSC testnet (97) · escrow contract {ERC8183.commerce}
        </p>
      </div>
    </footer>
  );
}
