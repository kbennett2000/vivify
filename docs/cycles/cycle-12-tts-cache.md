# Cycle 12 — disk-persistent TTS cache (every repeat is instant)

## Goal
Make a repeated phrase **free**. Cycle 11 cut a cold synthesis to its real floor (~3.3s of inherent
real-time playback), but that floor is paid **every** time — even for a line the engine spoke a moment
ago. This cycle caches the **full `/tts` response** to disk, keyed by `hash(text + voice)`, so:

1. **First synthesis of a phrase** pays full price (~3.3s) and writes the result to disk.
2. **Every later request for the same text+voice** is served from disk in **tens of ms** — no Wine, no
   SAPI4, no capture, no mutex queueing.

The cache lives on a **Docker named volume**, so it survives `docker compose down && up` (the host keeps
the entries). Scope: **`services/voice-server` only**. No `@vivify/core`/browser change. No latency, trim,
or warmup change from Cycle 11.

## Design

### Cache key — `hash(text + voice)`
`keyFor(text, voice) = sha256(text + '\x00' + stableStringify(voice ?? {}))` → hex (`src/cache.ts`).
`stableStringify` sorts object keys recursively, so `{speed,pitch}` and `{pitch,speed}` hash equal and the
arbitrary `voice.raw` blob is handled. **Different voices never collide** — a phrase spoken by two voice
configs is two entries (per spec).

### Cache value — the exact response payload, one file per entry
The cached bytes ARE the response body: `JSON.stringify({ audioWavBase64, mouthTimeline, format: 'wav' })`,
written to `<dir>/<key>.json`. A hit reads the file and writes it to the socket **verbatim** — no parse, no
re-stringify, no recompute. A hit needs **zero** synthesis-side work.

### Where the hit short-circuits (`src/server.ts`, `/tts` handler)
After request validation, **before** the `runExclusive` serialize mutex:
1. `key = keyFor(text, voice)`; `hit = await cache.get(key)`.
2. **Hit** → emit `[tts-timing] cache=HIT total=Nms (diskRead=…)`, `sendRawJson(res, 200, hit)`, return.
   Hits open no capture window, so they **don't queue behind an in-flight synthesis** — they're instant
   and concurrent.
3. **Miss** → synthesize under the mutex exactly as Cycle 11 does, then `cache.set(key, payload)`
   (best-effort) before responding. Inside the mutex, a **second `cache.get` re-check** guards against two
   identical requests racing the same cold key (the first fills it; the second now hits instead of
   re-synthesizing).

### Failure posture — honest, never degraded
- **Corrupt/unreadable cache file** → treated as a **miss** (logged), then synthesized normally. A bad
  cache entry can never poison a response.
- **Write failure** → logged; the freshly-synthesized response is still returned.
- The cache never breaks a request and never returns degraded/silent audio — consistent with the repo's
  honest-failure rule.

### Enabled by env, default OFF in code; unbounded by default
`cacheDir` is enabled only when configured — `opts.cacheDir` or `VIVIFY_CACHE_DIR`. The **code default is
unset**, so existing tests and `pnpm`-local dev are untouched. The **container** turns it on via a
Dockerfile `ENV VIVIFY_CACHE_DIR=/var/cache/vivify-tts`, so `docker compose up` needs **zero new steps**.
Caps are **unbounded by default**; optional via `VIVIFY_CACHE_MAX_ENTRIES` / `VIVIFY_CACHE_MAX_BYTES`
(when set, the oldest entries by mtime are evicted on write).

### Startup stats
On boot the server logs `[cache] N entries, M on disk` (from `TtsCache.init()` scanning `*.json`).

### Timing marker
`TtsTiming` gains `cache?: 'hit' | 'miss'` (+ hit-only `diskReadMs`). `formatTtsTiming` renders
`cache=HIT total=Nms (diskRead=Y, NB)` on a hit and appends `cache=miss` on a miss — the `[tts-timing]`
hit/miss marker, and the observable the server test asserts through `onTiming`.

## Bonus to confirm (not engineered) — a hit can't have the first-Speak clip
A cache HIT bypasses the live engine + capture path entirely, so the first-Speak cold-start clip (which
only afflicts live capture; Cycle 11) **cannot** occur on cached playback. We don't build anything for
this — the acceptance just confirms cached audio is clean.

## Docker
- **`docker-compose.yml`** — the `voice` service mounts a named volume
  `vivify-tts-cache:/var/cache/vivify-tts`, declared in a top-level `volumes:` block. Survives
  `compose down && up` (not `down -v`). No new steps for `docker compose up`.
- **`services/voice-server/Dockerfile`** — `VIVIFY_CACHE_DIR=/var/cache/vivify-tts` added to the runtime
  `ENV` block (the late layer, after `COPY dist/`). `TtsCache.init()` creates the dir; the volume mount
  provides the mountpoint, so no `mkdir` in the image.
- **Bare `docker run`** — add one flag: `-v vivify-tts-cache:/var/cache/vivify-tts`.

## What is verified where
- **CI (this repo, no Wine/PA):**
  - `test/cache.test.ts` — `keyFor` stable + **differs by voice**; `set`→`get` round-trips exact bytes;
    absent key → `null`; **persistence across restart** (a fresh `TtsCache` over the same dir reads a prior
    entry); cap eviction if configured.
  - `test/server.test.ts` — with an injected `cacheDir`: first `/tts` → `cache:'miss'` (synthesizes via the
    fake bridge); identical second `/tts` → `cache:'hit'`, body **byte-identical**, no bridge cost; a
    different voice → miss (separate key).
  - `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` green.
- **Operator (rebuild + Speak the same phrase twice):**
  - Startup logs `[cache] N entries, M on disk`.
  - First Speak of a phrase → `[tts-timing] … cache=miss …`, ~3.3s.
  - Second Speak of the **same** phrase → `[tts-timing] cache=HIT total≈tens-of-ms (diskRead=…)`,
    **near-instant**, audio **identical and clean** (no first-Speak clip on the cached path).
  - A different phrase → miss (full price), then instant on its own repeat.
  - **Persistence:** `docker compose down && docker compose up` → startup `[cache]` count reflects prior
    entries; the previously-cached phrase is still an instant hit.
  - **Build-cache caveat:** if the cache behavior looks absent after a plain rebuild, rebuild with
    `docker compose build --no-cache voice`. The named volume persists across rebuilds (data, not image) —
    intended; use `docker compose down -v` to wipe the cache.

## Non-goals / known limitations
No cache invalidation / TTL — a phrase's synthesis is deterministic for a given text+voice, so an entry
never goes stale. No size cap by default (user wants everything cached; caps are opt-in env knobs). No
trim/latency/warmup change (Cycle 11 stands). No `@vivify/core`/browser change. See ADR-0024.
