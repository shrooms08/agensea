/** Single source of truth for whether motion is allowed. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true; // SSR: assume static
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** useLayoutEffect on the client, useEffect on the server (which never runs it).
 *  Needed so a motion reset happens BEFORE paint — a plain useEffect lets the
 *  final value paint once and then jump back to 0, which reads as a flash. */
import { useEffect, useLayoutEffect } from 'react';
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
