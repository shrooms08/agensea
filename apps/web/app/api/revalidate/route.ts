/**
 * POST /api/revalidate — on-demand ISR invalidation, to be hit after a sweep.
 *
 * Auth: Authorization: Bearer $REVALIDATE_SECRET, compared in constant time.
 * Without a configured secret the route refuses outright rather than defaulting
 * open.
 *
 * WHY THIS EXISTS: the Supabase project is on the FREE plan, which pauses after
 * 7 days of low activity. Static/ISR pages keep serving from Vercel's CDN even
 * while the database is paused — only revalidation fails, and Next serves the
 * last good render. A dynamically rendered page would 500 instead. So pages use
 * long-lived ISR and this route is the way to push a fresh sweep out promptly.
 */
import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PATHS = ['/', '/bazaar', '/agents', '/marketplace', '/compare',
  '/category/rebalancing', '/category/grid-trading',
  '/category/yield-optimisation', '/category/health-factor-monitoring'];

function authorised(header: string | null): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false;                       // fail closed
  const presented = header?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;         // length differs -> reject
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorised(req.headers.get('authorization'))) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }
  const url = new URL(req.url);
  const only = url.searchParams.get('path');
  const targets = only ? [only] : PATHS;
  // revalidatePath only: no cache tags are in use, and Next 16's revalidateTag
  // requires a cache profile argument we would have nothing meaningful to pass.
  for (const p of targets) revalidatePath(p);
  return Response.json({ ok: true, revalidated: targets, at: new Date().toISOString() });
}

export async function GET() {
  return Response.json({ ok: false, error: 'use POST with a bearer token' }, { status: 405 });
}
