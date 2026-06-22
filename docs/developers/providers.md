# Writing a TTS provider

Speech in vivify goes through one small seam: the `TtsProvider`. The engine never knows _how_ a voice
is produced — it just asks a provider to speak and gets back audio plus a mouth timeline for lip-sync.
That's what lets the library stay pure-browser while the authentic voice is an opt-in upgrade
([ADR-0005](../decisions/0005-pluggable-tts-provider.md)).

## The interface

From `@vivify/types` (re-exported by `@vivify/core`):

```ts
interface TtsProvider {
  speak(text: string, voice: VoiceConfig, signal?: AbortSignal): Promise<TtsResult>;
}

interface TtsResult {
  audio: ArrayBuffer; // Synthesized audio as a WAV byte buffer.
  mouthTimeline: MouthEvent[]; // Per-event mouth timeline for lip-sync; may be empty.
}

interface MouthEvent {
  timeMs: number; // Time of this event, in ms from the start of the audio.
  shape: number; // Mouth HEIGHT (SAPI4 bMouthHeight, ~0..255). Named `shape` for back-compat.
  width?: number; // Mouth WIDTH (SAPI4 bMouthWidth, ~0..255). Optional.
}
```

That's the whole contract: one method. `voice` is the character's `VoiceConfig` (the SAPI voice
settings carried in the `CharacterModel`). `signal`, if given, should **abort the in-flight
synthesis** — when the engine is stopped mid-utterance it aborts the signal, and your `speak` promise
should reject on abort.

`mouthTimeline` may be **empty** — a fallback provider that can't report mouth shapes just returns
`[]`, and the engine runs its own heuristic mouth animation alongside the audio. Only the authentic
path fills in a real timeline.

## The three providers that ship

| Provider | Package | Audio | Lip-sync timeline | Needs a backend |
| --- | --- | --- | --- | --- |
| **`StubTtsProvider`** | `@vivify/core` | _none (silent)_ | empty | no |
| **`WebSpeechProvider`** | `@vivify/voice-truvoice` | browser speech | empty | no |
| **`TruVoiceProvider`** | `@vivify/voice-truvoice` | authentic TruVoice WAV | real, per-event | yes |

### `StubTtsProvider` — the silent default

`createAgent`'s default. It returns `{ audio: empty, mouthTimeline: [] }`, so the character animates
with no sound. Useful when you want motion without voice, or as a safe baseline.

### `WebSpeechProvider` — zero-backend fallback

Speaks through the browser's built-in `speechSynthesis`. No server, nothing to install — this is what
the [quickstart](quickstart.md) uses. It's audible but **not authentic** (it's your browser's voice,
not TruVoice), and it returns an empty timeline, so lip-sync is the engine's heuristic. Outside a
browser, or where speech isn't supported, it's a silent no-op.

### `TruVoiceProvider` — the authentic voice

The real thing: the L&H TruVoice voice with a true per-event mouth timeline. It POSTs to the
[voice server](../voice/overview.md) and decodes `{ audioWavBase64, mouthTimeline }`:

```ts
import { TruVoiceProvider } from '@vivify/voice-truvoice';

const provider = new TruVoiceProvider({ url: 'http://localhost:8080' });
```

Because the TruVoice voice only exists as a Windows SAPI4 engine, it needs that backend running
([ADR-0004](../decisions/0004-authentic-voice-requires-backend.md)). Passing the engine's
`AbortSignal` cancels the in-flight request, so `stop()` interrupts synthesis mid-flight.

## Writing your own

Implement the one method. Here's a provider that calls some other speech backend:

```ts
import type { TtsProvider, TtsResult, VoiceConfig } from '@vivify/core';

export class MyProvider implements TtsProvider {
  constructor(private readonly endpoint: string) {}

  async speak(text: string, voice: VoiceConfig, signal?: AbortSignal): Promise<TtsResult> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice }),
      signal, // honor abort: reject if the engine stops mid-utterance
    });
    if (!res.ok) throw new Error(`tts backend responded ${res.status}`);
    return {
      audio: await res.arrayBuffer(), // a WAV buffer
      mouthTimeline: [], // fill this in if your backend reports mouth shapes
    };
  }
}
```

Use it per-agent or per-utterance:

```ts
const agent = await createAgent(acs, stage, { provider: new MyProvider('/api/tts') }); // default for all speech
agent.speak('Just this line, different voice.', { provider: new MyProvider('/api/other') }); // one-off override
```

**Contract checklist:**

- Return a WAV `ArrayBuffer` in `audio` (or an empty one for silent).
- Return `mouthTimeline: []` if you can't report mouth shapes — the engine handles the rest.
- Honor `signal`: reject when aborted, so `stop()` cleanly interrupts.

## Where to next

- **[API reference](api.md)** — where the provider plugs in (`CreateAgentOptions.provider`,
  `SpeakOptions.provider`).
- **[The authentic voice — overview](../voice/overview.md)** — what the voice server is and why it's
  needed.
- **[Quickstart](quickstart.md)** — the fallback provider in a runnable snippet.

---

← Back to the **[documentation home](../README.md)**
