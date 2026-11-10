/**
 * The 3-D curtain of the Air slice does not leak GPU objects (plan 8.6, 12). The curtain rebuilds its geometry and its colour texture when the
 * line or the size of the slice's lattice changes; this switches the section on and off, changes the line (four lengths, so the lattice size
 * changes), the preset and the chip, 60 times over, and checks that the renderer holds the same number of geometries and textures at the end
 * as after a warm-up. (The layers spec does the same for every other layer but leaves the section out.)
 *
 * It also leaves nothing queued in the GL. The page function ends with about 200 `renderNow` calls still to be drawn by the software GL, and until they are drawn the
 * browser cannot open another context: the next test in the same worker waited in `browser.newContext` until its 2 minutes were over ("Test timeout of 120000ms exceeded
 * while setting up context", the gate's full run at `air-tool.spec.ts:151`; the same in every one of 5 runs of that pattern, this test and then another in one worker with
 * another browser's software GL in the other, and in none of 6 pairs with one worker, idle or beside two busy loops). Measured while it waited: that browser's main
 * process used no CPU (a futex), its renderer none, its GPU process 2.2 cores; the first context opened after this test's context was closed took 261 s, twice.
 * `gl.finish()` does not wait for the queue (Chromium only flushes); a read of one pixel does, and took 273 s and 259 s here beside the other browser (and the context
 * then opened in 124 and 665 ms). So the test waits for its own frames.
 */
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 30_000 });

type View = {
  renderer?: {
    info: { memory: { geometries: number; textures: number } };
    getContext(): { RGBA: number; UNSIGNED_BYTE: number; readPixels(x: number, y: number, w: number, h: number, format: number, type: number, out: Uint8Array): void };
  };
  renderNow?: () => void;
  setLayers(l: Record<string, unknown>): void;
};
type Handle = { __firesim: { view: View; session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } } } } };

test('the curtain: switching the section, its line, its length and its chip keeps the GPU objects constant', async ({ page, browser }) => {
  test.setTimeout(900_000); // (it was 400 s: the read below alone took 273 s beside another browser, and the page is built first)
  await page.goto('/?debug=1');
  await acceptNotice(page);
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
  const r = await page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    if (!v.renderer || !v.renderNow) return null;
    const mem = (): { g: number; t: number } => ({ g: v.renderer!.info.memory.geometries, t: v.renderer!.info.memory.textures });
    const fields = ['speed', 'along', 'up', 'across'];
    const off = { enabled: false, azimuth: 0, centre: [0, 0] };
    const cycle = (i: number): void => {
      const len = [400, 1500, 3000, 5800][i % 4]!;
      const ang = (i * 37 * Math.PI) / 180;
      const a = [-Math.cos(ang) * len * 0.5, -Math.sin(ang) * len * 0.5];
      const b = [Math.cos(ang) * len * 0.5, Math.sin(ang) * len * 0.5];
      v.setLayers({ crossSection: { enabled: true, azimuth: 0, centre: [0, 0], a, b, preset: null, field: fields[i % 4] } });
      v.renderNow!();
      v.setLayers({ crossSection: { enabled: true, azimuth: (i * 20) % 360, centre: [0, 0], a: undefined, b: undefined, preset: i % 3 === 0 ? 'along' : null, field: fields[(i + 1) % 4] } });
      v.renderNow!();
      v.setLayers({ crossSection: off });
      v.renderNow!();
    };
    for (let i = 0; i < 8; i++) cycle(i);
    v.setLayers({ crossSection: off });
    v.renderNow!();
    const base = mem();
    for (let i = 0; i < 60; i++) cycle(i);
    v.setLayers({ crossSection: off });
    v.renderNow!();
    const end = mem();
    // The one call that makes the page wait for the GL to draw what it was given: a read of one pixel (`finish()` only flushes in Chromium). See the header.
    const gl = v.renderer.getContext();
    const t0 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return { base, end, drainMs: Math.round(performance.now() - t0) };
  });
  expect(r).not.toBeNull();
  expect(r!.end.t).toBe(r!.base.t);
  expect(r!.end.g).toBe(r!.base.g);

  // The state the next test needs, checked and not assumed: this browser opens a context at once (it did in 124 and 665 ms after the read above).
  const closeT0 = Date.now();
  await page.context().close();
  const closeMs = Date.now() - closeT0;
  const took: number[] = [];
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now();
    const probe = await browser.newContext();
    await probe.close();
    took.push(Date.now() - t0);
    if (took[took.length - 1]! < 3000) break;
  }
  console.log(`[curtain] the GL drew what was queued in ${r!.drainMs} ms; closing the context took ${closeMs} ms; opening a context took ${took.join(', ')} ms`);
});
