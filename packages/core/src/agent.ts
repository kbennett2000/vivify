// createAgent + a no-op Agent. Cycle 0 stub: the real engine (compositing,
// timing, branching, action queue, balloon, lip-sync) lands in Cycle 3+.

import type { Agent, AgentEvent, CharacterBundleRef, MoveOptions, SpeakOptions } from './types.js';

/**
 * A no-op Agent. Every method exists and is safe to call: async methods resolve
 * immediately, `animations()` returns an empty list, and the rest are inert.
 */
class NoopAgent implements Agent {
  async show(): Promise<void> {}
  async hide(): Promise<void> {}
  async play(_animationName: string): Promise<void> {}
  animations(): string[] {
    return [];
  }
  async speak(_text: string, _opts?: SpeakOptions): Promise<void> {}
  async moveTo(_x: number, _y: number, _opts?: MoveOptions): Promise<void> {}
  async gestureAt(_x: number, _y: number): Promise<void> {}
  stopCurrent(): void {}
  stop(): void {}
  on(_event: AgentEvent, _handler: (...a: unknown[]) => void): void {}
  dispose(): void {}
}

/**
 * Create an agent from a raw .acs buffer or a bundle reference, mounting into
 * the given element. Cycle 0 stub: returns a no-op Agent without loading,
 * decoding, or rendering anything.
 */
export async function createAgent(
  _source: ArrayBuffer | CharacterBundleRef,
  _mount?: HTMLElement,
): Promise<Agent> {
  return new NoopAgent();
}
