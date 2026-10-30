/**
 * The detailed streaks' look and cold start (0.7.0, item E, lane looks-A) in the real app (bundled Katoomba demo, 6 km, offline, the fast tier,
 * the High picture tier, the real worker, a Pixel 7 profile at device scale 1, software GL). The builder's rules are unit-tested (src/render/wind:
 * `detailStreaks.test.ts`, `detailObstacles.test.ts`); this checks what only a real renderer shows:
 *
 *   - the layer's programs compile ahead (`precompile`, the hook the scene view calls when the first air arrives): the program count rises at that
 *     call and the first frame of the most detailed level builds no program of its own; the console stays empty (the guard of ./fixtures)
 *   - the cold first zoom into the most detailed level: the layer's own share of a frame (`tickMaxMs`) and its slices are reported, and held to a
 *     generous bound that software GL cannot move (the numbers are logged for the verifier's trace)
 *   - the relief in the forest: the strokes ride on the canopy (lifted well over the 0.6.0 stroke), bend round the crowns (no vertex lies inside the disc
 *     a placed crown shows at the stroke's height, read from the vegetation layer's own placement), keep their colours (the same 64 colours of the Wind
 *     speed ramp), carry their pin (0.05 to 1, 1 with the relief off), and never exceed the tier's caps or the frame's triangle budget
 *   - the kill switch draws the 0.6.0 picture: the relief off twice gives the same bytes, on gives other ones
 * The layer is fed the canopy, the crowns and the plume here as the scene view does (lane looks-B wires it); feeding twice is harmless.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { crownIncursions, type PlacedTree } from '../src/render/wind/detailStreaks.testing';
import { DETAIL_MIN_SEGMENTS, FRAME_TRIANGLE_LIMIT, GLYPH_CAPS } from '../src/render/wind/glyphTypes';
import { acceptNotice, frame } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

interface Stats {
  active: boolean;
  level: number;
  count: number;
  segments: number;
  detail: 'off' | 'moving' | 'still' | 'paused';
  detailSegments: number;
  rebuilds: number;
  lastMs: number;
  sliceP95Ms: number;
  sliceMaxMs: number;
  slicesLast: number;
  tickMaxMs: number;
  cellM: number;
}
interface Layer {
  setRelief(on: boolean): void;
  setCanopy(f: unknown): void;
  setCrowns(s: unknown): void;
  setPlumes(p: unknown): void;
  setData(d: unknown): void;
  data: unknown;
  precompile(renderer: unknown, camera: unknown, scene: unknown): Promise<void>;
}
type Mesh = { visible: boolean; geometry: { instanceCount: number; getAttribute(n: string): { array: Float32Array } }; material: { uniforms: Record<string, { value: number }> } };
type View = {
  lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
  setLayers(l: Record<string, unknown>): void;
  renderNow(): void;
  windGlyphStats?(): Stats | null;
  renderQuality: 'low' | 'medium' | 'high';
  rig: { update(now: number): boolean; camera: unknown };
  scene: { getObjectByName(n: string): Mesh | undefined };
  renderer: { domElement: HTMLCanvasElement; info: { render: { calls: number; triangles: number }; programs?: unknown[] | null }; properties: { get(o: unknown): { currentProgram?: unknown } } };
  glyphs: Layer;
  vegetation: { crownSource(): unknown } | null;
  fuel: unknown;
};
type Handle = { __firesim: { view: View; session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } } } } };

/** Build the Katoomba demo at the fast tier and the High picture tier, and wait for the air. */
async function build(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('picture-quality').getByRole('radio', { name: 'High' }).check();
  await page.getByTestId('close-settings').click();
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: /^Fast/ }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null), { timeout: 60_000 }).not.toBeNull();
  expect(await page.evaluate(() => (window as unknown as Handle).__firesim.view.renderQuality)).toBe('high');
}

const lookAt = (page: Page, d: number, tilt = 55, x = 0, y = 0, az = 200): Promise<void> =>
  page.evaluate(([px, py, pd, a, t]) => (window as unknown as Handle).__firesim.view.lookAt(px!, py!, pd!, a!, t!, false), [x, y, d, az, tilt]);
const setLayers = (page: Page, l: Record<string, unknown>): Promise<void> => page.evaluate((v) => (window as unknown as Handle).__firesim.view.setLayers(v), l);
/** The detail batch's program, as three.js keeps it for the material (undefined until it is compiled): kept in a global so that a later call can say whether it is the same one. */
const detailProgram = (page: Page, keep: boolean): Promise<{ has: boolean; same: boolean }> =>
  page.evaluate((k) => {
    const v = (window as unknown as Handle).__firesim.view;
    const m = v.scene.getObjectByName('wind-detail')!;
    const prog = v.renderer.properties.get(m.material).currentProgram;
    const w = window as unknown as { __detailProgram?: unknown };
    const same = prog !== undefined && w.__detailProgram === prog;
    if (k) w.__detailProgram = prog;
    return { has: prog !== undefined, same };
  }, keep);
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rig = (window as unknown as Handle).__firesim.view.rig;
    const t0 = performance.now() + 4000;
    for (let i = 0; i < 100; i++) rig.update(t0 + i * 16);
  });
  await frame(page);
}
/** Draw a frame (a rebuild is finished in it) and read what the layer says. */
const drawAndRead = (page: Page): Promise<Stats> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.renderNow();
    v.renderNow();
    return v.windGlyphStats!()!;
  });

/** What the scene view does in 0.7.0: the layer is given the canopy, the crowns of the vegetation layer and (here, no fire) no plume. */
const feed = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    if (!v.vegetation) return false;
    v.glyphs.setCanopy(v.fuel);
    v.glyphs.setCrowns(v.vegetation.crownSource());
    v.glyphs.setPlumes([]);
    v.glyphs.setData(v.glyphs.data);
    return true;
  });
const relief = (page: Page, on: boolean): Promise<void> => page.evaluate((o) => (window as unknown as Handle).__firesim.view.glyphs.setRelief(o), on);

/** The detail batch as the builder wrote it: the world ends, the colour and pin, per segment. */
const batch = (page: Page): Promise<{ n: number; a: number[]; c: number[] }> =>
  page.evaluate(() => {
    const m = (window as unknown as Handle).__firesim.view.scene.getObjectByName('wind-detail')!;
    const n = m.geometry.instanceCount;
    return { n, a: Array.from(m.geometry.getAttribute('aA').array.subarray(0, 3 * n)), c: Array.from(m.geometry.getAttribute('aC').array.subarray(0, 4 * n)) };
  });

/** The frame as bytes (drawn and read in the same task) and the pixels the streaks change: the frame as it is against the same frame with the batch hidden. */
const pixels = (page: Page): Promise<{ png: string; streak: number }> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    const m = v.scene.getObjectByName('wind-detail')!;
    const read = (): Uint8ClampedArray => {
      v.renderNow();
      const src = v.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const withStreaks = read();
    const png = v.renderer.domElement.toDataURL('image/png');
    m.visible = false;
    const without = read();
    m.visible = true;
    let streak = 0;
    for (let i = 0; i < withStreaks.length; i += 4) {
      if (Math.abs(withStreaks[i]! - without[i]!) + Math.abs(withStreaks[i + 1]! - without[i + 1]!) + Math.abs(withStreaks[i + 2]! - without[i + 2]!) > 40) streak++;
    }
    return { png, streak };
  });

/**
 * The vertices of the detail batch (the start of every segment) and the placed trees near them, read out of the page: the trees are the vegetation layer's own
 * placement (what `crownSource()` gives the layer), taken by their feet's place and size. `crownIncursions` (the unit-tested reader, `detailStreaks.testing.ts`)
 * then counts the vertices inside a crown's disc at the vertex's own height.
 */
const batchAndTrees = (page: Page): Promise<{ n: number; a: number[]; trees: PlacedTree[] }> =>
  page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    const m = v.scene.getObjectByName('wind-detail')!;
    const n = m.geometry.instanceCount;
    const aA = m.geometry.getAttribute('aA').array;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = aA[3 * i]!;
      const y = -aA[3 * i + 2]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const sets = (v.vegetation!.crownSource() as { sets(): { group: number; count: number; position: Float32Array; size: Float32Array }[] }).sets();
    const trees: { x: number; y: number; ground: number; height: number; width: number }[] = [];
    for (const set of sets) {
      if (set.group > 6) continue;
      for (let t = 0; t < set.count; t++) {
        const x = set.position[3 * t]!;
        const y = set.position[3 * t + 1]!;
        if (x < x0 - 12 || x > x1 + 12 || y < y0 - 12 || y > y1 + 12) continue;
        trees.push({ x, y, ground: set.position[3 * t + 2]!, height: set.size[2 * t]!, width: set.size[2 * t + 1]! });
      }
    }
    return { n, a: Array.from(aA.subarray(0, 3 * n)), trees };
  });

test('wind detail looks: the early compile, the cold first zoom, the relief in the forest, the caps, the kill switch', async ({ page }) => {
  test.setTimeout(900_000);
  await build(page);
  await setLayers(page, { vegetation: true, understorey: true, windGlyphs: false, wind: 'surface', windHeight: 'fire' });
  expect(await feed(page), 'the vegetation layer exists').toBe(true);

  await test.step('the programs compile ahead of the first frame of the most detailed level, and that frame builds none of its own', async () => {
    await lookAt(page, 6000, 52); // far out: the Wind streaks only, nothing of the layer drawn
    await drawAndRead(page);
    const before = await detailProgram(page, false);
    await page.evaluate(() => {
      const v = (window as unknown as Handle).__firesim.view;
      return v.glyphs.precompile(v.renderer, v.rig.camera, v.scene);
    });
    const compiled = await detailProgram(page, true);
    console.log(`detail program: ${before.has ? 'there already (the scene view compiled it)' : 'not yet'} before precompile, ${compiled.has ? 'there' : 'missing'} after`);
    expect(compiled.has, 'precompile builds the detail program (or the scene view did already, with the first air)').toBe(true);
    await lookAt(page, 300, 55);
    await settle(page);
    const s = await drawAndRead(page);
    expect(s.level, 'the closest levels are reached').toBe(4);
    expect(s.detail).toBe('moving');
    expect((await detailProgram(page, false)).same, 'the first level-4 frame drew with the program that was compiled ahead').toBe(true);
  });

  await test.step('the cold first zoom: the layer\'s own share of a frame and its slices are reported (the verifier\'s trace is the judge; this is the bound software GL cannot move)', async () => {
    await lookAt(page, 4000, 55);
    await settle(page);
    await drawAndRead(page);
    const cold = await page.evaluate(
      () =>
        new Promise<Stats>((resolve) => {
          const v = (window as unknown as Handle).__firesim.view;
          v.windGlyphStats!(); // a new window for tickMaxMs
          v.lookAt(0, 0, 250, 200, 55, false);
          const t0 = performance.now();
          const tick = (): void => {
            if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
            else resolve(v.windGlyphStats!()!);
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(`first zoom to L4: tickMaxMs ${cold.tickMaxMs.toFixed(1)}, ${cold.rebuilds} rebuilds, last ${cold.lastMs.toFixed(1)} ms in ${cold.slicesLast} slices, slice p95 ${cold.sliceP95Ms.toFixed(1)} max ${cold.sliceMaxMs.toFixed(1)}`);
    expect(cold.level).toBe(4);
    expect(cold.tickMaxMs, 'the layer\'s own tick, with the rest of the frame left out').toBeGreaterThan(0);
    expect(cold.tickMaxMs, 'a tick is a slice of a few ms, never the whole build').toBeLessThan(150);
  });

  await test.step('in the forest, at the closest zoom: the strokes ride on the canopy, keep their colours and carry their pin, and the caps and the triangle budget hold', async () => {
    await lookAt(page, 120, 45);
    await settle(page);
    await relief(page, false);
    const off = await drawAndRead(page);
    const offBatch = await batch(page);
    await relief(page, true);
    const on = await drawAndRead(page);
    const onBatch = await batch(page);
    console.log(`forest, 120 m: relief off ${off.count} lines ${off.detailSegments} segments; on ${on.count} lines ${on.detailSegments} segments`);
    expect(off.detailSegments).toBeGreaterThan(500);
    expect(on.detailSegments).toBeGreaterThan(500);
    expect(on.count, 'in thick forest the streaks keep to the gaps, and the picture still has them').toBeGreaterThan(off.count * 0.3);
    for (const [what, s] of [['off', off], ['on', on]] as const) {
      expect(s.detailSegments, `${what}: the High tier's cap`).toBeLessThanOrEqual(GLYPH_CAPS.high.segments);
      expect(s.count, `${what}: the High tier's lines`).toBeLessThanOrEqual(GLYPH_CAPS.high.glyphs);
    }
    const tris = await page.evaluate(() => (window as unknown as Handle).__firesim.view.renderer.info.render.triangles);
    expect(tris, 'the frame stays inside its budget, 2 triangles a segment more for the streaks').toBeLessThanOrEqual(FRAME_TRIANGLE_LIMIT + 2 * DETAIL_MIN_SEGMENTS);
    // The pin: 1 everywhere with the relief off; 0.05 to 1 on, and some lines are pinned in the forest.
    expect(Math.min(...offBatch.c.filter((_, i) => i % 4 === 3))).toBe(1);
    const pins = onBatch.c.filter((_, i) => i % 4 === 3);
    expect(Math.min(...pins)).toBeGreaterThanOrEqual(0.05 - 1e-6);
    expect(Math.max(...pins)).toBe(1);
    expect(pins.filter((p) => p < 1).length, 'segments pinned near crowns').toBeGreaterThan(20);
    // The colours are the Wind speed ramp's 64, relief or not: the speed is the model's.
    const colours = (b: { c: number[] }): Set<string> => new Set(Array.from({ length: b.c.length / 4 }, (_, i) => `${b.c[4 * i]!.toFixed(4)},${b.c[4 * i + 1]!.toFixed(4)},${b.c[4 * i + 2]!.toFixed(4)}`));
    expect(colours(onBatch).size).toBeLessThanOrEqual(64);
    expect([...colours(onBatch)].filter((c) => !colours(offBatch).has(c)).length, 'no colour of the relief picture is outside the 0.6.0 picture\'s').toBeLessThanOrEqual(Math.ceil(0.15 * colours(offBatch).size));
    // The strokes ride on the canopy: over trees (a 24 m canopy and more) the lowest vertex is well over the 1.5 m of the 0.6.0 stroke.
    const heights = onBatch.a.filter((_, i) => i % 3 === 1);
    console.log(`forest, 120 m: vertex heights (world y) of the relief picture from ${Math.min(...heights).toFixed(1)} to ${Math.max(...heights).toFixed(1)} m; 0.6.0: from ${Math.min(...offBatch.a.filter((_, i) => i % 3 === 1)).toFixed(1)} to ${Math.max(...offBatch.a.filter((_, i) => i % 3 === 1)).toFixed(1)} m`);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(heights) - mean(offBatch.a.filter((_, i) => i % 3 === 1)), 'the strokes are lifted onto the canopy (metres, mean over the picture)').toBeGreaterThan(5);
  });

  // Reduced motion freezes the picture at one clock (the frame loop's `renderNow` moves the clock by up to 0.1 s a call otherwise), so that two frames can be compared.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await test.step('the crowns count: the lines part round the placed trees (no vertex inside a crown\'s disc at its height), and both pictures have streaks', async () => {
    await lookAt(page, 120, 45);
    await settle(page);
    await relief(page, false);
    await drawAndRead(page);
    const off = await pixels(page);
    const offPic = await batchAndTrees(page);
    await relief(page, true);
    await drawAndRead(page);
    const on = await pixels(page);
    const onPic = await batchAndTrees(page);
    const fractions = [0.5, 0.75, 0.85, 1.2];
    const offIn = crownIncursions(offPic.a, offPic.n, offPic.trees, fractions);
    const onIn = crownIncursions(onPic.a, onPic.n, onPic.trees, fractions);
    console.log(`forest, 120 m, 45 degrees: streak pixels ${off.streak} off, ${on.streak} on; segment starts inside 0.5, 0.75, 0.85 and 1.2 radii of a crown's disc at their own height: ${offIn.join(', ')} of ${offPic.n} off, ${onIn.join(', ')} of ${onPic.n} on, ${onPic.trees.length} trees in the box`);
    expect(off.streak).toBeGreaterThan(500);
    expect(on.streak).toBeGreaterThan(500);
    expect(onPic.trees.length, 'the vegetation layer has placed trees here').toBeGreaterThan(20);
    expect(onIn[3], 'the strokes ride at heights where crowns are cut, so the test has something to test').toBeGreaterThan(20);
    // The lines part round the crowns they know (the layer scans the placed trees that are big enough on the screen; a seed stands outside 0.8 radii, a line ends at 0.85):
    // the vertices of a crown the scan left out (too small on the screen, on the margin, a tree the scan's box missed) are allowed in the hundredths, a picture that
    // ignores the crowns has many more (see the reader's unit test, `crownIncursions`).
    expect(onIn[0], 'nothing deep inside a crown').toBeLessThanOrEqual(Math.ceil(0.02 * onPic.n));
    expect(onIn[1], 'few inside 0.75 radii').toBeLessThanOrEqual(Math.ceil(0.05 * onPic.n));
  });

  await test.step('the kill switch draws the 0.6.0 picture: relief off twice is the same bytes, on is another picture', async () => {
    const shotOf = async (on: boolean): Promise<string> => {
      await relief(page, on);
      await drawAndRead(page);
      return (await pixels(page)).png;
    };
    const a = await shotOf(false);
    const b = await shotOf(false);
    const c = await shotOf(true);
    expect(b === a, 'relief off is a still picture (same clock, same bytes)').toBe(true);
    expect(c === a, 'relief on is not the 0.6.0 picture in the forest').toBe(false);
  });
});
