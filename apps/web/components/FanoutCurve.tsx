'use client';
/**
 * The fan-out curve — 31 real breakpoints plus the (0,0) sentinel — log x AND log y.
 *
 * Two features of the data must stay visible, per the brief:
 *   - the 16 -> 96 gap on x (no client has fan-out between them)
 *   - the cliff at the top: the last two breakpoints, 1137 and 1800, take the
 *     count 1,566 -> 2,583 -> 4,353. Those two clients alone are the difference
 *     between "4,353 agents have a client" and "1,566 do".
 *     Those endpoints track agent_fanout_curve; the SHAPE is what matters here,
 *     and it has held across re-sweeps (same max, same cliff).
 * A log x-axis keeps the dense 1..16 head readable while still showing the
 * long tail. The y-axis is log too: linear 0..4,353 pushed every breakpoint
 * below ~400 agents into the bottom tenth of the plot — which is precisely the
 * region the finding lives in — so the collapse from 4,353 to the low hundreds
 * was unreadable without dragging. Both axes are labelled log on the chart.
 *
 * threshold 0 is the sentinel (0 agents). log(0) is undefined, so it is pinned
 * to the left edge rather than fed to the scale.
 */
import { useEffect, useRef, useState } from 'react';
import type { CurvePoint } from '@/lib/queries';
import { prefersReducedMotion } from '@/lib/motion';

// PAD_T leaves a header band above the plot for the two axis labels. They cannot
// sit beside their own ticks: the y label is wider than the 46px tick gutter and
// the x label lands on the 1000 tick.
const W = 640, H = 200, PAD_L = 46, PAD_R = 12, PAD_T = 24, PAD_B = 26;

export function FanoutCurve({ curve, index, onRevealed }: {
  curve: CurvePoint[]; index: number; onRevealed?: () => void;
}) {
  // (b) Draw left to right on FIRST view only, then fade the area in.
  // Reduced motion: `armed` stays false, no animation classes are applied, and
  // the static path renders complete.
  const wrap = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const [armed, setArmed] = useState(false);
  const [hover, setHover] = useState<CurvePoint | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (prefersReducedMotion()) { fired.current = true; onRevealed?.(); return; }
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (!es[0]?.isIntersecting || fired.current) return;
      fired.current = true;
      io.disconnect();
      const len = lineRef.current?.getTotalLength?.() ?? 1200;
      lineRef.current?.style.setProperty('--len', String(len));
      setArmed(true);
      window.setTimeout(() => onRevealed?.(), 1040);
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [onRevealed]);

  const pts = [...curve].sort((a, b) => a.threshold - b.threshold);
  const maxY = Math.max(...pts.map((p) => p.qualifying_agents), 1);
  const logMax = Math.log10(Math.max(...pts.map((p) => p.threshold), 10));

  // t=0 pinned to the axis origin; everything else on log10.
  const x = (t: number) => (t <= 0 ? PAD_L : PAD_L + (Math.log10(t) / logMax) * (W - PAD_L - PAD_R));
  // log y. 0 is a real value here (the sentinel) and log(0) is undefined, so
  // anything below 1 agent is pinned to the baseline.
  const logMaxY = Math.log10(Math.max(maxY, 10));
  const y = (v: number) => (v < 1 ? H - PAD_B : H - PAD_B - (Math.log10(v) / logMaxY) * (H - PAD_T - PAD_B));

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.threshold).toFixed(1)},${y(p.qualifying_agents).toFixed(1)}`).join('');
  // Same path, closed to the baseline. The top two breakpoints add ~2,800 agents
  // (see agent_fanout_curve); as a line that reads as a stroke, as an area it
  // reads as the mass it actually is.
  const area = `${path}L${x(pts[pts.length - 1]!.threshold).toFixed(1)},${(H - PAD_B).toFixed(1)}L${x(pts[0]!.threshold).toFixed(1)},${(H - PAD_B).toFixed(1)}Z`;
  const cur = pts[Math.max(0, Math.min(index, pts.length - 1))]!;
  const ticks = [1, 10, 100, 1000];
  const yTicks = [1, 10, 100, 1000].filter((v) => v <= maxY).concat(maxY);

  // Labelled points, DERIVED from the curve rather than typed in: the loosest
  // threshold and the breakpoints nearest 1000 / 250 / 100. These four make the
  // collapse legible with no interaction at all.
  const nearest = (t: number) => pts.reduce((best, p) =>
    Math.abs(p.threshold - t) < Math.abs(best.threshold - t) ? p : best, pts[0]!);
  const annotated = [...new Map(
    [pts[pts.length - 1]!, nearest(1000), nearest(250), nearest(100)].map((p) => [p.threshold, p]),
  ).values()];

  return (
    <svg ref={wrap} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
         aria-label={`Fan-out curve. At threshold ${cur.threshold}, ${cur.qualifying_agents} agents qualify.`}>
      {yTicks.map((v) => (
        <line key={v} x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)}
              stroke="var(--border)" strokeWidth="1" shapeRendering="crispEdges" />
      ))}
      {yTicks.map((v) => (
        <text key={v} x={PAD_L - 8} y={y(v) + 3} textAnchor="end"
              style={{ font: "400 9px var(--mono)", fill: 'var(--text-faint)' }}>
          {v.toLocaleString('en-GB')}
        </text>
      ))}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle"
              style={{ font: "400 9px var(--mono)", fill: 'var(--text-faint)' }}>{t}</text>
      ))}
      <text x={PAD_L} y={10} textAnchor="start"
            style={{ font: "400 9px var(--mono)", fill: 'var(--text-faint)' }}>agents (log)</text>
      <text x={W - PAD_R} y={10} textAnchor="end"
            style={{ font: "400 9px var(--mono)", fill: 'var(--text-faint)' }}>fan-out (log)</text>

      <path className={armed ? 'curve-area' : undefined} d={area} fill="var(--live)" fillOpacity="0.10" stroke="none" />
      <path ref={lineRef} className={armed ? 'curve-line' : undefined} d={path} fill="none" stroke="var(--live-dim)" strokeWidth="1.5" />
      {pts.map((p) => (
        <rect className={armed ? 'curve-dot' : undefined} key={p.threshold} x={x(p.threshold) - 1.5} y={y(p.qualifying_agents) - 1.5}
              width="3" height="3" fill="var(--live)" shapeRendering="crispEdges" />
      ))}

      {/* The finding, stated on the chart: four labelled points so the collapse
          reads without touching the slider. */}
      <g className={armed ? 'curve-reveal' : undefined}>
        {annotated.map((p) => {
          const px = x(p.threshold), py = y(p.qualifying_agents);
          const flip = px > W - 90;
          // The maximum sits exactly on the top gridline, where a label above the
          // point would run into the axis band; drop that one below its dot.
          const ty = py < PAD_T + 12 ? py + 11 : py - 5;
          return (
            <g key={`ann-${p.threshold}`}>
              <circle cx={px} cy={py} r="2.5" fill="none" stroke="var(--live)" strokeWidth="1" />
              {/* The curve passes through these labels near the top right, where
                  there is no free space to move them to. A --bg halo painted
                  under the glyphs keeps them readable without adding boxes. */}
              <text x={flip ? px - 9 : px + 9} y={ty} textAnchor={flip ? 'end' : 'start'}
                    stroke="var(--bg)" strokeWidth="3" paintOrder="stroke"
                    style={{ font: "500 9px var(--mono)", fill: 'var(--text-muted)' }}>
                {p.qualifying_agents.toLocaleString('en-GB')}
              </text>
            </g>
          );
        })}
      </g>

      {/* Position marker: --text, filled dot, no accent (accent means selected
          or first-party in the reference, neither of which applies here). */}
      <g className={armed ? 'curve-reveal' : undefined}>
        <line x1={x(cur.threshold)} x2={x(cur.threshold)} y1={PAD_T} y2={H - PAD_B}
              stroke="var(--text)" strokeWidth="1" shapeRendering="crispEdges" />
        <circle cx={x(cur.threshold)} cy={y(cur.qualifying_agents)} r="3.5" fill="var(--text)" />
      </g>

      {/* Hover readout. ONE overlay that resolves the nearest breakpoint from the
          pointer, not one hit target per point: on a log x-axis the breakpoints
          are 4.8px apart at the dense end (96 and 102), so per-point rects
          overlap and the later one swallows its neighbour. No library, no layout
          shift, and the slider is untouched by it. */}
      <rect x={PAD_L} y={PAD_T} width={W - PAD_L - PAD_R} height={H - PAD_T - PAD_B}
            fill="transparent" style={{ cursor: 'crosshair' }}
            onMouseMove={(e) => {
              const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
              if (!box?.width) return;
              // viewBox is uniform-scaled to the rendered width, so x maps linearly.
              const vx = ((e.clientX - box.left) / box.width) * W;
              setHover(pts.reduce((best, p) =>
                Math.abs(x(p.threshold) - vx) < Math.abs(x(best.threshold) - vx) ? p : best, pts[0]!));
            }}
            onMouseLeave={() => setHover(null)} />
      {hover && (() => {
        const px = x(hover.threshold), py = y(hover.qualifying_agents);
        const label = `${hover.threshold === 0 ? 'none' : '≤ ' + hover.threshold.toLocaleString('en-GB')} · ${hover.qualifying_agents.toLocaleString('en-GB')} agents`;
        const wBox = label.length * 5.4 + 12;
        const bx = Math.min(Math.max(px - wBox / 2, PAD_L), W - PAD_R - wBox);
        const by = Math.max(py - 26, PAD_T);
        return (
          <g pointerEvents="none">
            <circle cx={px} cy={py} r="3" fill="var(--live)" />
            <rect x={bx} y={by} width={wBox} height="17" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="1" />
            <text x={bx + wBox / 2} y={by + 12} textAnchor="middle"
                  style={{ font: "400 9px var(--mono)", fill: 'var(--text)' }}>{label}</text>
          </g>
        );
      })()}
    </svg>
  );
}
