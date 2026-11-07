/**
 * The hold of the engine's run loop (contract 0.8.0 J, 3.2: flow control): continuations run on wake-ups, wait while the
 * gate is held, and run in order when it is lifted.
 */
import { describe, expect, it } from 'vitest';
import { HoldGate } from './holdGate';

function rig(): { gate: HoldGate; wakes: () => number; ran: string[]; pump: () => void } {
  let wakes = 0;
  const ran: string[] = [];
  const gate = new HoldGate(() => void wakes++);
  /** Deliver the wake-ups posted so far, the way the channel would. */
  const pump = (): void => {
    const n = wakes;
    wakes = 0;
    for (let i = 0; i < n; i++) gate.onWake();
  };
  return { gate, wakes: () => wakes, ran, pump };
}

describe('HoldGate', () => {
  it('runs a scheduled function after one wake-up', () => {
    const { gate, wakes, ran, pump } = rig();
    gate.schedule(() => ran.push('a'));
    expect(wakes()).toBe(1);
    expect(ran).toEqual([]);
    pump();
    expect(ran).toEqual(['a']);
  });

  it('runs a function scheduled by a running function, one wake-up at a time (the run loop)', () => {
    const { gate, ran, pump } = rig();
    let n = 0;
    const loop = (): void => {
      ran.push(`chunk ${++n}`);
      if (n < 3) gate.schedule(loop);
    };
    gate.schedule(loop);
    for (let i = 0; i < 5; i++) pump();
    expect(ran).toEqual(['chunk 1', 'chunk 2', 'chunk 3']);
  });

  it('keeps a function back while held, even when wake-ups arrive, and runs it when the hold is lifted', () => {
    const { gate, wakes, ran, pump } = rig();
    gate.hold(true);
    gate.schedule(() => ran.push('a'));
    expect(wakes()).toBe(0);
    pump();
    expect(ran).toEqual([]);
    expect(gate.isHeld).toBe(true);
    expect(gate.waiting).toBe(1);
    gate.hold(false);
    expect(wakes()).toBe(1);
    pump();
    expect(ran).toEqual(['a']);
    expect(gate.waiting).toBe(0);
  });

  it('a wake-up already on its way when the hold starts does not run anything, and the function waits for the lift', () => {
    const { gate, ran, pump } = rig();
    gate.schedule(() => ran.push('a'));
    gate.hold(true); // the wake-up is posted but not yet delivered
    pump();
    expect(ran).toEqual([]);
    gate.hold(false);
    pump();
    expect(ran).toEqual(['a']);
  });

  it('runs what was waiting in order, and an extra wake-up is harmless', () => {
    const { gate, ran, pump } = rig();
    gate.hold(true);
    gate.schedule(() => ran.push('a'));
    gate.schedule(() => ran.push('b'));
    gate.hold(false);
    gate.onWake();
    gate.onWake();
    gate.onWake(); // nothing is left
    pump();
    expect(ran).toEqual(['a', 'b']);
    gate.hold(false);
    pump();
    expect(ran).toEqual(['a', 'b']);
  });
});
