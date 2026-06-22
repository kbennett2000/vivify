// Cycle 12 acceptance (docs/cycles/cycle-12-tts-cache.md → CI bullet): the disk-persistent TTS
// cache (src/cache.ts). These drive the real module against real temp directories (no mocks):
// keys hash by (text, voice) and differ by voice; set→get round-trips the exact stored bytes; an
// absent key is a miss; a FRESH cache instance over the same dir reads a prior entry (this is the
// container-restart / Docker-volume persistence contract); and optional caps evict oldest-first.

import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TtsCache, keyFor, stableStringify } from '../src/cache.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('keyFor / stableStringify (cache key by text + voice)', () => {
  it('is stable for the same (text, voice)', () => {
    const a = keyFor('hello world', { speed: 157, pitch: 100 });
    const b = keyFor('hello world', { speed: 157, pitch: 100 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('differs by text', () => {
    expect(keyFor('one', {})).not.toBe(keyFor('two', {}));
  });

  it('differs by voice (no collision across voice configs)', () => {
    const text = 'same phrase, different voices';
    expect(keyFor(text, { engineModeId: 'GENIE' })).not.toBe(
      keyFor(text, { engineModeId: 'ROBBY' }),
    );
    expect(keyFor(text, { speed: 100 })).not.toBe(keyFor(text, { speed: 200 }));
  });

  it('treats undefined voice and {} the same', () => {
    expect(keyFor('x', undefined)).toBe(keyFor('x', {}));
  });

  it('is independent of voice key ORDER (stableStringify sorts keys)', () => {
    expect(keyFor('x', { speed: 1, pitch: 2 })).toBe(keyFor('x', { pitch: 2, speed: 1 }));
    // and the raw blob is handled recursively
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  });

  it('does not blur text into the voice JSON (NUL-separated)', () => {
    // Without a separator, ("a", {"x":1}) and ("a{\"x\":1}", {}) could collide. They must not.
    expect(keyFor('a', { x: 1 } as never)).not.toBe(keyFor('a{"x":1}', {}));
  });
});

describe('TtsCache (disk round-trip, miss, persistence, caps)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vivify-cache-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('init() creates the dir and reports zero entries when empty', async () => {
    const cache = new TtsCache({ dir: join(dir, 'nested', 'cache') });
    const stats = await cache.init();
    expect(stats).toEqual({ entries: 0, bytes: 0 });
  });

  it('set() then get() round-trips the EXACT stored bytes', async () => {
    const cache = new TtsCache({ dir });
    await cache.init();
    const key = keyFor('round trip', { speed: 120 });
    const payload = JSON.stringify({
      audioWavBase64: 'UklGRg==',
      mouthTimeline: [],
      format: 'wav',
    });

    expect(await cache.get(key)).toBeNull(); // miss before write
    await cache.set(key, payload);
    const got = await cache.get(key);
    expect(got).not.toBeNull();
    expect(got!.toString('utf8')).toBe(payload);
  });

  it('get() of an absent key is a miss (null), never throws', async () => {
    const cache = new TtsCache({ dir });
    await cache.init();
    expect(await cache.get(keyFor('never written', {}))).toBeNull();
  });

  it('stats() counts entries + bytes after writes', async () => {
    const cache = new TtsCache({ dir });
    await cache.init();
    await cache.set(keyFor('a', {}), 'AAAA');
    await cache.set(keyFor('b', {}), 'BBBBBB');
    const stats = await cache.stats();
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBe(10); // 4 + 6 bytes
  });

  it('persists across a FRESH instance over the same dir (container-restart / volume contract)', async () => {
    const key = keyFor('survives restart', { engineModeId: 'GENIE' });
    const payload = JSON.stringify({
      audioWavBase64: 'AAAA',
      mouthTimeline: [{ timeMs: 0, shape: 0 }],
      format: 'wav',
    });

    // Writer "instance #1" persists the entry, then goes away.
    const writer = new TtsCache({ dir });
    await writer.init();
    await writer.set(key, payload);

    // A brand-new instance (simulating the server rebooting over the same Docker volume) sees it.
    const reader = new TtsCache({ dir });
    const stats = await reader.init();
    expect(stats.entries).toBe(1);
    const got = await reader.get(key);
    expect(got!.toString('utf8')).toBe(payload);
  });

  it('evicts oldest-by-mtime when maxEntries is exceeded', async () => {
    const cache = new TtsCache({ dir, maxEntries: 2 });
    await cache.init();
    const k1 = keyFor('first', {});
    const k2 = keyFor('second', {});
    const k3 = keyFor('third', {});

    await cache.set(k1, 'one');
    await delay(10); // distinct mtimes so "oldest" is unambiguous
    await cache.set(k2, 'two');
    await delay(10);
    await cache.set(k3, 'three'); // now 3 > maxEntries(2) → oldest (k1) evicted

    expect(await cache.get(k1)).toBeNull(); // evicted
    expect((await cache.get(k2))!.toString()).toBe('two');
    expect((await cache.get(k3))!.toString()).toBe('three');
    expect((await cache.stats()).entries).toBe(2);
  });

  it('leaves no .tmp files behind after a successful write (atomic rename)', async () => {
    const cache = new TtsCache({ dir });
    await cache.init();
    await cache.set(keyFor('atomic', {}), 'payload');
    const names = await readdir(dir);
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false);
    expect(names.filter((n) => n.endsWith('.json')).length).toBe(1);
  });
});
