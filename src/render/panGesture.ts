/**
 * One-finger map dragging, next to OrbitControls (which keeps the two-finger gesture and the mouse).
 *
 * Touch / pen pointers are tracked here, with their own listeners on the same element, registered BEFORE OrbitControls'
 * so they run first. A single finger grabs the ground ({@link GroundGrab}) and moves the camera and its target over it; the
 * pan is applied once per frame by {@link PanGesture.step} (the pointer events only store where the finger is), which also
 * keeps the grab exact while something else moves the camera under a resting finger (damping of a rotation that was just
 * let go, the terrain clearance easing). After the finger lifts a light glide ({@link PanMomentum}) carries on.
 *
 * The state machine, for pointers that arrive while the gesture is allowed (interaction on, no flight):
 *
 *   idle ──1st finger──▶ pan ──2nd finger──▶ multi ──one finger lifts──▶ pan (re-grabbed where that finger is, no jump)
 *                         │                    └──both lift──▶ idle (no glide)
 *                         └──finger lifts──▶ idle (+ glide when it was clearly moving)
 *
 * The two-finger gesture itself (pinch to zoom towards the fingers while the midpoint's drag turns and tilts the view,
 * both at once) is OrbitControls' TOUCH.DOLLY_ROTATE, which sees the same pointers; with TOUCH.ONE disabled it does nothing
 * for one finger. Fingers beyond the second are IGNORED: their events are stopped here, before OrbitControls would see them
 * (which would end the two-finger gesture), so the first two fingers carry on undisturbed. A pen is handled like a finger
 * and likewise hidden from OrbitControls (which would take it for a mouse and pan a second time). The mouse is not touched.
 *
 * Cancelled by: any new touch, a flight ({@link PanGesture.cancel}, fingers stay tracked until they lift), a mode change,
 * interaction being switched off, disposal. At eye level (no pan) the pointers are still tracked, only to ignore extras.
 */
import * as THREE from 'three';
import { GroundGrab, PanMomentum, type GrabSurface } from './groundPan';

export interface PanHost {
  readonly camera: THREE.PerspectiveCamera;
  /** The orbit target (world); the pan moves it together with the camera. */
  target(): THREE.Vector3;
  /** Pointers are accepted now: interaction on and no flight. */
  accepts(): boolean;
  /** One finger pans (orbit and top view); false at eye level, where the finger looks around instead (OrbitControls). */
  canPan(): boolean;
  surface(): GrabSurface | null;
  /** Ground metres one screen pixel stands for at the target (turns the glide's speed into the finger's px/s). */
  metresPerPixel(): number;
  /** A drag began (the view's "interacting" flag; OrbitControls only reports its own gestures and never sees a pen). */
  started(): void;
  /** The last finger of a gesture that called {@link started} is gone. */
  ended(): void;
}

type State = 'idle' | 'pan' | 'multi' | 'off';

export class PanGesture {
  private state: State = 'idle';
  private n = 0;
  private readonly ids = [-1, -1];
  private readonly xs = [0, 0];
  private readonly ys = [0, 0];
  /** Hidden from OrbitControls (a pen). */
  private readonly hide = [false, false];
  /** Fingers beyond the second, for as long as they are down. */
  private readonly extra = new Set<number>();
  private readonly grab = new GroundGrab();
  private readonly momentum = new PanMomentum();
  private ndcX = 0;
  private ndcY = 0;
  private lastT = -1;
  private dt = 0;
  private intended = 0;
  /** `started` was reported and `ended` not yet. */
  private live = false;
  private readonly move = new THREE.Vector3();
  private readonly listeners: [string, (e: PointerEvent) => void, AddEventListenerOptions][];

  constructor(
    private readonly el: HTMLElement,
    private readonly host: PanHost,
  ) {
    const cap: AddEventListenerOptions = { capture: true };
    const capPassive: AddEventListenerOptions = { capture: true, passive: true };
    this.listeners = [
      ['pointerdown', this.onDown, cap],
      ['pointermove', this.onMove, capPassive],
      ['pointerup', this.onUp, capPassive],
      ['pointercancel', this.onUp, capPassive],
      ['lostpointercapture', this.onLost, capPassive],
    ];
    for (const [type, fn, opt] of this.listeners) el.addEventListener(type, fn as EventListener, opt);
  }

  /** A one-finger drag is in progress. */
  get panning(): boolean {
    return this.state === 'pan';
  }

  /** The glide after a release is running (a touch now stops it). */
  get gliding(): boolean {
    return this.momentum.gliding;
  }

  // ───────────────────────────── events ─────────────────────────────

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (e.isPrimary && e.pointerType === 'touch') this.forgetAll(); // the first finger of a group: anything still tracked missed its end
    if (!this.host.accepts()) return;
    const id = e.pointerId;
    // A press of a pointer that is still tracked: its end never arrived (a pen lifted somewhere else), so it starts afresh.
    const old = this.slot(id);
    if (old >= 0) this.release(old, null);
    this.extra.delete(id);
    this.momentum.stop();
    if (this.n >= 2) {
      this.extra.add(id);
      e.stopImmediatePropagation(); // OrbitControls must not see a third finger
      return;
    }
    const hide = e.pointerType === 'pen' && this.host.canPan();
    if (hide) {
      e.stopImmediatePropagation();
      // OrbitControls captures the pointer it takes for a mouse; it never sees this one. The browser captures a finger by itself,
      // but not a pen: without this a stroke that leaves the canvas would lose its end (the slot would be stuck, the pan dead).
      try {
        this.el.setPointerCapture(id);
      } catch {
        /* the pointer is already gone */
      }
    }
    const s = this.n++;
    this.ids[s] = id;
    this.xs[s] = e.clientX;
    this.ys[s] = e.clientY;
    this.hide[s] = hide;
    if (this.n === 1) {
      if (this.host.canPan()) this.startPan(e.clientX, e.clientY);
      else this.state = 'off'; // eye level: OrbitControls looks around, nothing to do here but count
    } else {
      this.flush(); // the last move of the pan is not lost; the two-finger gesture takes over from here
      this.grab.clear();
      this.state = 'multi';
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const id = e.pointerId;
    if (this.extra.has(id)) {
      e.stopImmediatePropagation();
      return;
    }
    const s = this.slot(id);
    if (s < 0) return;
    if (this.hide[s]) e.stopImmediatePropagation();
    this.xs[s] = e.clientX;
    this.ys[s] = e.clientY; // (applied once per frame by step(): a move event only says where the finger is)
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const id = e.pointerId;
    if (this.extra.delete(id)) {
      e.stopImmediatePropagation();
      return;
    }
    const s = this.slot(id);
    if (s < 0) return;
    if (this.hide[s]) e.stopImmediatePropagation();
    this.release(s, e.type === 'pointerup' ? e : null);
  };

  /** A tracked pointer lost its capture without an up / cancel: end it like a cancel. */
  private readonly onLost = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const s = this.slot(e.pointerId);
    if (s >= 0) this.release(s, null);
  };

  private release(s: number, up: PointerEvent | null): void {
    if (this.state === 'pan' && up) {
      this.xs[s] = up.clientX;
      this.ys[s] = up.clientY;
      this.flush(); // the finger's final position
    }
    const wasPan = this.state === 'pan';
    this.uncapture(s);
    for (let i = s; i < this.n - 1; i++) {
      this.ids[i] = this.ids[i + 1]!;
      this.xs[i] = this.xs[i + 1]!;
      this.ys[i] = this.ys[i + 1]!;
      this.hide[i] = this.hide[i + 1]!;
    }
    this.n--;
    if (this.n === 0) {
      this.grab.clear();
      this.state = 'idle';
      this.finish();
      // Light inertia only for a finger that was clearly moving when it lifted (not for a cancel).
      if (wasPan && up) this.momentum.release(this.host.metresPerPixel());
      else this.momentum.stop();
    } else if (this.host.accepts() && this.host.canPan()) {
      // 2 → 1: the finger that is left carries on as a pan from where it is (re-grabbed: no jump).
      this.startPan(this.xs[0]!, this.ys[0]!);
    } else this.state = 'off';
  }

  private slot(id: number): number {
    return id === this.ids[0] && this.n > 0 ? 0 : id === this.ids[1] && this.n > 1 ? 1 : -1;
  }

  /** Give back the capture taken for a pen (slot `s`). The browser drops it itself when the pointer goes up. */
  private uncapture(s: number): void {
    if (!this.hide[s]) return;
    try {
      this.el.releasePointerCapture(this.ids[s]!);
    } catch {
      /* it went with the pointer */
    }
  }

  private uncaptureAll(): void {
    for (let s = 0; s < this.n; s++) this.uncapture(s);
  }

  /** Drop every tracked pointer (a fresh group of contacts begins, so the old ones are stale). */
  private forgetAll(): void {
    if (this.n === 0 && this.extra.size === 0) return;
    this.uncaptureAll();
    this.n = 0;
    this.extra.clear();
    this.grab.clear();
    this.momentum.stop();
    this.state = 'idle';
    this.finish();
  }

  // ───────────────────────────── the pan ─────────────────────────────

  /** Grab the ground under the finger (slot 0) as it is now; the velocity of the drag goes on. */
  private regrab(): void {
    this.host.camera.updateMatrixWorld();
    this.ndc(this.xs[0]!, this.ys[0]!);
    this.grab.begin(this.host.camera, this.ndcX, this.ndcY, this.host.target(), this.host.surface());
  }

  private startPan(cx: number, cy: number): void {
    this.xs[0] = cx;
    this.ys[0] = cy;
    this.regrab();
    this.momentum.stop();
    this.state = 'pan';
    if (!this.live) {
      this.live = true;
      this.host.started();
    }
  }

  private finish(): void {
    if (!this.live) return;
    this.live = false;
    this.host.ended();
  }

  private ndc(cx: number, cy: number): void {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.ndcX = ((cx - r.left) / w) * 2 - 1;
    this.ndcY = -((cy - r.top) / h) * 2 + 1;
  }

  /** Move the camera now so the grabbed point is under the finger (a pan has one finger: slot 0). */
  private flush(): void {
    if (this.state !== 'pan' || !this.grab.active) return;
    this.ndc(this.xs[0]!, this.ys[0]!);
    if (this.grab.solve(this.host.camera, this.ndcX, this.ndcY, this.move)) {
      this.host.camera.position.add(this.move);
      this.host.target().add(this.move);
    }
  }

  /**
   * Once per frame, after OrbitControls' own update and before the clamps: keep the grabbed point under the finger, or run
   * the glide. `now` is the frame time (ms).
   */
  step(now: number): void {
    // The real time since the previous frame (a slow phone must not read a slow drag as a fast one); a gap of seconds (the
    // page was in the background) is not a time step.
    const gap = this.lastT < 0 ? 0 : (now - this.lastT) / 1000;
    // Frames that stopped for a while (a screen covered the map, the page was hidden) end a glide: it would only jump ahead, or
    // start again when the map comes back.
    if (gap > 0.5) this.momentum.stop();
    const dt = gap > 0 && gap <= 2 ? gap : 0;
    this.lastT = now;
    this.dt = dt;
    this.intended = 0;
    if (this.state === 'pan') {
      if (!this.host.accepts() || !this.host.canPan()) {
        this.cancel();
        return;
      }
      this.move.set(0, 0, 0);
      this.flush();
      this.intended = Math.hypot(this.move.x, this.move.z);
    } else if (this.momentum.gliding) {
      if (!this.host.accepts() || !this.host.canPan()) {
        this.momentum.stop();
        return;
      }
      if (this.momentum.step(dt, this.host.metresPerPixel(), this.move)) {
        this.host.camera.position.add(this.move);
        this.host.target().add(this.move);
        this.intended = Math.hypot(this.move.x, this.move.z);
      }
    }
  }

  /**
   * After the clamps: the translation (dx, dz) the pan or the glide really achieved this frame. It feeds the velocity of
   * a drag, and ends a glide that is pushing against the edge of the domain.
   */
  settle(dx: number, dz: number): void {
    if (this.state === 'pan') {
      this.momentum.track(dx, dz, this.dt);
      // The edge of the domain held the view back (the clamp took part of the translation away): the finger is now ahead of the
      // ground it grabbed. Grab again where it is, so that a finger that turns back is followed at once instead of having to
      // travel back over everything it dragged beyond the edge first.
      if (this.intended > 1e-6 && Math.hypot(dx - this.move.x, dz - this.move.z) > 0.02 * this.intended + 0.01) this.regrab();
    } else if (this.momentum.gliding && this.intended > 1e-9 && Math.hypot(dx, dz) < 0.3 * this.intended) this.momentum.stop();
  }

  /**
   * The view moved under a drag by something else (a vertical-exaggeration change): grab again where the finger is, so
   * the ground that was under it is the ground under it now.
   */
  rebase(): void {
    if (this.state === 'pan') this.startPan(this.xs[0]!, this.ys[0]!);
  }

  /** Stop the glide only (a wheel turn or a mouse drag began). */
  stopGlide(): void {
    this.momentum.stop();
  }

  /** Stop the glide and any drag in progress (a flight, a mode change, interaction off). Fingers stay tracked until they lift. */
  cancel(): void {
    this.momentum.stop();
    this.grab.clear();
    if (this.state === 'pan' || this.state === 'multi') this.state = this.n > 0 ? 'off' : 'idle';
  }

  /** Drop everything, fingers included. */
  reset(): void {
    this.uncaptureAll();
    this.n = 0;
    this.extra.clear();
    this.grab.clear();
    this.momentum.stop();
    this.state = 'idle';
    this.finish();
  }

  dispose(): void {
    for (const [type, fn, opt] of this.listeners) this.el.removeEventListener(type, fn as EventListener, opt);
    this.reset();
  }
}
