# vivify

**Bring Microsoft Agent characters back to life in the browser — faithfully.**

Genie, Merlin, Peedy, Robby, Clippy, and any `.acs` character ever made: parsed, rendered, animated, and (optionally) speaking in their original TruVoice voice with real lip-sync. A framework-agnostic engine plus tooling, so you can drop a character into anything.

> 🚧 **Status: early development.** See `docs/roadmap.md`.

## Packages
- `@vivify/core` — the engine (load / show / play / speak / moveTo / gestureAt / stop). Framework-agnostic.
- `@vivify/acs` — `.acs` parser + `acs2bundle` CLI. Runs in Node and the browser.
- `@vivify/voice-truvoice` — authentic-voice provider (talks to the voice server).
- `services/voice-server` — Dockerized Wine + SAPI4 + TruVoice → `{ audio, mouthTimeline }`.
- `apps/mash` — the MASH-style playground (demo + integration example).

## Quick start (target API — not yet implemented)
```ts
import { createAgent } from "@vivify/core";

const genie = await createAgent("/agents/genie.acs"); // raw .acs or a prebuilt bundle
await genie.show();
await genie.play("Greet");
await genie.speak("You rubbed the lamp?");
```

## Authenticity & assets
The engine is MIT-licensed and ships **no** Microsoft/L&H binaries or character files. To get the authentic voice and the characters, you supply the original components yourself — see **[`docs/legal-and-assets.md`](docs/legal-and-assets.md)**.

## License
MIT © Kris Bennett. The Microsoft Agent characters, the SAPI4/TruVoice engine, and related assets are the property of their respective owners and are **not** distributed by this project.
