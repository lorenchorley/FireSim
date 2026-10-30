/**
 * The detailed streaks' batch and shaders (0.6.0), in node: what the shader TEXT promises (no texture, WebGL1, the uniforms and attributes of the
 * contract, the depth bias of the glyph strokes, a vertex that depends on its own end only so a joined line stays joined), a scalar mirror of the
 * pulse and its timing (the GLSL functions themselves, translated to JS, against the rules of the contract at points), and the batch's
 * buffers, uniforms and material state. The picture itself needs a GPU: e2e/wind-detail-render.spec.ts draws it in a real browser.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HALO_INK } from './flowGlyphs';
import { DETAIL_DEPTH_BIAS_M, DETAIL_PULSE_GLSL, DETAIL_STILL_TIME_S, DETAIL_WIDTH_PX, DetailBatch } from './detailBatch';
import { GLYPH_CAPS } from './glyphTypes';

const shared = (): Record<string, THREE.IUniform> => ({
  uClock: { value: 0 },
  uViewport: { value: new THREE.Vector2(400, 800) },
});
const make = (capacity = 64): DetailBatch => new DetailBatch({ capacity, widthPx: DETAIL_WIDTH_PX, depthBiasM: DETAIL_DEPTH_BIAS_M, shared: shared() });
const material = (b: DetailBatch): THREE.ShaderMaterial => b.mesh.material as THREE.ShaderMaterial;
const strip = (s: string): string => s.replace(/\/\/.*$/gm, '');

describe('the shader text', () => {
  const b = make();
  const vs = strip(material(b).vertexShader);
  const fs = strip(material(b).fragmentShader);

  it('reads no texture and needs nothing beyond WebGL1 (the neighbouring streak batch\'s own level)', () => {
    for (const [name, text] of [['vertex', vs], ['fragment', fs]] as const) {
      expect(text, name).not.toMatch(/texture2D|texture\(|textureLod|texelFetch|sampler2D|samplerCube|uniform\s+sampler/);
      expect(text, name).not.toMatch(/#version|\bflat\b|\bin\s+(float|vec[234])|\bout\s+(float|vec[234])|dFdx|dFdy|fwidth|gl_VertexID|gl_InstanceID|\buint\b|\bswitch\b|<<|>>/);
      expect(text, name).not.toMatch(/\b(half|fixed|sample|input|output|inline|noinline|volatile|public|static|extern|external|interface|template|this|namespace|using)\b/); // reserved words in GLSL ES 1.00
    }
  });

  it('has every uniform of the contract, and the five attributes', () => {
    for (const u of ['uTime', 'uMoving', 'uFade', 'uWidthPx', 'uPxPerM1', 'uViewport', 'uDepthBias']) expect(vs, u).toMatch(new RegExp(`uniform \\w+ ${u};`));
    for (const a of ['vec3 aA', 'vec3 aB', 'vec4 aC', 'vec4 aD', 'vec4 aE']) expect(vs, a).toContain(`attribute ${a};`);
    expect(Object.keys(material(b).uniforms).sort()).toEqual(['uDepthBias', 'uFade', 'uMoving', 'uPxPerM1', 'uTime', 'uViewport', 'uWidthPx']);
    expect(fs).toMatch(/uniform float uWidthPx;/);
  });

  it('passes to the fragment what it declares, with the same types, and nothing it does not read', () => {
    const decl = (text: string): Map<string, string> => new Map([...text.matchAll(/varying\s+(\w+)\s+(\w+);/g)].map((m) => [m[2]!, m[1]!]));
    const v = decl(vs);
    const f = decl(fs);
    expect([...f.keys()].sort()).toEqual([...v.keys()].sort());
    for (const [name, type] of f) expect(v.get(name), name).toBe(type);
    for (const name of f.keys()) expect(fs.split(name).length - 1, `${name} is read in the fragment shader`).toBeGreaterThan(1);
  });

  it('balances its braces and parentheses', () => {
    for (const [name, text] of [['vertex', vs], ['fragment', fs]] as const) {
      for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']] as const) expect(text.split(open).length, `${name} ${open}`).toBe(text.split(close).length);
    }
  });

  it('is animated by the clock alone: the time comes from uTime, and uMoving 0 picks the frozen frame', () => {
    expect(vs).toMatch(/float t = uMoving > 0\.5 \? uTime : STILL_TIME;/);
    expect(vs).toContain(`const float STILL_TIME = ${DETAIL_STILL_TIME_S.toFixed(5)};`);
    expect(DETAIL_STILL_TIME_S).toBe(3.7);
    // `t` is the only thing the motion reads: no other time, no random number.
    expect(vs).not.toMatch(/uClock|uTimeOfDay|random/);
  });

  it('keeps a line joined: each end meanders by its own ground point, never by its segment\'s direction', () => {
    expect(vs).toMatch(/pa\.xz \+= meander\(aA\.xz, pxA, t\) \* turbF;/);
    expect(vs).toMatch(/pb\.xz \+= meander\(aB\.xz, pxB, t\) \* turbF;/);
    const meander = /vec2 meander\(vec2 p, float pxPerM, float t\) \{([\s\S]*?)\n\}/.exec(vs)![1]!;
    expect(meander).not.toMatch(/\bdir\b|aA|aB|aD|aE|position/); // a point and the time, nothing of the segment
    // The depth of a point (and so how many octaves count) is the depth of that point, from the same matrices at both of its segments.
    expect(vs).toMatch(/float pxA = uPxPerM1 \/ ca0\.w;/);
    expect(vs).toMatch(/float pxB = uPxPerM1 \/ cb0\.w;/);
  });

  it('shows an eddy octave only when it would be seen: three octaves of 60, 15 and 4 m with 20, 5 and 1.2 m of amplitude, in 0.75 to 3 px', () => {
    for (const [amp, lam] of [[20, 60], [5, 15], [1.2, 4]] as const) {
      expect(vs, `${amp} m`).toMatch(new RegExp(`smoothstep\\(0\\.75, 3\\.0, ${amp.toFixed(1)} \\* pxPerM\\)`));
      expect(vs, `${lam} m`).toMatch(new RegExp(`p / ${lam}\\.0 \\+ vec2`));
    }
    expect(vs).toMatch(/float turbF = \(0\.25 \+ 0\.75 \* aE\.y\) \* aC\.a;/); // rough ground and the lee of ridges meander more, calm ground a quarter, and a pinned line (0.7.0: bent round a crown) less
  });

  it('multiplies the meander by the line\'s pin, the colour alpha (1 free, 0.2 to 1 where the builder bent a line round a crown), and still drops a segment at alpha 0', () => {
    expect(vs).toMatch(/pa\.xz \+= meander\(aA\.xz, pxA, t\) \* turbF;/);
    expect(vs.match(/aC\.a/g)).toHaveLength(2); // the drop test and the pin: nothing else reads the alpha
    expect(vs).toMatch(/aC\.a <= 0\.0 \|\|/);
    expect(vs).toMatch(/vC = aC\.rgb;/); // the colour is the model's, the alpha is not a colour
    expect(fs).not.toMatch(/aC|vC\.a/);
    // The uniforms are the ones of 0.6.0: the pin needs none.
    expect(Object.keys(material(b).uniforms).sort()).toEqual(['uDepthBias', 'uFade', 'uMoving', 'uPxPerM1', 'uTime', 'uViewport', 'uWidthPx']);
  });

  it('slides the stroke toward the eye by uDepthBias along its own ray, as the glyph strokes do (but up to 0.8 of the way to the eye, not half): the depth changes, the place on the screen does not', () => {
    expect(vs).toMatch(/vec3 v = \(viewMatrix \* vec4\(p, 1\.0\)\)\.xyz;/);
    expect(vs).toMatch(/v \* \(1\.0 - min\(uDepthBias, 0\.8 \* l\) \/ l\)/);
    expect(vs).toMatch(/return max\(b\.z \/ b\.w, -0\.999\);/); // so far a slide never puts a stroke in front of the near plane, where it would be clipped
    expect(vs).toMatch(/gl_Position = c;\s*\n\s*if \(uDepthBias > 0\.0\) gl_Position\.z = mix\(za, zb, position\.x\) \* c\.w;/);
    expect(vs).toMatch(/if \(uDepthBias > 0\.0\) \{\s*za = biasedDepth\(pa\);\s*zb = biasedDepth\(pb\);/);
    expect(material(b).uniforms.uDepthBias!.value).toBe(40);
    expect(DETAIL_DEPTH_BIAS_M).toBe(40); // the glyphs' own bias (GLYPH_DEPTH_BIAS_M)
  });

  it('draws a segment nothing of which shows off the screen, and closes the joins by a pixel', () => {
    expect(vs).toMatch(/\(ia <= 0\.0 && ib <= 0\.0\)/);
    expect(vs).toMatch(/uFade <= 0\.0/);
    expect(vs).toMatch(/gl_Position = vec4\(0\.0, 0\.0, -2\.0, 1\.0\);/);
    expect(vs).toMatch(/dir \* \(position\.x \* 2\.0 - 1\.0\)/);
    expect(fs).toMatch(/if \(vUv\.x < 1\.0 \|\| vUv\.x > vLen - 1\.0\) a = 1\.0 - sqrt\(max\(1\.0 - a, 0\.0\)\);/); // the two overlapping quads add up to one
  });

  it('draws the colour of the model on a dark navy ring, never fogged or tone mapped', () => {
    expect(fs).toContain(`const vec3 HALO_INK = vec3(${HALO_INK.map((v) => v.toFixed(5)).join(', ')});`);
    expect(fs).toMatch(/mix\(HALO_INK, vC, core\)/);
    expect(fs).toContain('#include <colorspace_fragment>');
    expect(vs + fs).not.toMatch(/fsFog|TONEMAP|uFog|uExposure|aces/i);
    expect(fs).toMatch(/if \(a < 0\.01\) discard;/);
    expect(fs).toMatch(/const float TAIL_WIDTH = 0\.45;/); // the tail thins to under half the head's width
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scalar GLSL of the pulse (`lineHead`, `pulse`) as JavaScript: type names dropped, `float x =` made `let x =`, `vec2(a, b)` an array. `h21` (a vector hash) is given
 * as a JS port. Everything else of the formula is the shader's own text.
 */
function h21(p: [number, number]): number {
  const fract = (x: number): number => x - Math.floor(x);
  const p3 = [fract(p[0] * 0.1031), fract(p[1] * 0.1031), fract(p[0] * 0.1031)] as [number, number, number];
  const d = p3[0] * (p3[1] + 33.33) + p3[1] * (p3[2] + 33.33) + p3[2] * (p3[0] + 33.33);
  p3[0] += d;
  p3[1] += d;
  p3[2] += d;
  return fract((p3[0] + p3[1]) * p3[2]);
}
function glslToJs(glsl: string): { lineHead: (t: number, seed: number, L: number, tail: number, speed: number) => number; pulse: (s: number, head: number, tail: number) => number } {
  const body = glsl.slice(glsl.indexOf('float lineHead('));
  const js = strip(body)
    .replace(/float\s+(\w+)\s*\(([^)]*)\)\s*\{/g, (_m, name: string, params: string) => `function ${name}(${params.replace(/float\s+/g, '')}) {`)
    .replace(/\bfloat\s+/g, 'let ')
    .replace(/\bvec2\(/g, 'vec2(');
  const make = new Function('h21', 'vec2', 'clamp', 'fract', `${js}\nreturn { lineHead, pulse };`) as (h: typeof h21, v: (a: number, b: number) => [number, number], c: typeof clamp, f: (x: number) => number) => ReturnType<typeof glslToJs>;
  return make(h21, (a, b) => [a, b], clamp, (x) => x - Math.floor(x));
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** The rules of the contract (3.3), written out once more by hand. */
const pulseIntensity = (s: number, head: number, tail: number): number => (s <= head ? clamp(1 - (head - s) / tail, 0, 1) : 0);
const headAt = (t: number, seed: number, L: number, tail: number, speed: number): number => {
  const vpx = clamp(14 * speed, 40, 260);
  const life = L + tail;
  const T = (life / vpx) * (0.7 + 0.6 * h21([seed * 91.7, 3.1]));
  const gap = 0.6 * h21([seed * 53.3, 7.7]);
  const ph = (() => {
    const x = t / T + h21([seed * 17.9, 1.3]);
    return x - Math.floor(x);
  })();
  return ph * (1 + gap) * life;
};

describe('the pulse and its timing (the GLSL functions, translated, against the contract)', () => {
  const g = glslToJs(DETAIL_PULSE_GLSL);

  it('pulse() is 1 at the head, falls to 0 a tail behind it and is 0 ahead of it: the same at 12 points', () => {
    const points: [number, number, number][] = [
      [50, 50, 40], // at the head
      [30, 50, 40], // half a tail behind
      [10, 50, 40], // a tail behind: 0
      [0, 50, 40], // further: 0
      [60, 50, 40], // ahead: 0
      [50.0001, 50, 40], // just ahead: 0
      [45, 50, 24],
      [26, 50, 24],
      [0, 0, 90], // the head at the start of the line
      [89, 90, 90],
      [200, 300, 90],
      [219, 220, 60],
    ];
    expect(points).toHaveLength(12);
    for (const [s, head, tail] of points) expect(g.pulse(s, head, tail), `s ${s}, head ${head}, tail ${tail}`).toBeCloseTo(pulseIntensity(s, head, tail), 12);
    expect(g.pulse(50, 50, 40)).toBe(1);
    expect(g.pulse(30, 50, 40)).toBeCloseTo(0.5, 12);
    expect(g.pulse(10, 50, 40)).toBe(0);
    expect(g.pulse(60, 50, 40)).toBe(0);
  });

  it('lineHead() is the contract\'s cycle: the same at 12 points of time, seed, length, tail and speed', () => {
    const pts: [number, number, number, number, number][] = [
      [0, 0.1, 150, 40, 5],
      [1.7, 0.1, 150, 40, 5],
      [3.7, 0.37, 90, 24, 0.5],
      [3.7, 0.37, 220, 90, 14],
      [12.25, 0.62, 180, 60, 9],
      [100.5, 0.9, 120, 30, 2],
      [100.5, 0.01, 120, 30, 2],
      [9999.9, 0.5, 200, 80, 12],
      [0.3, 0.99, 100, 24, 20],
      [55, 0.25, 160, 50, 7],
      [7.7, 0.75, 130, 45, 3.5],
      [2.2, 0.44, 210, 70, 11],
    ];
    expect(pts).toHaveLength(12);
    for (const [t, seed, L, tail, speed] of pts) expect(g.lineHead(t, seed, L, tail, speed), `t ${t}, seed ${seed}`).toBeCloseTo(headAt(t, seed, L, tail, speed), 9);
  });

  it('a pulse is born at the start of a line, crosses it and its tail, and rests for a gap of 0 to 60 % before the next', () => {
    for (const seed of [0.02, 0.2, 0.41, 0.66, 0.83, 0.97]) {
      const L = 160;
      const tail = 50;
      const speed = 8;
      const life = L + tail;
      let max = 0;
      let rest = 0;
      let live = 0;
      const heads: number[] = [];
      for (let t = 0; t < 40; t += 0.01) {
        const h = g.lineHead(t, seed, L, tail, speed);
        heads.push(h);
        max = Math.max(max, h);
        if (h > life) rest++;
        else live++;
      }
      expect(max, `seed ${seed}: never past 1.6 lives`).toBeLessThanOrEqual(1.6 * life + 1e-9);
      expect(Math.min(...heads), `seed ${seed}`).toBeGreaterThanOrEqual(0);
      // The head only ever moves forward, and drops back to 0 once a cycle: a restart, not a jump in the middle.
      let resets = 0;
      for (let i = 1; i < heads.length; i++) if (heads[i]! < heads[i - 1]! - 1e-9) resets++;
      expect(resets, `seed ${seed}: cycles in 40 s`).toBeGreaterThanOrEqual(3);
      // The share of the cycle with the pulse off the line is the gap's: under 0.6 / 1.6 of the time.
      expect(rest / (rest + live), `seed ${seed}`).toBeLessThanOrEqual(0.6 / 1.6 + 0.01);
    }
  });

  it('every line keeps its own rhythm: the cycle runs between 0.7 and 1.3 of the time the pulse takes to cross it, and the phase is the seed\'s', () => {
    const cycles: number[] = [];
    const phases = new Set<number>();
    for (let k = 0; k < 40; k++) {
      const seed = (k + 0.5) / 40;
      const L = 150;
      const tail = 40;
      const speed = 6;
      const vpx = clamp(14 * speed, 40, 260);
      const base = (L + tail) / vpx;
      let last = g.lineHead(0, seed, L, tail, speed);
      let firstReset = -1;
      let secondReset = -1;
      for (let t = 0.005; t < 8 * base; t += 0.005) {
        const h = g.lineHead(t, seed, L, tail, speed);
        if (h < last - 1e-9) {
          if (firstReset < 0) firstReset = t;
          else {
            secondReset = t;
            break;
          }
        }
        last = h;
      }
      expect(secondReset).toBeGreaterThan(0);
      cycles.push((secondReset - firstReset) / base);
      phases.add(+g.lineHead(0, seed, L, tail, speed).toFixed(3));
    }
    expect(Math.min(...cycles)).toBeGreaterThanOrEqual(0.7 - 0.02);
    expect(Math.max(...cycles)).toBeLessThanOrEqual(1.3 + 0.02);
    expect(Math.max(...cycles) - Math.min(...cycles), 'the cycles differ from line to line').toBeGreaterThan(0.3);
    expect(phases.size, 'the phases differ from line to line').toBeGreaterThan(30);
  });

  it('a line moves at 14 px for each m/s of its wind, kept between 40 and 260 px a second', () => {
    const seed = 0.31;
    const ph = (x: number): number => x - Math.floor(x);
    for (const [speed, vpx] of [[0.5, 40], [2, 40], [5, 70], [10, 140], [30, 260]] as const) {
      const T = (190 / vpx) * (0.7 + 0.6 * h21([seed * 91.7, 3.1]));
      const gap = 0.6 * h21([seed * 53.3, 7.7]);
      const t = 0.3;
      const expected = ph(t / T + h21([seed * 17.9, 1.3])) * (1 + gap) * 190;
      expect(g.lineHead(t, seed, 150, 40, speed), `speed ${speed}`).toBeCloseTo(expected, 9);
    }
    // A stronger wind crosses the line sooner: the cycle (the time between two restarts) is shorter at 10 m/s than at 3 m/s.
    const cycle = (speed: number): number => {
      let last = g.lineHead(0, seed, 150, 40, speed);
      let first = -1;
      for (let t = 0.002; t < 30; t += 0.002) {
        const h = g.lineHead(t, seed, 150, 40, speed);
        if (h < last - 1e-9) {
          if (first < 0) first = t;
          else return t - first;
        }
        last = h;
      }
      return NaN;
    };
    expect(cycle(10)).toBeLessThan(cycle(3));
  });
});

describe('the batch', () => {
  it('holds 72 bytes a segment: 18 floats in five flat arrays (864 kB at the 12,000 of the High tier)', () => {
    const b = make(GLYPH_CAPS.high.segments);
    expect(b.a.length).toBe(3 * 12000);
    expect(b.b.length).toBe(3 * 12000);
    expect(b.c.length).toBe(4 * 12000);
    expect(b.d.length).toBe(4 * 12000);
    expect(b.e.length).toBe(4 * 12000);
    expect(b.a.byteLength + b.b.byteLength + b.c.byteLength + b.d.byteLength + b.e.byteLength).toBe(72 * 12000);
    expect(b.capacity).toBe(12000);
    b.dispose();
  });

  it('is one draw call: one mesh, one instanced quad, hidden until the layer shows it', () => {
    const b = make();
    expect(b.mesh.name).toBe('wind-detail');
    expect(b.mesh.visible).toBe(false);
    expect(b.mesh.geometry).toBeInstanceOf(THREE.InstancedBufferGeometry);
    expect((b.mesh.geometry as THREE.InstancedBufferGeometry).index!.count).toBe(6);
    expect(b.mesh.frustumCulled).toBe(false);
    expect(b.mesh.renderOrder).toBe(6); // over the halo (5) of the glyph batches, which are hidden when this is drawn
    expect(Array.isArray(b.mesh.material)).toBe(false);
  });

  it('is plain blending with a depth test that never writes depth, and no tone mapping', () => {
    const m = material(make());
    expect(m.transparent).toBe(true);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.toneMapped).toBe(false);
    expect(m.blending).toBe(THREE.NormalBlending);
  });

  it('commits the first n segments: the instance count and the part of each attribute that is uploaded', () => {
    const b = make(100);
    b.commit(30);
    const g = b.mesh.geometry as THREE.InstancedBufferGeometry;
    expect(g.instanceCount).toBe(30);
    for (const [name, size] of [['aA', 3], ['aB', 3], ['aC', 4], ['aD', 4], ['aE', 4]] as const) {
      const at = g.getAttribute(name) as THREE.InstancedBufferAttribute;
      expect(at.itemSize).toBe(size);
      expect(at.updateRanges, name).toEqual([{ start: 0, count: 30 * size }]);
      expect(at.array, name).toBe({ aA: b.a, aB: b.b, aC: b.c, aD: b.d, aE: b.e }[name]);
    }
    b.commit(1000);
    expect(g.instanceCount).toBe(100); // never more than the capacity
    b.commit(0);
    expect(g.instanceCount).toBe(0);
  });

  it('takes its time from the view\'s clock and its viewport from the shared uniforms, and the rest are its own', () => {
    const s = shared();
    const b = new DetailBatch({ capacity: 4, widthPx: 3.2, depthBiasM: 40, shared: s });
    const u = material(b).uniforms;
    expect(u.uTime).toBe(s.uClock); // the same object: it moves with the clock, with no call from the layer
    expect(u.uViewport).toBe(s.uViewport);
    s.uClock!.value = 12.5;
    expect(u.uTime!.value).toBe(12.5);
    expect([u.uMoving!.value, u.uFade!.value, u.uWidthPx!.value, u.uDepthBias!.value]).toEqual([1, 1, 3.2, 40]);
  });

  it('sets moving, the fade, the pixels a metre covers and the stroke width', () => {
    const b = make();
    const u = material(b).uniforms;
    b.setMoving(false);
    expect(u.uMoving!.value).toBe(0);
    b.setMoving(true);
    expect(u.uMoving!.value).toBe(1);
    b.setFade(0.25);
    expect(u.uFade!.value).toBe(0.25);
    b.setPxPerM1(931.5);
    expect(u.uPxPerM1!.value).toBe(931.5);
    b.widthPx = 6.4;
    expect(u.uWidthPx!.value).toBe(6.4);
  });

  it('disposes its geometry and material', () => {
    const b = make();
    let disposed = 0;
    b.mesh.geometry.addEventListener('dispose', () => disposed++);
    material(b).addEventListener('dispose', () => disposed++);
    b.dispose();
    expect(disposed).toBe(2);
  });
});
