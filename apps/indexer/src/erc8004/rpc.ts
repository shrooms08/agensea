// JSON-RPC transport for ALCHEMY_BSC. eth_call only - this phase never uses
// eth_getLogs. Rate limited, retried with exponential backoff, and it captures
// any Alchemy compute-unit headers the endpoint chooses to expose.
import process from 'node:process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../../..');
const ENV_PATH = resolve(REPO_ROOT, '.env');
if (!existsSync(ENV_PATH)) throw new Error(`FATAL: no .env at ${ENV_PATH}`);
process.loadEnvFile(ENV_PATH);

const URL_ = process.env.ALCHEMY_BSC?.trim();
if (!URL_) throw new Error('FATAL: ALCHEMY_BSC missing or empty in .env (value never printed)');
const ENDPOINT: string = URL_;

const RATE_MS = 200; // 5 req/s
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let lastAt = 0;
async function throttle() {
  const wait = RATE_MS - (Date.now() - lastAt);
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

export const stats = {
  requests: 0,
  retries: 0,
  /** last seen values of any compute-unit-ish response header */
  cuHeaders: {} as Record<string, string>,
};

const CU_HEADER_HINTS = ['compute', 'cu-', 'ratelimit', 'rate-limit', 'quota', 'alchemy'];

export function describeError(err: unknown): string {
  const parts: string[] = [err instanceof Error ? `${err.name}: ${err.message}` : String(err)];
  let cause: unknown = (err as { cause?: unknown })?.cause;
  for (let d = 0; cause && d < 4; d++) {
    const c = cause as { name?: string; code?: string; message?: string };
    parts.push(`caused by ${c.name ?? ''}${c.code ? ` [${c.code}]` : ''}: ${c.message ?? String(cause)}`);
    cause = (cause as { cause?: unknown })?.cause;
  }
  return parts.join(' <- ');
}

/**
 * eth_call with retry. Throws only after `attempts` failures; a JSON-RPC error
 * object in the response is returned to the caller rather than retried, since
 * a revert is data, not a transport failure.
 */
export async function ethCall(
  to: string,
  data: string,
  attempts = 5,
): Promise<{ result?: string; error?: { code: number; message: string } }> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    await throttle();
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      stats.requests++;

      for (const [k, v] of res.headers) {
        const lk = k.toLowerCase();
        if (CU_HEADER_HINTS.some((h) => lk.includes(h))) stats.cuHeaders[lk] = v;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const body = (await res.json()) as {
        result?: string;
        error?: { code: number; message: string };
      };
      return body;
    } catch (err) {
      lastErr = err;
      stats.retries++;
      if (i < attempts) await sleep(500 * 2 ** (i - 1));
    }
  }
  throw new Error(`eth_call failed after ${attempts} attempts: ${describeError(lastErr)}`);
}

/** Current head block number, used only to re-read the ceiling context. */
export async function blockNumber(): Promise<number> {
  await throttle();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(30_000),
  });
  stats.requests++;
  const b = (await res.json()) as { result?: string };
  return b.result ? parseInt(b.result, 16) : 0;
}
