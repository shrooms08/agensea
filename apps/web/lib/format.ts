/** Formatting helpers. All data renders in --mono per the reference. */

/** "24 Aug 2026" — the date a figure was measured. Never omitted. */
export function measuredOn(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export const int = (n: number | string): string => Number(n).toLocaleString('en-GB');

export const pct = (n: number, dp = 2): string => `${n.toFixed(dp)}%`;

export function shortAddr(a: string | null | undefined): string {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Liveness bucket -> token name. The product's core semantic axis. */
export function livenessToken(clientCount: number): '--dead' | '--stale' | '--live' {
  if (clientCount === 0) return '--dead';
  if (clientCount === 1) return '--stale';
  return '--live';
}
