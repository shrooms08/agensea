'use client';
/**
 * Fan-out threshold slider.
 *
 * The value is a BREAKPOINT INDEX, not a threshold. The 31 real thresholds are
 * wildly uneven — 1,2,3,4,6,8,14,16 then a jump to 96, then 254/924/1137/1800
 * (read live from agent_fanout_curve; 32 rows as of the 31 Aug 2026 sweep) —
 * so mapping position to value would leave most of the travel dead. Index
 * mapping gives even travel; the readout always shows the real threshold and
 * the real agent count, never the index. Index 0 is the (0,0) sentinel.
 *
 * The native input is kept for keyboard and screen-reader behaviour; only its
 * appearance is replaced. Ticks mark every real breakpoint on the rail, and the
 * readout tracks the thumb rather than sitting in a corner.
 */
import { useEffect, useRef, useState } from 'react';
import type { CurvePoint } from '@/lib/queries';
import { FanoutCurve } from './FanoutCurve';
import { int, measuredOn } from '@/lib/format';
import { prefersReducedMotion, easeOut, useIsoLayoutEffect } from '@/lib/motion';

export function ThresholdSlider({ curve, measuredAt }: { curve: CurvePoint[]; measuredAt: string }) {
  const pts = [...curve].sort((a, b) => a.threshold - b.threshold);
  const last = pts.length - 1;
  // Default to the breakpoint nearest fan-out 100 rather than the loosest one.
  // At the loosest position the chart shows 4,353 and a flat line while the
  // copy beside it says the number collapses — a reader who never drags the
  // slider never sees the finding. Derived from the data, not an index literal.
  const defaultIndex = pts.reduce(
    (best, p, i) => (Math.abs(p.threshold - 100) < Math.abs(pts[best]!.threshold - 100) ? i : best), 0);
  const [index, setIndex] = useState(defaultIndex);
  const cur = pts[index]!;
  const pctPos = last > 0 ? (index / last) * 100 : 0;

  // (b) thumb + readout appear only after the curve has drawn.
  // Defaults to TRUE: with reduced motion, or if JS never runs, the control must
  // be visible. It is hidden only when motion is actually going to play, and
  // that happens before paint so there is no flash.
  const [revealed, setRevealed] = useState(true);
  useIsoLayoutEffect(() => { if (!prefersReducedMotion()) setRevealed(false); }, []);

  // (c) Moving the slider eases the readout toward the new value rather than
  // snapping. Reduced motion: assign directly, no rAF loop.
  const [display, setDisplay] = useState(cur.qualifying_agents);
  const raf = useRef(0);
  // Declared before the effect that closes over it: the effect runs post-render
  // so a later `const` would be in TDZ at module-eval order and is fragile.
  const displayRef = useRef(display);
  displayRef.current = display;
  useEffect(() => {
    const target = cur.qualifying_agents;
    if (prefersReducedMotion()) { setDisplay(target); return; }
    cancelAnimationFrame(raf.current);
    const from = displayRef.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 150);
      setDisplay(from + (target - from) * easeOut(p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setDisplay(target);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [cur.qualifying_agents]);

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <FanoutCurve curve={pts} index={index} onRevealed={() => setRevealed(true)} />

      <div className="slider" style={{ marginTop: 6, opacity: revealed ? 1 : 0, transition: 'opacity 240ms ease-out' }}>
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
      <div style={{ position: 'relative', height: 56, marginTop: 2, opacity: revealed ? 1 : 0, transition: 'opacity 240ms ease-out' }}>
        <div style={{
          position: 'absolute', left: `clamp(0px, calc(${pctPos}% - 60px), calc(100% - 120px))`,
          width: 120, textAlign: pctPos < 8 ? 'left' : pctPos > 92 ? 'right' : 'center',
        }}>
          <div style={{ font: "500 14px/1.1 var(--mono)", color: 'var(--text)' }}>
            {cur.threshold === 0 ? 'none' : `≤ ${int(cur.threshold)}`}
          </div>
          <div className="tnum" style={{ font: "500 13px/1.2 var(--mono)", color: 'var(--live)', marginTop: 4 }}>
            {int(Math.round(display))}
          </div>
          <div className="meta" style={{ color: 'var(--text-faint)', marginTop: 2, whiteSpace: 'nowrap' }}>
            of {int(pts[last]!.qualifying_agents)} unfiltered
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
