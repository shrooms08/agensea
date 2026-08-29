/**
 * Shared state with read-modify-write under an exclusive file lock.
 *
 * Phase 3a bug: step5_settle loaded state at start and wrote it at the end,
 * clobbering step6_fixture's concurrent writes (two tx hashes were lost).
 * Phase 3b runs three agents concurrently, so every write now re-reads under a
 * lock, merges, and writes atomically via rename.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const SECRETS = resolve(ROOT, '.secrets');
const FILE = resolve(SECRETS, 'phase3a.json');
const LOCK = FILE + '.lock';
mkdirSync(SECRETS, { recursive: true, mode: 0o700 });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withLock<T>(fn: () => T): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');           // atomic create-or-fail
      closeSync(fd);
      try { return fn(); } finally { try { unlinkSync(LOCK); } catch { /* already gone */ } }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (Date.now() > deadline) {
        // Stale lock from a killed process: break it rather than hang forever.
        try { unlinkSync(LOCK); } catch { /* raced */ }
        continue;
      }
      await sleep(50 + Math.floor(Math.random() * 100));
    }
  }
}

export function readState(): Record<string, any> {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
}

/** Re-read under lock, apply `patch` to the CURRENT contents, write atomically. */
export async function updateState(patch: Record<string, any>): Promise<Record<string, any>> {
  return withLock(() => {
    const cur = readState();
    const next = { ...cur, ...patch };
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, FILE);                        // atomic replace
    return next;
  });
}

/** Nested merge for per-agent sub-objects, e.g. updateAgent('agent2', {...}). */
export async function updateAgent(key: string, patch: Record<string, any>): Promise<void> {
  await withLock(() => {
    const cur = readState();
    const next = { ...cur, [key]: { ...(cur[key] ?? {}), ...patch } };
    const tmp = FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, FILE);
  });
}

/** Legacy shim so Phase 3a scripts keep working. */
export const state: Record<string, any> = readState();
export const save = () => { void updateState(state); };
