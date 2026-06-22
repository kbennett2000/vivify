# Character bundles

A character can run two ways. The browser path is the simplest: hand `@vivify/core` a raw `.acs` as an
`ArrayBuffer` and it parses and plays it in memory ([ADR-0012](../decisions/0012-core-depends-on-acs.md)).
But parsing a `.acs` on every page load means shipping the whole binary and decoding it client-side. A
**bundle** is the ahead-of-time alternative: convert once, serve static web assets, load fast — and
host them on a CDN.

## What a bundle is

Run the `acs2bundle` CLI (from `@vivify/acs`) and you get a folder with three things:

```
<outDir>/
  sheet.png        a packed, transparent sprite-sheet of every unique image in the character
  manifest.json    the full CharacterModel minus the pixels and WAVs (zod-validated)
  audio/000.wav    each embedded sound, extracted (only present if the character has sounds)
  audio/001.wav
  ...
```

The `manifest.json` is the serialized superset IR — animations, frame branching, balloon and voice
config, the mouth-overlay data, the state map, plus an atlas mapping each sprite to its rectangle in
`sheet.png`. It's the same `CharacterModel` the in-browser parser produces, just split from its binary
assets so the browser can fetch them as ordinary files. (Why a superset and not a clippy-compatible
format? [ADR-0003](../decisions/0003-superset-bundle-format.md).)

## Converting a `.acs`

`acs2bundle` is the CLI shipped by `@vivify/acs`. From the repo:

```bash
pnpm --filter @vivify/acs exec acs2bundle <input.acs> <outDir>
```

For example:

```bash
pnpm --filter @vivify/acs exec acs2bundle ./Genie.acs ./public/characters/genie
```

It prints a summary (image / animation / sound counts and the sheet dimensions) and writes the three
outputs into `<outDir>`. It's Node-only — it reads the `.acs` from disk and writes PNG/JSON/WAV files —
so it's an ahead-of-time build step, not something you run in the browser.

> You supply the `.acs` file. vivify never ships character files or engine binaries — they're
> gitignored, and you bring your own. See **[Legal & assets](../legal-and-assets.md)**.

## Hosting on a CDN

Serve the `<outDir>` as static files (any web host or CDN), then point the engine at the manifest with
a `CharacterBundleRef`:

```ts
import { createAgent } from '@vivify/core';

const agent = await createAgent(
  { manifestUrl: 'https://cdn.example.com/characters/genie/manifest.json' },
  document.getElementById('stage')!,
);
await agent.show();
```

`createAgent` accepts **either** a raw `.acs` `ArrayBuffer` **or** a `CharacterBundleRef` — the rest of
the API is identical from there. The engine fetches the manifest, sprite sheet, and audio from the URL
you gave it. Keep the `sheet.png` and `audio/` files next to the `manifest.json` (the manifest
references them by relative name), and you're serving characters straight from the edge.

## Raw `.acs` vs bundle — which to use

| | Raw `.acs` `ArrayBuffer` | Prebuilt bundle (`CharacterBundleRef`) |
| --- | --- | --- |
| Setup | none — just fetch the file | one `acs2bundle` build step |
| Client work | parses the binary in the browser | fetches ready-made static assets |
| Best for | quick experiments, user-uploaded files | production, CDN delivery, many page loads |

Both go through the exact same engine and the exact same `Agent` API — the only difference is where the
parsing happens.

## Where to next

- **[API reference](api.md)** — `createAgent` and `CharacterBundleRef`.
- **[Quickstart](quickstart.md)** — the raw-`.acs` path in a runnable snippet.
- **[Architecture](../architecture.md)** — where the bundle sits in the data flow.

---

← Back to the **[documentation home](../README.md)**
