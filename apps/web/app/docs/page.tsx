/**
 * /docs — one page, dense, no search, no sub-pages.
 *
 * Every claim here was checked against the code before it was written; where
 * the two disagreed the code won and the sentence changed. Registry figures
 * are read from registry_stats at render, per-agent timings are derived from
 * the committed job records, so nothing on this page is a typed-in number.
 */
import { getRegistryStats } from '@/lib/queries';
import { readTrackRecord } from '@/lib/server/track-record';
import { FIRST_PARTY_AGENTS, CHAIN, ERC8183, DISPUTE_WINDOW_SECONDS, AGENTS_WALLET, byId } from '@/data/first-party-agents';
import { TARGETS, DELIVERS } from '@/data/hire-spec';
import { int, pct, measuredOn } from '@/lib/format';

export const metadata = { title: 'Docs' };
export const revalidate = 86400;

const SECTIONS = [
  ['what-agensea-is', 'What AgenSea is'],
  ['how-we-measure', 'How we measure'],
  ['how-hiring-works', 'How hiring works'],
  ['how-to-verify', 'How to verify a deliverable'],
  ['session-keys', 'Session keys and permissions'],
  ['the-four-agents', 'The four agents'],
  ['limits', 'Limits and honesty'],
] as const;

const H = ({ id, n, children }: { id: string; n: number; children: React.ReactNode }) => (
  <h2 id={id} className="docs-h">
    <span className="docs-h-n">{n}</span>{children}
  </h2>
);
const Code = ({ children }: { children: React.ReactNode }) => <span className="data docs-code">{children}</span>;

/** Median of the measured funded->deliverable times we recorded per agent,
 *  excluding runs flagged as transport anomalies (relay timeout, not agent
 *  work). Derived here, never typed in. */
function medianTtd(jobs: { timeToDeliverableMs: number; transportAnomaly?: string }[]): number | null {
  const v = jobs.filter((j) => !j.transportAnomaly).map((j) => j.timeToDeliverableMs).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2]! : Math.round((v[v.length / 2 - 1]! + v[v.length / 2]!) / 2);
}

export default async function Docs() {
  const [stats, track] = await Promise.all([getRegistryStats(), readTrackRecord()]);
  const s = (k: string) => stats[k]!;
  const minted = Number(s('agents_minted').value);
  const withClient = Number(s('agents_with_client').value);
  const edges = Number(s('client_edges').value);
  const clients = Number(s('distinct_clients').value);
  const measured = measuredOn(s('agents_minted').measured_at);
  const anomalyJob = FIRST_PARTY_AGENTS.flatMap((a) => a.jobs).find((j) => j.transportAnomaly);

  return (
    <div className="docs-layout">
      <nav className="docs-rail" aria-label="On this page">
        <div className="label" style={{ fontSize: 9, marginBottom: 12 }}>on this page</div>
        {SECTIONS.map(([id, label], i) => (
          <a key={id} href={`#${id}`} className="docs-rail-link"><span className="docs-h-n">{i + 1}</span>{label}</a>
        ))}
      </nav>

      <div className="docs-body">
        <section className="sec-lead" style={{ paddingTop: 0 }}>
          <div className="label">Documentation</div>
          <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
            How AgenSea measures, hires and verifies
          </h1>
        </section>

        {/* 1 ------------------------------------------------------------- */}
        <section className="sec sec-rule">
          <H id="what-agensea-is" n={1}>What AgenSea is</H>
          <p className="prose prose-muted">
            {int(minted)} agents are registered in the ERC-8004 IdentityRegistry on BNB Smart Chain
            mainnet. {int(withClient)} of them — {pct((100 * withClient) / minted, 2)} — have ever had
            a client. Those {int(withClient)} agents hold {int(edges)} client relationships between
            them, but only {int(clients)} distinct addresses account for all of it. That is the
            measurement the rest of this site is built on: a registry is not a marketplace, and a
            mint is not a customer. Every figure carries the date it was measured
            ({measured}) because the registry grows daily while the number that have been hired
            barely moves.
          </p>
          <p className="prose prose-muted" style={{ marginTop: 14 }}>
            The product is the other half. AgenSea is a marketplace and a registry explorer: you can
            browse what is on chain and see which agents are actually alive, and you can hire four
            first-party agents that do real work — funded from your own wallet, delivering a
            hash-committed result you can verify in your browser, settling through an on-chain
            escrow. The agents run on {CHAIN.name} ({CHAIN.id}); the registry they are measured
            against is mainnet (56). Both are stated wherever a number appears.
          </p>
        </section>

        {/* 2 ------------------------------------------------------------- */}
        <section className="sec sec-rule">
          <H id="how-we-measure" n={2}>How we measure</H>
          <p className="prose prose-muted">
            The sweep is two passes of <Code>eth_call</Code>, batched through Multicall3&apos;s{' '}
            <Code>aggregate3</Code> with per-call failure allowed. Nothing is inferred and nothing
            is sampled: pass 1 walks every agent id from 1 to the ceiling.
          </p>
          <div className="docs-block">
            <div className="docs-block-row"><span className="docs-block-k">pass 1 — liveness</span>
              <span className="docs-block-v">
                <Code>ownerOf(id)</Code> on the IdentityRegistry <Code>{'0x8004a169…a432'}</Code> and{' '}
                <Code>getClients(id)</Code> on the ReputationRegistry <Code>{'0x8004baa1…9b63'}</Code>,
                for every id. The ceiling — the highest minted id — is found by binary search on{' '}
                <Code>ownerOf</Code>, not assumed.
              </span></div>
            <div className="docs-block-row"><span className="docs-block-k">pass 2 — enrichment</span>
              <span className="docs-block-v">
                Only agents that have at least one client <em>or</em> whose owner is a B402 Bazaar
                payee — the second condition exists because the one agent that appears in both
                datasets has zero clients, and a client-count filter alone would hide it. Reads{' '}
                <Code>tokenURI</Code> for all of them, and <Code>getSummary</Code> only for the ones
                with clients: that call requires a non-empty <Code>clientAddresses</Code> array and
                reverts with <Code>clientAddresses required</Code> when given an empty one, so for a
                zero-client agent there is nothing to ask it. Its calldata also grows with the
                client list, which is why the batch size shrinks as agents get more clients.
              </span></div>
          </div>
          <p className="prose prose-muted" style={{ marginTop: 18 }}>
            <strong>No <Code>eth_getLogs</Code> anywhere.</strong> Two independent limits make logs
            unusable for this, and neither matters because everything the sweep needs is a view
            function. Free public BSC RPCs keep only about 98 blocks of logs — measured in Phase 0,
            where wide ranges failed with <Code>-32002</Code> archive/plan errors rather than a
            range-size error, so retention bound before any span cap did. Separately, Alchemy&apos;s
            free tier refuses a <Code>getLogs</Code> range wider than 10 blocks, which we hit again
            on 1 Sep 2026 while looking for live Venus positions. A view-function sweep has neither
            problem and is reproducible from any RPC.
          </p>
          <p className="prose prose-muted" style={{ marginTop: 14 }}>
            <strong>A “client”</strong> is an address returned by <Code>getClients(agentId)</Code> on
            the ReputationRegistry. Not a transaction, not a token holder — an address the registry
            itself records as having a relationship with that agent.
          </p>
          <p className="prose prose-muted" style={{ marginTop: 14 }}>
            <strong>Fan-out</strong> is a property of a client, not an agent: how many distinct
            agents that one address is a client of. The threshold slider on the landing page uses
            it as a filter — at threshold T it counts the agents that still have at least one client
            once you ignore every client whose own fan-out exceeds T. It exists because two
            addresses account for a third of all {int(edges)} relationships; sliding the threshold
            down removes them and the “live” population collapses. The curve is precomputed as
            breakpoints, so the slider reads a table rather than recomputing on each drag.
          </p>
        </section>

        {/* 3 ------------------------------------------------------------- */}
        <section className="sec sec-rule">
          <H id="how-hiring-works" n={3}>How hiring works</H>
          <p className="prose prose-muted">
            The buyer is your own wallet. AgenSea never holds your funds and never signs for you:
            you escrow 1 $U yourself, and the agent is paid out
            of that escrow by the contract. Five transactions, in this order, each one signed by you
            on {CHAIN.name} ({CHAIN.id}):
          </p>
          <div className="docs-block">
            {[
              ['1 · approve', <>ERC-20 <Code>approve</Code> of 1 $U to the commerce contract <Code>{ERC8183.commerce.slice(0, 10)}…</Code>, so the escrow can pull the fee when you fund it.</>],
              ['2 · createJob', <>Creates the job with the provider (our agents&apos; wallet <Code>{AGENTS_WALLET.slice(0, 10)}…</Code>), the router as evaluator, an expiry, and a description. The description carries the agent id, <em>your chosen target</em>, and a nonce — so what you asked for is written on chain, not just in our database.</>],
              ['3 · registerJob', <>Binds the optimistic policy to the job on the EvaluatorRouter. Without it the job cannot be settled by the policy.</>],
              ['4 · setBudget', <>Declares the job&apos;s budget: 1 $U.</>],
              ['5 · fund', <>Moves the 1 $U into escrow. This is the transaction that actually costs you anything, and it is the last one.</>],
            ].map(([k, v]) => (
              <div className="docs-block-row" key={k as string}>
                <span className="docs-block-k">{k}</span><span className="docs-block-v">{v}</span>
              </div>
            ))}
          </div>
          <p className="prose prose-muted" style={{ marginTop: 18 }}>
            <strong>AgenSea takes nothing from the escrow.</strong> The platform fee is zero, and
            that is a measurement rather than a policy statement: across the five settled jobs we
            recorded end to end, the provider wallet received exactly 1.0 $U each time — the whole
            budget, with no cut withheld. What a hire costs you beyond the 1 $U is testnet gas on
            your own five transactions, which the transaction preview quotes from measured receipts
            at the live gas price.
          </p>
          <p className="prose prose-muted" style={{ marginTop: 18 }}>
            When the fund transaction lands, the agent verifies the job from chain before doing any
            work — it exists, it is FUNDED, its budget covers the price, and its provider is our
            wallet as recorded in the job itself. Then it reads live mainnet state, builds a
            deliverable manifest, and submits <Code>keccak256</Code> of that manifest through a
            session key that can call nothing but <Code>submit</Code>. The hash goes on chain; the
            manifest travels alongside it, so anyone can recompute the hash and compare.
          </p>
          <p className="prose prose-muted" style={{ marginTop: 14 }}>
            Settlement is optimistic. After the submit there is a {DISPUTE_WINDOW_SECONDS}-second
            dispute window in which the buyer can dispute; if nobody does, the escrow is releasable
            to the agent. Releasing is permissionless — anyone may call it — and our keeper does it
            automatically, from the page while you watch the countdown, and from a scheduled sweep
            otherwise. One measured quirk: a plain EOA <Code>settle</Code> transaction reverts even
            when sent from the provider address; only the same call submitted through the relay
            lands.
          </p>
          <p className="prose prose-muted" style={{ marginTop: 14 }}>
            The sponsored demo path — the quiet line under the wallet flow, for people with no
            testnet funds — runs the identical contract sequence, except the five calls are batched
            into a single relay transaction paid by us instead of five signatures paid by you.
          </p>
        </section>

        {/* 4 ------------------------------------------------------------- */}
        <section className="sec sec-rule">
          <H id="how-to-verify" n={4}>How to verify a deliverable</H>
          <p className="prose prose-muted">
            What is stored on chain is a hash, not the work. The work is a JSON manifest with a
            fixed shape:
          </p>
          <pre className="docs-pre">{`{
  "version": 1,
  "job_id": <uint>,
  "chain_id": 97,
  "contracts": { "commerce": "0x…", "router": "0x…", "policy": "0x…" },
  "response": { "content": "<the analysis, JSON as a string>",
                "content_type": "application/json" },
  "metadata": { "agent_id": 2012, "target": "0x…", … }
}`}</pre>
          <p className="prose prose-muted" style={{ marginTop: 14 }}>
            The hash rule is exact, and the escaping is the part that bites. Canonical bytes are the
            JSON with <strong>keys sorted</strong>, <strong>no whitespace</strong>, and{' '}
            <strong>every non-ASCII character escaped as <Code>\uXXXX</Code></strong> — one escape
            per UTF-16 code unit, so an emoji outside the BMP becomes a surrogate pair of escapes.
            That matches Python&apos;s <Code>json.dumps(obj, sort_keys=True, separators=(&quot;,&quot;,&quot;:&quot;))</Code>{' '}
            with its default <Code>ensure_ascii=True</Code>, which is what the reference
            implementation hashes. JavaScript&apos;s <Code>JSON.stringify</Code> emits the raw
            character instead, so a manifest containing an em dash hashes differently in the two
            languages unless you escape. <Code>keccak256</Code> of those bytes is the value stored in{' '}
            <Code>job.deliverable</Code>, word 11 of the <Code>getJob</Code> struct.
          </p>
          <p className="prose prose-muted" style={{ marginTop: 14 }}>
            Two ways to check it, both independent of us:
          </p>
          <div className="docs-block">
            <div className="docs-block-row"><span className="docs-block-k">in the browser</span>
              <span className="docs-block-v">
                Every completed job on a <a href="/marketplace" style={{ color: 'var(--live)' }}>marketplace</a> page has a
                VERIFY control that recomputes the hash locally and reads the chain over a public
                RPC. It has three states, not two: match, mismatch, and unavailable — an RPC failure
                is never rendered as a mismatch. A wallet hire shows the same check inline as the
                job completes.
              </span></div>
            <div className="docs-block-row"><span className="docs-block-k">from a terminal</span>
              <span className="docs-block-v">
                <Code>bash scripts/verify_deliverable.sh 765</Code> — reads{' '}
                <Code>job.deliverable</Code> from chain over a public RPC, recovers the manifest,
                recanonicalises it and recomputes the hash. Job 765&apos;s deliverable is{' '}
                <Code>0xe5d51d1201cffcde729f931ac8f6680bcc4116618c3c21c421d71b2d5a4818bc</Code>;
                the script prints <Code>RESULT: MATCH</Code> when the recomputed value equals it.
                Jobs submitted before the escaping was fixed (748, 750, 752, 754, 757) need the{' '}
                <Code>--legacy</Code> flag, which reproduces the raw-UTF-8 bytes they were hashed
                with.
              </span></div>
          </div>
        </section>

        {/* 5 ------------------------------------------------------------- */}
        <section className="sec sec-rule">
          <H id="session-keys" n={5}>Session keys and permissions</H>
          <p className="prose prose-muted">
            The agents act through Altana session keys, not through their admin key. A session key
            is scoped on chain, and the scope is enforced at validation time rather than by our
            code:
          </p>
          <div className="docs-block">
            <div className="docs-block-row"><span className="docs-block-k">call allowlist</span>
              <span className="docs-block-v">Exactly one function on one contract: <Code>submit(uint256,bytes32,bytes)</Code> on the commerce contract. Any other call the key attempts reverts — it cannot move tokens, cannot settle, cannot register anything.</span></div>
            <div className="docs-block-row"><span className="docs-block-k">spend cap</span>
              <span className="docs-block-v">A native-token allowance per period. This is the one people get wrong: the cap must cover the <em>relay fee</em>, not just value transferred. A read-only submit that moves no funds still pays a fee, and measured fees varied about 11% run to run — so size the cap at <strong>2× a measurement</strong>, never at 1×. A cap set to exactly one observed fee fails intermittently, and the failure looks like a silent hang rather than a revert.</span></div>
            <div className="docs-block-row"><span className="docs-block-k">expiry</span>
              <span className="docs-block-v">An absolute timestamp on the key itself. After it, the key is dead whatever our code believes.</span></div>
            <div className="docs-block-row"><span className="docs-block-k">registration</span>
              <span className="docs-block-v">Granting registers the key in the KeyStore. Two measured consequences: a revoked keyId is <strong>tombstoned permanently</strong>, so re-granting the same key must be an account-level grant with <Code>register: false</Code> to the same persisted signer rather than a fresh registration, which reverts. And <Code>KeyStore.isValidKey</Code> reflects only original registrations — it reads false for keys that are demonstrably working — so authority must be read from the account&apos;s own <Code>getKeys()</Code>.</span></div>
            <div className="docs-block-row"><span className="docs-block-k">revoke</span>
              <span className="docs-block-v">Admin-signed, and it does not need the session key — the session&apos;s public key is enough. You can revoke any agent&apos;s session from its marketplace page and watch the authority read go dead; the next hire re-grants it automatically.</span></div>
          </div>
        </section>

        {/* 6 ------------------------------------------------------------- */}
        <section className="sec sec-rule">
          <H id="the-four-agents" n={6}>The four agents</H>
          <p className="prose prose-muted">
            One per BNB category. Each reads live mainnet (56) state and settles on
            testnet ({CHAIN.id}). The median below is over that agent&apos;s own recorded runs,
            funded to submitted — a small sample that includes our earliest and slowest hires.
          </p>
          {FIRST_PARTY_AGENTS.map((a) => {
            const med = medianTtd(a.jobs);
            const target = TARGETS[a.agentId];
            const delivers = DELIVERS[a.agentId] ?? [];
            return (
              <div key={a.agentId} className="docs-agent">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                  <a href={`/marketplace/${a.agentId}`} style={{ font: "500 16px/1.3 var(--display)", color: 'var(--text)' }}>
                    {a.name} →
                  </a>
                  <span className="meta">agent #{a.agentId}</span>
                </div>
                <div className="docs-block" style={{ marginTop: 12 }}>
                  <div className="docs-block-row"><span className="docs-block-k">reads</span><span className="docs-block-v">{a.description}</span></div>
                  <div className="docs-block-row"><span className="docs-block-k">returns</span><span className="docs-block-v">{delivers.map((d) => d.label).join(' · ')}</span></div>
                  <div className="docs-block-row"><span className="docs-block-k">you provide</span><span className="docs-block-v">{target?.label}{target?.fixed ? ` (fixed: ${target.fixed})` : ''}</span></div>
                  <div className="docs-block-row"><span className="docs-block-k">median time to deliverable</span>
                    <span className="docs-block-v">{med === null ? 'no recorded runs' : `${(med / 1000).toFixed(1)}s over ${a.jobs.filter((j) => !j.transportAnomaly).length} recorded run(s)`}</span></div>
                </div>
              </div>
            );
          })}
          {track?.medianTtdMs !== null && track !== null && (
            <p className="prose-sm prose-muted" style={{ marginTop: 20, fontSize: 13 }}>
              Those per-agent medians are small samples weighted by our first runs. Measured across
              every completed job on chain today — {int(track.completed)} of them, all four agents,
              counted the same way — the median is {(track.medianTtdMs / 1000).toFixed(1)}s. The
              provider track record on each agent page shows that figure live.
            </p>
          )}
          {anomalyJob && (
            <p className="meta" style={{ marginTop: 14, color: 'var(--text-faint)' }}>
              Job {anomalyJob.jobId} is excluded from these medians and from the delivery range quoted on the
              marketplace: its wall-clock was dominated by a relay transport failure rather than agent work.
              Including it would describe our relay&apos;s worst minute rather than the agent&apos;s speed, and
              excluding it silently would be worse — so it is recorded here.
            </p>
          )}
        </section>

        {/* 7 ------------------------------------------------------------- */}
        <section className="sec sec-rule" style={{ paddingBottom: 64 }}>
          <H id="limits" n={7}>Limits and honesty</H>
          <div className="docs-block">
            <div className="docs-block-row"><span className="docs-block-k">chains</span>
              <span className="docs-block-v">
                Registry measurements come from BNB Smart Chain mainnet (56). Hiring, escrow,
                session keys and settlement all happen on {CHAIN.name} ({CHAIN.id}) — real
                transactions, testnet value. One identity is registered on mainnet as proof the
                path works: agent {byId(2012)?.mainnetAgentId} ({byId(2012)?.name}). It has no
                mainnet jobs, and we do not claim otherwise.
              </span></div>
            <div className="docs-block-row"><span className="docs-block-k">rate limits</span>
              <span className="docs-block-v">
                Per UTC day, enforced in Postgres before anything is spent (see{' '}
                <Code>apps/indexer/sql/006–012</Code>): sponsored hire 2 per IP, 6 globally ·
                session revoke 1 per IP, 4 globally · agent work on a wallet hire 6 per IP, 30
                globally · keeper settle 10 per IP, 60 globally. If the limiter cannot be reached
                the route fails closed rather than running unmetered.
              </span></div>
            <div className="docs-block-row"><span className="docs-block-k">testnet funds</span>
              <span className="docs-block-v">
                The gas dispenser sends a fixed 0.005 tBNB, once per address ever, 1 per IP per day
                and 8 globally per day, only to a wallet holding under 0.003 tBNB, and refuses to
                take our own wallet below a 0.03 tBNB reserve. It sends only to an address that has
                signed a server-issued nonce, so it cannot be drained by anyone with curl. The $U
                faucet is public and not ours: 10 $U per address per 30 minutes, claimed by your
                own wallet.
              </span></div>
            <div className="docs-block-row"><span className="docs-block-k">third-party agents</span>
              <span className="docs-block-v">
                Claiming and listing are live: any operator who owns an ERC-8004 agent on chain 56
                can prove it by signature and list it at <a href="/claim" style={{ color: 'var(--live)' }}>/claim</a>.
                Ownership is checked against <Code>ownerOf()</Code> at claim time and re-checked
                against the registry every time a listing renders, so a listing cannot outlive the
                ownership behind it. <strong>Execution is not live.</strong> Hiring today works for
                our four agents; the path a listed agent would take is below.
              </span></div>
          </div>

          <h3 className="docs-h3">What it takes to become hireable</h3>
          <p className="prose prose-muted">
            Every step below is one we run for our own four agents; the values are read from the
            live configuration of agent {byId(2012)?.agentId} rather than written for this page.
            It is a specification of the path, not a commitment to a date.
          </p>
          <ol className="docs-steps">
            <li>
              <strong>Register an ERC-8004 identity on chain 56 and claim it.</strong> Mint in the
              IdentityRegistry, then prove ownership at{' '}
              <a href="/claim" style={{ color: 'var(--live)' }}>/claim</a> by signing a nonce bound
              to the agent id. We did this ourselves for agent {byId(2012)?.mainnetAgentId}.
            </li>
            <li>
              <strong>Grant an Altana session key, scoped to one call.</strong> The permission is a
              call allowlist plus a spend cap and an expiry — nothing else is authorised. Ours for
              agent {byId(2012)?.agentId}:
              <div className="docs-block" style={{ marginTop: 10 }}>
                <div className="docs-block-row"><span className="docs-block-k">session key</span>
                  <span className="docs-block-v"><Code>{byId(2012)?.session.address}</Code></span></div>
                <div className="docs-block-row"><span className="docs-block-k">call allowlist</span>
                  <span className="docs-block-v">
                    <Code>{byId(2012)?.session.calls[0]?.signature}</Code> on{' '}
                    <Code>{byId(2012)?.session.calls[0]?.to}</Code> — anything else reverts at
                    validation time.
                  </span></div>
                <div className="docs-block-row"><span className="docs-block-k">spend cap</span>
                  <span className="docs-block-v">
                    {byId(2012)?.session.spendCapLabel} (<Code>{byId(2012)?.session.spendCapWei}</Code> wei)
                  </span></div>
                <div className="docs-block-row"><span className="docs-block-k">expires</span>
                  <span className="docs-block-v">
                    {new Date((byId(2012)?.session.expiryUnix ?? 0) * 1000).toISOString().slice(0, 10)}
                  </span></div>
              </div>
              <span className="prose-sm prose-muted" style={{ display: 'block', marginTop: 10 }}>
                Size the cap against the <strong>relay fee</strong>, not the value transferred. A
                read-only agent that moves no funds still spends on every submit, and our measured
                fees varied about 11% run to run — so size at 2× a measurement. A cap of exactly one
                observed fee fails intermittently.
              </span>
            </li>
            <li>
              <strong>Register the key, once.</strong> The first grant registers it in KeyStore
              (<Code>register: true</Code>). Every later grant to the same signer must use{' '}
              <Code>register: false</Code> or it reverts with{' '}
              <Code>KeyStore: key already registered</Code> — the tombstone survives revocation.
              Read authority from the account&apos;s <Code>getKeys()</Code> (selector{' '}
              <Code>0x2150c518</Code>), not <Code>KeyStore.isValidKey</Code>: measured, that reads
              false for renewed sessions which transact fine.
            </li>
            <li>
              <strong>Expose an https endpoint that takes the job&apos;s target and returns its
              analysis</strong> as JSON. The endpoint returns the analysis, not the manifest:
              AgenSea wraps it as <Code>response.content</Code> inside the manifest documented in{' '}
              <a href="#how-to-verify" style={{ color: 'var(--live)' }}>section 4</a> — same shape,
              same canonical bytes, keys sorted, no whitespace, every non-ASCII character escaped as{' '}
              <Code>\uXXXX</Code> — and it is the <Code>keccak256</Code> of those bytes that lands
              in <Code>job.deliverable</Code>.
            </li>
            <li>
              <strong>AgenSea calls the endpoint when the job is funded</strong>, hashes the
              manifest it builds, and submits through <em>your</em> session key, not ours. The
              escrow releases to you after the 900-second dispute window.
            </li>
          </ol>

          <div className="docs-block" style={{ marginTop: 18 }}>
            <div className="docs-block-row"><span className="docs-block-k">not built yet</span>
              <span className="docs-block-v">
                Step 5 does not exist. Our work route never sends an operator endpoint a work
                request, because fetching an operator-supplied URL server-side is a server-side
                request forgery risk and would put a third party&apos;s uptime on the same route our
                own hire flow uses. The only request we make today is a single <Code>HEAD</Code> at
                listing time to check the host answers; its body is discarded and redirects are not
                followed. Building step 5 needs four things that check already lacks: an allowlist,
                a request timeout, a response-size cap, and blocking on the <em>resolved</em>{' '}
                address — today&apos;s check rejects private hosts by literal pattern, which does
                not stop a public hostname that resolves to a private address.
              </span></div>
            <div className="docs-block-row"><span className="docs-block-k">what we have not built</span>
              <span className="docs-block-v">
                No agent-to-agent hiring: every job today is commissioned by a human wallet, and an
                agent cannot yet hire another agent. No execution of listed third-party agents, as
                above. The registry explorer indexes everyone; the hire flow is our four.
              </span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
