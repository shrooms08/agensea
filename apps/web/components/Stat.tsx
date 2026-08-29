/**
 * A headline figure.
 *
 * measured_at is not optional — the registry grows ~110 agents per 45 minutes,
 * so a bare count misleads. It renders in --text-muted, never --text-faint,
 * which is ~2.4:1 on --bg and below AA for anything you must actually read.
 *
 * The value wraps rather than clips: a long string previously truncated to
 * "0 (measured" on /marketplace, printing an unclosed parenthesis.
 */
import { measuredOn, int } from '@/lib/format';

export function Stat({ label, value, measuredAt, note, tone = 'var(--text)' }: {
  label: string; value: number | string; measuredAt: string; note?: string | null; tone?: string;
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="num stat-value" style={{ color: tone, marginTop: 10 }}>
        {typeof value === 'number' ? int(value) : value}
      </div>
      <div className="meta" style={{ marginTop: 9 }}>measured {measuredOn(measuredAt)}</div>
      {note && <div className="meta" style={{ marginTop: 3 }}>{note}</div>}
    </div>
  );
}
