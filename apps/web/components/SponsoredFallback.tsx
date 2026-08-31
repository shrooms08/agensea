'use client';
/** The sponsored path, demoted: one quiet line that expands the existing
 *  HireDemo unchanged. Deleted only on Minos's explicit word. */
import { useState } from 'react';

export function SponsoredFallback({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return (
    <button onClick={() => setOpen(true)}
      style={{ font: "400 12px/1.5 var(--mono)", color: 'var(--text-muted)', background: 'none',
               border: 'none', padding: '10px 0', cursor: 'pointer', textAlign: 'left' }}>
      No testnet funds? Run a sponsored job →
    </button>
  );
}
