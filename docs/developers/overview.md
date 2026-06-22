# For developers — overview

So you want to put a talking, gesturing Microsoft Agent character into your own app. Good news: that's
exactly what vivify is built for. The character engine is a plain TypeScript library with **no
framework dependency** — drop it into React, Vue, Svelte, or a single `<script>` tag, and it behaves
the same everywhere.

This page is the orientation: what the pieces are, how they fit, and where to go next. If you'd rather
just see code, jump straight to the **[quickstart](quickstart.md)**.

> 💾 **Remember when…** adding a feature meant linking a DLL and praying? This is the opposite of that.
> One import, one function call, a character on screen. (You can skip this aside — it changes no
> instruction.)

## What this is, architecturally

vivify is a pnpm monorepo. The work is split into small packages with one job each, so you can take
only the part you need.

| Package / app | What it does |
| --- | --- |
| **`@vivify/types`** | The shared contracts — `CharacterModel` (the superset [IR](../glossary.md)), and the `TtsProvider` / `TtsResult` / `MouthEvent` voice types. No runtime code; just the types every other package agrees on. |
| **`@vivify/acs`** | The `.acs` parser and the `acs2bundle` CLI. Reads a raw character file into a `CharacterModel`. Same module runs in Node (convert ahead of time) and in the browser (drop a raw `.acs` and play it). |
| **`@vivify/core`** | The engine. Takes a `CharacterModel`, renders and animates it on a canvas, draws the balloon, runs the action queue, and drives lip-sync. Framework-agnostic. Speaks through a pluggable `TtsProvider`. |
| **`@vivify/voice-truvoice`** | Two voice providers: `TruVoiceProvider` (the authentic L&H TruVoice voice, via the voice server) and `WebSpeechProvider` (a zero-backend browser fallback). |
| **`services/voice-server`** | The authentic-voice backend (`@vivify/voice-server`): a Dockerized Wine + SAPI4 + TruVoice service exposing `POST /tts` → `{ audioWavBase64, mouthTimeline }`. You supply the engine binaries; we ship the wiring. |
| **`apps/mash`** | The MASH demo (package name `mash`). The showcase _and_ the dogfood — it's built only on `@vivify/core`'s public API, so it doubles as a worked example. |

**The data flow, end to end:**

```
.acs ──▶ @vivify/acs ──▶ CharacterModel (the superset IR) ──▶ @vivify/core ──▶ canvas + balloon
                                                                   │
                                                                   └─▶ TtsProvider ──▶ { audio, mouthTimeline } ──▶ lip-sync
```

The parser produces the **same IR** whether it runs in Node (to emit a bundle) or in the browser (to
play directly). The engine never knows how speech is produced — it just asks a provider. For the full
diagram and the rationale, see **[Architecture](../architecture.md)**.

## Runs anywhere (the openness pitch)

The engine is the point of this section. `@vivify/core` is vanilla TypeScript with **no UI framework
dependency** ([ADR-0007](../decisions/0007-framework-agnostic-core.md)). It owns a canvas it mounts
into a host element you give it, and it exposes one small control surface that mirrors the classic
Microsoft Agent API:

```ts
import { createAgent } from '@vivify/core';

const agent = await createAgent(acsArrayBuffer, document.getElementById('stage')!);
await agent.show();
agent.play('Wave');
agent.speak('Hello from your own app.');
agent.moveTo(400, 200);
agent.gestureAt(600, 300);
agent.stop();
```

Every call **enqueues** and runs in order — a classic Agent action queue — so `show → play → speak`
plays as a tidy sequence without you wiring up promises by hand. The full method list (`show`, `hide`,
`play`, `animations`, `speak`, `moveTo`, `gestureAt`, `stopCurrent`, `stop`, `on`, `dispose`) and
every signature live in the **[API reference](api.md)**.

Because it's framework-agnostic, "use it in React" is just "call `createAgent` in an effect and hand
it a ref'd element." Same engine in Vue, Svelte, or no framework at all — the demo (`apps/mash`) uses
no framework on purpose ([ADR-0013](../decisions/0013-mash-vanilla-ts.md)).

**Voice is opt-in, and the browser path needs nothing.** Speech goes through a pluggable
`TtsProvider` ([ADR-0005](../decisions/0005-pluggable-tts-provider.md)) — a one-method seam. Three
providers exist out of the box:

- **`StubTtsProvider`** — the silent default. The character animates; no audio.
- **`WebSpeechProvider`** — an audible fallback using the browser's built-in speech. Zero backend,
  nothing to install. This is what the quickstart uses.
- **`TruVoiceProvider`** — the real, authentic TruVoice voice with true lip-sync. Needs the
  [voice server](../voice/overview.md) running ([ADR-0004](../decisions/0004-authentic-voice-requires-backend.md)),
  because that voice only exists as a Windows SAPI4 engine.

Swapping authenticity in is a one-line change at the call site. See **[TTS providers](providers.md)**
to write your own.

## Get running fast (from source)

The packages aren't on npm yet (see the [quickstart](quickstart.md) for the honest status), so today
you work from the repo. You need **Node 20+** and **pnpm 9**.

```bash
git clone <your-fork-or-this-repo> vivify
cd vivify
pnpm install
```

Run the MASH demo with Vite's dev server:

```bash
pnpm --filter mash dev
```

The standard checks, all from the repo root:

```bash
pnpm -r typecheck   # tsc across every workspace
pnpm -r test        # vitest across every workspace
pnpm lint           # eslint .
pnpm format         # prettier --check .   (format:write to apply)
```

Want the embed-in-your-own-app path (the ~10-line snippet) instead of the demo? That's the
**[quickstart](quickstart.md)**.

## How to extend

The seams are deliberately small. The common extension points:

- **Write a custom `TtsProvider`** — route speech to your own backend, a different voice, or a mock
  for tests. One `speak` method. → **[TTS providers](providers.md)**
- **Convert a `.acs` to a web bundle** and host it on a CDN — `acs2bundle` packs a character into a
  sprite sheet + `manifest.json` + audio, and the engine can load it from a URL. → **[Character
  bundles](bundles.md)**
- **Use the engine in a framework** — the API is the same everywhere; the quickstart shows the shape.
  → **[Quickstart](quickstart.md)**

The load-bearing decisions behind all of this are written up in the **[ADRs](../decisions/)** — start
with [ADR-0003](../decisions/0003-superset-bundle-format.md) (why our IR is a superset, not
clippy-compatible) and [ADR-0007](../decisions/0007-framework-agnostic-core.md) (why the core has no
framework dependency).

## Contributing / project conventions

vivify is built in **small, reviewable cycles**. The working model, in brief (the full version is in
**[CLAUDE.md](../../CLAUDE.md)**):

- **Cycle docs.** Each build cycle has a spec in [`docs/cycles/`](../cycles/). Implement to the spec;
  if reality diverges, update the doc in the same PR.
- **ADRs for load-bearing decisions.** Anything a future contributor would otherwise have to
  reverse-engineer goes in [`docs/decisions/`](../decisions/).
- **Diffs over self-reports.** Nothing is "done" because the author says so — done means the cycle's
  acceptance check passes, tests are green, and the diff has been read.
- **Validation against oracles, not vibes.** Every claim about the `.acs` format is checked against a
  ground-truth oracle (DoubleAgent / Lebeau's decompiler), never against "looks right."
- **IP hygiene.** Code is MIT. We never commit Microsoft/L&H binaries or `.acs` files — they're
  gitignored; you supply your own ([ADR-0006](../decisions/0006-permissive-license-no-bundled-ip.md),
  [Legal & assets](../legal-and-assets.md)).
- **Conventional commits, one PR per cycle.** CI (typecheck + test + lint) must be green **and** the
  diff reviewed before merge — never force-merged on green alone.

> 🚧 **Screenshots and GIFs are coming in the next cycle.** This page is words for now; a character
> actually moving and talking is worth more than a paragraph, and that's on the way.

---

← Back to the **[documentation home](../README.md)**
