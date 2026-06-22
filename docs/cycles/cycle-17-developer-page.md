# Cycle 17 — developer documentation pages

## Goal
Fill the five `docs/developers/*` stubs at their **canonical paths** (no renames) with accurate,
verified content so a competent developer can understand the architecture, embed vivify in their own
app, and contribute. The README (the "For developers" line) and the docs landing
(`docs/README.md`) already link to all five, so the links resolve today but lead to "🚧 Coming soon"
placeholders. This cycle makes them real.

The **audience flips** here. Every other docs page targets the zero-assumptions nostalgia visitor;
these target a developer. Per the parked `vision-and-docs-spec.md`, the tone stays warm,
second-person, present-tense, and quietly funny — but technical density is fine, and any nostalgia
wink lives only in a clearly-set-off aside that's deletable without losing instruction. The spec's
`developers/*` map is the page contract:

- `overview.md` — the openness pitch: framework-agnostic, embed in anything (the heavy lift).
- `quickstart.md` — install → ~10-line embed, copy-paste, browser fallback voice by default.
- `api.md` — engine API reference.
- `providers.md` — writing a custom `TtsProvider`; fallback vs authentic.
- `bundles.md` — `acs2bundle`; hosting characters on a CDN.

**Docs only — no code; CI stays green.**

## Verified facts the pages use (no guessing — cross-checked against the repo)

**Packages / data flow** (link, don't duplicate, [`docs/architecture.md`](../architecture.md)):
- `@vivify/types` — shared contracts: `CharacterModel` (the superset IR), `TtsProvider`, `TtsResult`,
  `MouthEvent` (`packages/types/src/index.ts`).
- `@vivify/core` — framework-agnostic engine; load → render/composite → animate → speak.
- `@vivify/acs` — `.acs` parser + `acs2bundle` CLI; same module in Node and the browser.
- `@vivify/voice-truvoice` — `TruVoiceProvider` (authentic) + `WebSpeechProvider` (browser fallback).
- `services/voice-server` (`@vivify/voice-server`) — Dockerized Wine + SAPI4 + TruVoice; `POST /tts`.
- `apps/mash` (package name `mash`) — the showcase/dogfood, built only on the public API.

**Public API** (`@vivify/core`, verified — `packages/core/src/{agent,types,index}.ts`):
- `createAgent(source: ArrayBuffer | CharacterBundleRef, mount?, opts?): Promise<Agent>`
- `createAgentFromModel(model: CharacterModel, mount?, opts?): Agent`
- `CreateAgentOptions { clock?, provider?, rng?, audio? }` — **`provider` defaults to the silent
  `StubTtsProvider`.**
- `Agent { show(); hide(); play(name); animations(): string[]; speak(text, opts?); moveTo(x, y, opts?);
  gestureAt(x, y); stopCurrent(); stop(); on(event, handler); dispose() }` — every action enqueues
  and runs in order.
- `SpeakOptions { hold?, provider? }`, `MoveOptions { speed? }`, `AgentEvent` union,
  `CharacterBundleRef { manifestUrl }`. Also exported: `ActionQueue`, `Playback`, `WebAudioSink`,
  `StubTtsProvider`, lip-sync helpers; the `@vivify/types` contracts are re-exported.

**TtsProvider seam** (`packages/types/src/index.ts`):
- `interface TtsProvider { speak(text, voice: VoiceConfig, signal?: AbortSignal): Promise<TtsResult> }`
- `TtsResult { audio: ArrayBuffer; mouthTimeline: MouthEvent[] }`
- Implementations: `StubTtsProvider` (silent default, in core), `WebSpeechProvider` (browser fallback,
  in voice-truvoice), `TruVoiceProvider` (authentic, POSTs `${url}/tts`).

**Commands (only these exist — verified against `package.json`):**
- Node `>=20`, `pnpm@9.15.0`; workspaces `packages/*`, `services/*`, `apps/*`.
- Root: `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint` (`eslint .`), `pnpm format`
  (`prettier --check .`), `pnpm format:write`.
- MASH dev: `pnpm --filter mash dev` (Vite).
- `acs2bundle`: bin in `@vivify/acs` → `pnpm --filter @vivify/acs exec acs2bundle <input.acs> <outDir>`
  (usage string in `cli.ts`: `acs2bundle <input.acs> <outDir>`).
- Voice server (Node): `pnpm --filter @vivify/voice-server build && … start`. Docker: `docker compose
  up` (compose service `voice` :8080, `mash` :8090).

## Honesty call — packages are not published to npm (handled, not papered over)
Every `@vivify/*` package is `"private": true` at `"version": "0.0.0"` — **none are on npm**. The
spec's "`npm i` → talking character" is the destination, not today's reality. Per
[ADR-0025](../decisions/0025-repo-front-door.md) ("ship only what's real, signpost the rest, no
polish-theater") and the CLAUDE.md honesty rule, `quickstart.md`:
- leads with the **working** path today — clone, `pnpm install`, use the workspace packages / run MASH
  (`apps/mash/src/app.ts` is itself a live, ~10-line use of the public API);
- shows the canonical embed snippet (real, correct API) as the shape consumers will use;
- frames the `npm i …` line as **"once published,"** not a command that works today.

The other four pages have no such gap — the API, types, CLI, and providers all exist and are verified.

## Pages written
- `docs/developers/overview.md` (heavy lift): what it is architecturally (packages table + data-flow,
  linking `architecture.md`); the runs-anywhere pitch (framework-agnostic core, the `TtsProvider`
  seam, browser voice needs nothing) with the real public-API list; get-running-fast from source; how
  to extend; contributing/conventions (summarized from CLAUDE.md). One set-off "screenshots coming"
  note; nav footer.
- `docs/developers/quickstart.md`: honest install path → the ~10-line embed using
  `WebSpeechProvider` for an audible zero-backend default (with the silent-default caveat explained).
- `docs/developers/api.md`: the verified surface, signatures copied from source; action-queue
  semantics (`stopCurrent` vs `stop`).
- `docs/developers/providers.md`: the `TtsProvider` interface + `TtsResult`/`MouthEvent`; the three
  implementations; how to write your own; fallback vs authentic.
- `docs/developers/bundles.md`: what a bundle is (`sheet.png` + `manifest.json` + `audio/`), the
  `acs2bundle` invocation, raw-`.acs`-in-browser vs ahead-of-time bundle, hosting via
  `CharacterBundleRef { manifestUrl }`.

**ADRs referenced:** 0001 (monorepo), 0003 (superset IR/bundle), 0004 (voice needs a backend), 0005
(pluggable provider), 0006 (MIT, no bundled IP), 0007 (framework-agnostic core), 0012 (core depends on
acs for the raw-`.acs` path), 0013 (MASH vanilla TS).

## Acceptance check
- All five `docs/developers/*` pages contain real content (no "🚧 Coming soon" placeholder) and read
  in the developer voice.
- Every documented API signature matches `packages/core/src/{agent,types}.ts` /
  `packages/types/src/index.ts`; every command exists in the relevant `package.json`.
- No `npm i` line is presented as working today; the not-yet-published status is stated plainly.
- Every relative link in the new pages resolves (architecture, ADRs, CLAUDE.md, sibling dev pages,
  `voice/overview.md`, docs home, main README).

## Verification
- **CI (this repo):** `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm format` stays green.
  Docs only, and Markdown is prettier-ignored, so the change touches no code path.
- **Reviewer (`code-reviewer`):** verifies every signature against source, every command against
  `package.json`, every link resolves, and the not-published framing is honest — trusting nothing from
  the draft.
- **Operator/PO:** read `docs/developers/overview.md` on GitHub for voice + correctness; follow
  `quickstart.md` against a local clone.

## Non-goals
Screenshots / GIFs (next cycle — signposted, not faked). No code changes. No package publishing / no
flipping `private: false`. No edits to `architecture.md`, the ADRs, or `CLAUDE.md` (link only). No
merge — open a PR (base `main`) and stop.
