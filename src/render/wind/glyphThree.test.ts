/**
 * The engine takes its matrices from a real `THREE.PerspectiveCamera`, as the render layer will give them: projection x view for
 * the builder, `matrixWorld x projectionMatrixInverse` for the visible box, the orientation and position for the pose. The test
 * camera of the other tests (glyphOracle.testing.ts) is checked against it, so that what they prove holds for the real thing.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createGlyphBuilder, type GlyphOutputDetail } from './flowGlyphs';
import { boxContains, metresPerPixelAt, visibleBox } from './glyphLod';
import { buildAll, glyphsOf, makeCamera, makeScenario } from './glyphOracle.testing';
import { createPoseSig, POSE, poseChange } from './glyphPose';

function threeCamera(eye: [number, number, number], target: [number, number, number], w = 412, h = 868): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, w / h, 5, 60000);
  cam.position.set(...eye);
  cam.lookAt(...target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}
const viewProjOf = (cam: THREE.PerspectiveCamera): number[] => new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
const unprojectOf = (cam: THREE.PerspectiveCamera): number[] => new THREE.Matrix4().multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse).elements;

describe('with a real THREE camera', () => {
  const eye: [number, number, number] = [100, 1500, 3000];
  const target: [number, number, number] = [0, 0, 0];

  it('the test camera has the same matrices and orientation', () => {
    const cam = threeCamera(eye, target);
    const mine = makeCamera({ eye, target });
    const vp = viewProjOf(cam);
    for (let k = 0; k < 16; k++) expect(mine.viewProj[k]).toBeCloseTo(vp[k]!, 9);
    const un = unprojectOf(cam);
    const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));
    for (let k = 0; k < 16; k++) expect(rel(mine.unproject[k]!, un[k]!)).toBeLessThan(1e-6);
    const q = cam.quaternion;
    const sign = Math.sign(q.x * mine.quat[0] + q.y * mine.quat[1] + q.z * mine.quat[2] + q.w * mine.quat[3]);
    expect(sign * mine.quat[0]).toBeCloseTo(q.x, 9);
    expect(sign * mine.quat[3]).toBeCloseTo(q.w, 9);
  });

  it('the visible box from THREE matrices is the one from the test camera, and the builder draws the same glyphs', () => {
    const cam = threeCamera(eye, target);
    const bounds = { x0: -5900, y0: -5900, x1: 5900, y1: 5900 };
    const a = visibleBox(unprojectOf(cam), [cam.position.x, cam.position.y, cam.position.z], 0, bounds, 20000)!;
    const mine = makeCamera({ eye, target });
    const b = visibleBox(mine.unproject, mine.eye, 0, bounds, 20000)!;
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(a[k]).toBeCloseTo(b[k], 3);
    // The builder, from THREE's own matrices.
    const sc = makeScenario({ n: 90, cell: 133, cellPx: 40, field: () => [4, 3], camera: mine });
    const own = createGlyphBuilder('high');
    buildAll(own, sc.input);
    const viaThree = createGlyphBuilder('high');
    buildAll(viaThree, { ...sc.input, viewProj: viewProjOf(cam), eye: [cam.position.x, cam.position.y, cam.position.z], box: a });
    const seeds = (bld: ReturnType<typeof createGlyphBuilder>): Set<string> => new Set(glyphsOf(bld.out as GlyphOutputDetail).map((g) => `${g.seed[0].toFixed(3)},${g.seed[1].toFixed(3)}`));
    const s1 = seeds(own);
    const s2 = seeds(viaThree);
    expect(s1.size).toBeGreaterThan(100);
    expect(s2.size).toBe(s1.size);
    let common = 0;
    for (const k of s1) if (s2.has(k)) common++;
    expect(common).toBeGreaterThan(0.99 * s1.size);
  });

  it('a top view as the rig builds it (looking straight down, THREE nudges the up vector) gives the box of the screen', () => {
    const cam = threeCamera([250, 2063, -400], [250, 0, -400]);
    const mpp = metresPerPixelAt(2063, 50, 868);
    const bounds = { x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 };
    const bx = visibleBox(unprojectOf(cam), [cam.position.x, cam.position.y, cam.position.z], 0, bounds, 20000, 0)!;
    expect((bx.x1 - bx.x0) / mpp).toBeCloseTo(412, 0);
    expect((bx.y1 - bx.y0) / mpp).toBeCloseTo(868, 0);
    expect(boxContains(visibleBox(unprojectOf(cam), [cam.position.x, cam.position.y, cam.position.z], 0, bounds, 20000, 0.25)!, bx)).toBe(true);
  });

  it('the pose signature of a THREE camera: the forward height the pose test derives is the camera\'s', () => {
    const cam = threeCamera(eye, target);
    const built = createPoseSig();
    const fill = (c: THREE.PerspectiveCamera, sig: Float64Array): void => {
      sig.set([c.position.x, c.position.y, c.position.z, 0, 0, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, 412, 868, 1]);
    };
    fill(cam, built);
    built[POSE.target] = target[0];
    built[POSE.target + 1] = target[2];
    // Zoom in by 15 % along the view direction: the target stays, the eye moves.
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const d = cam.position.distanceTo(new THREE.Vector3(...target));
    const near = threeCamera([eye[0] + dir.x * 0.15 * d, eye[1] + dir.y * 0.15 * d, eye[2] + dir.z * 0.15 * d], target);
    const now = createPoseSig();
    fill(near, now);
    now[POSE.target] = target[0];
    now[POSE.target + 1] = target[2];
    expect(poseChange(built, now, 0.85 * d)).toBe('zoomed');
    const near2 = threeCamera([eye[0] + dir.x * 0.05 * d, eye[1] + dir.y * 0.05 * d, eye[2] + dir.z * 0.05 * d], target);
    fill(near2, now);
    expect(poseChange(built, now, 0.95 * d)).toBeNull();
  });
});
