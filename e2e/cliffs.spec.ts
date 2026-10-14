/**
 * Cliff drawing (workstream H-look, plan 9d.3 and 9d.6) in the real app: the bundled Katoomba demo, offline, the real engine, on the Low
 * and High picture tiers. The sharpened 10 m terrain draws the escarpment as near-vertical rock walls, lit and detailed from the 10 m
 * terrain and the rock mask; the Data sets Terrain card says the drawing is not the data; the debug statistics screen shows the build.
 *
 * What is checked, on frames decoded with fast-png (the same orbit view near the escarpment each time):
 *  - the drawn ground is steeper than without the 10 m terrain (the view's own height field, along the fall line), the figures the
 *    statistics screen shows are right for the tier (vertices, triangles, rock detail), and the old path still runs without a 10 m
 *    terrain (statistics null);
 *  - edge contrast on the cliff pixels is higher than in the same view built without the sharpening. This is a weak, necessary check:
 *    spike S5 saw it rise 4 to 15 % in orbit views, and a serrated drawing passes it. The real judgement is the pictures (attached);
 *  - no near-black and no all-zero (NaN) pixel; draw calls unchanged; triangles inside the 1 to 1.5 million budget;
 *  - the Data sets Terrain card carries the disclosure; the statistics screen shows the terrain row; the console stays empty (the
 *    guard in fixtures.ts).
 *
 * The tier follows the device (cores and memory) until the picture-quality setting exists, so the test browser says what each run
 * needs and the test reads the tier back from the view. Frames are read from the canvas with the app's own loop stopped.
 */
import type { Page } from '@playwright/test';
import { decode } from 'fast-png';
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

test.use({ deviceScaleFactor: 1 });

type Tier = 'low' | 'high';

/** Katoomba's tallest sheer face (spike S5): its middle in local metres, and the compass direction it faces (downhill). */
const FACE = { x: 2505, y: -1995, down: 181 };

interface ViewHandle {
  scenario: {
    terrain: unknown;
    fuel: unknown;
    terrainHiRes?: { grid: { nx: number; ny: number; cellSize: number }; elevation: Float32Array };
  };
  view: {
    renderQuality?: Tier | 'medium';
    terrainStats?(): { sharpenedShare: number | null; sharpenMs: number | null; maskMs: number | null; meshMs: number | null; gradientMs: number | null; meshVertices: number; meshTriangles: number; rockDetail: string } | null;
  };
}

/** The device the app sees decides the tier (cores 8 and 6 GB or more give High, 4 cores or fewer give Low). */
async function start(page: Page, tier: Tier): Promise<void> {
  await page.addInitScript(([cores, memory]) => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });
  }, tier === 'high' ? [8, 8] : [2, 2]);
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

interface Frame {
  w: number;
  h: number;
  ch: number;
  data: ArrayLike<number>;
  calls: number;
  triangles: number;
  png: Buffer;
  /** The cliff face's box in frame pixels (its lip, foot and both ends, projected). */
  box: { x0: number; y0: number; x1: number; y1: number };
}

interface Shot {
  /** Photo and trees on (the app's own look) or off (the ground alone: edge contrast is read on this). */
  look: 'photo' | 'ground';
  /** The scenario is built with its 10 m terrain (sharpened cliffs) or without (nothing sharpened, the old path). */
  hiRes: boolean;
  /** Camera distance (m) and tilt (deg from straight down) of the orbit view; the target is the foot of the face. */
  distance: number;
  tilt?: number;
}

/**
 * One frame of the 3-D view as pixels: the scenario is (re)built the way `shot` says, the camera is put 25 degrees off the face's fall
 * line and `distance` m from its foot, the loop is stopped and the canvas is read in the task that draws it.
 */
async function shoot(page: Page, shot: Shot): Promise<Frame & { stats: ReturnType<NonNullable<ViewHandle['view']['terrainStats']>> | undefined }> {
  const r = await page.evaluate(
    (o) => {
      const fs = (window as unknown as { __firesim: ViewHandle }).__firesim;
      const v = fs.view as unknown as {
        renderer: { setAnimationLoop(f: null): void; domElement: HTMLCanvasElement; info: { render: { calls: number; triangles: number } } };
        rig: { setViewInsets(i: object, animate: boolean): void };
        setScenario(t: unknown, f: unknown, o: object): void;
        setLayers(p: Record<string, unknown>): void;
        lookAt(x: number, y: number, d: number, az: number, tilt: number): void;
        projectToScreen(x: number, y: number): [number, number] | null;
        renderNow(): void;
        terrainStats?(): unknown;
        u: Record<string, { value: number }>;
      };
      v.renderer.setAnimationLoop(null);
      v.rig.setViewInsets({}, false);
      const sc = fs.scenario;
      // The aerial photo of the build is kept from its first layer, so every rebuild shows the same photo.
      const w = window as unknown as { __cliffsPhoto?: { image: unknown; attribution: string } | null };
      if (w.__cliffsPhoto === undefined) {
        const tex = (fs.view as unknown as { terrainLayer?: { imageryTex?: { image: unknown } | null } }).terrainLayer?.imageryTex;
        w.__cliffsPhoto = tex ? { image: tex.image, attribution: '' } : null;
      }
      v.setScenario(sc.terrain, sc.fuel, { imagery: w.__cliffsPhoto ?? undefined, hiRes: o.hiRes ? sc.terrainHiRes ?? null : null });
      v.setLayers(o.look === 'photo' ? { imagery: true, vegetation: true } : { imagery: false, vegetation: false, understorey: false });
      const rad = (d: number): number => (d * Math.PI) / 180;
      const foot = { x: o.face.x + 60 * Math.sin(rad(o.face.down)), y: o.face.y + 60 * Math.cos(rad(o.face.down)) };
      v.lookAt(foot.x, foot.y, o.distance, (o.face.down + 25) % 360, o.tilt);
      v.u.uClock!.value = 3;
      for (let i = 0; i < 3; i++) v.renderNow(); // three, so the canopy and the labels are settled
      const canvas = v.renderer.domElement;
      // The face's box: its lip (60 m uphill of the middle), its foot (100 m downhill), and 150 m either way along the face.
      const pts: [number, number][] = [];
      for (const along of [-150, 0, 150])
        for (const across of [-60, 0, 100]) {
          const a = rad(o.face.down);
          pts.push([o.face.x + across * Math.sin(a) + along * Math.cos(a), o.face.y + across * Math.cos(a) - along * Math.sin(a)]);
        }
      const px = pts.map(([x, y]) => v.projectToScreen(x, y)).filter((p): p is [number, number] => !!p);
      const sx = canvas.width / canvas.clientWidth;
      const sy = canvas.height / canvas.clientHeight;
      const xs = px.map((p) => p[0] * sx);
      const ys = px.map((p) => p[1] * sy);
      const info = v.renderer.info.render;
      return {
        url: canvas.toDataURL('image/png'),
        calls: info.calls,
        triangles: info.triangles,
        stats: (v.terrainStats?.() ?? null) as never,
        box: { x0: Math.max(0, Math.floor(Math.min(...xs))), y0: Math.max(0, Math.floor(Math.min(...ys))), x1: Math.min(canvas.width, Math.ceil(Math.max(...xs))), y1: Math.min(canvas.height, Math.ceil(Math.max(...ys))) },
      };
    },
    { ...shot, face: FACE, tilt: shot.tilt ?? 66 },
  );
  const png = decode(Buffer.from(r.url.split(',')[1]!, 'base64'));
  return { w: png.width, h: png.height, ch: png.channels, data: png.data, calls: r.calls, triangles: r.triangles, png: Buffer.from(r.url.split(',')[1]!, 'base64'), box: r.box, stats: r.stats };
}

const luma = (f: Frame, x: number, y: number): number => {
  const i = (y * f.w + x) * f.ch;
  return 0.2126 * f.data[i]! + 0.7152 * f.data[i + 1]! + 0.0722 * f.data[i + 2]!;
};

/** Mean Sobel gradient magnitude of the luma inside the face's box: how crisp the edges on the cliff are. */
function edgeContrast(f: Frame): number {
  const { x0, y0, x1, y1 } = f.box;
  let sum = 0;
  let n = 0;
  for (let y = Math.max(1, y0); y < Math.min(f.h - 1, y1); y++)
    for (let x = Math.max(1, x0); x < Math.min(f.w - 1, x1); x++) {
      const gx = luma(f, x + 1, y - 1) + 2 * luma(f, x + 1, y) + luma(f, x + 1, y + 1) - luma(f, x - 1, y - 1) - 2 * luma(f, x - 1, y) - luma(f, x - 1, y + 1);
      const gy = luma(f, x - 1, y + 1) + 2 * luma(f, x, y + 1) + luma(f, x + 1, y + 1) - luma(f, x - 1, y - 1) - 2 * luma(f, x, y - 1) - luma(f, x + 1, y - 1);
      sum += Math.hypot(gx, gy);
      n++;
    }
  return n ? sum / n : 0;
}

/** Share (percent) of the frame's pixels darker than `lum`, and the number of pure black ones (a NaN lights to black). */
function darkness(f: Frame, lum: number): { share: number; black: number } {
  let dark = 0;
  let black = 0;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const i = (y * f.w + x) * f.ch;
      if (f.data[i] === 0 && f.data[i + 1] === 0 && f.data[i + 2] === 0) black++;
      if (luma(f, x, y) < lum) dark++;
    }
  return { share: (100 * dark) / (f.w * f.h), black };
}

/** The steepest step (deg) of the view's drawn ground between two points `step` m apart along the face's fall line, on the face's neighbourhood. */
const steepestStep = (page: Page, step: number): Promise<number> =>
  page.evaluate(
    ([face, s]) => {
      const f = face as { x: number; y: number; down: number };
      const hf = ((window as unknown as { __firesim: { view: unknown } }).__firesim.view as { hf: { heightAt(x: number, y: number): number } }).hf;
      const a = (f.down * Math.PI) / 180;
      let best = 0;
      for (let along = -120; along <= 120; along += 20)
        for (let d = -80; d <= 120; d += 2) {
          const x0 = f.x + d * Math.sin(a) + along * Math.cos(a);
          const y0 = f.y + d * Math.cos(a) - along * Math.sin(a);
          const x1 = x0 + (s as number) * Math.sin(a);
          const y1 = y0 + (s as number) * Math.cos(a);
          best = Math.max(best, (Math.atan(Math.abs(hf.heightAt(x1, y1) - hf.heightAt(x0, y0)) / (s as number)) * 180) / Math.PI);
        }
      return best;
    },
    [FACE, step] as const,
  );

for (const tier of ['high', 'low'] as const) {
  test(`Cliffs on the ${tier} tier: near-vertical rock walls in the real view, the statistics, no black or NaN pixels`, async ({ page }) => {
    test.setTimeout(600_000);
    await start(page, tier);
    const handle = (): Promise<{ q: string | undefined; stats: ReturnType<NonNullable<ViewHandle['view']['terrainStats']>> | undefined; hi: boolean }> =>
      page.evaluate(() => {
        const f = (window as unknown as { __firesim: ViewHandle }).__firesim;
        return { q: f.view.renderQuality, stats: f.view.terrainStats?.(), hi: !!f.scenario.terrainHiRes };
      });
    const first = await handle();
    expect(first.q, 'the tier the test browser asked for').toBe(tier);
    expect(first.hi, 'the bundled Katoomba demo has its 10 m terrain').toBe(true);

    // ── What the statistics screen is given ──
    const st = first.stats!;
    expect(st, 'a 10 m terrain was sharpened').not.toBeNull();
    const mesh = tier === 'high' ? 400 : 224;
    expect(st.meshVertices).toBe(mesh * mesh);
    expect(st.meshTriangles).toBe(2 * (mesh - 1) * (mesh - 1));
    expect(st.rockDetail).toBe(tier);
    expect(st.sharpenedShare!).toBeGreaterThan(0.02); // S5: 3.9 % of Katoomba's cells move
    expect(st.sharpenedShare!).toBeLessThan(0.08);
    for (const ms of [st.sharpenMs, st.maskMs, st.meshMs, st.gradientMs]) {
      expect(ms).not.toBeNull();
      expect(ms!).toBeGreaterThan(0);
      expect(ms!).toBeLessThan(4000); // a loaded software-GL test machine, not the phone's budget
    }
    test.info().annotations.push({ type: `${tier} build ms`, description: `sharpen ${st.sharpenMs!.toFixed(0)}, mask ${st.maskMs!.toFixed(0)}, mesh ${st.meshMs!.toFixed(0)}, lighting ${st.gradientMs!.toFixed(0)}` });
    console.log(`CLIFFS ${tier} build: share ${(100 * st.sharpenedShare!).toFixed(2)} %, sharpen ${st.sharpenMs!.toFixed(0)} ms, mask ${st.maskMs!.toFixed(0)} ms, mesh ${st.meshMs!.toFixed(0)} ms, lighting ${st.gradientMs!.toFixed(0)} ms, ${st.meshTriangles} triangles`);

    // ── The rock copy that keeps trees off bare faces (SceneView.placeVegetation reads it): rock at Katoomba's face, none without a 10 m terrain ──
    const rockAt = (): Promise<number | null> =>
      page.evaluate((face) => {
        const rc = (window as unknown as { __firesim: { view: { rockCopy: { grid: { x0: number; y0: number; nx: number; ny: number; cellSize: number }; r: Uint8Array } | null } } }).__firesim.view.rockCopy;
        if (!rc) return null;
        const g = rc.grid;
        let best = 0;
        for (let dy = -40; dy <= 40; dy += 10)
          for (let dx = -40; dx <= 40; dx += 10) {
            const i = Math.round((face.x + dx - g.x0) / g.cellSize);
            const j = Math.round((face.y + dy - g.y0) / g.cellSize);
            if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) best = Math.max(best, rc.r[j * g.nx + i]!);
          }
        return best;
      }, FACE);
    expect(await rockAt(), 'bare rock (R of 0.5 or more) on Katoomba\'s face').toBeGreaterThanOrEqual(128);

    // ── The same view with the sharpened cliffs and without (the old path: no 10 m terrain, nothing sharpened) ──
    const photo = await shoot(page, { look: 'photo', hiRes: true, distance: 1100 });
    const close = await shoot(page, { look: 'photo', hiRes: true, distance: 450, tilt: 60 });
    const wall = await shoot(page, { look: 'ground', hiRes: true, distance: 1100 });
    const wallStep = await steepestStep(page, 22);
    const plain = await shoot(page, { look: 'ground', hiRes: false, distance: 1100 });
    const plainStep = await steepestStep(page, 22);
    const oldPhoto = await shoot(page, { look: 'photo', hiRes: false, distance: 1100 });
    expect(plain.stats, 'nothing is sharpened without a 10 m terrain').toBeNull();
    expect(await rockAt(), 'no rock copy without a 10 m terrain: trees are placed as before').toBeNull();
    await test.info().attach(`orbit-${tier}.png`, { body: photo.png, contentType: 'image/png' });
    await test.info().attach(`close-${tier}.png`, { body: close.png, contentType: 'image/png' });
    await test.info().attach(`ground-sharpened-${tier}.png`, { body: wall.png, contentType: 'image/png' });
    await test.info().attach(`ground-not-sharpened-${tier}.png`, { body: plain.png, contentType: 'image/png' });

    // The drawn face is steeper: over 22 m (one mesh cell) the sharpened ground climbs at least 70 degrees, which the unsharpened
    // path never draws. (S5: the steepest High edge is 83.5 degrees against 78.0, and at Low 79.1 against 73.2; without the 10 m
    // terrain the mesh is the 30 m fire grid's.)
    console.log(`CLIFFS ${tier} steepest 22 m step of the drawn ground near the face: ${wallStep.toFixed(1)} degrees, without sharpening ${plainStep.toFixed(1)}`);
    expect(wallStep).toBeGreaterThan(plainStep + 3);
    expect(wallStep).toBeGreaterThan(65);

    // Edge contrast on the cliff pixels is higher than in the same view without the sharpening (a weak, necessary check).
    const crisp = edgeContrast(wall);
    const soft = edgeContrast(plain);
    console.log(`CLIFFS ${tier} edge contrast on the face ${crisp.toFixed(1)} against ${soft.toFixed(1)} without sharpening (${((100 * (crisp - soft)) / soft).toFixed(0)} %)`);
    expect(crisp, `edge contrast ${crisp.toFixed(1)} against ${soft.toFixed(1)}`).toBeGreaterThan(soft * 1.04);

    // No near-black pixel and no pure black one (a NaN in the lighting draws black), near and far, with the photo and without. The photo's own
    // deep shade is the unsharpened view's too, so the allowance is that view's share (spike S5: none under luminance 12 in either).
    const dark0 = darkness(oldPhoto, 12);
    for (const [name, f] of [['orbit', photo], ['close', close], ['ground', wall]] as const) {
      const d = darkness(f, 12);
      expect.soft(d.black, `${tier} ${name}: all-zero pixels`).toBeLessThanOrEqual(dark0.black);
      expect.soft(d.share, `${tier} ${name}: share of pixels under luminance 12 (percent; ${dark0.share.toFixed(3)} in the unsharpened view)`).toBeLessThan(dark0.share + 0.05);
    }

    // Draw calls are the same with and without the sharpening, and the triangles are inside the 1 to 1.5 million budget.
    expect(wall.calls).toBe(plain.calls);
    expect(photo.triangles).toBeLessThan(1_500_000);
    expect(photo.triangles).toBeGreaterThan(100_000);
    console.log(`CLIFFS ${tier} draw calls ${wall.calls} (${plain.calls} without), triangles ${photo.triangles} with the canopy, ${wall.triangles} ground only`);

    // Leave the app as it was built, then the screens.
    await shoot(page, { look: 'photo', hiRes: true, distance: 1100 });
    expect((await handle()).stats).not.toBeNull();

    if (tier !== 'high') return;
    // ── The Data sets Terrain card says the drawing is not the data ──
    await page.evaluate(() => (window as unknown as { __firesim: { app: { openDatasets(id?: string): void } } }).__firesim.app.openDatasets('terrain'));
    const detail = page.getByTestId('dataset-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Cliff faces are drawn steeper than the data so they read as rock walls. Fire, wind and slope numbers use the data as received.');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('datasets-screen')).toHaveCount(0);

    // ── The statistics screen shows the terrain row ──
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-debug-stats').click();
    const screen = page.getByTestId('debug-stats');
    await expect(screen).toBeVisible({ timeout: 30_000 });
    const display = page.getByTestId('debug-group-display');
    if ((await display.getAttribute('aria-expanded')) !== 'true') await display.click();
    const row = page.getByTestId('debug-group-display-body').locator('[data-row=cliffs]');
    await expect(row).toContainText('of the 10 m cells moved');
    await expect(row).toContainText('sharpening');
    await expect(row).toContainText('rock mask');
    await expect(row).toContainText(`${mesh * mesh} vertices, ${2 * (mesh - 1) * (mesh - 1)} triangles`);
    await expect(row).toContainText('rock detail in the shader: high');
    expect(await row.innerText()).not.toMatch(/\b(undefined|NaN|Infinity|null)\b/);
  });
}
