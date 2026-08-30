'use client';
/**
 * ParticleCreature — a 13x13 grid of glowing dots. Two stages:
 *
 *  variant="stage" (404): contained canvas; the creature stays put and
 *  leans toward the cursor (center dots lead, edges trail), wandering
 *  in place when idle. Shipped and approved — behavior unchanged.
 *
 *  variant="layer" (landing): a fixed full-viewport canvas BEHIND the
 *  page (z-index -1, pointer-events none — it can never intercept a
 *  click, hover, or the slider). The creature roams the whole viewport
 *  on a slow Lissajous path, eases toward the cursor when it moves and
 *  resumes wandering after ~2s idle. Drawn at low intensity (alpha
 *  capped) so it never exceeds a subtle glow behind content, and it
 *  fades in only once the hero region has scrolled past — the two
 *  particle systems never run a frame together.
 *
 * Written from scratch in the site's motion idiom: one canvas, one rAF
 * loop, CSS for gating. No libraries.
 *
 * Discipline, same contract as the heroes:
 *  - <768px and prefers-reduced-motion: hidden by CSS pre-paint; the JS
 *    checks getComputedStyle rather than re-deriving the media queries.
 *  - The rAF is cancelled outright while suspended (off-screen / hero
 *    on screen / tab hidden), with the settled-log proof used by the
 *    mobile hero: the frame counter must not advance across suspension.
 */
import { useEffect, useRef } from 'react';

const N = 13;                    // dots per side
const SPACING = 26;              // px between dot centers (logical)
const PAD = 40;                  // stage canvas padding so glow never clips
const SIZE = (N - 1) * SPACING + PAD * 2; // 352 logical px square (stage)
const CENTER = (N - 1) / 2;
const DMAX = Math.hypot(CENTER, CENTER);
const FOLLOW_RANGE = 240;        // stage: px of cursor distance mapped to full lean
const LEAN_MAX = 22;             // stage: px a fully-weighted dot displaces
const IDLE_AFTER_STAGE = 2500;   // ms without pointer movement -> wander
const IDLE_AFTER_LAYER = 2000;
const WANDER_A = 0.31, WANDER_B = 0.23; // stage Lissajous rates, rad/s
const ROAM_A = (2 * Math.PI) / 47, ROAM_B = (2 * Math.PI) / 31; // layer, rad/s
const ROAM_MARGIN = 180;         // layer: keep the body this far inside the edges
const PULSE_MS = 1100;
const LAYER_INTENSITY = 0.3;     // layer alpha cap — subtle glow, content wins

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

// Center-heavy weight drives scale, opacity and follow strength; the
// per-ring speed gradient is what makes motion read as staggered-from-center.
function gridWeights() {
  const out: { i: number; j: number; d: number; w: number }[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const d = Math.hypot(i - CENTER, j - CENTER);
    out.push({ i, j, d, w: Math.pow(Math.max(0, 1 - d / (DMAX + 0.75)), 1.6) });
  }
  return out;
}

export function ParticleCreature({ tag, variant = 'stage' }: { tag: string; variant?: 'stage' | 'layer' }) {
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

    let W = SIZE, H = SIZE;
    const sizeCanvas = () => {
      W = variant === 'layer' ? window.innerWidth : SIZE;
      H = variant === 'layer' ? window.innerHeight : SIZE;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();

    const IDLE_AFTER = variant === 'layer' ? IDLE_AFTER_LAYER : IDLE_AFTER_STAGE;
    const intensity = variant === 'layer' ? LAYER_INTENSITY : 1;

    type Dot = { ox: number; oy: number; w: number; speed: number; x: number; y: number };
    const dots: Dot[] = gridWeights().map(({ i, j, d, w }) => ({
      ox: (i - CENTER) * SPACING, oy: (j - CENTER) * SPACING,
      w,
      speed: variant === 'layer' ? 0.22 / (1 + d * 0.45) : 0.16 / (1 + d * 0.5),
      x: 0, y: 0,
    }));

    let raf = 0, running = false, frames = 0;
    let last = performance.now();
    let lastMove = -Infinity;           // never moved -> starts in wander
    let pulseStart = performance.now(); // load pulse fires immediately
    let wanderCycles = -1;              // -1 = not seeded; no pulse on a partial first loop
    let idleBlend = 1;                  // 0 = cursor, 1 = wander

    // Stage state: lean direction. Layer state: creature center + cursor pos.
    let leanTx = 0, leanTy = 0;
    let cx = W / 2, cy = H / 2;
    let cursorX = W / 2, cursorY = H / 2;
    let seeded = false;

    const onMove = (e: MouseEvent) => {
      if (variant === 'layer') {
        cursorX = e.clientX; cursorY = e.clientY;
      } else {
        const r = canvas.getBoundingClientRect();
        const vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
        const len = Math.hypot(vx, vy) || 1;
        const mag = Math.min(1, len / FOLLOW_RANGE);
        leanTx = (vx / len) * mag; leanTy = (vy / len) * mag;
      }
      lastMove = performance.now();
    };

    const tick = (now: number) => {
      const dt = Math.min(50, now - last); last = now;
      frames++;
      const step = dt / 16.667; // normalise lerps to 60fps units
      const t = now / 1000;

      const idle = now - lastMove > IDLE_AFTER;
      idleBlend += ((idle ? 1 : 0) - idleBlend) * 0.03 * step;

      // One completed loop of the slower wander axis = one soft pulse.
      const rate = variant === 'layer' ? ROAM_B : WANDER_B;
      const cycle = Math.floor((t * rate) / (2 * Math.PI));
      if (wanderCycles === -1) wanderCycles = cycle;
      else if (idleBlend > 0.5 && cycle > wanderCycles) { wanderCycles = cycle; pulseStart = now; }
      const pu = (now - pulseStart) / PULSE_MS;
      const pulse = pu >= 0 && pu < 1 ? 1 + 0.22 * Math.sin(Math.PI * pu) : 1;

      // Body center (both variants) and lean vector (stage only).
      let bx: number, by: number, leanX = 0, leanY = 0;
      if (variant === 'layer') {
        // Roam the whole viewport; ease toward the cursor while it is live.
        const wanderX = W / 2 + (W / 2 - Math.min(ROAM_MARGIN, W / 4)) * Math.sin(t * ROAM_A + 0.7) * 0.9;
        const wanderY = H / 2 + (H / 2 - Math.min(ROAM_MARGIN, H / 4)) * Math.sin(t * ROAM_B + 2.1) * 0.82;
        const tx = cursorX * (1 - idleBlend) + wanderX * idleBlend;
        const ty = cursorY * (1 - idleBlend) + wanderY * idleBlend;
        if (!seeded) { cx = tx; cy = ty; }
        const k = 1 - Math.pow(1 - 0.045, step);
        cx += (tx - cx) * k;
        cy += (ty - cy) * k;
        bx = cx; by = cy;
      } else {
        bx = SIZE / 2; by = SIZE / 2;
        const wx = Math.sin(t * WANDER_A) * 0.6;
        const wy = Math.sin(t * WANDER_B + 1.1) * 0.6;
        leanX = (leanTx * (1 - idleBlend) + wx * idleBlend) * LEAN_MAX;
        leanY = (leanTy * (1 - idleBlend) + wy * idleBlend) * LEAN_MAX;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const dot of dots) {
        const gx = bx + dot.ox + leanX * (0.35 + 0.65 * dot.w);
        const gy = by + dot.oy + leanY * (0.35 + 0.65 * dot.w);
        if (!seeded) { dot.x = gx; dot.y = gy; } // first frame: materialise in place, no fly-in
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

    const cleanups: (() => void)[] = [];

    if (variant === 'layer') {
      // The hero owns the first viewport. While any part of the hero region
      // is on screen the layer is stopped AND faded out; it fades in only
      // after the hero has scrolled past. If no hero exists, run at once.
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
    } else {
      let onScreen = false;
      const io = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen && document.visibilityState === 'visible') start();
        else stop('off-screen');
      }, { rootMargin: '80px' });
      io.observe(wrap);
      cleanups.push(() => io.disconnect());
      const onVis = () => {
        if (document.visibilityState === 'hidden') stop('tab hidden');
        else if (onScreen) start();
      };
      document.addEventListener('visibilitychange', onVis);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
    }

    return () => {
      stop('unmount');
      for (const c of cleanups) c();
    };
  }, [tag, variant]);

  if (variant === 'layer') {
    return (
      <div ref={wrapRef} className="creature-layer" aria-hidden="true">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    );
  }
  return (
    <div ref={wrapRef} className="creature-wrap" aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE, display: 'block' }} />
    </div>
  );
}
