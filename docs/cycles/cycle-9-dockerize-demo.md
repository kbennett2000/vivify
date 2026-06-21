# Cycle 9 — Dockerize the MASH demo

## Goal
Make running the MASH demo **one command** instead of the current two-terminal + manual-URL dance. Package
`apps/mash` as a small static web container (default port **8090**) whose "Voice server URL" field is
**pre-filled with `http://localhost:8080`**, so sound works automatically when the (separate) voice
container is up — no manual paste. The authentic-voice Wine/SAPI4 stack stays in its **own** container
(`services/voice-server`, unchanged); the MASH image ships **no** Microsoft/L&H IP.

Scope: **`apps/mash` + repo-root Docker glue.** No change to `@vivify/core`, `services/voice-server`, the
SAPI4 bridge, or the Wine prefix.

## Why
Today the demo requires: build/serve `apps/mash` in one shell, run the voice service in another, then
hand-paste `http://localhost:8080` into the voice field. That's friction for a showcase. A static MASH
container + a pre-filled default collapses it to `docker compose up` (or two `docker run` lines), with the
voice path wired by default.

## The container model
MASH is a **static SPA** — the engine and all logic run in the browser; the only server it talks to is the
voice service, and that call happens **client-side from the browser**. So:

- **MASH image** = the production Vite build served by **nginx** on an internal port **8090**. No Node
  runtime, no Vite dev server, no app server. Two-stage build: `node:20-slim` builds the bundle,
  `nginx:alpine` serves it.
- **Voice image** = the existing `services/voice-server` (Wine + SAPI4 + TruVoice), unchanged, on **8080**.
- They are **not** networked container-to-container: the browser (on the host) fetches the voice URL, so
  both images just **publish their ports to the host** and the browser reaches `localhost:8080` /
  `localhost:8090`. (CORS is already handled — the voice server reflects the request Origin.)

### Port: fixed internal 8090, host-overridable
The container always listens on **8090** internally; you change the **host** port with the standard Docker
flag — `docker run -p <hostport>:8090`. Nothing hardcodes the host side, so the override can't break. (We
deliberately do *not* make the internal port runtime-configurable; host-port mapping is the idiomatic and
sufficient mechanism.)

### Default voice URL (build-arg overridable, runtime-editable)
A pure helper `resolveVoiceServerUrl(raw)` returns `raw?.trim() || 'http://localhost:8080'`. On startup the
voice field is pre-filled from `resolveVoiceServerUrl(import.meta.env.VITE_VOICE_SERVER_URL)`. So:
- **Default** is `http://localhost:8080` → sound "just works" with the voice container running.
- **Build-time override**: `--build-arg VITE_VOICE_SERVER_URL=…` bakes a different default into the bundle.
- **Runtime**: the field stays editable for other hosts, and **clearing it goes silent** (StubTtsProvider).

Because the field is no longer blank by default, a failed voice fetch (no voice container running) must not
look broken: `speak()` rejections are caught and surfaced via the existing status line ("voice server not
reachable — clear the field for silent mode"), so the demo degrades gracefully.

## What changes
**New**
- **`apps/mash/Dockerfile`** — multi-stage. Build context is the **repo root** (MASH imports
  `@vivify/core` & friends from the workspace, so the build needs `packages/*` + the lockfile). Stage 1:
  `corepack enable` → `pnpm install --frozen-lockfile` → `pnpm --filter mash build` (the package name is
  `mash`, not `@vivify/mash`). Stage 2:
  `nginx:alpine` serving the built `dist/`. `ARG VITE_VOICE_SERVER_URL=http://localhost:8080`, `EXPOSE 8090`.
- **`apps/mash/nginx.conf`** — `listen 8090;`, SPA fallback `try_files $uri $uri/ /index.html;`. A missing
  `/characters/index.json` falls back to `index.html`; `app.ts` already treats a non-JSON content-type as
  "no built-ins", so this matches the dev server's behavior.
- **`.dockerignore`** (repo root) — excludes `node_modules`, `**/dist`, `.git`, `services/voice-server/
  vendor`, Wine prefixes, `*.acs`, etc. Keeps the build context small **and** guarantees no IP enters the
  MASH image.
- **`docker-compose.yml`** (repo root) — optional convenience: `voice` (builds `services/voice-server`,
  publishes `8080:8080`) + `mash` (builds `apps/mash`, publishes `8090:8090`). `docker compose up mash`
  works without the voice vendor binaries.
- **`apps/mash/README.md`** — the one command, the port-override one-liner, how the two containers relate,
  and the "drop your two engine files in `services/voice-server/vendor/`, build the voice container" note.

**Modified**
- **`apps/mash/src/characters.ts`** — add `resolveVoiceServerUrl(raw)` (pure; unit-tested).
- **`apps/mash/src/app.ts`** — pre-fill the voice field on startup; `.catch` the `speak()` call to show a
  friendly status on voice-server failure.
- **`apps/mash/index.html`** — voice-bar hint/placeholder reflect the new default; drop the stale
  "(silent)" subtitle.
- **`apps/mash/src/vite-env.d.ts`** — declare `VITE_VOICE_SERVER_URL` on `ImportMetaEnv` for strict TS.

## What is verified where
- **CI (this repo):** unit tests for `resolveVoiceServerUrl` (default on undefined/empty/whitespace; honors
  and trims a real value) join the existing MASH pure-helper suite; `pnpm -r typecheck && pnpm -r test &&
  pnpm lint && pnpm format` stay green. The Docker image is **not** built in CI (matches the voice-server
  model — the image is a deployment artifact, and a full image build doesn't belong in the unit gate).
- **Docker (implementer — Docker 29 + Compose v5):** image builds from the repo root; `docker run -p
  8090:8090` serves the SPA (HTTP 200 + the MASH `index.html`); `-p 9000:8090` proves the host-port
  override; the default voice URL `http://localhost:8080` is present in the built JS bundle.
- **On-screen (operator):** `docker compose up` → open `http://localhost:8090`, upload a `.acs`, Speak →
  authentic voice + lip-sync with **no manual URL paste** (voice container on 8080); changing the host port
  via `-p` works; clearing the voice field goes silent.

## How to run it
```sh
# Voice service (your user-supplied binaries in services/voice-server/vendor/):
pnpm --filter @vivify/voice-server typecheck      # emits dist/
docker build -t vivify-voice services/voice-server
docker run --rm -p 8080:8080 vivify-voice

# MASH demo (build context = repo root):
docker build -f apps/mash/Dockerfile -t vivify-mash .
docker run --rm -p 8090:8090 vivify-mash          # different host port: -p 9000:8090

# …or both at once:
docker compose up
# → MASH at http://localhost:8090, talking to voice at http://localhost:8080 automatically
```

## Non-goals / known limitations
No change to the voice container, Wine, or the SAPI4 bridge. No Docker build in CI. No `.acs`/MS-IP shipped
in any image. The internal MASH port is fixed at 8090 (host-port mapping is the override). Built-in
character bundles remain a local-only, gitignored convenience — the container ships none; upload is the
out-of-the-box path. See ADR-0021.
