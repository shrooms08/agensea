'use client';
/**
 * ParticleCreature — a 13x13 grid of glowing dots that leans toward the
 * cursor (center dots lead, edge dots trail) and wanders on its own when
 * idle. Written from scratch in the site's motion idiom: one canvas, one
 * rAF loop, CSS for gating. No libraries.
 *
 * Rendering: each dot is a pre-rendered radial glow sprite in --live green,
 * composited with globalCompositeOperation 'lighter' (the canvas analogue of
 * plus-lighter) over the transparent canvas on --bg.
 *
 * Discipline, same contract as the heroes:
 *  - <768px and prefers-reduced-motion: hidden by CSS pre-paint; the JS
 *    checks getComputedStyle rather than re-deriving the media queries.
 *  - IntersectionObserver cancels the rAF entirely while off-screen;
 *    visibilitychange cancels it while the tab is hidden. Both log the
 *    settled proof used by the mobile hero so suspension is verifiable
 *    from the console.
 */
import { useEffect, useRef } from 'react';

const N = 13;                    // dots per side
const SPACING = 26;              // px between dot centers (logical)
const PAD = 40;                  // canvas padding so glow + travel never clip
const SIZE = (N - 1) * SPACING + PAD * 2; // 352 logical px square
const CENTER = (N - 1) / 2;
const DMAX = Math.hypot(CENTER, CENTER);
const FOLLOW_RANGE = 240;        // px of cursor distance mapped to full lean
const LEAN_MAX = 22;             // px a fully-weighted dot displaces
const IDLE_AFTER = 2500;         // ms without pointer movement -> wander
const WANDER_A = 0.31, WANDER_B = 0.23; // rad/s Lissajous rates
const PULSE_MS = 1100;

export function ParticleCreature({ tag }: { tag: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    if (getComputedStyle(wrap).display === 'none') return; // mobile / reduced-motion

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Glow sprite: --live #39FF14 radial falloff, drawn once.
    const SPR = 64;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = SPR;
    const sctx = sprite.getContext('2d')!;
    const g = sctx.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2);
    g.addColorStop(0.0, 'rgba(57,255,20,0.95)');
    g.addColorStop(0.18, 'rgba(57,255,20,0.55)');
    g.addColorStop(0.5, 'rgba(57,255,20,0.12)');
    g.addColorStop(1.0, 'rgba(57,255,20,0)');
    sctx.fillStyle = g;
    sctx.beginPath();
    sctx.arc(SPR / 2, SPR / 2, SPR / 2, 0, Math.PI * 2);
    sctx.fill();

    // Per-dot state. weight: center-heavy falloff drives scale, opacity and
    // how far a dot leans; speed: center dots converge on the target faster,
    // which is what makes the follow read as staggered-from-center.
    type Dot = { x: number; y: number; w: number; speed: number; dx: number; dy: number };
    const dots: Dot[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const d = Math.hypot(i - CENTER, j - CENTER);
      const w = Math.pow(Math.max(0, 1 - d / (DMAX + 0.75)), 1.6);
      dots.push({
        x: PAD + i * SPACING, y: PAD + j * SPACING,
        w, speed: 0.16 / (1 + d * 0.5), dx: 0, dy: 0,
      });
    }

    let raf = 0, running = false, frames = 0;
    let last = performance.now();
    let lastMove = -Infinity;           // never moved -> starts in wander
    let cursorTx = 0, cursorTy = 0;     // unit lean direction * magnitude 0..1
    let idleBlend = 1;                  // 0 = cursor, 1 = wander
    let pulseStart = performance.now(); // load pulse fires immediately
    let wanderCycles = 0;

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const vx = e.clientX - cx, vy = e.clientY - cy;
      const len = Math.hypot(vx, vy) || 1;
      const mag = Math.min(1, len / FOLLOW_RANGE);
      cursorTx = (vx / len) * mag;
      cursorTy = (vy / len) * mag;
      lastMove = performance.now();
    };

    const tick = (now: number) => {
      const dt = Math.min(50, now - last); last = now;
      frames++;
      const step = dt / 16.667; // normalise lerps to 60fps units

      // Idle blend eases toward wander after IDLE_AFTER ms of stillness.
      const idle = now - lastMove > IDLE_AFTER;
      idleBlend += ((idle ? 1 : 0) - idleBlend) * 0.03 * step;

      // Wander target: slow Lissajous. One loop = one full period of the
      // slower axis; each completed loop triggers the soft pulse.
      const t = now / 1000;
      const cycle = Math.floor((t * WANDER_B) / (2 * Math.PI));
      if (idleBlend > 0.5 && cycle > wanderCycles) { wanderCycles = cycle; pulseStart = now; }
      else if (wanderCycles === 0) wanderCycles = cycle; // don't pulse on the first partial loop
      const wx = Math.sin(t * WANDER_A) * 0.6;
      const wy = Math.sin(t * WANDER_B + 1.1) * 0.6;

      const tx = (cursorTx * (1 - idleBlend) + wx * idleBlend) * LEAN_MAX;
      const ty = (cursorTy * (1 - idleBlend) + wy * idleBlend) * LEAN_MAX;

      // Soft pulse: half-sine scale envelope.
      const pu = (now - pulseStart) / PULSE_MS;
      const pulse = pu >= 0 && pu < 1 ? 1 + 0.22 * Math.sin(Math.PI * pu) : 1;

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalCompositeOperation = 'lighter';
      for (const dot of dots) {
        const k = 1 - Math.pow(1 - dot.speed, step);
        dot.dx += (tx * (0.35 + 0.65 * dot.w) - dot.dx) * k;
        dot.dy += (ty * (0.35 + 0.65 * dot.w) - dot.dy) * k;
        const s = (7 + 26 * dot.w) * pulse;         // sprite draw size, px
        ctx.globalAlpha = 0.16 + 0.84 * dot.w;
        ctx.drawImage(sprite, dot.x + dot.dx - s / 2, dot.y + dot.dy - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };

    // Suspension: both gates cancel the rAF outright — zero frames while
    // off-screen or hidden. The settled logs are the proof surface.
    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
      window.addEventListener('mousemove', onMove, { passive: true });
      console.info(`[creature:${tag}] running (frames so far: ${frames})`);
    };
    const stop = (why: string) => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      console.info(`[creature:${tag}] suspended (${why}) at frame ${frames}; rAF cancelled — no further frames`);
    };

    let onScreen = false;
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen && document.visibilityState === 'visible') start();
      else stop('off-screen');
    }, { rootMargin: '80px' });
    io.observe(wrap);

    const onVis = () => {
      if (document.visibilityState === 'hidden') stop('tab hidden');
      else if (onScreen) start();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stop('unmount');
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [tag]);

  return (
    <div ref={wrapRef} className="creature-wrap" aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE, display: 'block' }} />
    </div>
  );
}
