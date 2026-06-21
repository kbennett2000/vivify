// VivifyAgent — the public Agent control wired over the engine: action queue +
// playback + canvas compositor + balloon + state map + TtsProvider seam (silent
// stub by default). createAgent loads a CharacterModel (raw .acs or bundle) and
// mounts a host element it owns. Browser-only (harness-validated); the pure
// logic it composes (playback/queue/wrap/states) is unit-tested separately.

import type {
  AnimationModel,
  CharacterModel,
  FrameModel,
  TtsProvider,
  TtsResult,
} from '@vivify/types';
import type { Agent, AgentEvent, CharacterBundleRef, MoveOptions, SpeakOptions } from './types.js';
import { ActionQueue } from './queue.js';
import { Playback, playableLength, computeExitPath, type Rng } from './playback.js';
import { realClock, type Clock } from './clock.js';
import { Compositor } from './compositor.js';
import { Balloon } from './balloon.js';
import { animationForState, directionTo, gestureState, moveState } from './states.js';
import { StubTtsProvider } from './provider.js';
import { WebAudioSink, type AudioSink, type AudioHandle } from './audio.js';
import { chooseOverlay, interpolatedMouth } from './lipsync.js';
import { loadCharacter } from './loader.js';

export interface CreateAgentOptions {
  /** Injectable clock (default real timers). */
  clock?: Clock;
  /** Default TTS provider (default: silent StubTtsProvider). */
  provider?: TtsProvider;
  /** RNG for branch/state selection (default Math.random). */
  rng?: Rng;
  /** Audio playback sink (default Web Audio; tests inject a fake). */
  audio?: AudioSink;
}

const SPEAK_MIN_MS = 800;
const SPEAK_PER_CHAR_MS = 55;
const SPEAK_MAX_MS = 10000;
const DEFAULT_MOVE_SPEED = 120; // px/s
const LIPSYNC_TICK_MS = 50; // overlay/word-reveal update cadence during audio speech

class VivifyAgent implements Agent {
  private readonly host: HTMLElement;
  private readonly compositor: Compositor;
  private readonly balloon: Balloon;
  private readonly queue = new ActionQueue();
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly provider: TtsProvider;
  private readonly audio: AudioSink;
  private readonly animMap = new Map<string, AnimationModel>();
  private readonly listeners = new Map<AgentEvent, Set<(...a: unknown[]) => void>>();

  private current: Playback | null = null;
  private posX = 0;
  private posY = 0;
  private disposed = false;
  // The gesture pose currently HELD (null ⇒ at rest). A finished gesture holds its end
  // pose for stacking (e.g. point, then speak while pointing); we walk it back to rest
  // only before a different gesture or on an explicit stop() (ADR-0020).
  private heldAnim: AnimationModel | null = null;
  private heldIndex = 0;
  // Lazily-found frame carrying mouth overlays, used as the speak base when the held
  // frame has none so lip-sync always has somewhere to composite (undefined = not yet
  // computed, null = the character has no overlay-bearing frame).
  private overlayBaseFrame?: FrameModel | null;

  constructor(
    private readonly model: CharacterModel,
    mount?: HTMLElement,
    opts: CreateAgentOptions = {},
  ) {
    this.clock = opts.clock ?? realClock;
    this.rng = opts.rng ?? Math.random;
    this.provider = opts.provider ?? new StubTtsProvider();
    this.audio = opts.audio ?? new WebAudioSink();
    for (const anim of model.animations) this.animMap.set(anim.name, anim);

    const doc = mount?.ownerDocument ?? document;
    this.compositor = new Compositor(model, doc);
    this.balloon = new Balloon(model.balloon, doc);

    const host = doc.createElement('div');
    host.style.position = 'absolute';
    host.style.width = `${model.info.width}px`;
    host.style.height = `${model.info.height}px`;
    host.style.left = `${this.posX}px`;
    host.style.top = `${this.posY}px`;
    host.style.visibility = 'hidden';
    // Balloon sits above the character.
    this.balloon.el.style.bottom = `${model.info.height + 8}px`;
    this.balloon.el.style.left = '0px';
    host.appendChild(this.compositor.canvas);
    host.appendChild(this.balloon.el);
    this.host = host;
    (mount ?? doc.body).appendChild(host);

    this.logOverlayScan();
  }

  // TODO(cycle-6): remove once the overlay source is confirmed. One-shot diagnostic:
  // where (if anywhere) does this character carry per-frame mouth overlays? The mouth
  // won't move if the Speaking-state animation's frames have none — this scans EVERY
  // animation so the next run shows whether overlays live on a different animation or
  // nowhere at all. console.info so it shows at the browser's Info level.
  private logOverlayScan(): void {
    const anims = this.model.animations;
    let withOverlays = 0;
    let totalOverlays = 0;
    const detail: string[] = [];
    for (const a of anims) {
      const recs = a.frames.flatMap((f) => f.mouth?.overlays ?? []);
      if (recs.length === 0) continue;
      withOverlays++;
      totalOverlays += recs.length;
      const types = [...new Set(recs.map((o) => o.type))].sort((x, y) => x - y);
      const images = [...new Set(recs.map((o) => o.imageIndex))].slice(0, 8);
      detail.push(
        `${a.name}: ${recs.length} overlays, types=[${types.join(',')}], images=[${images.join(',')}]`,
      );
    }
    const speaking = this.model.states['Speaking'] ?? [];
    console.info(
      `[vivify:lipsync] scan: ${anims.length} animations, ${withOverlays} with overlays, ${totalOverlays} overlay records total; Speaking state -> [${speaking.join(',')}]`,
    );
    for (const line of detail) console.info(`[vivify:lipsync] scan:   ${line}`);
    if (withOverlays === 0) {
      console.info(
        '[vivify:lipsync] scan: NO per-frame mouth overlays anywhere in this character.',
      );
    }
  }

  // --- public API (all actions enqueue) ---

  animations(): string[] {
    return this.model.animations.map((a) => a.name);
  }

  play(animationName: string): Promise<void> {
    this.emit('play', animationName);
    return this.queue.enqueue((signal) => this.runGestureAnimation(animationName, signal));
  }

  show(): Promise<void> {
    this.emit('show');
    return this.queue.enqueue(async (signal) => {
      this.host.style.visibility = 'visible';
      await this.runState('Showing', signal);
    });
  }

  hide(): Promise<void> {
    this.emit('hide');
    return this.queue.enqueue(async (signal) => {
      await this.runState('Hiding', signal);
      if (!signal.aborted) this.host.style.visibility = 'hidden';
    });
  }

  speak(text: string, opts?: SpeakOptions): Promise<void> {
    this.emit('speak', text);
    const provider = opts?.provider ?? this.provider;
    return this.queue.enqueue(async (signal) => {
      // Load the text now (balloon stays display:none); it's SHOWN only once audio/the
      // heuristic animation actually starts, so it doesn't appear seconds before the
      // voice during the ~2-3s synthesis (cycle-8 #3).
      this.balloon.setText(text);
      // Ask the provider to synthesize (cancellable). A failure/abort/no-backend
      // falls back to the silent heuristic path below.
      let result: TtsResult | null = null;
      try {
        result = await provider.speak(text, this.model.voice, signal);
      } catch {
        result = null;
      }
      if (signal.aborted) {
        this.balloon.hide();
        return;
      }
      if (result && result.audio.byteLength > 0) {
        await this.speakWithAudio(result, signal);
      } else {
        // Silent (stub / Web Speech / failed fetch): heuristic-timed Speaking loop.
        const ms = Math.min(SPEAK_MAX_MS, SPEAK_MIN_MS + text.length * SPEAK_PER_CHAR_MS);
        await this.speakAnimate(ms, signal);
      }
      if (!opts?.hold) this.balloon.hide();
    });
  }

  moveTo(x: number, y: number, opts?: MoveOptions): Promise<void> {
    this.emit('move', x, y);
    return this.queue.enqueue(async (signal) => {
      const dir = directionTo(this.posX, this.posY, x, y);
      const distance = Math.hypot(x - this.posX, y - this.posY);
      const speed = opts?.speed && opts.speed > 0 ? opts.speed : DEFAULT_MOVE_SPEED;
      const durationMs = Math.max(1, (distance / speed) * 1000);
      const moveAnim = animationForState(this.model.states, moveState(dir), this.rng);
      const pb = moveAnim ? this.beginPlayback(moveAnim) : null;
      // tween is the single source of truth for position: it updates posX/posY +
      // host each step, lands exactly on (x,y) on completion, and on abort halts
      // wherever it stopped (no snap-to-destination).
      await this.tween(x, y, durationMs, signal);
      pb?.cancel();
      if (this.current === pb) this.current = null;
    });
  }

  gestureAt(x: number, y: number): Promise<void> {
    this.emit('gesture', x, y);
    return this.queue.enqueue((signal) => {
      const dir = directionTo(this.posX, this.posY, x, y);
      const name = animationForState(this.model.states, gestureState(dir), this.rng);
      return name ? this.runGestureAnimation(name, signal) : Promise.resolve();
    });
  }

  stopCurrent(): void {
    this.queue.stopCurrent();
  }

  stop(): void {
    this.queue.stop();
    this.current?.cancel();
    this.current = null;
    // "Stop / return to rest": after halting, walk the held gesture pose back to rest.
    if (this.heldAnim) {
      const held = this.heldAnim;
      const idx = this.heldIndex;
      this.heldAnim = null;
      void this.queue.enqueue((signal) => this.returnToRest(held, idx, signal));
    }
  }

  on(event: AgentEvent, handler: (...a: unknown[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.dispose();
    this.current?.cancel();
    this.current = null;
    this.listeners.clear();
    this.host.remove();
  }

  // --- internals ---

  private emit(event: AgentEvent, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch {
        // listener errors must not break the engine
      }
    }
  }

  private beginPlayback(name: string): Playback | null {
    const anim = this.animMap.get(name);
    if (!anim) return null;
    const pb = new Playback(anim, {
      clock: this.clock,
      rng: this.rng,
      onFrame: (_i, frame) => this.compositor.renderFrame(frame),
    });
    this.current = pb;
    pb.start();
    return pb;
  }

  /**
   * Play an animation to its natural end (or until aborted), resolving the LAST rendered
   * frame index. Forward-only — no return-to-rest (callers add that where appropriate).
   * The resolved index is only meaningful when the signal was NOT aborted (callers must
   * guard on `signal.aborted` before using it to start a return walk).
   */
  private playForward(anim: AnimationModel, signal: AbortSignal): Promise<number> {
    return new Promise<number>((resolve) => {
      if (signal.aborted) {
        resolve(0);
        return;
      }
      let lastIndex = 0;
      const pb = new Playback(anim, {
        clock: this.clock,
        rng: this.rng,
        onFrame: (i, frame) => {
          lastIndex = i;
          this.compositor.renderFrame(frame);
        },
        onEnd: () => finish(),
      });
      this.current = pb;
      const finish = (): void => {
        signal.removeEventListener('abort', onAbort);
        if (this.current === pb) this.current = null;
        resolve(lastIndex);
      };
      const onAbort = (): void => {
        pb.cancel();
        finish();
      };
      signal.addEventListener('abort', onAbort);
      pb.start();
    });
  }

  /** Play a named animation to completion (forward only) — used by state transitions. */
  private async runAnimation(name: string, signal: AbortSignal): Promise<void> {
    const anim = this.animMap.get(name);
    if (anim) await this.playForward(anim, signal);
  }

  /**
   * Play a named gesture animation, HOLDING its end pose on completion (so actions can
   * stack — e.g. point, then speak while pointing). If a previous gesture pose is still
   * held, walk THAT back to rest first so this one starts from rest (no hard cut). The
   * return path follows the held animation's `transitionType` (cycle-8 / ADR-0020).
   */
  private async runGestureAnimation(name: string, signal: AbortSignal): Promise<void> {
    const anim = this.animMap.get(name);
    if (!anim) return;
    // Transition through rest before a different gesture (only when not already at rest).
    if (this.heldAnim && !signal.aborted) {
      await this.returnToRest(this.heldAnim, this.heldIndex, signal);
      this.heldAnim = null;
    }
    if (signal.aborted) return;
    const lastIndex = await this.playForward(anim, signal);
    // Hold the end pose; do NOT auto-return (return happens before the next gesture / on stop).
    if (!signal.aborted) {
      this.heldAnim = anim;
      this.heldIndex = lastIndex;
    }
  }

  /**
   * Find a frame carrying mouth overlays to use as a speak base when the frame on screen
   * has none (cycle-8 #2). Prefers a Speaking/rest/idle state's frame, else the first
   * overlay-bearing frame anywhere. Lazily computed + cached (null = no such frame).
   */
  private findOverlayFrame(): FrameModel | undefined {
    if (this.overlayBaseFrame !== undefined) return this.overlayBaseFrame ?? undefined;
    const hasOverlays = (f: FrameModel): boolean => (f.mouth?.overlays.length ?? 0) > 0;
    for (const state of ['Speaking', 'RestPose', 'IdlingLevel1', 'Showing']) {
      for (const animName of this.model.states[state] ?? []) {
        const frame = this.animMap.get(animName)?.frames.find(hasOverlays);
        if (frame) return (this.overlayBaseFrame = frame);
      }
    }
    for (const anim of this.model.animations) {
      const frame = anim.frames.find(hasOverlays);
      if (frame) return (this.overlayBaseFrame = frame);
    }
    this.overlayBaseFrame = null;
    return undefined;
  }

  /** Walk `anim` back to rest after it finished on frame `lastIndex` (cycle-8 / ADR-0020). */
  private async returnToRest(
    anim: AnimationModel,
    lastIndex: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;
    if (anim.transitionType === 2) return; // authored to end neutral — no return
    if (anim.transitionType === 1) {
      // Exit-branch: follow exitFrame from the last frame to its terminal (rest) frame.
      await this.playIndices(anim, computeExitPath(anim.frames, lastIndex), signal);
      return;
    }
    // Named return animation (transitionType 0): play it forward once (no nesting).
    const ret = anim.returnAnimation ? this.animMap.get(anim.returnAnimation) : undefined;
    if (ret) await this.playForward(ret, signal);
  }

  /** Render a fixed sequence of an animation's frames over the clock; abortable. */
  private playIndices(anim: AnimationModel, indices: number[], signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted || indices.length === 0) {
        resolve();
        return;
      }
      let i = 0;
      let timer: number | null = null;
      const finish = (): void => {
        signal.removeEventListener('abort', onAbort);
        if (timer !== null) this.clock.clearTimeout(timer);
        resolve();
      };
      const onAbort = (): void => finish();
      signal.addEventListener('abort', onAbort);
      const step = (): void => {
        if (signal.aborted) return;
        const frame = anim.frames[indices[i]!];
        if (frame) this.compositor.renderFrame(frame);
        i += 1;
        if (i >= indices.length) {
          finish();
          return;
        }
        timer = this.clock.setTimeout(step, frame?.durationMs ?? 0);
      };
      step();
    });
  }

  private runState(state: string, signal: AbortSignal): Promise<void> {
    const name = animationForState(this.model.states, state, this.rng);
    return name ? this.runAnimation(name, signal) : Promise.resolve();
  }

  /** Loop the Speaking animation for ~ms (silent), then resolve; abort cancels. */
  private speakAnimate(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      this.balloon.show(); // silent path: speech "starts" now (cycle-8 #3)
      const name = animationForState(this.model.states, 'Speaking', this.rng);
      const pb = name ? this.beginPlayback(name) : null;
      let timer: number | null = null;
      const finish = (): void => {
        signal.removeEventListener('abort', onAbort);
        if (timer !== null) this.clock.clearTimeout(timer);
        pb?.cancel();
        if (this.current === pb) this.current = null;
        resolve();
      };
      const onAbort = (): void => finish();
      signal.addEventListener('abort', onAbort);
      timer = this.clock.setTimeout(finish, ms);
    });
  }

  /**
   * Audio-driven speech: play the WAV, loop the Speaking animation, and — synced
   * to audio playback time — composite the viseme mouth overlay (from the active
   * Speaking frame's overlays) + reveal balloon words. Resolves when audio ends
   * or the action aborts (which stops audio, animation, and the ticker at once).
   */
  private async speakWithAudio(result: TtsResult, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    // Loop the Speaking animation while audio plays (if this character has one). The
    // lip-sync ticker sources mouth overlays from whatever frame is ON SCREEN
    // (compositor.currentOverlays) — NOT from a Speaking-state animation — so it works
    // for characters (e.g. Genie) that have no Speaking state and just hold a rest pose
    // whose frames carry the mouth overlays (ADR-0018).
    let looping = true;
    // Holder so the closures below can share the latest Playback (TS can't narrow
    // a `let` reassigned only inside a closure).
    const lp: { pb: Playback | null } = { pb: null };
    const speakingName = animationForState(this.model.states, 'Speaking', this.rng);
    const speakingAnim = speakingName ? this.animMap.get(speakingName) : undefined;
    // Only loop a multi-frame animation. A single static pose (<=1 playable frame)
    // plays once and holds — the mouth overlay carries the motion. Restarting such
    // an animation from onEnd would recurse synchronously (start→finish→onEnd→…)
    // without ever yielding to the clock, so guard against it.
    const canLoop = speakingAnim ? playableLength(speakingAnim.frames) > 1 : false;

    // TODO(cycle-6): remove once the mouth path is confirmed. Diagnostic for "mouth
    // doesn't move" — one line isolating the broken link: timeline lost (events=0),
    // no Speaking state (speaking=none), or frames carry no mouth overlays
    // (overlaysPerFrame all 0). console.info so it shows at the browser's Info level.
    {
      const frames = speakingAnim?.frames ?? [];
      const overlaysPerFrame = frames.map((f) => f.mouth?.overlays.length ?? 0);
      const types = [
        ...new Set(frames.flatMap((f) => (f.mouth?.overlays ?? []).map((o) => o.type))),
      ];
      console.info(
        `[vivify:lipsync] entered: audioBytes=${result.audio.byteLength}, events=${result.mouthTimeline.length}, speaking=${speakingName ?? 'none'}, frames=${frames.length}, overlaysPerFrame=[${overlaysPerFrame.join(',')}], types=[${types.join(',')}], canLoop=${canLoop}`,
      );
    }
    let lipsyncLogged = false;
    let lastLoggedImageIndex: number | null = null;

    const startLoop = (): void => {
      if (!speakingAnim) return;
      const pb = new Playback(speakingAnim, {
        clock: this.clock,
        rng: this.rng,
        onFrame: (_i, frame) => {
          this.compositor.renderFrame(frame);
        },
        onEnd: () => {
          if (looping && !signal.aborted && canLoop) startLoop();
        },
      });
      this.current = pb;
      lp.pb = pb;
      pb.start();
    };
    startLoop();

    // Lip-sync composites the mouth overlay onto the frame ON SCREEN. If this character
    // has no Speaking animation AND the held frame carries no overlays (e.g. a 0-overlay
    // rest pose), render an overlay-bearing base frame so the mouth still moves — the
    // pose-preserving case (held frame HAS overlays) is untouched (cycle-8 #2).
    if (!speakingAnim && this.compositor.currentOverlays().length === 0) {
      const base = this.findOverlayFrame();
      if (base) this.compositor.renderFrame(base);
    }

    let handle: AudioHandle | null = null;
    try {
      handle = await this.audio.play(result.audio);
    } catch {
      handle = null;
    }
    if (!handle || signal.aborted) {
      looping = false;
      lp.pb?.cancel();
      if (this.current === lp.pb) this.current = null;
      handle?.stop();
      return;
    }

    const audioHandle = handle;
    this.balloon.show(); // audio has actually started — reveal the balloon now (cycle-8 #3)
    await new Promise<void>((resolve) => {
      let timer: number | null = null;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (timer !== null) this.clock.clearTimeout(timer);
        looping = false;
        audioHandle.stop();
        lp.pb?.cancel();
        if (this.current === lp.pb) this.current = null;
        this.compositor.setMouthOverlay(null);
        resolve();
      };
      const onAbort = (): void => finish();
      signal.addEventListener('abort', onAbort);
      void audioHandle.ended.then(finish);
      const tick = (): void => {
        if (settled) return;
        const t = audioHandle.currentTimeMs();
        // Interpolate mouth height+width between (sparse) timeline anchors so the mouth
        // MOVES, map to an AgentMouthOverlay type (VoiceMouthOverlay), and select that
        // overlay from the frame currently on screen (ADR-0018, ADR-0017 interim).
        const overlays = this.compositor.currentOverlays();
        const m = interpolatedMouth(result.mouthTimeline, t);
        const chosen = m ? chooseOverlay(m.height, m.width, overlays) : null;
        this.compositor.setMouthOverlay(chosen);
        // TODO(cycle-6): remove once the mouth path is confirmed. Log the first tick's
        // decision + every overlay change, so a moving mouth is visible in the console
        // (and width/type are checkable). A static mouth is then obviously static.
        if (!lipsyncLogged || (chosen?.imageIndex ?? null) !== lastLoggedImageIndex) {
          lipsyncLogged = true;
          lastLoggedImageIndex = chosen?.imageIndex ?? null;
          const hw = m ? `h=${Math.round(m.height)} w=${Math.round(m.width)}` : 'no-event';
          const reason = chosen
            ? `type=${chosen.type} imageIndex=${chosen.imageIndex}`
            : m === null
              ? 'null (no timeline event <= t / empty timeline)'
              : `null (frame has ${overlays.length} mouth overlays)`;
          console.info(`[vivify:lipsync] t=${Math.round(t)} ${hw} -> ${reason}`);
        }
        timer = this.clock.setTimeout(tick, LIPSYNC_TICK_MS);
      };
      tick();
    });
  }

  private tween(toX: number, toY: number, durationMs: number, signal: AbortSignal): Promise<void> {
    const fromX = this.posX;
    const fromY = this.posY;
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const start = this.clock.now();
      let timer: number | null = null;
      const finish = (): void => {
        signal.removeEventListener('abort', onAbort);
        if (timer !== null) this.clock.clearTimeout(timer);
        resolve();
      };
      const onAbort = (): void => finish();
      signal.addEventListener('abort', onAbort);
      const apply = (px: number, py: number): void => {
        this.posX = px;
        this.posY = py;
        this.host.style.left = `${px}px`;
        this.host.style.top = `${py}px`;
      };
      const stepMs = 16;
      const tick = (): void => {
        const t = Math.min(1, (this.clock.now() - start) / durationMs);
        apply(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
        if (t >= 1) {
          finish();
          return;
        }
        timer = this.clock.setTimeout(tick, stepMs);
      };
      tick();
    });
  }
}

/**
 * Create an agent from a raw `.acs` ArrayBuffer or a bundle reference, mounted
 * into `mount` (or document.body). Returns once the character is loaded.
 */
export async function createAgent(
  source: ArrayBuffer | CharacterBundleRef,
  mount?: HTMLElement,
  opts?: CreateAgentOptions,
): Promise<Agent> {
  const model = await loadCharacter(source);
  return createAgentFromModel(model, mount, opts);
}

/**
 * Build an agent from an already-decoded `CharacterModel` (e.g. one produced by
 * `@vivify/acs` directly), skipping the loader. `createAgent` calls this after
 * loading for you.
 */
export function createAgentFromModel(
  model: CharacterModel,
  mount?: HTMLElement,
  opts?: CreateAgentOptions,
): Agent {
  return new VivifyAgent(model, mount, opts);
}
