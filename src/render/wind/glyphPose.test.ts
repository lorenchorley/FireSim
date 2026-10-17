/**
 * When a camera move calls for a rebuild: the built pose against the pose now, with the thresholds of the design (plan 9.4): moved,
 * zoomed, turned, resized, exaggeration; a drag adds up against the built picture, the cheap path allocates nothing.
 */
import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { makeCamera, type Camera } from './glyphOracle.testing';
import { createPoseSig, POSE, poseChange, POSE_MOVE_FRAC, POSE_MOVE_MIN_M, REBUILD_MIN_GAP_MS, type PoseSig } from './glyphPose';

/** The pose signature of a camera: eye, target x and z, orientation, canvas size, exaggeration. */
function sig(cam: Camera, o: { cssW?: number; cssH?: number; vex?: number } = {}, out: PoseSig = createPoseSig()): PoseSig {
  out[POSE.eye] = cam.eye[0];
  out[POSE.eye + 1] = cam.eye[1];
  out[POSE.eye + 2] = cam.eye[2];
  out[POSE.target] = cam.target[0];
  out[POSE.target + 1] = cam.target[2];
  out[POSE.quat] = cam.quat[0];
  out[POSE.quat + 1] = cam.quat[1];
  out[POSE.quat + 2] = cam.quat[2];
  out[POSE.quat + 3] = cam.quat[3];
  out[POSE.cssW] = o.cssW ?? cam.cssW;
  out[POSE.cssH] = o.cssH ?? cam.cssH;
  out[POSE.vex] = o.vex ?? 1;
  return out;
}

const TARGET: [number, number, number] = [200, 30, -100];
/** A camera `d` metres from the target, looking from `polarDeg` off the vertical and compass azimuth `azDeg`. */
function orbit(d: number, polarDeg = 55, azDeg = 200, target = TARGET): Camera {
  const p = (polarDeg * Math.PI) / 180;
  const a = (azDeg * Math.PI) / 180;
  const eye: [number, number, number] = [target[0] + Math.sin(a) * Math.sin(p) * d, target[1] + Math.cos(p) * d, target[2] - Math.cos(a) * Math.sin(p) * d];
  return makeCamera({ eye, target });
}

describe('poseChange', () => {
  it('the design numbers', () => {
    expect(REBUILD_MIN_GAP_MS).toBe(250);
    expect(POSE_MOVE_MIN_M).toBe(12);
    expect(POSE_MOVE_FRAC).toBe(0.1);
    expect(createPoseSig()).toHaveLength(12);
  });

  it('keeps the picture for the same pose', () => {
    const c = orbit(1000);
    expect(poseChange(sig(c), sig(c), 1000)).toBeNull();
  });

  it('moved: the eye shifts by more than max(12 m, 10 % of the distance)', () => {
    for (const [d, limit] of [[1000, 100], [50, 12], [300, 30]] as const) {
      const built = orbit(d);
      const slide = (m: number): Camera => makeCamera({ eye: [built.eye[0] + m, built.eye[1], built.eye[2]], target: [built.target[0] + m, built.target[1], built.target[2]] });
      expect(poseChange(sig(built), sig(slide(limit * 0.98)), d)).toBeNull();
      expect(poseChange(sig(built), sig(slide(limit * 1.02)), d)).toBe('moved');
      expect(poseChange(sig(built), sig(slide(-limit * 1.02)), d)).toBe('moved');
    }
  });

  it('zoomed: the distance to the target changes by more than 10 %, from above and from the side', () => {
    for (const polar of [0.0001, 30, 55, 80]) {
      const built = orbit(1000, polar);
      for (const [ratio, want] of [[0.92, null], [1.08, null], [0.85, 'zoomed'], [1.15, 'zoomed'], [0.5, 'zoomed'], [3, 'zoomed']] as const) {
        const now = orbit(1000 * ratio, polar);
        expect(poseChange(sig(built), sig(now), 1000 * ratio), `polar ${polar}, ratio ${ratio}`).toBe(want);
      }
    }
  });

  it('turned: the orientation changes by more than 10 degrees (turning on the spot, and orbiting)', () => {
    const built = orbit(1000);
    const eye = built.eye;
    const yaw = (deg: number): Camera => {
      // The same eye, the target swung round the vertical through the eye by `deg`.
      const r = (deg * Math.PI) / 180;
      const dx = built.target[0] - eye[0];
      const dz = built.target[2] - eye[2];
      return makeCamera({ eye, target: [eye[0] + dx * Math.cos(r) - dz * Math.sin(r), built.target[1], eye[2] + dx * Math.sin(r) + dz * Math.cos(r)] });
    };
    expect(poseChange(sig(built), sig(yaw(8)), 1000)).toBeNull();
    expect(poseChange(sig(built), sig(yaw(-8)), 1000)).toBeNull();
    expect(poseChange(sig(built), sig(yaw(12)), 1000)).toBe('turned');
    expect(poseChange(sig(built), sig(yaw(-12)), 1000)).toBe('turned');
    // Orbiting 15 degrees round the target moves the eye a lot too, and is a turn.
    expect(poseChange(sig(built), sig(orbit(1000, 55, 215)), 1000)).toBe('turned');
    // And a tilt of the same size.
    expect(poseChange(sig(built), sig(orbit(1000, 70, 200)), 1000)).toBe('turned');
    expect(poseChange(sig(built), sig(orbit(1000, 52, 200)), 1000)).toBeNull(); // 3 degrees of tilt: the eye moves 52 m of 100
  });

  it('resized and exaggeration come first, and say what changed', () => {
    const c = orbit(1000);
    expect(poseChange(sig(c), sig(c, { cssW: 360 }), 1000)).toBe('resized');
    expect(poseChange(sig(c), sig(c, { cssH: 700 }), 1000)).toBe('resized');
    expect(poseChange(sig(c), sig(c, { vex: 2 }), 1000)).toBe('exaggeration');
    expect(poseChange(sig(c), sig(orbit(100, 10, 10), { cssW: 360 }), 100)).toBe('resized');
    expect(poseChange(sig(c), sig(orbit(100, 10, 10), { vex: 1.5 }), 100)).toBe('exaggeration');
  });

  it('is measured against the BUILT picture: a slow drag adds up and a rebuild starts the count again', () => {
    const start = orbit(1000);
    let built = sig(start);
    let reasons = 0;
    for (let frame = 1; frame <= 40; frame++) {
      const x = 30 * frame; // 30 m a frame at a limit of 100 m
      const cam = makeCamera({ eye: [start.eye[0] + x, start.eye[1], start.eye[2]], target: [start.target[0] + x, start.target[1], start.target[2]] });
      const now = sig(cam);
      const why = poseChange(built, now, 1000);
      if (why) {
        reasons++;
        expect(why).toBe('moved');
        built = sig(cam, {}, built); // rebuilt: the built pose is now this one
        expect(poseChange(built, now, 1000)).toBeNull();
      }
    }
    expect(reasons).toBe(Math.floor((40 * 30) / 120)); // every 4 frames: 120 m is the first multiple of 30 m over the limit
  });

  it('the cheap path allocates nothing', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const a = sig(orbit(1000));
    const b = sig(orbit(1000));
    let hits = 0;
    const run = (n: number): void => {
      for (let i = 0; i < n; i++) if (poseChange(a, b, 1000) !== null) hits++;
    };
    run(200000);
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    run(500000);
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    expect(hits).toBe(0);
    expect(grew).toBeLessThan(50 * 1024);
  });
});
