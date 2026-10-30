/**
 * The two-finger turn of the orbit and top views, owned here so that OrbitControls is used through its public API only.
 *
 * OrbitControls' two-finger gesture (TOUCH.DOLLY_ROTATE) pinches and turns at once. The pinch (zoom towards the fingers) stays
 * its own. The turn goes the wrong way round for this app: a drag to the right must turn the camera anticlockwise seen from
 * above, so the world seems to turn clockwise under the fingers. Mirroring it used to mean overriding two private members of
 * three r186's OrbitControls (`_rotateLeft`, `_handleTouchMoveDollyRotate`); a three upgrade could break that without a type
 * error. Now:
 *
 *  - The two touch fingers are tracked here, with capture listeners on the same element, registered BEFORE OrbitControls' own
 *    (and after PanGesture's, which hides a third finger from both). While two fingers are down in a view where they pinch and
 *    turn (`touches.TWO` is DOLLY_ROTATE: orbit and top; at eye level it is ROTATE and nothing here runs), `enableRotate` is held
 *    false, so the stock DOLLY_ROTATE handlers do the pinch and skip their own turn.
 *  - The drag of the midpoint of the two fingers is turned into azimuth and polar steps exactly as OrbitControls turns it (2π ·
 *    rotateSpeed per screen height), the azimuth the other way round. They are kept here, not applied.
 *  - {@link TwoFingerTurn.step}, called from the overridden `update()` before OrbitControls' own work, applies one damped step
 *    to the camera about the orbit target and lets the rest run out, the way OrbitControls damps its own rotation: the same
 *    factor per `update()` call, so the turn goes on after the fingers lift (inertia) and stops at the polar limits.
 *
 * `enableRotate` is given back to true as soon as the pair of fingers ends: a finger lifts, a cancel, a lost capture, a finger
 * that starts a new group, a view-mode change ({@link TwoFingerTurn.cancel}) or disposal. It is not given back by a flight or by
 * interaction being switched off: OrbitControls' own gesture is still the pinch of those two fingers (it ignores them while it is
 * disabled and carries on afterwards), and its stock turn must not take over in the other direction while they are down.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const TWO_PI = 2 * Math.PI;

export class TwoFingerTurn {
  private n = 0;
  private readonly ids = [-1, -1];
  private readonly xs = [0, 0];
  private readonly ys = [0, 0];
  /** Two fingers are down and turn the view: OrbitControls' own turn is held off (`enableRotate` false). */
  private held = false;
  /** Midpoint of the two fingers at the last move that was handled (CSS px). */
  private mx = 0;
  private my = 0;
  /** What is left of the turn (azimuth) and the tilt (polar angle), radians: {@link TwoFingerTurn.step} applies it, damped. */
  private theta = 0;
  private phi = 0;
  private readonly offset = new THREE.Vector3();
  private readonly spherical = new THREE.Spherical();
  private readonly listeners: [string, (e: PointerEvent) => void, AddEventListenerOptions][];

  /** `controls` is a function because the controls are built after this (their listeners must come after ours). */
  constructor(
    private readonly el: HTMLElement,
    private readonly controls: () => OrbitControls,
  ) {
    const cap: AddEventListenerOptions = { capture: true };
    const capPassive: AddEventListenerOptions = { capture: true, passive: true };
    this.listeners = [
      ['pointerdown', this.onDown, cap],
      ['pointermove', this.onMove, capPassive],
      ['pointerup', this.onEnd, capPassive],
      ['pointercancel', this.onEnd, capPassive],
      ['lostpointercapture', this.onEnd, capPassive],
    ];
    for (const [type, fn, opt] of this.listeners) el.addEventListener(type, fn as EventListener, opt);
  }

  // ───────────────────────────── events ─────────────────────────────

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) this.forgetAll(); // the first finger of a group: anything still tracked missed its end
    const c = this.controls();
    if (!c.enabled) return; // a flight or finger drawing: OrbitControls takes no part, and neither does this
    const old = this.slot(e.pointerId);
    if (old >= 0) this.release(old); // a press of a finger that is still tracked: its end never arrived
    if (this.n >= 2) return; // (PanGesture hides fingers beyond the second before they get here)
    const s = this.n++;
    this.ids[s] = e.pointerId;
    this.xs[s] = e.clientX;
    this.ys[s] = e.clientY;
    if (this.n === 2 && c.touches.TWO === THREE.TOUCH.DOLLY_ROTATE && c.enableRotate) {
      this.held = true;
      c.enableRotate = false;
      this.mx = 0.5 * (this.xs[0]! + this.xs[1]!);
      this.my = 0.5 * (this.ys[0]! + this.ys[1]!);
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const s = this.slot(e.pointerId);
    const c = this.controls();
    if (s < 0 || !c.enabled) return;
    this.xs[s] = e.clientX;
    this.ys[s] = e.clientY;
    if (!this.held) return;
    // As OrbitControls' touch rotate: the midpoint's step, times rotateSpeed, is 2π per screen height ("yes, height"). Its azimuth
    // step is taken off the azimuth (`theta -= angle`); here it is added: that is the mirrored turn.
    const x = 0.5 * (this.xs[0]! + this.xs[1]!);
    const y = 0.5 * (this.ys[0]! + this.ys[1]!);
    const h = this.el.clientHeight;
    this.theta += (TWO_PI * ((x - this.mx) * c.rotateSpeed)) / h;
    this.phi -= (TWO_PI * ((y - this.my) * c.rotateSpeed)) / h;
    this.mx = x;
    this.my = y;
  };

  /** A finger's pointerup, pointercancel or lostpointercapture (the browser's own end of a finger that never sent one). */
  private readonly onEnd = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const s = this.slot(e.pointerId);
    if (s >= 0) this.release(s);
  };

  private release(s: number): void {
    this.free(); // fewer than two fingers: the pinch-and-turn is over (OrbitControls ends its own gesture on the same event)
    for (let i = s; i < this.n - 1; i++) {
      this.ids[i] = this.ids[i + 1]!;
      this.xs[i] = this.xs[i + 1]!;
      this.ys[i] = this.ys[i + 1]!;
    }
    this.n--;
  }

  private slot(id: number): number {
    return id === this.ids[0] && this.n > 0 ? 0 : id === this.ids[1] && this.n > 1 ? 1 : -1;
  }

  /** Drop every tracked finger (a fresh group of contacts begins, so the old ones are stale). */
  private forgetAll(): void {
    this.free();
    this.n = 0;
  }

  /** Give OrbitControls' own turn back. */
  private free(): void {
    if (!this.held) return;
    this.held = false;
    this.controls().enableRotate = true;
  }

  // ───────────────────────────── the rig ─────────────────────────────

  /**
   * The view mode changed under the fingers (the rig has ended OrbitControls' gesture; the fingers stay tracked and do nothing
   * until they lift): the turn ends too. What is left of it still runs out.
   */
  cancel(): void {
    this.free();
  }

  /** The rig set `enableRotate` for a view mode: a pair of fingers that is still turning keeps OrbitControls' own turn off. */
  keepHeld(): void {
    if (this.held) this.controls().enableRotate = false;
  }

  /**
   * One damped step of the turn and tilt, applied to the camera about the orbit target. Called from `update()` before
   * OrbitControls' own work (which re-reads the camera, adds a mouse or pinch step, and looks at the target), so it runs for every
   * call, the extra ones OrbitControls makes after each touch move included. The same arithmetic as OrbitControls' damping:
   * a share `dampingFactor` of what is left is applied (all of it without damping), the polar angle kept within its limits.
   */
  step(): void {
    if (this.theta === 0 && this.phi === 0) return;
    const c = this.controls();
    const f = c.enableDamping ? c.dampingFactor : 1;
    const dTheta = this.theta * f;
    const dPhi = this.phi * f;
    this.theta *= 1 - f;
    this.phi *= 1 - f;
    const camera = c.object.position;
    this.offset.copy(camera).sub(c.target); // (the camera's up is +y, as everywhere in the app)
    this.spherical.setFromVector3(this.offset);
    this.spherical.theta += dTheta;
    this.spherical.phi = Math.max(c.minPolarAngle, Math.min(c.maxPolarAngle, this.spherical.phi + dPhi));
    this.spherical.makeSafe();
    this.offset.setFromSpherical(this.spherical);
    camera.copy(c.target).add(this.offset);
  }

  dispose(): void {
    for (const [type, fn, opt] of this.listeners) this.el.removeEventListener(type, fn as EventListener, opt);
    this.forgetAll();
    this.theta = 0;
    this.phi = 0;
  }
}
