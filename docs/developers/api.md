# Engine API reference

The public surface of `@vivify/core`. Signatures here are copied from the source
(`packages/core/src/agent.ts` and `types.ts`); if you find drift, the source wins — please flag it.

New here? The **[quickstart](quickstart.md)** shows this API in action in about ten lines.

## Creating an agent

```ts
function createAgent(
  source: ArrayBuffer | CharacterBundleRef,
  mount?: HTMLElement,
  opts?: CreateAgentOptions,
): Promise<Agent>;

function createAgentFromModel(
  model: CharacterModel,
  mount?: HTMLElement,
  opts?: CreateAgentOptions,
): Agent;
```

- **`createAgent`** is the usual entry point. `source` is either a raw `.acs` as an `ArrayBuffer` or a
  `CharacterBundleRef` pointing at a prebuilt bundle (see **[bundles](bundles.md)**). It loads the
  character, then mounts. Resolves once the character is ready.
- **`createAgentFromModel`** skips the loader when you already have a decoded `CharacterModel` (for
  example, straight from `@vivify/acs`'s `parseAcs`). `createAgent` calls this for you after loading.
- **`mount`** is the host element the engine renders into. Omit it and the engine falls back to
  `document.body`.

### `CreateAgentOptions`

```ts
interface CreateAgentOptions {
  clock?: Clock; // Injectable clock (default: real timers).
  provider?: TtsProvider; // Default TTS provider (default: silent StubTtsProvider).
  rng?: Rng; // RNG for branch/state selection (default: Math.random).
  audio?: AudioSink; // Audio playback sink (default: Web Audio; tests inject a fake).
}
```

The default `provider` is the **silent** `StubTtsProvider` — pass a real one (e.g.
`WebSpeechProvider` or `TruVoiceProvider`) for audible speech. See **[TTS providers](providers.md)**.

### `CharacterBundleRef`

```ts
interface CharacterBundleRef {
  manifestUrl: string; // URL of the bundle's manifest.json.
}
```

## The `Agent` control

Returned by `createAgent` / `createAgentFromModel`. It mirrors the classic Microsoft Agent control:
**every action enqueues and runs in order.**

```ts
interface Agent {
  show(): Promise<void>;
  hide(): Promise<void>;
  play(animationName: string): Promise<void>;
  animations(): string[]; // Names of the character's available animations.
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  moveTo(x: number, y: number, opts?: MoveOptions): Promise<void>;
  gestureAt(x: number, y: number): Promise<void>;
  stopCurrent(): void; // Drop the currently-running queued action.
  stop(): void; // Clear the queue and return to idle.
  on(event: AgentEvent, handler: (...a: unknown[]) => void): void;
  dispose(): void;
}
```

### The action queue

The methods that return `Promise<void>` (`show`, `hide`, `play`, `speak`, `moveTo`, `gestureAt`)
**enqueue** work. Calls play strictly in order, so you can fire a sequence without chaining promises
yourself:

```ts
agent.play('Wave'); // runs first
agent.speak('Hi there!'); // then this
agent.moveTo(300, 200); // then this
```

`await` a returned promise when you need to know a specific action finished. Two ways to interrupt:

- **`stopCurrent()`** drops only the action running right now; the rest of the queue continues.
- **`stop()`** clears the whole queue and returns the character to idle.

`animations()` returns the available animation names (synchronously) — handy for building a UI or for
validating a name before you `play` it. `dispose()` tears the agent down and releases its host
element; call it when you're done (e.g. a React effect cleanup).

### `SpeakOptions`

```ts
interface SpeakOptions {
  hold?: boolean; // Keep the balloon up after speaking instead of auto-hiding.
  provider?: TtsProvider; // Override the TTS provider for this one utterance.
}
```

`provider` here overrides the agent's default provider for a single `speak` call — useful to mix
silent and authentic speech, or to point one line at a different voice.

### `MoveOptions`

```ts
interface MoveOptions {
  speed?: number; // Movement speed (pixels/second); the engine picks a default if omitted.
}
```

### Events

```ts
type AgentEvent =
  | 'show'
  | 'hide'
  | 'play'
  | 'speak'
  | 'move'
  | 'gesture'
  | 'idle'
  | 'command'
  | 'error';
```

Register handlers with `agent.on(event, handler)` to react as actions run (for example, re-enabling a
button on `'idle'`, or surfacing an `'error'`).

## Also exported

`@vivify/core` re-exports the shared contracts from `@vivify/types` for convenience
(`CharacterModel`, `VoiceConfig`, `TtsProvider`, `TtsResult`, `MouthEvent`, and the model types), and
exposes the engine building blocks for advanced use: `StubTtsProvider`, `ActionQueue`, `Playback`,
`WebAudioSink`, and the lip-sync helpers. The everyday path needs none of these — `createAgent` and the
`Agent` methods above are the whole story.

## Where to next

- **[TTS providers](providers.md)** — the `TtsProvider` seam in detail.
- **[Character bundles](bundles.md)** — what a `CharacterBundleRef` points at, and how to build one.
- **[Quickstart](quickstart.md)** — the API in a runnable snippet.

---

← Back to the **[documentation home](../README.md)**
