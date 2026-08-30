'use client';
/**
 * The 31-row fan-out curve, log x.
 *
 * Two features of the data must stay visible, per the brief:
 *   - the 16 -> 96 gap on x (no client has fan-out between them)
 *   - the 924 -> 1800 cliff on y (1,566 -> 4,353 agents: two addresses)
 *     Those endpoints track agent_fanout_curve; the SHAPE is what matters here,
 *     and it has held across re-sweeps (same max, same cliff).
 * A log x-axis keeps the dense 1..16 head readable while still showing the
 * long tail; the cliff is a vertical jump and shows regardless.
 *
 * threshold 0 is the sentinel (0 agents). log(0) is undefined, so it is pinned
 * to the left edge rather than fed to the scale.
 */
import { useEffect, useRef, useState } from 'react';
import type { CurvePoint } from '@/lib/queries';
import { prefersReducedMotion } from '@/lib/motion';

const W = 640, H = 200, PAD_L = 46, PAD_R = 12, PAD_T = 12, PAD_B = 26;

export function FanoutCurve({ curve, index, onRevealed }: {
  curve: CurvePoint[]; index: number; onRevealed?: () => void;
}) {
  // (b) Draw left to right on FIRST view only, then fade the area in.
  // Reduced motion: `armed` stays false, no animation classes are applied, and
  // the static path renders complete.
  const wrap = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const [armed, setArmed] = useState(false);
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
  const y = (v: number) => H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.threshold).toFixed(1)},${y(p.qualifying_agents).toFixed(1)}`).join('');
  // Same path, closed to the baseline. The cliff between 924 and 1800 is a
  // jump of ~2,800 agents (see agent_fanout_curve); as a line it reads as a stroke, as an
  // area it reads as the mass it actually is.
  const area = `${path}L${x(pts[pts.length - 1]!.threshold).toFixed(1)},${(H - PAD_B).toFixed(1)}L${x(pts[0]!.threshold).toFixed(1)},${(H - PAD_B).toFixed(1)}Z`;
  const cur = pts[Math.max(0, Math.min(index, pts.length - 1))]!;
  const ticks = [1, 10, 100, 1000];

  return (
    <svg ref={wrap} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
         aria-label={`Fan-out curve. At threshold ${cur.threshold}, ${cur.qualifying_agents} agents qualify.`}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PAD_L} x2={W - PAD_R} y1={y(maxY * f)} y2={y(maxY * f)}
              stroke="var(--border)" strokeWidth="1" shapeRendering="crispEdges" />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={PAD_L - 8} y={y(maxY * f) + 3} textAnchor="end"
              style={{ font: "400 9px var(--mono)", fill: 'var(--text-faint)' }}>
          {Math.round(maxY * f).toLocaleString('en-GB')}
        </text>
      ))}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle"
              style={{ font: "400 9px var(--mono)", fill: 'var(--text-faint)' }}>{t}</text>
      ))}

      <path className={armed ? 'curve-area' : undefined} d={area} fill="var(--live)" fillOpacity="0.10" stroke="none" />
      <path ref={lineRef} className={armed ? 'curve-line' : undefined} d={path} fill="none" stroke="var(--live-dim)" strokeWidth="1.5" />
      {pts.map((p) => (
        <rect className={armed ? 'curve-dot' : undefined} key={p.threshold} x={x(p.threshold) - 1.5} y={y(p.qualifying_agents) - 1.5}
              width="3" height="3" fill="var(--live)" shapeRendering="crispEdges" />
      ))}

      {/* Position marker: --text, filled dot, no accent (accent means selected
          or first-party in the reference, neither of which applies here). */}
      <g className={armed ? 'curve-reveal' : undefined}>
        <line x1={x(cur.threshold)} x2={x(cur.threshold)} y1={PAD_T} y2={H - PAD_B}
              stroke="var(--text)" strokeWidth="1" shapeRendering="crispEdges" />
        <circle cx={x(cur.threshold)} cy={y(cur.qualifying_agents)} r="3.5" fill="var(--text)" />
      </g>
    </svg>
  );
}
