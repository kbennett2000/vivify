// Cycle 3 — serial action queue. Actions run strictly in order; stopCurrent
// aborts the running action (queue continues); stop clears pending + aborts;
// aborted actions resolve (do not reject). See docs/cycles/cycle-3-renderer.md.

import { describe, it, expect } from 'vitest';
import { ActionQueue } from '../src/queue.js';

/** A controllable async action: resolves only when release() or abort fires. */
function deferredAction(log: string[], label: string) {
  let release!: () => void;
  const action = (signal: AbortSignal): Promise<void> =>
    new Promise<void>((resolve) => {
      log.push(`start:${label}`);
      release = () => {
        log.push(`done:${label}`);
        resolve();
      };
      if (signal.aborted) {
        log.push(`abort:${label}`);
        resolve();
        return;
      }
      signal.addEventListener('abort', () => {
        log.push(`abort:${label}`);
        resolve();
      });
    });
  return { action, release: () => release() };
}

describe('ActionQueue', () => {
  it('runs actions strictly in order', async () => {
    const queue = new ActionQueue();
    const log: string[] = [];

    const mk = (label: string) => async () => {
      log.push(`start:${label}`);
      await Promise.resolve();
      log.push(`end:${label}`);
    };

    const p1 = queue.enqueue(mk('a'));
    const p2 = queue.enqueue(mk('b'));
    const p3 = queue.enqueue(mk('c'));

    await Promise.all([p1, p2, p3]);

    expect(log).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  });

  it('stopCurrent aborts the running action and the next still runs', async () => {
    const queue = new ActionQueue();
    const log: string[] = [];

    const first = deferredAction(log, 'a');
    const second = deferredAction(log, 'b');

    const p1 = queue.enqueue(first.action);
    const p2 = queue.enqueue(second.action);

    // Let the pump start the first action.
    await Promise.resolve();
    expect(log).toEqual(['start:a']);

    queue.stopCurrent(); // aborts 'a' → it resolves
    await p1; // aborted action resolves (does not reject)

    // The second action proceeds; release it to finish.
    await Promise.resolve();
    expect(log).toContain('start:b');
    second.release();
    await p2;

    expect(log).toEqual(['start:a', 'abort:a', 'start:b', 'done:b']);
  });

  it('aborted actions resolve rather than reject', async () => {
    const queue = new ActionQueue();
    const log: string[] = [];
    const a = deferredAction(log, 'x');

    const p = queue.enqueue(a.action);
    await Promise.resolve();
    queue.stopCurrent();

    await expect(p).resolves.toBeUndefined();
  });

  it('stop clears pending actions (they resolve, never run) and aborts current', async () => {
    const queue = new ActionQueue();
    const log: string[] = [];

    const running = deferredAction(log, 'run');
    const neverA = deferredAction(log, 'pendA');
    const neverB = deferredAction(log, 'pendB');

    const p1 = queue.enqueue(running.action);
    const p2 = queue.enqueue(neverA.action);
    const p3 = queue.enqueue(neverB.action);

    await Promise.resolve();
    expect(log).toEqual(['start:run']);
    expect(queue.pending).toBe(2);

    queue.stop();

    // All promises resolve, the pending two never start.
    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([undefined, undefined, undefined]);
    expect(queue.pending).toBe(0);
    expect(log).toEqual(['start:run', 'abort:run']);
    expect(log).not.toContain('start:pendA');
    expect(log).not.toContain('start:pendB');
  });

  it('pending reflects not-yet-started actions', async () => {
    const queue = new ActionQueue();
    const log: string[] = [];
    const running = deferredAction(log, 'r');

    const p1 = queue.enqueue(running.action);
    queue.enqueue(async () => {});
    queue.enqueue(async () => {});

    await Promise.resolve();
    expect(queue.pending).toBe(2);

    running.release();
    await p1;
  });

  it('dispose makes subsequent enqueues resolve without running', async () => {
    const queue = new ActionQueue();
    const log: string[] = [];

    queue.dispose();
    await expect(
      queue.enqueue(async () => {
        log.push('ran');
      }),
    ).resolves.toBeUndefined();
    expect(log).toEqual([]);
  });
});
