// Serial action queue (classic Agent semantics: every action enqueues and runs
// in order). Each action receives an AbortSignal; `stopCurrent` aborts the
// running action and the queue continues, `stop` clears pending + aborts.
// Pure logic (no DOM); unit-tested.

export type QueuedAction = (signal: AbortSignal) => Promise<void>;

interface QueueItem {
  action: QueuedAction;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class ActionQueue {
  private items: QueueItem[] = [];
  private running = false;
  private current: AbortController | null = null;
  private disposed = false;

  /** Resolves when the action completes (or is aborted — aborts resolve quietly). */
  enqueue(action: QueuedAction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.disposed) {
        resolve();
        return;
      }
      this.items.push({ action, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.items.length > 0) {
        const item = this.items.shift()!;
        const controller = new AbortController();
        this.current = controller;
        try {
          await item.action(controller.signal);
          item.resolve();
        } catch (err) {
          // Abort is a normal control-flow signal (stop/stopCurrent), not an error.
          if (controller.signal.aborted) item.resolve();
          else item.reject(err);
        } finally {
          this.current = null;
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Abort the running action; the queue proceeds to the next item. */
  stopCurrent(): void {
    this.current?.abort();
  }

  /** Drop all pending actions (they resolve) and abort the running one. */
  stop(): void {
    const pending = this.items.splice(0);
    for (const item of pending) item.resolve();
    this.current?.abort();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /** Number of pending (not-yet-started) actions. */
  get pending(): number {
    return this.items.length;
  }
}
