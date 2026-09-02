'use client';
/**
 * VERIFY — re-derive a deliverable hash in the browser and compare it to the
 * value stored on chain.
 *
 * THREE STATES, never conflated:
 *   MATCH        computed == on-chain
 *   MISMATCH     computed != on-chain (the deliverable does not describe this manifest)
 *   UNREACHABLE  the chain could not be read — we do NOT know either way
 *
 * An RPC failure (timeout, 429, DNS, CORS) must never render as MISMATCH. That
 * would accuse a valid deliverable of being wrong because someone's network hiccuped.
 */
import { useState } from 'react';
import { manifestHash, readOnChainDeliverable, CANONICALISATION, type Canon, type VerifyState } from '@/lib/verify';

const BOX = { padding: '18px 20px', border: '1px solid var(--border)', background: 'var(--surface)' } as const;
const MONO9 = { font: "500 9px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase' } as const;

export function VerifyDeliverable({ jobId, manifest, canon }: { jobId: string; manifest: unknown; canon: Canon }) {
  const [state, setState] = useState<VerifyState>({ kind: 'idle' });

  async function run() {
    setState({ kind: 'checking' });
    let computed: string;
    try {
      computed = manifestHash(manifest, canon);
    } catch (e) {
      setState({ kind: 'unreachable', detail: `could not hash the manifest: ${(e as Error).message}` });
      return;
    }
    const chain = await readOnChainDeliverable(jobId);
    if (!chain.ok) { setState({ kind: 'unreachable', detail: chain.detail }); return; }
    setState(chain.hash.toLowerCase() === computed.toLowerCase()
      ? { kind: 'match', computed, onChain: chain.hash, block: chain.rpc }
      : { kind: 'mismatch', computed, onChain: chain.hash });
  }

  const tone =
    state.kind === 'match' ? 'var(--verified)' :
    state.kind === 'mismatch' ? 'var(--danger)' :
    state.kind === 'unreachable' ? 'var(--warn)' : 'var(--text-muted)';

  return (
    <div style={BOX}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{ ...MONO9, color: 'var(--text-faint)' }}>Deliverable · job {jobId}</div>
          <div style={{ font: "400 11px/1.5 var(--mono)", color: 'var(--text-muted)', marginTop: 8, maxWidth: 460 }}>
            {CANONICALISATION(canon)}
          </div>
        </div>
        <button onClick={run} disabled={state.kind === 'checking'}
          style={{
            font: "500 11px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
            color: state.kind === 'checking' ? 'var(--text-faint)' : 'var(--bg)',
            background: state.kind === 'checking' ? 'var(--surface-raised)' : 'var(--live)',
            border: 'none', padding: '10px 16px', cursor: state.kind === 'checking' ? 'wait' : 'pointer',
          }}>
          {state.kind === 'checking' ? 'Checking…' : 'Verify'}
        </button>
      </div>

      <details style={{ marginTop: 14 }}>
        <summary style={{ ...MONO9, color: 'var(--text-muted)', cursor: 'pointer' }}>Reproduce this yourself</summary>
        <pre style={{ font: "400 10px/1.5 var(--mono)", color: 'var(--text-muted)', background: 'var(--bg)', padding: 12, marginTop: 10, overflowX: 'auto' }}>
{`# on-chain deliverable (word 11 of the getJob struct)
cast call ${'0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE'} \\
  "getJob(uint256)" ${jobId} \\
  --rpc-url https://bsc-testnet-rpc.publicnode.com

# recompute from the manifest, under THIS deliverable's rule
python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(',',':'),ensure_ascii=${canon === 'escaped' ? 'True' : 'False'}),end='')" \\
  < manifest.json | cast keccak`}
        </pre>
      </details>

      {state.kind !== 'idle' && state.kind !== 'checking' && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ ...MONO9, color: tone }}>
            {state.kind === 'match' && '✓ Match — the on-chain deliverable is this manifest'}
            {state.kind === 'mismatch' && '✗ Mismatch — the on-chain deliverable is NOT this manifest'}
            {state.kind === 'unreachable' && '! Could not reach the chain — verification is UNKNOWN, not failed'}
          </div>

          {state.kind === 'unreachable' && (
            <div style={{ font: "400 11px/1.5 var(--mono)", color: 'var(--text-muted)', marginTop: 10 }}>
              {state.detail}
              <div style={{ marginTop: 6, color: 'var(--text-faint)' }}>
                Public RPCs rate-limit. This says nothing about the deliverable — retry, or run the
                command below yourself.
              </div>
            </div>
          )}

          {/* On a MATCH the verdict is the result and the hashes are the
              working, so they collapse — closed by default.

              A MISMATCH NEVER COLLAPSES. That is the one state where a reader
              needs the two hashes in front of them without another click, so it
              renders the same block bare. Same markup either way; only the
              wrapper differs. */}
          {(state.kind === 'match' || state.kind === 'mismatch') && (() => {
            const hashes = (
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {[['computed in your browser', state.computed], ['stored on chain', state.onChain]].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ ...MONO9, color: 'var(--text-faint)' }}>{k}</div>
                    <div style={{ font: "400 11px/1.4 var(--mono)", color: 'var(--text)', wordBreak: 'break-all', marginTop: 4 }}>{v}</div>
                  </div>
                ))}
                {state.kind === 'match' && (
                  <div style={{ font: "400 10px/1.4 var(--mono)", color: 'var(--text-faint)' }}>
                    read from {state.block} · chain 97
                  </div>
                )}
              </div>
            );
            if (state.kind === 'mismatch') return hashes;
            return (
              <details style={{ marginTop: 10 }}>
                <summary style={{ ...MONO9, color: 'var(--text-muted)', cursor: 'pointer' }}>Show the hashes</summary>
                {hashes}
              </details>
            );
          })()}

        </div>
      )}
    </div>
  );
}
