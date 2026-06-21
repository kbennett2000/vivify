// Injectable clock so playback timing is deterministic under test. The real
// clock wraps the host timers; tests pass a fake clock that advances manually.

export interface Clock {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  now(): number;
}

export const realClock: Clock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};
