'use client';
/**
 * Fan-out threshold slider.
 *
 * The slider's value is a BREAKPOINT INDEX, not a threshold. The 31 real
 * thresholds are wildly uneven (1,2,3,4,8,14,16 then a jump to 96, then
 * 254/924/1137/1800), so mapping position to value would make most of the
 * travel dead space. Index mapping gives even travel; the label always shows
 * the real threshold and the real agent count, never the index.
 *
 * Index 0 is the (0,0) sentinel, which is the clamped low end.
 */
import { useState } from 'react';
import type { CurvePoint } from '@/lib/queries';
import { FanoutCurve } from './FanoutCurve';
import { int, measuredOn } from '@/lib/format';

export function ThresholdSlider({ curve, measuredAt }: { curve: CurvePoint[]; measuredAt: string }) {
  const pts = [...curve].sort((a, b) => a.threshold - b.threshold);
  const [index, setIndex] = useState(pts.length - 1); // default: unrestricted
  const cur = pts[index]!;

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
      <FanoutCurve curve={pts} index={index} />

      <input
        type="range" min={0} max={pts.length - 1} step={1} value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        aria-label="Maximum client fan-out"
        aria-valuetext={`fan-out ${cur.threshold}, ${cur.qualifying_agents} agents`}
        style={{ width: '100%', marginTop: 12, accentColor: 'var(--text)' }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
        <div style={{ font: "500 11px/1 var(--mono)", letterSpacing: '0.14em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
          Max client fan-out
        </div>
        <div style={{ font: "500 13px/1 var(--mono)", color: 'var(--text)' }}>
          {cur.threshold === 0 ? 'none' : `≤ ${int(cur.threshold)}`}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
        <div style={{ font: "400 12px/1.4 var(--mono)", color: 'var(--text-muted)' }}>
          {int(cur.qualifying_agents)} agents have at least one client below this fan-out
        </div>
        {/* measured_at is essential text: --text-muted, never --text-faint. */}
        <div style={{ font: "400 10px/1 var(--mono)", color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          measured {measuredOn(measuredAt)}
        </div>
      </div>
    </div>
  );
}
