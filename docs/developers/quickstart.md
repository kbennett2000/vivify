# Developer quickstart

Goal: a character on screen, talking, in about ten lines — with **no backend to install**. Speech uses
the browser's built-in voice by default, so this works the moment the page loads.

New to the project shape first? The **[overview](overview.md)** maps the packages. Otherwise, let's
get something moving.

## Heads-up: the packages aren't on npm yet

vivify is pre-release. The `@vivify/*` packages are still `private` and unpublished, so a literal
`npm i @vivify/core` **won't work today**. There are two honest ways to use it right now:

1. **From this repo (works today).** Clone it, `pnpm install`, and either run the MASH demo or import
   the workspace packages. `apps/mash/src/app.ts` is itself a real, minimal use of the public API —
   the best worked example there is.
2. **From npm (once published).** When the packages ship, the install line below is all you'll need.
   We're showing it now so the embed snippet is the real shape you'll use either way.

```bash
# once published — not available yet:
npm i @vivify/core @vivify/voice-truvoice
```

To run it from source today:

```bash
git clone <this-repo> vivify
cd vivify          # needs Node 20+ and pnpm 9
pnpm install
pnpm --filter mash dev    # the demo, on Vite's dev server
```

## The ~10-line embed

Give the engine a raw `.acs` file (as an `ArrayBuffer`) and an element to mount into. The
`WebSpeechProvider` makes it audible with zero backend:

```ts
import { createAgent } from '@vivify/core';
import { WebSpeechProvider } from '@vivify/voice-truvoice';

// 1. Fetch a character file the user supplied (.acs files are never bundled — see Legal & assets).
const acs = await fetch('/characters/Genie.acs').then((r) => r.arrayBuffer());

// 2. Create the agent, mounted into your element, with an audible browser voice.
const agent = await createAgent(acs, document.getElementById('stage')!, {
  provider: new WebSpeechProvider(),
});

// 3. Bring him on, and say hello.
await agent.show();
agent.speak('Hello! I am alive in your browser.');
```

That's it — he's alive, and talking.

### Why pass a provider at all?

`createAgent`'s **default** provider is the silent `StubTtsProvider`: the character animates, but you
hear nothing. That's deliberate — the engine never assumes a voice. Passing `WebSpeechProvider` opts
you into audible speech with no server. When you want the **authentic** TruVoice voice (with real
lip-sync), swap in `TruVoiceProvider` pointed at a running [voice server](../voice/overview.md) — a
one-line change. See **[TTS providers](providers.md)** for all three.

## Driving the character

Every method enqueues and runs in order, so you can stack actions and they play as a sequence:

```ts
agent.play('Wave'); // an animation by name — see agent.animations() for the list
agent.moveTo(400, 200); // glide to a point
agent.gestureAt(600, 300); // gesture toward a point
agent.speak('Watch this.', { hold: true }); // keep the balloon up after speaking
agent.stop(); // clear the queue and return to idle
```

The full surface — signatures, options, events, and the `stopCurrent` vs `stop` distinction — is in
the **[API reference](api.md)**.

## Where to next

- **[API reference](api.md)** — every method and option, copied from the source.
- **[TTS providers](providers.md)** — fallback vs authentic voice, and writing your own.
- **[Character bundles](bundles.md)** — convert a `.acs` ahead of time and serve it from a CDN.
- **[Legal & assets](../legal-and-assets.md)** — where `.acs` files come from (you supply them; we
  never ship them).

---

← Back to the **[documentation home](../README.md)**
