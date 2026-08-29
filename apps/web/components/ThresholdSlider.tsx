'use client';
/**
 * Fan-out threshold slider.
 *
 * The value is a BREAKPOINT INDEX, not a threshold. The 31 real thresholds are
 * wildly uneven — 1,2,3,4,8,14,16 then a jump to 96, then 254/924/1137/1800 —
 * so mapping position to value would leave most of the travel dead. Index
 * mapping gives even travel; the readout always shows the real threshold and
 * the real agent count, never the index. Index 0 is the (0,0) sentinel.
 *
 * The native input is kept for keyboard and screen-reader behaviour; only its
 * appearance is replaced. Ticks mark every real breakpoint on the rail, and the
 * readout tracks the thumb rather than sitting in a corner.
 */
import { useState } from 'react';
import type { CurvePoint } from '@/lib/queries';
import { FanoutCurve } from './FanoutCurve';
import { int, measuredOn } from '@/lib/format';

export function ThresholdSlider({ curve, measuredAt }: { curve: CurvePoint[]; measuredAt: string }) {
  const pts = [...curve].sort((a, b) => a.threshold - b.threshold);
  const last = pts.length - 1;
  const [index, setIndex] = useState(last);       // default: unrestricted
  const cur = pts[index]!;
  const pctPos = last > 0 ? (index / last) * 100 : 0;

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <FanoutCurve curve={pts} index={index} />

      <div className="slider" style={{ marginTop: 6 }}>
        <div className="slider-rail">
          <div className="slider-rail-done" style={{ width: `${pctPos}%` }} />
          {pts.map((p, i) => (
            <span key={p.threshold}
                  className={`slider-tick${i <= index ? ' is-past' : ''}`}
                  style={{ left: `${last > 0 ? (i / last) * 100 : 0}%` }} />
          ))}
        </div>
        <input
          type="range" min={0} max={last} step={1} value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label="Maximum client fan-out"
          aria-valuetext={`fan-out ${cur.threshold === 0 ? 'none' : cur.threshold}, ${cur.qualifying_agents} agents`}
        />
      </div>

      {/* Readout tracks the thumb. Clamped so it never leaves the rail. */}
      <div style={{ position: 'relative', height: 40, marginTop: 2 }}>
        <div style={{
          position: 'absolute', left: `clamp(0px, calc(${pctPos}% - 60px), calc(100% - 120px))`,
          width: 120, textAlign: pctPos < 8 ? 'left' : pctPos > 92 ? 'right' : 'center',
        }}>
          <div style={{ font: "500 14px/1.1 var(--mono)", color: 'var(--text)' }}>
            {cur.threshold === 0 ? 'none' : `≤ ${int(cur.threshold)}`}
          </div>
          <div style={{ font: "500 13px/1.2 var(--mono)", color: 'var(--live)', marginTop: 4 }}>
            {int(cur.qualifying_agents)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div className="label">Max client fan-out</div>
        <div className="meta" style={{ whiteSpace: 'nowrap' }}>measured {measuredOn(measuredAt)}</div>
      </div>
      <p className="prose-sm prose-muted" style={{ marginTop: 8, fontSize: 13 }}>
        {int(cur.qualifying_agents)} agents have at least one client below this fan-out.
      </p>
    </div>
  );
}
