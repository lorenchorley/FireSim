/**
 * Camera and touch controls, tuned for phones, damping, distance/tilt limits, a terrain-clearance clamp, animated fly-to
 * and three view modes:
 *   orbit   oblique 3-D view around a target on the ground
 *   top     plan view (north up unless rotated), for overlays and marking fire
 *   ground  eye level (1.7 m) at the user's position, looking towards the fire — "what you would see from here"
 *
 * Gestures in orbit and top view (the same in both):
 *   ONE finger drag     displaces the view like grabbing the map: the ground under the finger stays under it
 *                       ({@link PanGesture} / {@link GroundGrab}), with a light glide after the finger lifts
 *   TWO fingers         OrbitControls' TOUCH.DOLLY_ROTATE: the drag of their midpoint turns (horizontal) and tilts
 *                       (vertical) the view around the target, the change of their distance zooms towards the midpoint,
 *                       all at the same time (no lock, no threshold); the top view cannot tilt
 *   lifting / adding    a finger continues / switches without a jump; fingers beyond the second are ignored
 *   mouse               left drag pans, right drag rotates, middle drag and the wheel zoom (desktop development)
 * Eye level is a first-person look-around: one or two fingers turn the view; the eye itself cannot be displaced.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraState } from './api';
import type { HeightField } from './heightfield';
import { PanGesture } from './panGesture';

export type ViewMode = 'orbit' | 'top' | 'ground';

/**
 * Touch / mouse sensitivity of the orbit and top views.
 *  - zoomSpeed 1: OrbitControls maps a pinch by distance ← distance · (spacing before ÷ spacing after)^zoomSpeed, so 1 is exactly
 *    1 : 1 (fingers twice as far apart = half the distance); the wheel then gives the stock 5 % per notch.
 *  - rotateSpeed 2/3: OrbitControls turns 2π · rotateSpeed per screen height of midpoint drag, so one full turn takes
 *    1.5 screen heights (the old 0.6 took 1.67: about the same feel, a round number).
 */
export const GESTURE = { zoomSpeed: 1, rotateSpeed: 2 / 3 } as const;

interface Flight {
  t0: number;
  duration: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
}

/** After a one-finger drag the target's height starts following the terrain again, its easing ramping up over this time (ms). */
const HEIGHT_EASE_MS = 450;

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private hf: HeightField | null = null;
  private flight: Flight | null = null;
  private _mode: ViewMode = 'orbit';
  private interaction = true;
  /** Eye height above ground in 'ground' mode (m). */
  eyeHeight = 1.7;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private domainSize = 9000;
  /**
   * Eye position (world) held fixed in 'ground' mode. OrbitControls orbits the camera around its target; with the
   * target 1 m in front of the eye that would move the eye by up to 2 m while looking around, so after each controls
   * update both are shifted back to keep the eye still (a first-person look-around).
   */
  private eye: THREE.Vector3 | null = null;
  /** Vertical field of view (deg) of the unobscured canvas; the camera's own fov grows with the view insets. */
  private readonly baseFov = 50;
  private viewW = 1;
  private viewH = 1;
  /** Screen areas covered by UI (CSS px): the optical centre is moved to the middle of the rest (animated). */
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private insetsShown = { top: 0, right: 0, bottom: 0, left: 0 };
  /** One-finger pan (its pointer listeners are registered before OrbitControls' own, see PanGesture). */
  private readonly pan: PanGesture;
  /** Share (0–1) of the usual terrain-following easing of the target's height in force: 0 while a finger drags, then ramping up. */
  private heightEase = 1;
  private heightEaseT = -1e9;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 2, 200000);
    this.camera.position.set(0, 4000, 6000);
    this.pan = new PanGesture(dom, {
      camera: this.camera,
      target: () => this.controls.target,
      accepts: () => this.interaction && !this.flight,
      canPan: () => this._mode !== 'ground',
      surface: () => this.hf,
      metresPerPixel: () => this.metresPerPixel(),
      started: () => this.controls.dispatchEvent({ type: 'start' }),
      ended: () => this.controls.dispatchEvent({ type: 'end' }),
    });
    this.controls = new OrbitControls(this.camera, dom);
    const c = this.controls;
    // Wheel zoom or a mouse drag (OrbitControls dispatches 'start') ends a glide.
    c.addEventListener('start', this.stopGlide);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.rotateSpeed = GESTURE.rotateSpeed;
    c.zoomSpeed = GESTURE.zoomSpeed;
    c.panSpeed = 1.0;
    c.screenSpacePanning = false; // pan over the ground plane, not the screen plane
    c.minDistance = 40;
    c.maxDistance = 30000;
    c.maxPolarAngle = THREE.MathUtils.degToRad(86);
    c.zoomToCursor = true;
    this.applyModeControls();
  }

  get mode(): ViewMode {
    return this._mode;
  }

  /** Attach the heightfield used for clearance and target clamping. */
  setHeightField(hf: HeightField): void {
    this.hf = hf;
    this.domainSize = Math.max(hf.xMax - hf.xMin, hf.yMax - hf.yMin);
    this.controls.maxDistance = this.domainSize * 3;
    this.camera.far = Math.max(60000, this.domainSize * 12);
    this.camera.near = 1;
    this.camera.updateProjectionMatrix();
  }

  /** World-space target point on the ground for a local point. */
  groundPoint(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.hf ? this.hf.worldHeightAt(x, y) : 0;
    return out.set(x, h, -y);
  }

  /** Default overview: from the south-south-west, looking at the domain centre. */
  home(animate = false): void {
    if (!this.hf) return;
    const cx = (this.hf.xMin + this.hf.xMax) / 2;
    const cy = (this.hf.yMin + this.hf.yMax) / 2;
    const target = this.groundPoint(cx, cy);
    const d = this.domainSize * 0.95;
    const pos = this.offsetFrom(target, d, THREE.MathUtils.degToRad(200), THREE.MathUtils.degToRad(52));
    this.goTo(target, pos, animate ? 1.2 : 0);
  }

  /** Camera position at distance d from target, looking from compass azimuth `az` (radians) with polar angle `polar`. */
  private offsetFrom(target: THREE.Vector3, d: number, az: number, polar: number): THREE.Vector3 {
    // Camera sits in the direction `az` FROM the target (az 180° = camera south of the target, looking north).
    const hx = Math.sin(az) * Math.sin(polar) * d;
    const hy = Math.cos(az) * Math.sin(polar) * d;
    return new THREE.Vector3(target.x + hx, target.y + Math.cos(polar) * d, target.z - hy);
  }

  setMode(mode: ViewMode, opts: { user?: [number, number] | null; lookAt?: [number, number] | null } = {}): void {
    const prev = this._mode;
    this._mode = mode;
    this.applyModeControls();
    // A finger that is still down keeps the gesture OrbitControls began for the old mode (one finger rotating at eye level):
    // end it, so that the finger does nothing until it lifts (the pan of this mode starts with the next touch).
    if (mode !== prev) (this.controls as unknown as { state: number }).state = -1;
    if (!this.hf) return;
    const c = this.controls;
    if (mode === 'top') {
      const t = c.target.clone();
      const d = prev === 'ground' ? this.domainSize * 0.8 : Math.max(800, this.camera.position.distanceTo(t));
      this.goTo(t, new THREE.Vector3(t.x, t.y + d, t.z + d * 1e-3), 0.9);
    } else if (mode === 'orbit') {
      const t = prev === 'ground' ? this.groundPoint(...(opts.lookAt ?? [c.target.x, -c.target.z])) : c.target.clone();
      const d = prev === 'ground' ? this.domainSize * 0.5 : Math.max(600, this.camera.position.distanceTo(t));
      this.goTo(t, this.offsetFrom(t, d, this.azimuthOfView(), THREE.MathUtils.degToRad(55)), 0.9);
    } else {
      const [ux, uy] = opts.user ?? [(this.hf.xMin + this.hf.xMax) / 2, (this.hf.yMin + this.hf.yMax) / 2];
      const eye = this.groundPoint(ux, uy);
      eye.y += this.eyeHeight * Math.max(1, this.hf.vex);
      let dir: THREE.Vector3;
      if (opts.lookAt) {
        const la = this.groundPoint(opts.lookAt[0], opts.lookAt[1]);
        dir = la.sub(eye);
        // Look slightly above the target so the horizon and the smoke are in view.
        dir.y = Math.max(dir.y, -0.25 * Math.hypot(dir.x, dir.z));
      } else dir = new THREE.Vector3(0, 0, -1);
      dir.normalize();
      const target = eye.clone().addScaledVector(dir, 1);
      this.goTo(target, eye, 1.1);
      this.eye = eye.clone();
    }
    if (mode !== 'ground') this.eye = null;
  }

  /**
   * Re-scale world heights after a vertical-exaggeration change (old → new factor), keeping the camera's offset from
   * its target so the view does not jump.
   */
  rescaleHeights(oldVex: number, newVex: number): void {
    if (oldVex === newVex || oldVex <= 0) return;
    const t = this.controls.target;
    const dy = t.y * (newVex / oldVex) - t.y;
    t.y += dy;
    this.camera.position.y += dy;
    if (this.eye) this.eye.y += dy;
    this.pan.rebase(); // a finger that is dragging grabs the (re-scaled) ground again where it is
    const f = this.flight;
    if (f) {
      for (const [tgt, pos] of [
        [f.fromTarget, f.fromPos],
        [f.toTarget, f.toPos],
      ] as const) {
        const d = tgt.y * (newVex / oldVex) - tgt.y;
        tgt.y += d;
        pos.y += d;
      }
    }
  }

  /** Compass azimuth (radians) of the camera as seen from the target. */
  private azimuthOfView(): number {
    const v = this.tmp.copy(this.camera.position).sub(this.controls.target);
    return Math.atan2(v.x, -v.z);
  }

  private applyModeControls(): void {
    const c = this.controls;
    c.enabled = this.interaction;
    this.pan.cancel(); // a drag or glide of the old mode ends (the fingers stay tracked until they lift)
    if (this._mode === 'top') {
      c.minPolarAngle = 0;
      c.maxPolarAngle = 0.001;
      c.enableRotate = true;
      c.enablePan = true;
      c.enableZoom = true;
      c.rotateSpeed = GESTURE.rotateSpeed;
      c.zoomSpeed = GESTURE.zoomSpeed;
      c.minDistance = 60;
      // One finger is the grab pan of PanGesture (null: OrbitControls does nothing for it); two fingers pinch and turn at once.
      c.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    } else if (this._mode === 'ground') {
      c.minPolarAngle = THREE.MathUtils.degToRad(20);
      c.maxPolarAngle = THREE.MathUtils.degToRad(160);
      c.enablePan = false;
      c.enableZoom = false;
      c.enableRotate = true;
      c.rotateSpeed = -0.35; // look around: drag the view, not the world
      c.minDistance = 0.5;
      c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.ROTATE };
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
    } else {
      c.minPolarAngle = 0;
      c.maxPolarAngle = THREE.MathUtils.degToRad(86);
      c.enablePan = true;
      c.enableZoom = true;
      c.enableRotate = true;
      c.rotateSpeed = GESTURE.rotateSpeed;
      c.zoomSpeed = GESTURE.zoomSpeed;
      c.minDistance = 40;
      c.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    }
  }

  setInteractionEnabled(on: boolean): void {
    this.interaction = on;
    if (!this.flight) this.controls.enabled = on;
    if (!on) this.pan.reset(); // finger drawing took over the screen: no drag, no glide, no tracked finger
  }

  private readonly stopGlide = (): void => {
    this.pan.stopGlide();
  };

  /** Ground metres one canvas pixel stands for at the orbit target (the scale of the glide's speed thresholds). */
  private metresPerPixel(): number {
    const d = this.camera.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2))) / Math.max(1, this.viewH);
  }

  /** Animate to a target/position (duration s; 0 = jump). */
  goTo(target: THREE.Vector3, pos: THREE.Vector3, duration = 1.2): void {
    this.pan.cancel(); // a flight or a jump ends any drag or glide
    if (duration <= 0) {
      this.flight = null;
      this.controls.enabled = this.interaction; // a jump that interrupts a flight must not leave the controls switched off
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.camera.lookAt(target);
      this.controls.update();
      return;
    }
    this.flight = {
      t0: performance.now(),
      duration: duration * 1000,
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      fromPos: this.camera.position.clone(),
      toPos: pos.clone(),
    };
    this.controls.enabled = false;
  }

  /** Fly to a local point keeping the current viewing direction; `distance` defaults to the current one (≥ 400 m). */
  flyTo(x: number, y: number, distance?: number): void {
    const target = this.groundPoint(x, y);
    if (this._mode === 'ground') this.setMode('orbit');
    const dir = this.tmp2.copy(this.camera.position).sub(this.controls.target);
    const cur = dir.length();
    const d = distance ?? Math.max(400, Math.min(cur, 4000));
    if (cur < 1e-6) dir.set(0, 1, 1);
    dir.normalize();
    if (this._mode === 'top') dir.set(0, 1, 1e-3).normalize();
    this.goTo(target, target.clone().addScaledVector(dir, d), 1.3);
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** A flick is still gliding on (a touch now only stops it). */
  get gliding(): boolean {
    return this.pan.gliding;
  }

  /** Per-frame update: flights, damping, clamps, near plane. Returns true if the camera moved. */
  update(now: number): boolean {
    const before = this.tmp.copy(this.camera.position);
    const bx = before.x;
    const by = before.y;
    const bz = before.z;
    const tb = this.tmp3.copy(this.controls.target);
    let px = 0;
    let pz = 0;
    let panned = false;
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.t0) / f.duration);
      const e = easeInOut(t);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      // Arc a little higher mid-flight for long moves so the flight does not skim through ridges.
      const pos = this.tmp2.lerpVectors(f.fromPos, f.toPos, e);
      const dist = f.fromTarget.distanceTo(f.toTarget);
      pos.y += Math.sin(Math.PI * e) * Math.min(dist * 0.25, 1500);
      this.camera.position.copy(pos);
      this.camera.lookAt(this.controls.target);
      if (t >= 1) {
        this.flight = null;
        this.controls.enabled = this.interaction;
        this.controls.update();
      }
    } else {
      this.controls.update();
      if (this._mode === 'ground' && this.eye) {
        // First-person look-around: keep the eye where it is (see `eye`).
        const off = this.tmp2.copy(this.eye).sub(this.camera.position);
        if (off.lengthSq() > 1e-10) {
          this.camera.position.add(off);
          this.controls.target.add(off);
        }
      }
      // One-finger drag / glide: after OrbitControls (which may still be damping a rotation), before the clamps.
      px = this.controls.target.x;
      pz = this.controls.target.z;
      this.pan.step(now);
      panned = true;
      if (this.pan.panning) this.heightEaseT = now;
      this.heightEase = Math.min(1, Math.max(0, (now - this.heightEaseT) / HEIGHT_EASE_MS));
    }
    this.clamp();
    if (panned) this.pan.settle(this.controls.target.x - px, this.controls.target.z - pz);
    this.updateNear();
    const insetsMoving = this.stepInsets(now);
    const moved =
      insetsMoving ||
      Math.abs(this.camera.position.x - bx) + Math.abs(this.camera.position.y - by) + Math.abs(this.camera.position.z - bz) > 1e-3 ||
      tb.distanceToSquared(this.controls.target) > 1e-6;
    return moved;
  }

  /**
   * Near plane from the camera's height above the ground: ~0.4 m at eye level, tens of metres in overviews. A fixed
   * 1 m near plane with a 100 km far plane leaves only metres of depth resolution at 10 km (24-bit depth), so tree
   * bases and flames would z-fight with the ground in wide views.
   */
  private updateNear(): void {
    if (!this.hf) return;
    const cam = this.camera.position;
    const x = THREE.MathUtils.clamp(cam.x, this.hf.xMin, this.hf.xMax);
    const y = THREE.MathUtils.clamp(-cam.z, this.hf.yMin, this.hf.yMax);
    const agl = Math.max(0, cam.y - this.hf.worldHeightAt(x, y));
    const near = THREE.MathUtils.clamp(agl * 0.25, 0.3, 60);
    if (Math.abs(near - this.camera.near) > 0.1 * this.camera.near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Keep the target on the ground inside the domain and the camera above the terrain. */
  private clamp(): void {
    const hf = this.hf;
    if (!hf || this.flight) return;
    const c = this.controls;
    const cam = this.camera.position;
    if (this._mode !== 'ground') {
      // Target inside the domain and on the surface (move the camera with it so the view does not jump).
      const tx = THREE.MathUtils.clamp(c.target.x, hf.xMin, hf.xMax);
      const tz = THREE.MathUtils.clamp(c.target.z, -hf.yMax, -hf.yMin);
      const ty = hf.worldHeightAt(tx, -tz);
      const dx = tx - c.target.x;
      const dz = tz - c.target.z;
      // Ease vertically (25 % per frame), except while one finger drags the map: the grab moves the camera sideways to keep the
      // ground under the finger, and at a flat viewing angle a small change of the camera's height means a large sideways
      // correction (1 / tan of the angle at which the finger's ray meets the ground: ×3 to ×10 on a mountain side), which
      // changes the ground height under the target, which changes the height again: a loop that flip-flops or runs away.
      // After the drag the height follows the terrain again, the gain ramping up over HEIGHT_EASE_MS so that the view does not
      // lurch by the (up to a hundred pixels) that the terrain rose or fell while the height was held.
      const dy = (ty - c.target.y) * 0.25 * this.heightEase;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-4) {
        c.target.x += dx;
        c.target.y += dy;
        c.target.z += dz;
        cam.x += dx;
        cam.y += dy;
        cam.z += dz;
      }
    }
    // Camera clearance above the ground under it (inside or just outside the domain).
    const x = THREE.MathUtils.clamp(cam.x, hf.xMin, hf.xMax);
    const y = THREE.MathUtils.clamp(-cam.z, hf.yMin, hf.yMax);
    const ground = hf.worldHeightAt(x, y);
    const clearance = this._mode === 'ground' ? this.eyeHeight * Math.max(1, hf.vex) * 0.9 : Math.max(8, 0.03 * cam.distanceTo(c.target));
    if (cam.y < ground + clearance) cam.y = ground + clearance;
  }

  resize(aspect: number, width?: number, height?: number): void {
    if (width && height) {
      this.viewW = width;
      this.viewH = height;
    } else {
      this.viewH = 1000;
      this.viewW = 1000 * aspect;
    }
    this.applyViewOffset();
    this.pan.rebase(); // the canvas changed shape under a finger that is dragging (the phone was turned): grab where it is now
  }

  /**
   * Screen areas (CSS px from each canvas edge) covered by panels and bars. The projection's centre moves to the
   * middle of the rest (camera.setViewOffset), so fly-to targets, the orbit pivot and "Fly to the fire" land in the part
   * of the map the user can see — above an open tool panel, not behind it. The canvas keeps its angular size.
   */
  setViewInsets(insets: { top?: number; right?: number; bottom?: number; left?: number }, animate = true): void {
    const c = (v: number | undefined): number => Math.max(0, Number.isFinite(v) ? (v as number) : 0);
    this.insets = { top: c(insets.top), right: c(insets.right), bottom: c(insets.bottom), left: c(insets.left) };
    if (!animate) {
      this.insetsShown = { ...this.insets };
      this.applyViewOffset();
    }
  }

  /** Vertical field of view (deg) and aspect of the canvas itself (the camera's fov/aspect include the insets). */
  get viewFov(): number {
    return this.baseFov;
  }
  get viewAspect(): number {
    return Math.max(1, this.viewW) / Math.max(1, this.viewH);
  }

  /** Current optical centre in canvas CSS px (the middle of the unobscured area once the insets have settled). */
  get viewCentre(): [number, number] {
    const i = this.insets;
    return [(i.left + this.viewW - i.right) / 2, (i.top + this.viewH - i.bottom) / 2];
  }

  private insetT = -1;

  /** Ease the shown insets towards the requested ones (time constant 70 ms, frame-rate independent); true while moving. */
  private stepInsets(now: number): boolean {
    const a = this.insetsShown;
    const b = this.insets;
    const dt = this.insetT < 0 ? 16 : Math.max(0, now - this.insetT);
    this.insetT = now;
    const f = 1 - Math.exp(-dt / 70);
    let moving = false;
    for (const k of ['top', 'right', 'bottom', 'left'] as const) {
      const d = b[k] - a[k];
      if (Math.abs(d) < 0.5 || f > 0.999) {
        if (a[k] !== b[k]) moving = true;
        a[k] = b[k];
      } else {
        a[k] += d * f;
        moving = true;
      }
    }
    if (moving) this.applyViewOffset();
    return moving;
  }

  private applyViewOffset(): void {
    const w = Math.max(1, this.viewW);
    const h = Math.max(1, this.viewH);
    const i = this.insetsShown;
    // Keep the unobscured area at least a third of the canvas so the frustum never degenerates.
    const dx = THREE.MathUtils.clamp((i.left - i.right) / 2, -w / 3, w / 3);
    const dy = THREE.MathUtils.clamp((i.top - i.bottom) / 2, -h / 3, h / 3);
    const cam = this.camera;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      cam.clearViewOffset();
      cam.fov = this.baseFov;
      cam.aspect = w / h;
    } else {
      // A virtual frame, larger than the canvas, whose centre (the optical axis) sits at the canvas point (w/2 + dx,
      // h/2 + dy); the canvas is the window of it at (|dx| − dx, |dy| − dy).
      const fw = w + 2 * Math.abs(dx);
      const fh = h + 2 * Math.abs(dy);
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2)) * (fh / h)));
      cam.aspect = fw / fh;
      cam.setViewOffset(fw, fh, Math.abs(dx) - dx, Math.abs(dy) - dy, w, h);
    }
    cam.updateProjectionMatrix();
  }

  /** Dolly towards (factor < 1) or away from (> 1) the target, within the mode's distance limits (animated). */
  zoomBy(factor: number): void {
    if (!(factor > 0) || this._mode === 'ground') return;
    const c = this.controls;
    const t = this.flight ? this.flight.toTarget : c.target;
    const p = this.flight ? this.flight.toPos : this.camera.position;
    const off = this.tmp2.copy(p).sub(t);
    const d = THREE.MathUtils.clamp(off.length() * factor, c.minDistance, c.maxDistance);
    this.goTo(t.clone(), t.clone().addScaledVector(off.normalize(), d), 0.35);
  }

  /** Compass heading (deg, clockwise from north) the camera looks towards. */
  get heading(): number {
    const v = this.tmp.copy(this.controls.target).sub(this.camera.position);
    if (Math.hypot(v.x, v.z) < 1e-6) {
      // Straight down (top view): the screen's up direction.
      const up = this.tmp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      return (THREE.MathUtils.radToDeg(Math.atan2(up.x, -up.z)) + 360) % 360;
    }
    return (THREE.MathUtils.radToDeg(Math.atan2(v.x, -v.z)) + 360) % 360;
  }

  /** Turn the view to face `deg` (clockwise from north) around the current target, keeping distance and tilt. */
  setHeading(deg: number): void {
    if (!this.hf) return;
    const c = this.controls;
    const t = c.target.clone();
    if (this._mode === 'ground') {
      const eye = this.camera.position.clone();
      const dir = t.clone().sub(eye);
      const hLen = Math.hypot(dir.x, dir.z);
      const a = THREE.MathUtils.degToRad(deg);
      const nt = eye.clone().add(new THREE.Vector3(Math.sin(a) * hLen, dir.y, -Math.cos(a) * hLen));
      this.goTo(nt, eye, 0.6);
      return;
    }
    const off = this.camera.position.clone().sub(t);
    const d = off.length();
    const polar = Math.max(1e-3, Math.acos(THREE.MathUtils.clamp(off.y / Math.max(d, 1e-9), -1, 1)));
    // The camera sits opposite the viewing direction.
    this.goTo(t, this.offsetFrom(t, d, THREE.MathUtils.degToRad(deg + 180), polar), 0.6);
  }

  /**
   * The view as numbers (tests, the debug handle): the orbit target in local metres, the camera's distance from it, and the
   * camera's compass azimuth and polar angle (from vertical) as seen from the target, in degrees; `headingDeg` is where the
   * camera looks. At eye level the target is 1 m in front of the eye, so these describe the look direction.
   */
  cameraState(): CameraState {
    const t = this.controls.target;
    const off = this.tmp.copy(this.camera.position).sub(t);
    const d = off.length();
    return {
      target: [t.x, -t.z],
      distance: d,
      azimuthDeg: (THREE.MathUtils.radToDeg(Math.atan2(off.x, -off.z)) + 360) % 360,
      polarDeg: d > 1e-9 ? THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(off.y / d, -1, 1))) : 0,
      headingDeg: this.heading,
      mode: this._mode,
    };
  }

  dispose(): void {
    this.pan.dispose();
    this.controls.removeEventListener('start', this.stopGlide);
    this.controls.dispose();
  }
}
