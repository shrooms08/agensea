// Loads the repo-root .env and hands back a Supabase client.
// Secrets are read, never logged: this module deliberately exposes no getter
// that returns the key, so no caller can print it by accident.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
// src -> indexer -> apps -> repo root
export const REPO_ROOT = resolve(HERE, '../../..');
const ENV_PATH = resolve(REPO_ROOT, '.env');

if (!existsSync(ENV_PATH)) {
  throw new Error(`FATAL: no .env at ${ENV_PATH}. Expected SUPABASE_URL and SUPABASE_SERVICE_KEY.`);
}
// Node >=20.12 built-in; avoids a dotenv dependency.
process.loadEnvFile(ENV_PATH);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(
      `FATAL: ${name} is missing or empty in ${ENV_PATH}. ` +
        `Populate it and re-run. (Value is never printed.)`,
    );
  }
  return v.trim();
}

export function supabase(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Safe to log: the project ref is in the hostname, the key never appears.
export function describeTarget(): string {
  const url = requireEnv('SUPABASE_URL');
  try {
    return new URL(url).host;
  } catch {
    return '<unparseable SUPABASE_URL>';
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Unwrap a `TypeError: fetch failed` into its underlying cause chain. */
export function describeError(err: unknown): string {
  const parts: string[] = [err instanceof Error ? `${err.name}: ${err.message}` : String(err)];
  let cause: unknown = (err as { cause?: unknown })?.cause;
  for (let depth = 0; cause && depth < 4; depth++) {
    const c = cause as { name?: string; code?: string; message?: string };
    parts.push(`caused by ${c.name ?? ''}${c.code ? ` [${c.code}]` : ''}: ${c.message ?? String(cause)}`);
    cause = (cause as { cause?: unknown })?.cause;
  }
  return parts.join(' <- ');
}

/**
 * Transport failures that surface as a RETURNED error rather than a throw.
 * supabase-js does both depending on the call, so retrying only on `throw`
 * silently misses half of them - which is exactly how the first Pass 1 run
 * died on its 4th batch with "advance cursor failed: TypeError: fetch failed".
 * A genuine PostgREST rejection (unique violation, bad column) carries a
 * `code` and must NOT be retried.
 */
const TRANSIENT = /fetch failed|network|ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT|EAI_AGAIN|terminated|aborted|timeout/i;

export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: string; code?: string };
  if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return false; // real SQLSTATE
  return TRANSIENT.test(e.message ?? '');
}

/**
 * Retry a Supabase call on transport failure, whether it throws OR returns a
 * transport-shaped `{ error }`. Writes are idempotent by construction (upsert
 * on the primary key, accepts replaced per resource, cursor advanced only
 * after a confirmed write), so replaying a partially-landed request is safe.
 */
export async function withRetry<T>(label: string, fn: () => PromiseLike<T>, attempts = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fn();
      const returned = (res as { error?: unknown } | null)?.error;
      if (returned && isTransientDbError(returned)) {
        // Convert to a throw so the one retry path below handles both cases.
        throw Object.assign(new Error((returned as { message?: string }).message ?? 'transient db error'), {
          cause: returned,
        });
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const backoff = Math.min(16000, 500 * 2 ** (i - 1)) + Math.floor(Math.random() * 250);
        process.stderr.write(`  retry ${i}/${attempts - 1} ${label}: ${describeError(err)} (waiting ${backoff}ms)\n`);
        await sleep(backoff);
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${describeError(lastErr)}`);
}
