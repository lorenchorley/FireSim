/**
 * The yield of the engine's run loop, with a hold (contract 0.8.0 J, 3.2). `SimHost` runs in chunks and calls `schedule(fn)`
 * to continue after a pause that lets the worker's message queue run. In the worker the pause is an immediate
 * (`wake`, engineWorker.ts: a MessageChannel post to itself would not let the queue run, see there); while the link to the client is behind the gate keeps the continuation back until the hold is lifted, so a
 * run that produces pictures faster than the link carries them slows down and does not fill the host's memory. Pure: the wake-up
 * is passed in, so it is tested without a thread.
 */
export class HoldGate {
  private readonly pending: (() => void)[] = [];
  private held = false;

  constructor(private readonly wake: () => void) {}

  /** Run `fn` after the next wake-up, unless the gate is held (then after the hold is lifted). */
  readonly schedule = (fn: () => void): void => {
    this.pending.push(fn);
    if (!this.held) this.wake();
  };

  /** A wake-up arrived: run the oldest continuation (none while held; an extra wake-up does nothing). */
  onWake(): void {
    if (this.held) return;
    this.pending.shift()?.();
  }

  hold(on: boolean): void {
    this.held = on;
    if (!on) for (let i = 0; i < this.pending.length; i++) this.wake();
  }

  get isHeld(): boolean {
    return this.held;
  }

  get waiting(): number {
    return this.pending.length;
  }
}
