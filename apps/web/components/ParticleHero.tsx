'use client';
/**
 * Particle hero — scroll-scrubbed convergence into the canonical mark.
 *
 * A ~2.2-viewport scroll region. Several thousand particles drift loosely on
 * load; scroll progress through the region drives each particle from its
 * scatter position to a sampled point inside one of the 10 cells of
 * design/agensea-mark-left.svg. Pure function of scroll position — scrolling
 * up reverses identically. No timers, no play-once state.
 *
 * PERFORMANCE CONTRACT
 *  - one THREE.Points, one BufferGeometry, one draw call
 *  - the lerp runs in the vertex shader; JS touches ONE uniform per frame
 *  - the scroll path does no work at all: progress is read from
 *    window.scrollY inside the rAF loop that already runs for idle drift,
 *    so there is no scroll listener and nothing scroll-linked to jank
 *  - three.js is dynamically imported only after the fallback checks pass,
 *    so static/fallback visitors never download it
 *
 * FALLBACKS (checked before any WebGL work):
 *  prefers-reduced-motion, no WebGL, or viewport < 768px
 *   -> fallback="static": formed mark as SVG + wordmark + sub, normal height
 *   -> fallback="none":   render nothing (the landing page below already has
 *      its own hero, which IS the normal-height hero for those visitors)
 */
import { useEffect, useRef, useState } from 'react';
import { MARK_CELLS, MARK_ARTBOARD } from '@/lib/mark-cells';
import { Mark, Wordmark } from './Logo';

const PARTICLES = 8000;
const STRAGGLER_FRACTION = 0.10;
const REGION_VIEWPORTS = 2.2;

type Mode = 'pending' | 'canvas' | 'fallback';

function supportsWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** Sample N points uniformly from the filled area of the mark's cells.
 *  Uniform pixel sampling is proportional to cell area by construction. */
function sampleMark(n: number): Float32Array | null {
  const R = 384; // raster resolution of the 512 artboard
  const c = document.createElement('canvas');
  c.width = R; c.height = R;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const s = R / MARK_ARTBOARD;
  ctx.fillStyle = '#fff';
  for (const cell of MARK_CELLS) {
    ctx.beginPath();
    ctx.roundRect(cell.x * s, cell.y * s, cell.w * s, cell.h * s, cell.r * s);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, R, R).data;
  const filled: number[] = [];
  for (let i = 0; i < R * R; i++) if (img[i * 4 + 3]! > 128) filled.push(i);
  if (filled.length === 0) return null;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const px = filled[(Math.random() * filled.length) | 0]!;
    // artboard coords + sub-pixel jitter
    out[i * 2] = ((px % R) + Math.random()) / s;
    out[i * 2 + 1] = (Math.floor(px / R) + Math.random()) / s;
  }
  return out;
}

const VERT = /* glsl */ `
  attribute vec2 aTarget;
  attribute float aSeed;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aStraggler;
  uniform float uProgress;
  uniform float uTime;
  uniform float uDpr;
  varying float vAlpha;
  void main() {
    // Per-particle stagger: seeds delay onset by up to 0.22 of the scrub, so
    // cells knit rather than snap. Everything completes by uProgress = 1.
    float p = clamp((uProgress - aSeed * 0.22) / 0.78, 0.0, 1.0);
    p = p * p * (3.0 - 2.0 * p);              // smoothstep ease
    p *= (1.0 - aStraggler * 0.88);           // stragglers stay ~loose
    vec2 drift = vec2(
      sin(uTime * 0.35 + aSeed * 43.7) + sin(uTime * 0.13 + aSeed * 17.3),
      cos(uTime * 0.29 + aSeed * 31.1) + cos(uTime * 0.11 + aSeed * 23.9)
    ) * (5.0 + aSeed * 11.0);
    vec2 pos = mix(position.xy, aTarget, p) + drift * (1.0 - p * 0.94);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = aSize * uDpr;
    vAlpha = aAlpha * (0.72 + 0.28 * p);
  }
`;
const FRAG = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.24, d) * vAlpha;
    if (a < 0.012) discard;
    gl_FragColor = vec4(0.9608, 0.9608, 0.9608, a); /* --text #F5F5F5 */
  }
`;

export function ParticleHero({ caption, sub, fallback = 'none' }: {
  caption: string; sub: string; fallback?: 'none' | 'static';
}) {
  const [mode, setMode] = useState<Mode>('pending');
  const regionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mobile and reduced-motion are handled by CSS (display:none on
    // .hero-region, decided pre-paint — no layout shift). JS only needs to
    // catch the rare no-WebGL browser, and to check the CSS actually hid us
    // (getComputedStyle) rather than re-deriving the media queries.
    const el = regionRef.current;
    const hiddenByCss = el ? getComputedStyle(el).display === 'none' : true;
    setMode(hiddenByCss || !supportsWebGL() ? 'fallback' : 'canvas');
  }, []);

  useEffect(() => {
    if (mode !== 'canvas') return;
    let dead = false, raf = 0, cleanup: (() => void) | undefined;

    (async () => {
      const THREE = await import('three');           // lazy: fallback users never load it
      if (dead || !canvasRef.current || !regionRef.current) return;

      const canvas = canvasRef.current;
      const region = regionRef.current;
      const renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: false, powerPreference: 'high-performance',
      });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const scene = new THREE.Scene();
      let camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
      const uniforms = {
        uProgress: { value: 0 },
        uTime: { value: 0 },
        uDpr: { value: dpr },
      };
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms,
        transparent: true, depthWrite: false, depthTest: false,
      });
      let points: InstanceType<typeof THREE.Points> | null = null;
      let geometry: InstanceType<typeof THREE.BufferGeometry> | null = null;

      const build = () => {
        const w = window.innerWidth, h = window.innerHeight;
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        camera = new THREE.OrthographicCamera(0, w, 0, h, -10, 10); // y-down, px units
        const targets = sampleMark(PARTICLES);
        if (!targets) { setMode('fallback'); return; }

        // Mark placement: artboard centred (content centre == artboard centre).
        const markPx = Math.min(0.68 * h, 0.5 * w, 640);
        const ox = (w - markPx) / 2, oy = (h - markPx) / 2 - 0.02 * h;

        const scatter = new Float32Array(PARTICLES * 3);
        const target = new Float32Array(PARTICLES * 2);
        const seed = new Float32Array(PARTICLES);
        const size = new Float32Array(PARTICLES);
        const alpha = new Float32Array(PARTICLES);
        const strag = new Float32Array(PARTICLES);
        for (let i = 0; i < PARTICLES; i++) {
          scatter[i * 3] = (Math.random() * 1.3 - 0.15) * w;
          scatter[i * 3 + 1] = (Math.random() * 1.3 - 0.15) * h;
          scatter[i * 3 + 2] = 0;
          target[i * 2] = ox + (targets[i * 2]! / MARK_ARTBOARD) * markPx;
          target[i * 2 + 1] = oy + (targets[i * 2 + 1]! / MARK_ARTBOARD) * markPx;
          seed[i] = Math.random();
          const depth = Math.random();                       // depth variance
          size[i] = (1.1 + depth * 2.3) * (0.75 + 0.5 * Math.random());
          alpha[i] = 0.22 + depth * 0.7;
          strag[i] = Math.random() < STRAGGLER_FRACTION ? 1 : 0;
        }
        geometry?.dispose();
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(scatter, 3));
        geometry.setAttribute('aTarget', new THREE.BufferAttribute(target, 2));
        geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
        geometry.setAttribute('aStraggler', new THREE.BufferAttribute(strag, 1));
        if (points) scene.remove(points);
        points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        scene.add(points);
      };
      build();

      let resizeT = 0;
      const onResize = () => { clearTimeout(resizeT); resizeT = window.setTimeout(build, 250) as unknown as number; };
      window.addEventListener('resize', onResize);

      // Optional frame-time capture for the perf report (?perf=1).
      const perf = new URLSearchParams(location.search).has('perf');
      const frames: number[] = [];
      if (perf) (window as unknown as { __frames: number[] }).__frames = frames;
      let last = performance.now();

      const t0 = performance.now();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        if (perf) { frames.push(now - last); }
        last = now;

        const rect = region.getBoundingClientRect();
        // Fully below or above the viewport: skip rendering entirely.
        if (rect.bottom < -8 || rect.top > window.innerHeight + 8) return;

        const scrollable = rect.height - window.innerHeight;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 1;

        uniforms.uProgress.value = progress;           // the ONE scrub write
        uniforms.uTime.value = (now - t0) / 1000;

        if (captionRef.current) {
          captionRef.current.style.opacity = String(
            Math.min(1, progress * 9) * (1 - Math.min(1, Math.max(0, (progress - 0.88) / 0.1))));
        }
        if (revealRef.current) {
          const o = Math.min(1, Math.max(0, (progress - 0.85) / 0.11));
          revealRef.current.style.opacity = String(o);
          revealRef.current.style.transform = `translateY(${(1 - o) * 10}px)`;
        }
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(tick);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        geometry?.dispose(); material.dispose(); renderer.dispose();
      };
    })();

    return () => { dead = true; cleanup?.(); };
  }, [mode]);

  // no-WebGL (mode 'fallback' while the CSS left us visible): collapse the
  // region, optionally showing the static hero. Rare path; the one-off shift
  // is accepted for it.
  if (mode === 'fallback') {
    if (fallback === 'none') return <div ref={regionRef} className="hero-region" style={{ display: 'none' }} />;
    return (
      <section style={{ padding: '64px 0 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, textAlign: 'center' }}>
        <Mark size={180} />
        <Wordmark height={30} />
        <p className="prose prose-muted" style={{ maxWidth: 560 }}>{sub}</p>
      </section>
    );
  }

  return (
    <div ref={regionRef} className="hero-region">
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        <div ref={captionRef} style={{
          position: 'absolute', left: 0, right: 0, bottom: '9vh', textAlign: 'center', opacity: 0,
          font: "500 11px/1 var(--mono)", letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}>{caption}</div>
        <div ref={revealRef} style={{
          position: 'absolute', left: 0, right: 0, top: '76%', textAlign: 'center', opacity: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, pointerEvents: 'none',
        }}>
          <Wordmark height={26} />
          <p className="prose-sm prose-muted" style={{ maxWidth: 520, margin: '0 auto', fontSize: 14 }}>{sub}</p>
        </div>
      </div>
    </div>
  );
}
