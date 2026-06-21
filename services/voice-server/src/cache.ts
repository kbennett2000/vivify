// Cycle 12 — disk-persistent TTS cache. A synthesized phrase is deterministic for a given
// (text, voice), so the WHOLE `/tts` response payload is cached to disk keyed by a hash of
// the two. The first synthesis of a phrase pays full price and writes the result; every later
// request for the same text+voice is served from disk in tens of ms — no Wine, no SAPI4, no
// capture. The cache lives on a Docker named volume so it survives container rebuild/recreate.
//
// The cached bytes ARE the response body — `JSON.stringify({ audioWavBase64, mouthTimeline,
// format })` — so a hit reads the file and writes it to the socket verbatim (no parse, no
// re-stringify, no recompute). Failures are honest: a corrupt/unreadable entry is treated as a
// miss (synthesize), a write failure still returns the fresh response. The cache never breaks a
// request and never returns degraded audio. See docs/cycles/cycle-12-tts-cache.md + ADR-0024.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VoiceConfig } from '@vivify/types';

/**
 * Deterministic JSON: object keys sorted recursively, so `{speed,pitch}` and `{pitch,speed}`
 * serialize identically (same cache key) and the arbitrary `voice.raw` blob is handled. Arrays
 * keep order (it's semantic); primitives serialize as plain JSON.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined) // match JSON.stringify: undefined props are dropped
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

/**
 * Cache key for a (text, voice) pair: `sha256(text + '\x00' + stableStringify(voice))` → hex.
 * The NUL separator keeps text and the voice JSON from blurring into each other, and different
 * voices never collide (a phrase spoken by two voice configs is two entries).
 */
export function keyFor(text: string, voice: VoiceConfig | undefined): string {
  return createHash('sha256')
    .update(text, 'utf8')
    .update('\x00')
    .update(stableStringify(voice ?? {}), 'utf8')
    .digest('hex');
}

export interface TtsCacheOptions {
  /** Absolute path to the cache directory (created on init). */
  dir: string;
  /** Optional cap on the number of entries; oldest-by-mtime evicted on write. Unbounded if unset/≤0. */
  maxEntries?: number;
  /** Optional cap on total bytes on disk; oldest-by-mtime evicted on write. Unbounded if unset/≤0. */
  maxBytes?: number;
}

export interface CacheStats {
  entries: number;
  bytes: number;
}

// Unique-enough tmp suffix for atomic writes without Date.now()/Math.random() concerns; a
// process-local counter is sufficient since writes are serialized per key by the server mutex.
let tmpCounter = 0;

/**
 * Disk cache of full `/tts` response payloads, one `<key>.json` file per entry. Construct with a
 * directory; call `init()` once at startup (creates the dir, returns stats for logging). `get`
 * returns the raw stored bytes (or null on miss / unreadable). `set` writes atomically (tmp +
 * rename) so a concurrent `get` never reads a half-written file, then enforces optional caps.
 */
export class TtsCache {
  private readonly dir: string;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(opts: TtsCacheOptions) {
    this.dir = opts.dir;
    this.maxEntries = opts.maxEntries && opts.maxEntries > 0 ? opts.maxEntries : 0;
    this.maxBytes = opts.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : 0;
  }

  private fileFor(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  /** Create the cache dir and report how much is already on disk (for the startup `[cache]` log). */
  async init(): Promise<CacheStats> {
    await mkdir(this.dir, { recursive: true });
    return this.stats();
  }

  /** Count entries + total bytes by scanning the `*.json` files. */
  async stats(): Promise<CacheStats> {
    let entries = 0;
    let bytes = 0;
    for (const f of await this.listEntries()) {
      entries += 1;
      bytes += f.size;
    }
    return { entries, bytes };
  }

  /** Raw stored response bytes for a key, or null on a miss (ENOENT) or any read error. */
  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.fileFor(key));
    } catch {
      // ENOENT (miss) or a corrupt/unreadable entry — both are treated as a miss so the caller
      // synthesizes. A bad cache file can never poison a response.
      return null;
    }
  }

  /**
   * Write a response payload for a key. Atomic (tmp file + rename) so a concurrent reader never
   * sees a partial file. Best-effort: a write failure is swallowed (the caller still returns the
   * freshly-synthesized response) and surfaced via the returned promise rejection only if awaited.
   */
  async set(key: string, payload: string): Promise<void> {
    const finalPath = this.fileFor(key);
    tmpCounter += 1;
    const tmpPath = join(this.dir, `.${key}.${process.pid}.${tmpCounter}.tmp`);
    try {
      await writeFile(tmpPath, payload);
      await rename(tmpPath, finalPath);
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }
    if (this.maxEntries > 0 || this.maxBytes > 0) await this.enforceCaps();
  }

  /** List entry files with size + mtime (for stats + eviction). Ignores `.tmp` and non-json. */
  private async listEntries(): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: Array<{ path: string; size: number; mtimeMs: number }> = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue; // skip in-flight `.tmp` files
      const path = join(this.dir, name);
      try {
        const s = await stat(path);
        if (s.isFile()) out.push({ path, size: s.size, mtimeMs: s.mtimeMs });
      } catch {
        // raced unlink — ignore
      }
    }
    return out;
  }

  /**
   * Evict oldest-by-mtime entries until within both caps. Best-effort; unlink errors ignored.
   * Intentionally simple/unindexed — it re-`readdir`+`stat`s the whole dir per write — because the
   * DEFAULT is unbounded (caps off ⇒ this never runs). If huge caps + high write rates ever matter,
   * swap in an in-memory index; not worth the complexity for the "cache everything" default.
   */
  private async enforceCaps(): Promise<void> {
    const entries = await this.listEntries();
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    let count = entries.length;
    let bytes = entries.reduce((sum, e) => sum + e.size, 0);
    for (const e of entries) {
      const overEntries = this.maxEntries > 0 && count > this.maxEntries;
      const overBytes = this.maxBytes > 0 && bytes > this.maxBytes;
      if (!overEntries && !overBytes) break;
      await rm(e.path, { force: true }).catch(() => {});
      count -= 1;
      bytes -= e.size;
    }
  }
}
