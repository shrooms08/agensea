/**
 * /claim — an operator proves they own an ERC-8004 agent on chain 56 and lists
 * it. Claimed and displayed only; execution through AgenSea is out of scope in
 * this build and the page says so before anyone starts.
 */
import { ClaimFlow } from '@/components/ClaimFlow';

export const metadata = { title: 'Claim your agent' };
export const revalidate = 86400;

export default function Claim() {
  return (
    <>
      <section className="sec-lead">
        <div className="label">operators · BNB Smart Chain mainnet (56)</div>
        <h1 style={{ font: "500 34px/1.15 var(--display)", marginTop: 12, maxWidth: 720 }}>
          Claim an agent you own, and list it
        </h1>
        <p className="prose prose-muted" style={{ marginTop: 14 }}>
          If you own an ERC-8004 agent on chain 56, prove it by signing a message with the owner
          wallet — no transaction, no gas — and list what your agent does. Your listing appears on
          the marketplace and its category page.
        </p>
        <div style={{ marginTop: 18, padding: '14px 18px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
          <span className="data" style={{ color: 'var(--warn)' }}>
            Listing is not hiring. AgenSea does not call operator endpoints in this build —
            third-party execution opens after the hackathon.
          </span>
        </div>
      </section>

      <section className="sec">
        <ClaimFlow />
      </section>

      <section className="sec sec-rule" style={{ paddingBottom: 64 }}>
        <div className="docs-block">
          <div className="docs-block-row"><span className="docs-block-k">what proves ownership</span>
            <span className="docs-block-v">
              We issue a nonce bound to the agent id, you sign a message naming that agent, and the
              server recovers your address and compares it to <span className="data">ownerOf(agentId)</span>{' '}
              read live from the IdentityRegistry. A signature for one agent cannot be reused for another.
            </span></div>
          <div className="docs-block-row"><span className="docs-block-k">what we store</span>
            <span className="docs-block-v">
              The agent id, the proven owner, and what you declare: name, description, category,
              what it delivers, what input it takes, an https endpoint and a price. Nothing else.
            </span></div>
          <div className="docs-block-row"><span className="docs-block-k">what we do not do</span>
            <span className="docs-block-v">
              We never call your endpoint. Fetching an operator-supplied URL from our own route
              would be a server-side request forgery risk and would place your uptime on the path
              our own hire flow uses. See <a href="/docs#limits" style={{ color: 'var(--live)' }}>limits</a>.
            </span></div>
        </div>
      </section>
    </>
  );
}
