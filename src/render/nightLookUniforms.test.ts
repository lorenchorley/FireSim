/**
 * Night lighting, the uniform plumbing without a WebGL context (SkyDome and SmokeLayer only build Three.js objects): the
 * shared uniforms carry the MAP lighting, so the sky dome and the smoke body must hold their own sun and lighting uniforms
 * (written from the real lighting by SceneView.applyLighting), or a bright map would paint a sun disc into a night sky and turn
 * the plume into a pale cloud. Everything that must follow the clock (the night factor, the fog) stays shared.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SkyDome } from './skyDome';
import { SmokeLayer } from './smokeLayer';

const v = (value: unknown): THREE.IUniform => ({ value });

/** The shared record of SceneView (the lighting keys carry the map lighting there). */
function shared(): Record<string, THREE.IUniform> {
  return {
    uVex: v(1),
    uClock: v(0),
    uSunDir: v(new THREE.Vector3(0.3, 0.8, -0.4).normalize()),
    uSunColour: v(new THREE.Color(1, 0.95, 0.88)),
    uSunI: v(2.6),
    uSkyAmb: v(new THREE.Color(0.5, 0.6, 0.8)),
    uGroundAmb: v(new THREE.Color(0.3, 0.26, 0.2)),
    uAmbI: v(0.65),
    uNight: v(0),
    uMapNight: v(0),
    uShadowGain: v(1),
    uExposure: v(1),
    uFogColour: v(new THREE.Color(0.7, 0.78, 0.88)),
    uFogDensity: v(1 / 45000),
  };
}

const materialOf = (mesh: THREE.Mesh): THREE.ShaderMaterial => mesh.material as THREE.ShaderMaterial;

/** The uniform names a material's shaders declare. */
function declared(m: THREE.ShaderMaterial): Set<string> {
  const names = new Set<string>();
  for (const src of [m.vertexShader, m.fragmentShader]) for (const x of src.matchAll(/uniform\s+(?:float|int|vec[234]|sampler2D)\s+(u[A-Za-z0-9]+)/g)) names.add(x[1]!);
  return names;
}

describe('night lighting: what the sky dome and the smoke body keep from the real clock', () => {
  it('the sky dome has its own sun direction, sun colour, sun intensity and exposure', () => {
    const s = shared();
    const dome = new SkyDome(s);
    const u = materialOf(dome.mesh).uniforms;
    for (const k of ['uSunDir', 'uSunColour', 'uSunI', 'uExposure']) {
      expect(u[k], k).toBe(dome.uniforms[k]); // set by SceneView through `sky.uniforms`
      expect(u[k], `${k} is not the shared (map) one`).not.toBe(s[k]);
    }
    // The night factor (stars) and the fog colour are the real ones and stay shared.
    expect(u.uNight).toBe(s.uNight);
    expect(u.uFogColour).toBe(s.uFogColour);
    // A change of the map lighting does not reach the sky.
    (s.uSunI!.value as number) = 9;
    expect(dome.uniforms.uSunI!.value).toBe(2.6);
    dome.dispose();
  });

  it('the smoke body has its own five lighting uniforms', () => {
    const s = shared();
    const smoke = new SmokeLayer(s, 16);
    const u = materialOf(smoke.mesh).uniforms;
    for (const k of ['uSunColour', 'uSunI', 'uSkyAmb', 'uAmbI', 'uExposure']) {
      expect(u[k], k).toBe(smoke.uniforms[k]);
      expect(u[k], `${k} is not the shared (map) one`).not.toBe(s[k]);
    }
    // The fire light on the smoke follows the real night; the fog, the clock and the projection are shared.
    for (const k of ['uNight', 'uFogColour', 'uFogDensity', 'uClock', 'uVex']) expect(u[k], k).toBe(s[k]);
    // The map's lighting is not the smoke's: they start from the same defaults and move apart.
    (s.uAmbI!.value as number) = 9;
    expect(smoke.uniforms.uAmbI!.value).toBe(0.65);
    // The two controls SceneView already used are still there.
    expect(smoke.uniforms.uMix).toBeDefined();
    expect(smoke.uniforms.uAlphaScale).toBeDefined();
    smoke.dispose();
  });

  it('every uniform the two shaders read is provided', () => {
    const dome = new SkyDome(shared());
    const smoke = new SmokeLayer(shared(), 16);
    for (const m of [materialOf(dome.mesh), materialOf(smoke.mesh)]) for (const name of declared(m)) expect(Object.keys(m.uniforms), `uniform ${name}`).toContain(name);
    dome.dispose();
    smoke.dispose();
  });
});
