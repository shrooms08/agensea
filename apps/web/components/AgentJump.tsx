'use client';
/** Jump straight to any agent id. The detail route renders on demand
 *  (dynamicParams), so every minted agent is reachable even though the table
 *  above shows only the highest fan-out slice. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AgentJump({ max }: { max: number }) {
  const [id, setId] = useState('');
  const router = useRouter();
  const n = Number(id);
  const valid = /^\d{1,7}$/.test(id) && n >= 1 && n <= max;
  return (
    <form className="agent-jump" onSubmit={(e) => { e.preventDefault(); if (valid) router.push(`/agents/${n}`); }}>
      <label className="label" style={{ fontSize: 9 }} htmlFor="agent-jump-input">go to agent id</label>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <input id="agent-jump-input" className="target-input" style={{ maxWidth: 240 }} inputMode="numeric"
          value={id} onChange={(e) => setId(e.target.value)} placeholder={`1 – ${max.toLocaleString('en-GB')}`} />
        <button type="submit" className="wallet-connect" disabled={!valid}
          style={{ opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed' }}>Open</button>
      </div>
      {id && !valid && <div className="data" style={{ color: 'var(--danger)', marginTop: 8 }}>enter an id between 1 and {max.toLocaleString('en-GB')}</div>}
    </form>
  );
}
