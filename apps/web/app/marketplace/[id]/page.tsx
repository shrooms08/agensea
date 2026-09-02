/**
 * /marketplace/[id] — first-party agent detail, TESTNET 97.
 *
 * Distinct namespace from /agents/[id] (registry, mainnet 56) on purpose: the
 * numeric ids collide across chains and merging them would misrepresent both.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FIRST_PARTY_AGENTS, byId, CHAIN, ERC8183, DISPUTE_WINDOW_SECONDS, AGENTS_WALLET } from '@/data/first-party-agents';
import { DELIVERS, TARGETS } from '@/data/hire-spec';
import { readTrackRecord } from '@/lib/server/track-record';
import { deliverableFor } from '@/data/deliverables';
import { CategoryChip, FirstPartyBadge, CAT_TOKEN } from '@/components/CategoryChip';
import { VerifyDeliverable } from '@/components/VerifyDeliverable';
import { SessionRevoke } from '@/components/SessionRevoke';
import { WalletHire } from '@/components/WalletHire';

export const revalidate = 86400;
export const dynamicParams = false;   // exactly four, all known at build

export function generateStaticParams() {
  return FIRST_PARTY_AGENTS.map((a) => ({ id: String(a.agentId) }));
}

const Field = ({ k, v, tone, mono = true }: { k: string; v: string; tone?: string; mono?: boolean }) => (
  <div>
    <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{k}</div>
    <div style={{ font: mono ? "400 12px/1.5 var(--mono)" : "400 13px/1.5 var(--display)", color: tone ?? 'var(--text)', marginTop: 6, wordBreak: 'break-all' }}>{v}</div>
  </div>
);

export default async function FirstPartyAgent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = byId(Number(id));
  if (!agent) notFound();

  const s = agent.session;
  const track = await readTrackRecord();
  const expiry = new Date(s.expiryUnix * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return (
    <div id="hire" style={{ scrollMarginTop: 76 }}>
      <WalletHire
        agentId={agent.agentId}
        agentName={agent.name}
        priceLabel={agent.priceLabel}
        mode="listing"
        delivers={DELIVERS[agent.agentId] ?? []}
        targetSpec={TARGETS[agent.agentId]!}
        session={{
          capTBnb: (Number(s.spendCapWei) / 1e18).toFixed(6),
          signature: s.calls[0]?.signature ?? 'submit(uint256,bytes32,bytes)',
          commerce: ERC8183.commerce,
          expiryLabel: new Date(s.expiryUnix * 1000).toISOString().slice(0, 10),
        }}
        header={<>
        <section className="sec-lead">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div className="label" style={{ fontSize: 9 }}>
              hire <span style={{ color: 'var(--text-faint)' }}>·</span> provider{' '}
              <a href={`${CHAIN.explorer}/address/${AGENTS_WALLET}`} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}>
                {AGENTS_WALLET.slice(0, 6)}…{AGENTS_WALLET.slice(-4)}
              </a>{' '}
              <span style={{ color: 'var(--text-faint)' }}>·</span> testnet {CHAIN.id}
            </div>
            <FirstPartyBadge />
          </div>
          <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 16 }}>{agent.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <span style={{ font: "500 15px/1 var(--mono)", color: 'var(--text)' }}>{agent.priceLabel} per hire</span>
            <CategoryChip slug={agent.slug} />
          </div>
          <p className="prose prose-muted" style={{ marginTop: 16 }}>{agent.description}</p>
          <p className="prose-sm" style={{ color: 'var(--text-faint)', marginTop: 10, fontSize: 13 }}>
            Settles on {CHAIN.name} ({CHAIN.id}); reads live data from BNB Smart Chain mainnet ({agent.analysisChainId}) to do the analysis.
          </p>
        </section>
        </>}
        stats={<>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 20, padding: '20px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <Field k="price" v={agent.priceLabel} tone={CAT_TOKEN[agent.slug]} />
          <Field k="completed · this agent" v={String(agent.jobs.filter((j) => j.status === 'COMPLETED').length)} />
          <Field k="fastest analysis" v={`${(Math.min(...agent.jobs.map((j) => j.analysisMs)) / 1000).toFixed(1)}s`} />
          <Field k="dispute window" v={`${DISPUTE_WINDOW_SECONDS}s`} />
          {agent.mainnetAgentId && (
            <div>
              <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>mainnet identity</div>
              <div style={{ font: "400 12px/1.5 var(--mono)", marginTop: 6 }}>
                <a href={`https://bscscan.com/tx/${agent.mainnetRegisterTx}`} target="_blank" rel="noreferrer" style={{ color: 'var(--live-dim)' }}>
                  {agent.mainnetAgentId} ↗
                </a>
                <span style={{ color: 'var(--text-faint)' }}> · </span>
                <Link href={`/agents/${agent.mainnetAgentId}`} style={{ color: 'var(--live-dim)' }}>registry →</Link>
              </div>
            </div>
          )}
        </section>
        </>}
        sessionPanel={<>
        <section className="sec">
          <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Session permissions</h2>
          <p className="prose-sm prose-muted" style={{ marginTop: 10 }}>
            This agent acts through an Altana session key whose permissions are enforced on-chain.
            It can call exactly one function on one contract, under a spending cap, until expiry.
          </p>
          <div className="card-lg" style={{ marginTop: 16, border: '1px solid var(--border)', display: 'grid', gap: 16 }}>
            <Field k="session key" v={s.address} />
            <div>
              <div style={{ font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>call allowlist</div>
              {s.calls.map((c) => (
                <div key={c.signature} style={{ font: "400 12px/1.6 var(--mono)", color: 'var(--live)', marginTop: 8 }}>
                  {c.signature}<span style={{ color: 'var(--text-muted)' }}> on </span>{c.to}
                </div>
              ))}
              <div style={{ font: "400 11px/1.5 var(--mono)", color: 'var(--text-faint)', marginTop: 8 }}>
                Anything else reverts at validation time.
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
              <Field k="spend cap" v={`${s.spendCapLabel}  (${s.spendCapWei} wei)`} />
              <Field k="expires" v={expiry} />
            </div>
          </div>
          <SessionRevoke agentId={agent.agentId} />
          <div style={{ marginTop: 14, padding: '14px 18px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
            <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.12em', color: 'var(--warn)', textTransform: 'uppercase' }}>Sizing a cap</div>
            <p className="prose-sm prose-muted" style={{ marginTop: 8, fontSize: 13 }}>
              The cap must cover the <strong style={{ color: 'var(--text)' }}>relay fee</strong>, not just value transferred —
              a read-only agent that moves no funds still spends on every submit. Measured fees varied
              about 11% run to run, so size at <strong style={{ color: 'var(--text)' }}>2× a measurement</strong>, never 1×.
              A cap of exactly one observed fee will fail intermittently.
            </p>
          </div>
        </section>
        </>}
        completedWork={<>
        <section className="sec sec-rule">
          <h2 style={{ font: "500 20px/1.2 var(--display)" }}>Completed work</h2>
          <p className="prose-sm prose-muted" style={{ marginTop: 10 }}>
            Each deliverable is a JSON manifest whose keccak256 is stored on chain. Verify recomputes
            the hash in your browser and compares it to the chain — nothing here is taken on trust.
          </p>
          <div style={{ display: 'grid', gap: 18, marginTop: 22 }}>
            {agent.jobs.map((job) => {
              const d = deliverableFor(job.jobId);
              return (
                <div key={job.jobId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                    <div style={{ font: "500 13px/1 var(--mono)", color: 'var(--text)' }}>
                      Job {job.jobId}
                      <span style={{ color: job.status === 'COMPLETED' ? 'var(--live)' : 'var(--stale)', marginLeft: 10 }}>{job.status}</span>
                    </div>
                    <a href={`${CHAIN.explorer}/tx`} style={{ font: "400 10px/1 var(--mono)", color: 'var(--text-faint)' }}>
                      analysis {(job.analysisMs / 1000).toFixed(1)}s
                    </a>
                  </div>
                  {job.transportAnomaly && (
                    <div style={{ font: "400 11px/1.5 var(--mono)", color: 'var(--warn)', marginBottom: 10 }}>
                      {job.transportAnomaly}
                    </div>
                  )}
                  {d ? <VerifyDeliverable jobId={job.jobId} manifest={d.manifest} canon={d.canon} />
                     : <div style={{ font: "400 11px/1 var(--mono)", color: 'var(--text-faint)' }}>manifest not published</div>}
                </div>
              );
            })}
          </div>
        </section>
        </>}

          trackRecord={track && (
            <section className="sec">
              <div className="label" style={{ fontSize: 9 }}>provider track record</div>
              <div className="track-bar">
                <div><div className="track-num">{track.completed}</div><div className="label" style={{ fontSize: 9 }}>completed · all four agents</div></div>
                <div><div className="track-num">{track.distinctBuyers}</div><div className="label" style={{ fontSize: 9 }}>distinct buyers</div></div>
                <div><div className="track-num">{track.disputes}</div><div className="label" style={{ fontSize: 9 }}>disputes</div></div>
                {track.medianTtdMs !== null && (
                  <div><div className="track-num">{(track.medianTtdMs / 1000).toFixed(1)}s</div><div className="label" style={{ fontSize: 9 }}>median time to deliverable</div></div>
                )}
              </div>
              <p className="meta" style={{ marginTop: 12, color: 'var(--text-faint)' }}>
                Counted from settled ERC-8183 jobs on chain by distinct buyer wallets — every job whose
                provider is this wallet, scanned to job {track.scannedTo}. Time to deliverable is the job&apos;s
                on-chain submittedAt minus the timestamp its buyer wrote into the job description.
              </p>
            </section>
          )}
      />
    </div>
  );
}
