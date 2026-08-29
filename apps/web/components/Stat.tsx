/**
 * A headline figure. The measured_at date is NOT optional — the registry grows
 * ~110 agents per 45 minutes, so a bare count is misleading. Rendered in
 * --text-muted, never --text-faint: it is essential text and --text-faint is
 * ~2.4:1 on --bg, below WCAG AA.
 */
import { measuredOn, int } from '@/lib/format';

export function Stat({ label, value, measuredAt, note, tone = 'var(--text)' }: {
  label: string; value: number | string; measuredAt: string; note?: string | null; tone?: string;
}) {
  return (
    <div style={{ padding: '20px 22px', background: 'var(--surface)' }}>
      <div style={{ font: "500 10px/1 var(--mono)", letterSpacing: '0.14em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ font: "500 32px/1.1 var(--display)", color: tone, marginTop: 12, letterSpacing: '-0.02em' }}>
        {typeof value === 'number' ? int(value) : value}
      </div>
      <div style={{ font: "400 10px/1.4 var(--mono)", color: 'var(--text-muted)', marginTop: 10 }}>
        measured {measuredOn(measuredAt)}
      </div>
      {note && (
        <div style={{ font: "400 10px/1.4 var(--mono)", color: 'var(--text-muted)', marginTop: 4 }}>{note}</div>
      )}
    </div>
  );
}
