'use client';
/**
 * (a) Stat values count 0 -> final on FIRST scroll into view.
 *
 * Fires once and disconnects the observer; there is no path that re-triggers.
 * Under prefers-reduced-motion the final value is rendered immediately — the
 * static output is the fallback, never a hidden element waiting on an
 * animation that will not run.
 *
 * tabular-nums via .num/.tnum so the width does not jitter as digits change.
 * measured_at is not passed through here and never animates.
 */
import { useRef, useState } from 'react';
import { prefersReducedMotion, easeOut, useIsoLayoutEffect } from '@/lib/motion';
import { int } from '@/lib/format';

const DURATION = 800;

/**
 * NOTE: no `format` function prop. Stat is a server component, and a function
 * cannot cross the server/client boundary — passing one 500s the page. The
 * formatting lives here instead.
 */
export function CountUp({ value, className, style }: {
  value: number; className?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);   // SSR + reduced motion: final value
  const done = useRef(false);

  useIsoLayoutEffect(() => {
    if (done.current) return;
    if (prefersReducedMotion()) { done.current = true; setShown(value); return; }
    const el = ref.current;
    if (!el) return;

    setShown(0);
    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e?.isIntersecting || done.current) return;
      done.current = true;
      io.disconnect();                       // once. never re-triggers.
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / DURATION);
        setShown(value * easeOut(p));
        if (p < 1) requestAnimationFrame(step);
        else setShown(value);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [value]);

  return <span ref={ref} className={className} style={style}>{int(Math.round(shown))}</span>;
}
