/**
 * The 3-D curtain of the Air slice does not leak GPU objects (plan 8.6, 12). The curtain rebuilds its geometry and its colour texture when the
 * line or the size of the slice's lattice changes; this switches the section on and off, changes the line (four lengths, so the lattice size
 * changes), the preset and the chip, 60 times over, and checks that the renderer holds the same number of geometries and textures at the end
 * as after a warm-up. (The layers spec does the same for every other layer but leaves the section out.)
 */
import { expect, test } from './fixtures';
import { acceptNotice } from './helpers';

test.use({ deviceScaleFactor: 1, actionTimeout: 30_000 });

type View = {
  renderer?: { info: { memory: { geometries: number; textures: number } } };
  renderNow?: () => void;
  setLayers(l: Record<string, unknown>): void;
};
type Handle = { __firesim: { view: View; session: { state: { get(): { snapshot: { atmosphere?: { kind?: string } } | null } } } } };

test('the curtain: switching the section, its line, its length and its chip keeps the GPU objects constant', async ({ page }) => {
  test.setTimeout(400_000);
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
    return { base, end: mem() };
  });
  expect(r).not.toBeNull();
  expect(r!.end.t).toBe(r!.base.t);
  expect(r!.end.g).toBe(r!.base.g);
});
