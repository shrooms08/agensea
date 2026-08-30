'use client';
/**
 * ParticleCreature — a 13x13 body of glowing dots that roams the full
 * viewport behind the page: fixed canvas, z-index -1, pointer-events
 * none — it can never intercept a click, hover, or the slider. It
 * wanders on a slow Lissajous path, eases toward the cursor while it
 * moves, and resumes wandering after ~2s idle. Used on the landing page
 * (low intensity, hero handoff) and the 404 page (brighter, no hero).
 *
 * The body is deliberately non-rigid:
 *  - the center is a slightly under-damped spring, so sharp target
 *    changes swing through a curve instead of pivoting;
 *  - dot targets stretch along the velocity vector proportional to
 *    speed (lead dots overshoot, trailing dots lag), clamped so it
 *    stays elastic rather than liquid, relaxing round when idle;
 *  - per-dot response falls off with an eased (smoothstep) curve from
 *    center to edge, so direction changes ripple through the body;
 *  - each dot carries a small unique sine wobble (hashed phase and
 *    frequency) so the formation shimmers instead of grid-locking.
 *
 * Written from scratch in the site's motion idiom: one canvas, one rAF
 * loop, CSS for gating. No libraries.
 *
 * Discipline, same contract as the heroes:
 *  - <768px and prefers-reduced-motion: hidden by CSS pre-paint; the JS
 *    checks getComputedStyle rather than re-deriving the media queries.
 *  - The rAF is cancelled outright while suspended (hero on screen /
 *    tab hidden), with the settled-log proof used by the mobile hero:
 *    the frame counter must not advance across suspension.
 */
import { useEffect, useRef } from 'react';

const N = 13;                    // dots per side
const SPACING = 26;              // px between dot centers at rest
const CENTER = (N - 1) / 2;
const DMAX = Math.hypot(CENTER, CENTER);
const IDLE_AFTER = 2000;         // ms without pointer movement -> wander
const ROAM_A = (2 * Math.PI) / 47, ROAM_B = (2 * Math.PI) / 31; // rad/s
const ROAM_MARGIN = 180;         // keep the wander path inside the edges
const PULSE_MS = 1100;
// Body spring (per-frame units at 60fps): ~2s travel period, damping
// ratio ~0.75 — a visible swing on sharp turns that settles in one arc.
const SPRING_K = 0.0028;
const SPRING_DAMP = 0.92;
// Velocity stretch: full elongation at ~18px/frame, never beyond 50%.
const STRETCH_PER_SPEED = 1 / 18;
const STRETCH_MAX = 0.5;

function makeSprite(): HTMLCanvasElement {
  // Glow sprite: --live #39FF14 radial falloff, drawn once, composited
  // 'lighter' (the canvas analogue of plus-lighter) over --bg.
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
  return sprite;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function ParticleCreature({ tag, intensity = 0.3 }: { tag: string; intensity?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    if (getComputedStyle(wrap).display === 'none') return; // mobile / reduced-motion

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sprite = makeSprite();

    let W = 0, H = 0;
    const sizeCanvas = () => {
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();

    type Dot = {
      ox: number; oy: number;   // rest offset from body center
      w: number;                // center-heavy weight: scale, opacity
      speed: number;            // per-frame response, eased center->edge
      wobA: number; wobFx: number; wobFy: number; wobPx: number; wobPy: number;
      x: number; y: number;
    };
    const dots: Dot[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const d = Math.hypot(i - CENTER, j - CENTER);
      const w = Math.pow(Math.max(0, 1 - d / (DMAX + 0.75)), 1.6);
      const nd = Math.min(1, d / DMAX);
      const ease = nd * nd * (3 - 2 * nd); // smoothstep: lag falls off eased, not linear
      const n = i * N + j;
      dots.push({
        ox: (i - CENTER) * SPACING, oy: (j - CENTER) * SPACING,
        w,
        speed: 0.34 - 0.28 * ease,
        wobA: 1.2 + 2.4 * (1 - w),          // edges shimmer more than the core
        wobFx: 0.4 + 0.6 * hash(n),          // Hz, unique per dot
        wobFy: 0.4 + 0.6 * hash(n + 500),
        wobPx: hash(n + 1000) * Math.PI * 2,
        wobPy: hash(n + 1500) * Math.PI * 2,
        x: 0, y: 0,
      });
    }

    let raf = 0, running = false, frames = 0;
    let last = performance.now();
    let lastMove = -Infinity;           // never moved -> starts in wander
    let pulseStart = performance.now(); // load pulse fires immediately
    let wanderCycles = -1;              // -1 = not seeded; no pulse on a partial first loop
    let idleBlend = 1;                  // 0 = cursor, 1 = wander
    let cx = 0, cy = 0, vx = 0, vy = 0; // body spring state
    let cursorX = 0, cursorY = 0;
    let ux = 1, uy = 0;                 // last travel direction (unit)
    let stretch = 0;                    // smoothed elongation 0..STRETCH_MAX
    let seeded = false;

    const onMove = (e: MouseEvent) => {
      cursorX = e.clientX; cursorY = e.clientY;
      lastMove = performance.now();
    };

    const tick = (now: number) => {
      const dt = Math.min(50, now - last); last = now;
      frames++;
      const step = dt / 16.667; // normalise to 60fps units
      const t = now / 1000;

      const idle = now - lastMove > IDLE_AFTER;
      idleBlend += ((idle ? 1 : 0) - idleBlend) * 0.03 * step;

      // One completed loop of the slower wander axis = one soft pulse.
      const cycle = Math.floor((t * ROAM_B) / (2 * Math.PI));
      if (wanderCycles === -1) wanderCycles = cycle;
      else if (idleBlend > 0.5 && cycle > wanderCycles) { wanderCycles = cycle; pulseStart = now; }
      const pu = (now - pulseStart) / PULSE_MS;
      const pulse = pu >= 0 && pu < 1 ? 1 + 0.22 * Math.sin(Math.PI * pu) : 1;

      // Target: wander path, or the cursor while it is live.
      const wanderX = W / 2 + (W / 2 - Math.min(ROAM_MARGIN, W / 4)) * Math.sin(t * ROAM_A + 0.7) * 0.9;
      const wanderY = H / 2 + (H / 2 - Math.min(ROAM_MARGIN, H / 4)) * Math.sin(t * ROAM_B + 2.1) * 0.82;
      const tx = cursorX * (1 - idleBlend) + wanderX * idleBlend;
      const ty = cursorY * (1 - idleBlend) + wanderY * idleBlend;
      if (!seeded) { cx = tx; cy = ty; }

      // Under-damped spring: sharp target changes swing through a curve
      // (momentum carries the body past the turn) instead of pivoting.
      vx += (tx - cx) * SPRING_K * step;
      vy += (ty - cy) * SPRING_K * step;
      const damp = Math.pow(SPRING_DAMP, step);
      vx *= damp; vy *= damp;
      cx += vx * step;
      cy += vy * step;

      // Velocity -> stretch axis and smoothed magnitude. Relaxes round at rest.
      const speed = Math.hypot(vx, vy);
      if (speed > 0.15) { ux = vx / speed; uy = vy / speed; }
      const targetStretch = Math.min(speed * STRETCH_PER_SPEED, 1) * STRETCH_MAX;
      stretch += (targetStretch - stretch) * 0.08 * step;

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const dot of dots) {
        // Elongate the formation along the travel axis: the projection of a
        // dot's rest offset onto the axis scales up, so lead dots overshoot
        // the center and trailing dots lag, clamped by STRETCH_MAX.
        const proj = dot.ox * ux + dot.oy * uy;
        const gx = cx + dot.ox + ux * proj * stretch
          + dot.wobA * Math.sin(t * dot.wobFx * Math.PI * 2 + dot.wobPx);
        const gy = cy + dot.oy + uy * proj * stretch
          + dot.wobA * Math.sin(t * dot.wobFy * Math.PI * 2 + dot.wobPy);
        if (!seeded) { dot.x = gx; dot.y = gy; } // first frame: materialise in place
        const k = 1 - Math.pow(1 - dot.speed, step);
        dot.x += (gx - dot.x) * k;
        dot.y += (gy - dot.y) * k;
        const s = (7 + 26 * dot.w) * pulse;
        ctx.globalAlpha = (0.16 + 0.84 * dot.w) * intensity;
        ctx.drawImage(sprite, dot.x - s / 2, dot.y - s / 2, s, s);
      }
      seeded = true;
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };

    // Suspension: every gate cancels the rAF outright — zero frames while
    // suspended. The settled logs are the proof surface.
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

    // The hero owns the first viewport where one exists (landing): while any
    // part of the hero region is on screen the layer is stopped AND faded
    // out; it fades in only once the hero has scrolled past. Pages without a
    // hero (404) run immediately.
    const cleanups: (() => void)[] = [];
    const hero = document.querySelector('.hero-region');
    let heroGone = !hero;
    let visible = document.visibilityState === 'visible';
    const decide = () => {
      if (heroGone && visible) { wrap.classList.add('is-on'); start(); }
      else { wrap.classList.remove('is-on'); stop(heroGone ? 'tab hidden' : 'hero on screen'); }
    };
    if (hero) {
      const io = new IntersectionObserver(([entry]) => { heroGone = !entry.isIntersecting; decide(); });
      io.observe(hero);
      cleanups.push(() => io.disconnect());
    }
    const onVis = () => { visible = document.visibilityState === 'visible'; decide(); };
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
    const onResize = () => { sizeCanvas(); };
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
    decide();

    return () => {
      stop('unmount');
      for (const c of cleanups) c();
    };
  }, [tag, intensity]);

  return (
    <div ref={wrapRef} className="creature-layer" aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
