# Cycle 15 — authentic voice in one `docker compose up`

## Goal
Make the authentic TruVoice voice run with a single `docker compose up` once the user has dropped in their
supplied files — **no host Node/pnpm, no manual `dist` build**. Before this cycle the voice image only
`COPY`'d a host-prebuilt `dist/`, so a user had to install Node 20 + pnpm, `pnpm install`, and run a
typecheck to emit `dist/` before building. This cycle moves that build **into the image**. Ports (MASH
8090 / voice 8080), the TTS cache, and its named volume are unchanged. Code cycle — the operator rebuilds
+ tests the full Wine path.

## The change

### 1. In-image `dist` build (multi-stage Dockerfile)
`services/voice-server/Dockerfile` gains a first stage that compiles the server itself, mirroring the
proven `apps/mash/Dockerfile`:

```dockerfile
FROM node:20-slim AS build
RUN corepack enable            # pnpm@9.15.0 (pinned in root package.json)
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @vivify/voice-server run build   # tsc --build → dist/
```

The runtime (Debian + Wine + SAPI4) stage then does `COPY --from=build
/repo/services/voice-server/dist /opt/vivify/dist/` instead of `COPY dist/`. A new
`"build": "tsc --build"` script in `services/voice-server/package.json` builds **only** the emit (the
`@vivify/types` project reference first, then the server) — not the test typecheck. `@vivify/types` imports
are type-only (all `import type`), so nothing from the workspace ships at runtime. The final image keeps
the Node **runtime** but **no pnpm / TypeScript toolchain** (those live only in the discarded build stage).

### 2. Build context → repo root
The build now needs the pnpm workspace (lockfile, `packages/types`), so `docker-compose.yml`'s `voice`
service switches to `build: { context: ., dockerfile: services/voice-server/Dockerfile }` — exactly how
`mash` builds. Every runtime-stage `COPY` source gets the `services/voice-server/` prefix (`vendor/`,
`bridge/`, `pulse-null.pa`, `entrypoint.sh`).

### 3. Per-Dockerfile ignore so the voice build can read `vendor/`
The root `.dockerignore` excludes `services/voice-server/vendor/` so the proprietary engine can never enter
the **MASH** image (which also builds from the root and does `COPY . .`). But the **voice** image must read
`vendor/` at build time. Solution: a Dockerfile-specific ignore,
`services/voice-server/Dockerfile.dockerignore`, which BuildKit uses **instead of** the root ignore for the
voice build. It mirrors the root ignore **except** it allows `vendor/`. The root ignore is unchanged, so
MASH's posture is untouched.

### 4. `speech.h` stays user-supplied (license decision)
The SAPI4 SDK header carries _"Copyright 1994-1998 Microsoft Corporation. All rights reserved."_ with no
redistribution grant. Auto-fetching it (even at build time from a third-party mirror) would make our build
reproduce Microsoft IP with no license, violating
[ADR-0006](../decisions/0006-permissive-license-no-bundled-ip.md) / the zero-bundled-IP rule. So it stays
**user-supplied** under the gitignored `services/voice-server/vendor/sdk/include/speech.h`; the build
**fails loudly** with the exact drop path + a pointer to `docs/legal-and-assets.md` if it's missing. (A
future clean-room header could remove it entirely — out of scope; see ADR-0027.)

## What is verified where
- **CI (this repo):** `pnpm --filter @vivify/voice-server run build` emits `dist/`; `pnpm -r typecheck &&
  pnpm -r test && pnpm lint && pnpm format` green (the compose YAML is prettier-clean; no `src`/test
  change).
- **Docker, in this sandbox (verified, not assumed):** `docker build --target build -f
  services/voice-server/Dockerfile .` ran `pnpm install` + `tsc --build` **inside** the image and emitted
  `/repo/services/voice-server/dist/main.js` — proving the host needs no toolchain. Running that stage
  confirmed the Dockerfile-specific ignore lets the build read `services/voice-server/vendor/`
  (`spchapi.exe`, `tv_enua.exe`, `sdk/include/speech.h`) and the other runtime COPY sources (`bridge/`,
  `pulse-null.pa`, `entrypoint.sh`), while bridge build artifacts stay excluded.
- **Operator (the acceptance — full Wine path can't run in the sandbox):** from a clean checkout, drop the
  **3** files into `services/voice-server/vendor/`, then `docker compose build --no-cache && docker compose
  up` → both containers up, MASH on 8090, voice on 8080, upload a `.acs` → Speak → authentic Genie (first
  synthesis ~3–4s; repeats instant via the cache). No host Node/pnpm. The Debian/Wine/SAPI4 install steps
  are environment-specific and remain operator-validated (the same boundary as every voice cycle).

### Final minimal steps (after this cycle)
- **Was:** install Node + pnpm → `pnpm install` → `pnpm --filter @vivify/voice-server typecheck` (build
  dist) → drop 3 files → `docker compose up`.
- **Now:** drop 3 user-supplied files into `services/voice-server/vendor/` — `spchapi.exe`, `tv_enua.exe`,
  `sdk/include/speech.h` (sources in [`docs/legal-and-assets.md`](../legal-and-assets.md)) → `docker
  compose up`. **Docker is the only host tool.**

## Non-goals
The full per-platform install-page rewrite (`docs/install/*`) is the deferred docs cycle — this cycle only
updates the voice-server README to the one-command flow. No `@vivify/core`/browser change. Removing
`speech.h` via a clean-room header is a possible future cycle, not this one. See ADR-0027.
