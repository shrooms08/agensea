'use client';
/**
 * Session authority + Revoke control for the session panel.
 * Authority is read from the ACCOUNT on chain (via GET /api/revoke/[id],
 * which decodes the account's getKeys()) — never from our own state.
 * Revoke requires an explicit confirmation step stating exactly what stops
 * working, is rate-limited server-side, and shows the revocation tx when it
 * lands. The session heals automatically on the next demo hire
 * (tombstone-safe register:false re-grant).
 */
import { useEffect, useState } from 'react';

type Auth = { active: boolean; expiry: number | null } | null;
const EXPLORER = 'https://testnet.bscscan.com/tx/';

export function SessionRevoke({ agentId }: { agentId: number }) {
  const [auth, setAuth] = useState<Auth | 'loading'>('loading');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revokeTx, setRevokeTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`/api/revoke/${agentId}`, { cache: 'no-store' });
      setAuth(((await r.json()) as { authority: Auth }).authority);
    } catch { setAuth(null); }
  };
  useEffect(() => { void load(); }, []);

  async function revoke() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/revoke/${agentId}`, { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; tx?: string; authority?: Auth; error?: string };
      if (!r.ok) { setErr(j.error ?? `HTTP ${r.status}`); }
      else { setRevokeTx(j.tx ?? null); setAuth(j.authority ?? null); }
    } catch { setErr("couldn't reach the chain — the revocation may not have gone through"); }
    setBusy(false); setConfirming(false);
  }

  const revoked = auth !== 'loading' && auth !== null && !auth.active;

  return (
    <div style={{ marginTop: 14, padding: '16px 18px', background: revoked ? 'var(--surface-raised)' : 'var(--surface)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div className="label" style={{ fontSize: 9 }}>session authority · read from the account on chain</div>
          <div className="data" style={{ marginTop: 8, color: auth === 'loading' ? 'var(--text-faint)' : revoked ? 'var(--danger)' : auth ? 'var(--live)' : 'var(--warn)' }}>
            {auth === 'loading' ? 'reading chain…'
              : auth === null ? 'chain read unavailable — cannot display authority'
              : auth.active ? `ACTIVE${auth.expiry ? ` · expires ${new Date(auth.expiry * 1000).toISOString().slice(0, 10)}` : ''}`
              : 'REVOKED — this key holds no authority on the account'}
          </div>
          {revoked && (
            <div className="prose-sm prose-muted hd-enter" style={{ marginTop: 8, fontSize: 13 }}>
              This agent can no longer transact until a new session is granted. It heals
              automatically on the next demo hire (account-level re-grant; the KeyStore
              registration is tombstoned and is deliberately not re-created).
              {revokeTx && <> — <a href={EXPLORER + revokeTx} target="_blank" rel="noreferrer" style={{ color: 'var(--live-dim)' }}>revocation tx ↗</a></>}
            </div>
          )}
        </div>
        {!revoked && auth !== 'loading' && auth !== null && !confirming && (
          <button onClick={() => setConfirming(true)}
            style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
                     color: 'var(--danger)', background: 'transparent', border: '1px solid var(--danger)',
                     padding: '10px 16px', cursor: 'pointer' }}>
            Revoke session
          </button>
        )}
      </div>

      {confirming && (
        <div className="hd-enter" style={{ marginTop: 14, padding: '14px 16px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--danger)' }}>
          <div className="data" style={{ color: 'var(--text)' }}>
            Revoke this agent&apos;s session on chain? <strong>This agent can no longer transact
            until a new session is granted.</strong> Real transaction; rate-limited demo.
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button onClick={revoke} disabled={busy}
              style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
                       color: 'var(--bg)', background: 'var(--danger)', border: 'none', padding: '10px 16px',
                       cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Revoking…' : 'Confirm revoke'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy}
              style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.12em', textTransform: 'uppercase',
                       color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border-strong)',
                       padding: '10px 16px', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && (
        <div className="hd-enter" style={{ marginTop: 12, padding: '10px 14px', background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--warn)' }}>
          <span className="data" style={{ color: 'var(--warn)' }}>{err}</span>
        </div>
      )}
    </div>
  );
}
