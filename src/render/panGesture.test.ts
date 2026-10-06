/**
 * The pointer bookkeeping of PanGesture on its own (a fake element and a fake host, no OrbitControls): a pen is captured while
 * it is down (the browser captures a finger by itself, but not a pen: a stroke that leaves the canvas would lose its end), a
 * press whose end never arrived starts afresh, and every capture that was taken is given back.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { PanGesture, type PanHost } from './panGesture';

type Handler = (e: FakePointer) => void;
interface FakePointer {
  type: string;
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  stopped: boolean;
  stopImmediatePropagation(): void;
}

class FakeElement {
  readonly listeners: { type: string; fn: Handler }[] = [];
  /** Pointer ids captured now (what setPointerCapture / releasePointerCapture leave). */
  readonly captured = new Set<number>();
  addEventListener(type: string, fn: Handler): void {
    this.listeners.push({ type, fn });
  }
  removeEventListener(type: string, fn: Handler): void {
    const i = this.listeners.findIndex((l) => l.type === type && l.fn === fn);
    if (i >= 0) this.listeners.splice(i, 1);
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 400, height: 800 };
  }
  fire(type: string, init: Partial<FakePointer>): FakePointer {
    const e: FakePointer = {
      type,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: false,
      clientX: 0,
      clientY: 0,
      stopped: false,
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...init,
    };
    for (const l of [...this.listeners]) if (l.type === type && !e.stopped) l.fn(e);
    return e;
  }
}

interface Setup {
  el: FakeElement;
  gesture: PanGesture;
  camera: THREE.PerspectiveCamera;
  events: string[];
  host: { canPan: boolean; accepts: boolean };
  /** Run the per-frame step (16 ms) n times. */
  frames(n: number): void;
}

function setup(): Setup {
  const el = new FakeElement();
  const camera = new THREE.PerspectiveCamera(50, 0.5, 1, 100000);
  camera.position.set(0, 3000, 4000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const target = new THREE.Vector3(0, 0, 0);
  const flags = { canPan: true, accepts: true };
  const events: string[] = [];
  const host: PanHost = {
    camera,
    target: () => target,
    accepts: () => flags.accepts,
    canPan: () => flags.canPan,
    surface: () => null,
    metresPerPixel: () => 5,
    started: () => events.push('start'),
    ended: () => events.push('end'),
  };
  const gesture = new PanGesture(el as unknown as HTMLElement, host);
  let clock = 1000;
  return {
    el,
    gesture,
    camera,
    events,
    host: flags,
    frames(n) {
      for (let i = 0; i < n; i++) {
        clock += 16;
        gesture.step(clock);
      }
    },
  };
}

describe('PanGesture pointer bookkeeping', () => {
  let s: Setup;
  beforeEach(() => {
    s = setup();
  });

  it('captures a pen while it is down (OrbitControls never sees it) and gives the capture back when it lifts', () => {
    const down = s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(down.stopped).toBe(true);
    expect(s.el.captured.has(7)).toBe(true);
    s.el.fire('pointerup', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 500 });
    expect(s.el.captured.size).toBe(0);
    expect(s.events).toEqual(['start', 'end']);
  });

  it('leaves a finger to the browser (its capture is implicit) and to OrbitControls', () => {
    const down = s.el.fire('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 500 });
    expect(down.stopped).toBe(false);
    expect(s.el.captured.size).toBe(0);
    s.el.fire('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 500 });
  });

  it('does not capture or hide a pen at eye level, where OrbitControls looks around with it', () => {
    s.host.canPan = false;
    const down = s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(down.stopped).toBe(false);
    expect(s.el.captured.size).toBe(0);
    s.el.fire('pointerup', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 500 });
  });

  it('a pen whose lift was never heard (it ended outside the canvas) does not block the next stroke, which starts where the pen lands', () => {
    // Reference: a fresh stroke from y 600 to y 580.
    const ref = setup();
    ref.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 600 });
    const r0 = ref.camera.position.clone();
    ref.el.fire('pointermove', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 580 });
    ref.frames(2);
    const expected = ref.camera.position.distanceTo(r0);
    expect(expected).toBeGreaterThan(20);

    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    s.el.fire('pointermove', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 450 });
    s.frames(2);
    // ... the pen goes up somewhere else: no pointerup arrives here. The same pen touches down again, 150 px lower.
    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 600 });
    expect(s.gesture.panning).toBe(true);
    s.frames(2);
    const p0 = s.camera.position.clone();
    s.el.fire('pointermove', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 580 });
    s.frames(2);
    // Only the 20 px of the new stroke move the view (not the 170 px from where the lost stroke left off).
    expect(s.camera.position.distanceTo(p0)).toBeCloseTo(expected, 0);
    s.el.fire('pointerup', { pointerId: 7, pointerType: 'pen', clientX: 200, clientY: 580 });
    expect(s.el.captured.size).toBe(0);
    // Every start has its end.
    expect(s.events.filter((e) => e === 'start').length).toBe(s.events.filter((e) => e === 'end').length);
    expect(s.events.at(-1)).toBe('end');
  });

  it('gives every capture back when the gesture is reset (finger drawing took over) or disposed', () => {
    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(s.el.captured.size).toBe(1);
    s.gesture.reset();
    expect(s.el.captured.size).toBe(0);
    s.el.fire('pointerdown', { pointerId: 8, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(s.el.captured.size).toBe(1);
    s.gesture.dispose();
    expect(s.el.captured.size).toBe(0);
    expect(s.el.listeners.length).toBe(0);
  });

  it('a first finger of a new group drops a pen that is still tracked and its capture', () => {
    s.el.fire('pointerdown', { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: 200, clientY: 500 });
    expect(s.el.captured.has(7)).toBe(true);
    s.el.fire('pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 400 });
    expect(s.el.captured.size).toBe(0);
    expect(s.gesture.panning).toBe(true);
    s.el.fire('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 100, clientY: 400 });
    expect(s.events.at(-1)).toBe('end');
  });
});
