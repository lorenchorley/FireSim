/**
 * Behaviour and robustness (reviewer 2 of the screens phase), with the REAL engine unless a test says otherwise:
 *  - a whole 6 h scenario with every layer, heat map, tree style and screen switched mid-run (also at Max speed): nothing
 *    pauses the run, nothing pops up, three.js resources / DOM / listeners / heap stay flat across 200 random toggles, and
 *    drawing a frame does not get slower;
 *  - determinism: what a person does with the screen never changes the fire (arrival raster hash, burnt area, spot fires);
 *  - Setup: the data plan follows typed coordinates; a double tap on Build or Cancel does the other screen's job;
 *  - Android runtime (e2e/androidBridge.ts): hardware Back at every nesting level, no history left behind by quick
 *    open / close, settings and layer choices kept in native Preferences, background during a fast-forward, rotation;
 *  - building: cancelled builds leave nothing behind, services that answer 500 / refuse / rate-limit (429), a place with
 *    the network off, live places data (recorded NSW answers), a saved area that is damaged or deleted while in use;
 *  - storage: deleting asks first, and a refused delete is reported as refused.
 * Long on a loaded machine (the determinism and Max-speed tests run whole scenarios twice); every test sets its own timeout.
 * Needs the production build (`npx playwright test` builds and serves it).
 */
import { appendFileSync } from 'node:fs';
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { BLACKHEATH, fakeNswServer } from '../src/data/nswContextTesting';
import { emulateCapacitorAndroid } from './androidBridge';
import { acceptNotice, armPopupWatch, expectStillPlaying, openMenu, pickTool, popups, scenarioDuration, session, setSpeed, watchPopups } from './helpers';

// ───────────── plumbing ─────────────

/** Build the Katoomba demo offline with the "hot NW wind" preset (the same path the user takes). */
async function buildKatoomba(page: Page, query = ''): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
}

async function markFire(page: Page): Promise<void> {
  await pickTool(page, 'fire');
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect(page.getByTestId('fire-panel')).toHaveCount(0);
}

/** A small deterministic generator, so a failing toggle sequence can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Probe {
  heapMB: number;
  geometries: number;
  textures: number;
  programs: number;
  nodes: number;
  listeners: number;
  /** Median cost (ms) of drawing one frame, the GPU work included. */
  frameMs: number;
}

/** Collect garbage, then read what the page holds: JS heap, three.js resources, DOM nodes and listeners, the cost of a frame. */
async function probe(page: Page, cdp: CDPSession): Promise<Probe> {
  await cdp.send('HeapProfiler.collectGarbage');
  const counters = (await cdp.send('Memory.getDOMCounters')) as { nodes: number; jsEventListeners: number };
  const p = await page.evaluate(() => {
    const view = (window as unknown as { __firesim: { view: { renderNow(): void; renderer: { info: { memory: { geometries: number; textures: number }; programs?: unknown[] }; getContext(): WebGL2RenderingContext } } } }).__firesim.view;
    const gl = view.renderer.getContext();
    const times: number[] = [];
    for (let i = 0; i < 24; i++) {
      const t0 = performance.now();
      view.renderNow();
      gl.finish();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      heapMB: (mem?.usedJSHeapSize ?? 0) / 1048576,
      geometries: view.renderer.info.memory.geometries,
      textures: view.renderer.info.memory.textures,
      programs: view.renderer.info.programs?.length ?? 0,
      frameMs: times[Math.floor(times.length / 2)]!,
    };
  });
  return { ...p, nodes: counters.nodes, listeners: counters.jsEventListeners };
}

const layerState = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => (window as unknown as { __firesim: { view: { getLayers(): Record<string, unknown> } } }).__firesim.view.getLayers());

/** Click a control of the Layers panel as a finger would (the real handler runs; hit-testing is covered by the layout specs). */
const domClick = (page: Page, testId: string): Promise<boolean> =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return false;
    el.click();
    return true;
  }, testId);

/** Choose the i-th option of a segmented control / chip choice (radio inputs) of the Layers panel. */
const chooseOption = (page: Page, testId: string, index: number): Promise<boolean> =>
  page.evaluate(
    ([id, i]) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      const radios = root ? [...root.querySelectorAll<HTMLElement>('input[type=radio], [role=radio]')] : [];
      const el = radios[i as number];
      if (!el) return false;
      el.click();
      return true;
    },
    [testId, index] as const,
  );

/** Every control of the Layers panel a person can use to turn a layer or a heat map on or off. */
async function layerControls(page: Page): Promise<{ scene: string[]; heat: string[]; mapTypes: string[] }> {
  return page.evaluate(() => {
    const ids = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => e.getAttribute('data-testid')!).filter((t) => t && !/^layer-info/.test(t) && !/^layer-group/.test(t));
    return {
      scene: ids('[data-testid^="layer-"]').filter((t) => !/^layer-dataset/.test(t)),
      heat: ids('[data-testid^="overlay-"]').filter((t) => t !== 'overlay-opacity'),
      mapTypes: ids('[data-testid^="maptype-"]'),
    };
  });
}

// ───────────── layer toggling with the real engine ─────────────

test('real engine: a 6 h run with every layer, heat map, tree style and screen switched mid-run: never pauses, nothing pops up, nothing leaks, frames do not slow down', async ({ page, context }) => {
  test.setTimeout(900_000);
  const popupWatch = watchPopups(page);
  await popupWatch;
  await buildKatoomba(page);
  await armPopupWatch(page);
  const D = await scenarioDuration(page);
  expect(D).toBe(6 * 3600);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Memory.getDOMCounters');
  await markFire(page);
  await setSpeed(page, 120);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layers-panel')).toBeVisible();
  const controls = await layerControls(page);
  expect(controls.heat.length).toBeGreaterThanOrEqual(25); // 14 new + the older ones
  expect(controls.scene.length).toBeGreaterThanOrEqual(12);
  const initial = await layerState(page);

  const alive = async (what: string): Promise<void> => {
    const s = await expectStillPlaying(page, D);
    expect(s.error, `engine error after ${what}`).toBeNull();
  };

  // ── Cycle 1: every layer on, off; every heat map on, off; every tree style and code; sway; solo ──
  for (const id of controls.scene) {
    const before = await layerState(page);
    expect(await domClick(page, id), id).toBe(true);
    await alive(`toggling ${id}`);
    expect(JSON.stringify(await layerState(page)), `${id} changed the view's layers`).not.toBe(JSON.stringify(before));
    await domClick(page, id);
    await alive(`toggling ${id} back`);
  }
  for (const id of controls.heat) {
    const kind = id.replace('overlay-', '');
    await page.evaluate((k) => document.querySelector(`[data-testid="overlay-${k}"]`)?.closest('.lp-group-body')?.removeAttribute('hidden'), kind);
    expect(await domClick(page, id), id).toBe(true);
    // The wind-speed map needs the 3-D atmosphere: the engine's auto-tune may have chosen the fast tier on this machine, and
    // then the row says why it cannot be shown (it must not silently do nothing).
    const noAtmosphere = kind === 'windSpeed' && (await page.evaluate(() => ((window as unknown as { __firesim: { session: { state: { get(): { snapshot: { atmosphere: { nz: number } } | null } } } } }).__firesim.session.state.get().snapshot?.atmosphere?.nz ?? 0) === 0));
    if (noAtmosphere) {
      await page.waitForTimeout(300);
      expect((await layerState(page)).overlay).toBe('none');
      await expect(page.locator(`[data-layer="windSpeed"]`)).toContainText(/Needs the 3-D atmosphere/);
      continue;
    }
    await expect.poll(async () => (await layerState(page)).overlay, { message: `${id} shows its heat map` }).toBe(kind);
    await alive(`heat map ${kind}`);
    await page.waitForTimeout(120);
    await domClick(page, id);
    await expect.poll(async () => (await layerState(page)).overlay).toBe('none');
    await alive(`heat map ${kind} off`);
  }
  for (let i = 0; i < 3; i++) {
    await chooseOption(page, 'canopy-style', i);
    await alive(`tree style ${i}`);
  }
  await chooseOption(page, 'canopy-style', 2);
  for (let i = 0; i < 4; i++) {
    await chooseOption(page, 'canopy-code', i);
    await alive(`tree code ${i}`);
  }
  await chooseOption(page, 'canopy-style', 0);
  for (let i = 0; i < 2; i++) {
    await domClick(page, 'wind-sway');
    await domClick(page, 'solo-heat');
  }
  await alive('trees');

  // Restore the starting layers (the Reset button does it) and take the baseline.
  await page.getByTestId('layers-reset').click();
  await page.waitForTimeout(400);
  const afterReset = await layerState(page);
  expect(afterReset.overlay).toBe('none');
  expect({ ...afterReset, windSway: initial.windSway }).toEqual(initial);
  const base = await probe(page, cdp);

  // ── Random toggles, two rounds of 100, each ended by Reset ──
  const rand = rng(20261004);
  const sceneIds = controls.scene;
  const heatIds = controls.heat;
  const rounds: Probe[] = [];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 100; i++) {
      const r = rand();
      if (r < 0.34) await domClick(page, sceneIds[Math.floor(rand() * sceneIds.length)]!);
      else if (r < 0.72) {
        const id = heatIds[Math.floor(rand() * heatIds.length)]!;
        await domClick(page, id);
      } else if (r < 0.8) await chooseOption(page, 'canopy-style', Math.floor(rand() * 3));
      else if (r < 0.88) await chooseOption(page, 'canopy-code', Math.floor(rand() * 4));
      else if (r < 0.93) await domClick(page, 'wind-sway');
      else if (r < 0.97) await domClick(page, 'solo-heat');
      else await chooseOption(page, 'wind-layer', Math.floor(rand() * 3));
      if (i % 5 === 0) await page.waitForTimeout(60 + Math.floor(rand() * 200));
      if (i % 10 === 0) await alive(`random toggle ${round}.${i}`);
    }
    await alive(`round ${round}`);
    await page.getByTestId('layers-reset').click();
    await page.waitForTimeout(500);
    rounds.push(await probe(page, cdp));
  }
  console.log('PROBE base', JSON.stringify(base));
  console.log('PROBE round1', JSON.stringify(rounds[0]));
  console.log('PROBE round2', JSON.stringify(rounds[1]));

  // The run is still going, at the same speed, and nothing popped up.
  const s = await session(page);
  console.log('END', JSON.stringify(s));
  expect(s.error).toBeNull();
  if (s.viewTime < D - 5) expect(s.playing).toBe(true);
  expect(await popups(page)).toEqual([]);

  // Resources: the second round of 100 toggles must not add anything to the first (three.js resources, listeners, DOM).
  const [r1, r2] = rounds as [Probe, Probe];
  expect(r2.geometries, 'geometries').toBeLessThanOrEqual(r1.geometries);
  expect(r2.textures, 'textures').toBeLessThanOrEqual(r1.textures);
  expect(r2.programs, 'shader programs').toBeLessThanOrEqual(r1.programs);
  expect(r2.listeners, 'event listeners').toBeLessThanOrEqual(r1.listeners + 20);
  expect(r2.nodes, 'DOM nodes').toBeLessThanOrEqual(r1.nodes + 200);
  expect(r2.heapMB - r1.heapMB, 'JS heap grew by (MB)').toBeLessThan(12);
  // Against the very beginning: no unbounded growth either.
  expect(r2.geometries).toBeLessThanOrEqual(base.geometries + 40);
  expect(r2.textures).toBeLessThanOrEqual(base.textures + 40);
  // Frame cost: after 200 toggles the view draws as fast as before (generous margin: the machine is shared).
  expect(r2.frameMs).toBeLessThan(base.frameMs * 1.6 + 6);
});

// ───────────── every screen at Max speed, and during a fast-forward ─────────────

const MENU_SCREENS = [
  ['menu-datasets', 'datasets-screen'],
  ['menu-model', 'model-card'],
  ['menu-settings', 'settings'],
] as const;

test('real engine at Max speed: every screen opened and closed over and over (also while a fast-forward computes, and while the history replays): the run is never paused, nothing pops up, the console stays empty', async ({ page }) => {
  test.setTimeout(600_000);
  await watchPopups(page);
  await buildKatoomba(page);
  await armPopupWatch(page);
  const D = await scenarioDuration(page);
  await markFire(page);
  await setSpeed(page, Infinity);
  expect((await session(page)).speed).toBe(Infinity);

  // A fast-forward to the end of the 6 h scenario, with the screens opened and closed while the engine computes at full speed.
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-end').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('seek-cancel')).toBeVisible({ timeout: 5000 });
  let seekSeen = 0;
  for (let round = 0; round < 3; round++) {
    for (const [row, screen] of MENU_SCREENS) {
      if ((await session(page)).seekTarget === null) break;
      await page.getByTestId('menu').click();
      await page.getByTestId(row).click();
      await expect(page.getByTestId(screen)).toBeVisible();
      await page.waitForTimeout(200);
      const mid = await session(page);
      if (mid.seekTarget !== null) seekSeen++;
      expect(mid.error).toBeNull();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(screen)).toHaveCount(0);
    }
  }
  expect(seekSeen, 'a screen was open while the fast-forward was still computing').toBeGreaterThan(0);
  // The fast-forward lands exactly on the end of the scenario and the run is not left half-way.
  await expect.poll(async () => (await session(page)).seekTarget, { timeout: 120_000 }).toBeNull();
  const landed = await session(page);
  expect(landed.viewTime).toBe(D);
  expect(landed.error).toBeNull();

  // Back to the start, replay the computed history (Max would replay 6 h in two seconds: too short to visit anything, so 300 x)
  // and open / close the screens rapidly while it runs.
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-start').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page)).viewTime).toBeLessThan(120);
  await setSpeed(page, 300);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  let opened = 0;
  for (let i = 0; i < 6 && (await session(page)).viewTime < D - 60; i++) {
    for (const [row, screen] of MENU_SCREENS) {
      const s = await expectStillPlaying(page, D);
      if (s.viewTime >= D - 60) break;
      await page.getByTestId('menu').click();
      await page.getByTestId(row).click();
      await expect(page.getByTestId(screen)).toBeVisible();
      opened++;
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(screen)).toHaveCount(0);
    }
  }
  expect(opened).toBeGreaterThan(2);
  expect(await popups(page)).toEqual([]);
});

// ───────────── determinism: what a person does with the screen never changes the simulation ─────────────

/** FNV-1a over the bytes of every typed array and the JSON of the rest (the engine's snapshotHash, in the page). */
const HASH_SOURCE = `(() => {
  function fnv(h, bytes) { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }
  function hv(h, v, skip, path) {
    if (ArrayBuffer.isView(v)) return fnv(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (v === null || typeof v !== 'object') return fnv(h, new TextEncoder().encode(path + '=' + (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : JSON.stringify(v)) + ';'));
    if (Array.isArray(v)) { v.forEach((x, i) => (h = hv(h, x, skip, path + '[' + i + ']'))); return h; }
    for (const k of Object.keys(v).sort()) { const p = path ? path + '.' + k : k; if (skip.has(p)) continue; h = hv(h, v[k], skip, p); }
    return h;
  }
  return (s) => {
    // The ember landing raster decays lazily when it is read, so a different display step moves it by float rounding only.
    const skip = new Set(['stats.msPerSimMinute', 'engine', 'layers.landing']);
    return { all: hv(0x811c9dc5, s, skip, ''), arrival: hv(0x811c9dc5, s.fire.arrivalTime, new Set(), ''), burntHa: s.stats.burntAreaHa, spots: s.stats.spotFires, landing: Array.from(s.layers.landing) };
  };
})()`;

interface Fingerprint {
  tier: string;
  ignitions: string;
  at: Record<string, { all: number; arrival: number; burntHa: number; spots: number; landing: number[] }>;
}

async function fingerprint(page: Page): Promise<Fingerprint> {
  return page.evaluate((src) => {
    // eslint-disable-next-line no-eval
    const hash = (0, eval)(src) as (s: unknown) => { all: number; arrival: number; burntHa: number; spots: number; landing: number[] };
    const fs = (window as unknown as { __firesim: { session: { state: { get(): { ignitions: { points: number[][]; radius?: number; time: number }[]; snapshot: { engine: { tier: string } } | null } }; snapshots: { at(t: number): unknown } } } }).__firesim;
    const st = fs.session.state.get();
    const at: Fingerprint['at'] = {};
    for (const t of [1800, 3600, 7200, 10800]) at[String(t)] = hash(fs.session.snapshots.at(t));
    return { tier: st.snapshot?.engine.tier ?? '?', ignitions: JSON.stringify(st.ignitions.map((i) => ({ p: i.points, r: i.radius, t: i.time }))), at };
  }, HASH_SOURCE);
}

/** Build the Katoomba run on the FAST tier (the tier choice of "auto" depends on how fast this machine is; fast is the same everywhere). */
async function buildKatoombaFast(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.getByTestId('setup').waitFor();
  await page.waitForTimeout(1200);
  if (await page.getByTestId('notice').count()) await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('detail').getByRole('radio', { name: /Fast/ }).check({ force: true });
  await page.getByTestId('duration').getByRole('radio', { name: /^3/ }).check({ force: true }); // 3 h: the same fire as the 6 h run for its first 3 h, and half the time to wait for
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await page.waitForTimeout(2500); // the camera finishes its fly-in: the crosshair marks the same spot every time
  await markFire(page);
}

async function playToEnd(page: Page, D: number): Promise<void> {
  await expect.poll(async () => { const s = await session(page); return !s.playing && s.seekTarget === null && s.viewTime >= D - 1; }, { timeout: 240_000, intervals: [1000] }).toBe(true);
}

test('determinism: the same scenario and seed give the same fire (arrival raster, spot fires, every snapshot part) whatever was done with the screen in between', async ({ page }) => {
  test.setTimeout(900_000);

  const t0 = Date.now();
  const step = (what: string): void => {
    const line = `[determinism ${Math.round((Date.now() - t0) / 1000)} s] ${what}\n`;
    if (process.env.R2_PROGRESS) appendFileSync(process.env.R2_PROGRESS, line); // progress of a long run on a loaded machine
    else process.stdout.write(line);
  };
  // ── Run A: nothing touched: Play at Max to the end ──
  await buildKatoombaFast(page);
  step('A built');
  const D = await scenarioDuration(page);
  expect(D).toBe(3 * 3600);
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await playToEnd(page, D);
  step('A played to the end');
  const A = await fingerprint(page);
  step('A fingerprint');
  expect(A.tier).toBe('fast');
  expect(A.at['10800']!.burntHa).toBeGreaterThan(20);

  // ── Run B: the same build, with a session of fiddling: speeds, pauses, layers and heat maps, screens, the picture interval, timeline jumps, a cancelled fast-forward ──
  await buildKatoombaFast(page);
  step('B built');
  const popupWatch = armPopupWatch(page);
  await popupWatch;
  await setSpeed(page, 600);
  await page.getByTestId('play').click();
  await page.waitForTimeout(1500);
  await pickTool(page, 'layers');
  const controls = await layerControls(page);
  const rand = rng(7);
  for (let i = 0; i < 30; i++) {
    const pool = i % 2 ? controls.heat : controls.scene;
    await domClick(page, pool[Math.floor(rand() * pool.length)]!);
    if (i % 4 === 1) {
      await page.getByTestId('play').click(); // pause ...
      await page.waitForTimeout(150 + Math.floor(rand() * 300));
      await page.getByTestId('play').click(); // ... and resume
    }
    if (i === 8) {
      await page.keyboard.press('Escape');
      await setSpeed(page, 60);
      await pickTool(page, 'layers');
    }
    if (i === 12) {
      await page.keyboard.press('Escape');
      await page.getByTestId('time-btn').click();
      await page.getByTestId('step-30').click(); // a finer picture interval from now on
      await page.keyboard.press('Escape');
      await setSpeed(page, 3600);
      await pickTool(page, 'layers');
    }
    if (i === 20) {
      await page.keyboard.press('Escape');
      for (const [row, screen] of MENU_SCREENS) {
        await page.getByTestId('menu').click();
        await page.getByTestId(row).click();
        await expect(page.getByTestId(screen)).toBeVisible();
        await page.keyboard.press('Escape');
      }
      await page.getByTestId('time-btn').click(); // back to the start: the run replays computed history
      await page.getByTestId('time-start').click();
      await page.keyboard.press('Escape');
      await pickTool(page, 'layers');
    }
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('time-btn').click(); // a fast-forward to the end, cancelled half-way
  await page.getByTestId('time-end').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  if ((await session(page)).seekTarget !== null) await page.getByTestId('seek-cancel').click();
  await setSpeed(page, Infinity);
  const s = await session(page);
  if (s.viewTime < D - 1 && !s.playing) await page.getByTestId('play').click();
  step('B fiddling done');
  await playToEnd(page, D);
  step('B played to the end');
  const B = await fingerprint(page);
  step('B fingerprint');

  // Same fire marked (the crosshair), same tier; then the same fire results.
  expect(B.ignitions.replace(/"id":"[^"]*",?/g, '')).toBe(A.ignitions.replace(/"id":"[^"]*",?/g, ''));
  expect(B.tier).toBe(A.tier);
  for (const t of Object.keys(A.at)) {
    const a = A.at[t]!;
    const b = B.at[t]!;
    expect(b.arrival, `arrival raster at ${t} s`).toBe(a.arrival);
    expect(b.burntHa, `burnt area at ${t} s`).toBe(a.burntHa);
    expect(b.spots, `spot fires at ${t} s`).toBe(a.spots);
    expect(b.all, `every other part of the snapshot at ${t} s`).toBe(a.all);
    // The ember landing raster decays lazily when it is read: another picture interval moves it by float rounding only.
    let worst = 0;
    for (let k = 0; k < a.landing.length; k++) worst = Math.max(worst, Math.abs(a.landing[k]! - b.landing[k]!) / (1e-4 * Math.max(1e-6, Math.abs(a.landing[k]!)) + 1e-9));
    expect(worst, `ember landing raster at ${t} s (1 = the allowed rounding difference)`).toBeLessThanOrEqual(1);
  }
  expect(await popups(page)).toEqual([]);
});

// ───────────── Setup: the data plan follows the typed place ─────────────

test('Setup: typing coordinates re-plans the data: a place away from the demo sites needs a download and does not work offline', async ({ page }) => {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  const plan = page.getByTestId('plan-total');
  await page.getByTestId('site-katoomba').click();
  await expect(plan).toContainText('Works offline: yes'); // the bundled demo site needs nothing
  await page.waitForTimeout(800); // the plan has settled: nothing else is about to re-plan it
  await page.getByTestId('manual-coords').fill('-33.70, 149.86');
  await expect(plan).toContainText(/≈ [\d.]+ (KB|MB|GB) to download/); // not "Nothing to download"
  await expect(plan).toContainText('Works offline: no');
  await expect(page.getByTestId('plan-terrain')).toContainText(/Live/);
  // And back: another demo site is bundled again.
  await page.getByTestId('site-katoomba').click();
  await expect(plan).toContainText('Works offline: yes');
});

// ───────────── Android: hardware Back ─────────────

/** The Android shell's hardware Back (MainActivity): WebView.goBack() while the page has an entry to go back to, else the app is left. True = the app was left. */
async function hardwareBack(page: Page, appUrl: string): Promise<boolean> {
  await page.goBack({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(80);
  return page.url() !== appUrl;
}

const openThings = (page: Page): Promise<{ overlays: string[]; dialogs: number; menus: string[]; panel: boolean; dock: string }> =>
  page.evaluate(() => {
    const vis = (e: Element | null): boolean => !!e && !(e as HTMLElement).hidden && e.getClientRects().length > 0;
    const q = (s: string): Element | null => document.querySelector(s);
    return {
      overlays: [...document.querySelectorAll('.app-overlay')].map((e) => (e as HTMLElement).dataset.overlay ?? ''),
      dialogs: [...document.querySelectorAll('.modal-scrim')].filter((e) => !e.classList.contains('closing')).length,
      menus: ['tools-menu', 'view-menu', 'menu', 'speed', 'time-btn'].filter((id) => q(`[data-testid=${id}]`)?.getAttribute('aria-expanded') === 'true'),
      panel: vis(q('.tool-panel')),
      dock: q('[data-testid=dock]')?.getAttribute('data-detent') ?? '?',
    };
  });

test('Android: hardware Back closes one thing at a time at every nesting level, never pauses the run, and leaves the app only from Setup with nothing open', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await emulateCapacitorAndroid(page);
  await page.goto('/?mock=1&debug=1&theme=light');
  const app = page.url();
  await acceptNotice(page);

  // ── Setup: Settings → Data sets → one data set's page → Model card: Back unwinds them one by one ──
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings-datasets').click();
  await page.locator('[data-testid^=dataset-row-]').first().click();
  await expect(page.getByTestId('dataset-detail')).toBeVisible();
  expect(await hardwareBack(page, app)).toBe(false);
  await expect(page.getByTestId('dataset-detail')).toBeHidden();
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
  expect(await hardwareBack(page, app)).toBe(false);
  await expect(page.getByTestId('datasets-screen')).toHaveCount(0);
  await expect(page.getByTestId('settings')).toBeVisible();
  expect(await hardwareBack(page, app)).toBe(false);
  await expect(page.getByTestId('settings')).toHaveCount(0);
  await expect(page.getByTestId('setup')).toBeVisible();

  // ── Build: Back cancels the build and shows Setup; the next Back leaves the app (nothing left to close) ──
  await page.getByTestId('build').click();
  await expect(page.getByTestId('building').or(page.getByTestId('sim'))).toBeVisible();
  if (await page.getByTestId('building').count()) {
    expect(await hardwareBack(page, app)).toBe(false);
    await expect(page.getByTestId('setup')).toBeVisible();
    await page.getByTestId('build').click();
  }
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await markFire(page);
  await setSpeed(page, 60);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);

  // ── The run, nested as deep as it goes: the dock, a tool panel, a menu, then Settings and Data sets on top of all of it ──
  await page.getByTestId('tab-stats').click();
  await pickTool(page, 'layers');
  await openMenu(page, 'view');
  expect(await openThings(page)).toMatchObject({ menus: ['view-menu'], panel: true });
  const dockWas = (await openThings(page)).dock;
  expect(dockWas).not.toBe('closed');
  await page.getByTestId('menu').click(); // the main menu replaces the View menu
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('settings-datasets').click();
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
  const order: [string, () => Promise<void>][] = [
    ['Data sets closes', async () => void (await expect(page.getByTestId('datasets-screen')).toHaveCount(0), await expect(page.getByTestId('settings')).toBeVisible())],
    ['Settings closes', async () => void (await expect(page.getByTestId('settings')).toHaveCount(0), await expect(page.getByTestId('layers-panel')).toBeVisible())],
    ['the Layers panel closes (the dock is still open)', async () => void (await expect(page.getByTestId('layers-panel')).toHaveCount(0), expect((await openThings(page)).dock).not.toBe('closed'))],
    ['the dock closes', async () => void expect((await openThings(page)).dock).toBe('closed')],
  ];
  for (const [what, check] of order) {
    expect(await hardwareBack(page, app), what).toBe(false);
    await check();
    expect((await session(page)).playing, `the run is still playing after: ${what}`).toBe(true);
  }
  // Nothing left: Back asks; Back answers "stay" (and asks again next time); Leave goes to Setup; then Back leaves the app.
  expect(await hardwareBack(page, app)).toBe(false);
  await expect(page.getByTestId('confirm-leave')).toBeVisible();
  expect(await hardwareBack(page, app)).toBe(false);
  await expect(page.getByTestId('confirm-leave')).toHaveCount(0);
  expect((await session(page)).playing).toBe(true);
  expect(await hardwareBack(page, app)).toBe(false);
  await expect(page.getByTestId('confirm-leave')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  expect(errors).toEqual([]);
  expect(await hardwareBack(page, app), 'Back from Setup with nothing open leaves the app').toBe(true);
});

test('Android: 60 quick open / close cycles of every screen, one tap after the other, leave no history behind (the next Back from Setup leaves the app at once)', async ({ page }) => {
  test.setTimeout(240_000);
  await emulateCapacitorAndroid(page);
  await page.goto('/?mock=1&debug=1&theme=light');
  const app = page.url();
  await acceptNotice(page);
  await page.waitForTimeout(1000);
  const len0 = await page.evaluate(() => history.length);
  const tap = (id: string): Promise<void> => page.getByTestId(id).click({ noWaitAfter: true });
  // Settings, Data sets and the model card from Setup and from Settings; closed by their own button and by Escape: each tap follows the last at once.
  for (let i = 0; i < 15; i++) {
    await tap('open-settings');
    await tap('settings-datasets');
    await tap('datasets-close');
    await tap('settings-model-card');
    await tap('model-card-close');
    await tap('close-settings');
    await tap('open-datasets');
    await page.keyboard.press('Escape');
    await tap('setup-model-card');
    await tap('model-card-close');
  }
  await page.waitForTimeout(600);
  expect((await openThings(page)).overlays).toEqual([]);
  expect(await page.evaluate(() => history.length), 'entries left on the history').toBeLessThanOrEqual(len0 + 2);
  expect(await hardwareBack(page, app), 'one Back leaves the app: no stale guard entries').toBe(true);
});

// ───────────── Android: native Preferences ─────────────

test('Android: settings, the accepted notice, the Setup form and the layer choices come back from native Preferences even when the page storage is wiped', async ({ page }) => {
  test.setTimeout(240_000);
  await emulateCapacitorAndroid(page, { persistPreferences: true });
  await page.goto('/?mock=1&debug=1');
  await acceptNotice(page);
  await page.getByTestId('manual-coords').fill('-33.70, 149.86');
  await page.getByTestId('duration').getByRole('radio', { name: /^9/ }).check({ force: true });
  await page.getByTestId('open-settings').click();
  await page.getByTestId('theme').getByRole('radio', { name: /Night/ }).check({ force: true });
  await page.getByTestId('high-contrast').click();
  await page.getByTestId('handedness').getByRole('radio', { name: /Left/ }).check({ force: true });
  await page.getByTestId('time-step').getByRole('radio', { name: /30/ }).check({ force: true });
  await page.getByTestId('close-settings').click();
  await page.waitForTimeout(400);
  const native = await page.evaluate(() => ((window as unknown as { __nativeCalls: { plugin: string; method: string }[] }).__nativeCalls ?? []).filter((c) => c.plugin === 'Preferences' && c.method === 'set').length);
  expect(native, 'the choices were written to native Preferences').toBeGreaterThan(3);

  // Layer choices of a run: a use of the Layers panel is remembered too.
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await pickTool(page, 'layers');
  await page.getByTestId('layer-roads').click();
  await expect(page.getByTestId('layer-roads')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(400);

  // The page's own storage is wiped (a WebView that evicted it): only native Preferences can bring the choices back.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.removeItem('firesim.nothing');
  });
  await page.reload();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0); // still accepted
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('manual-coords')).toHaveValue('-33.70, 149.86');
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('theme').getByRole('radio', { name: /Night/ })).toBeChecked();
  await expect(page.getByTestId('handedness').getByRole('radio', { name: /Left/ })).toBeChecked();
  await expect(page.getByTestId('time-step').getByRole('radio', { name: /30/ })).toBeChecked();
  await page.getByTestId('close-settings').click();
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await pickTool(page, 'layers');
  await expect(page.getByTestId('layer-roads')).toHaveAttribute('aria-pressed', 'false'); // the roads were switched off last time
});

// ───────────── Android: background and rotation with the real engine ─────────────

const hideApp = (page: Page, state: 'hidden' | 'visible'): Promise<void> =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test('Android: the app going to the background in the middle of a fast-forward really stops the engine; back in the foreground the run stays paused, and Play carries on to the end', async ({ page }) => {
  test.setTimeout(420_000);
  await emulateCapacitorAndroid(page);
  await buildKatoomba(page);
  await markFire(page);
  const D = await scenarioDuration(page);
  await setSpeed(page, Infinity);
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-end').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('seek-cancel')).toBeVisible({ timeout: 5000 });
  await expect.poll(async () => (await session(page)).headTime, { timeout: 60_000 }).toBeGreaterThan(300);
  await hideApp(page, 'hidden');
  await expect.poll(async () => (await session(page)).seekTarget).toBeNull();
  const paused = await session(page);
  expect(paused.playing).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __firesim: { session: { state: { get(): { computing: boolean } } } } }).__firesim.session.state.get().computing), { timeout: 10_000, message: 'the worker stopped computing' }).toBe(false);
  const head = (await session(page)).headTime;
  await page.waitForTimeout(1500);
  expect((await session(page)).headTime, 'nothing is computed in the background').toBe(head);
  expect(head).toBeLessThan(D - 1); // it really stopped half-way
  await hideApp(page, 'visible');
  await page.waitForTimeout(500);
  expect((await session(page)).playing).toBe(false); // stays paused until Play
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 240_000 }).toBeGreaterThanOrEqual(D - 1);
  expect((await session(page)).error).toBeNull();
});

test('Android: rotating the phone in the middle of a run (dock and Layers panel open) keeps the run playing and the 3-D view filling its place', async ({ page }) => {
  test.setTimeout(420_000);
  await emulateCapacitorAndroid(page);
  await buildKatoomba(page);
  await markFire(page);
  await setSpeed(page, 120);
  await page.getByTestId('play').click();
  await page.getByTestId('tab-stats').click();
  await pickTool(page, 'layers');
  const fits = async (what: string): Promise<void> => {
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const scene = document.querySelector('[data-testid=scene]') as HTMLElement;
      const canvas = scene.querySelector('canvas') as HTMLCanvasElement;
      const r = scene.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      return { scene: [Math.round(r.width), Math.round(r.height)], canvas: [Math.round(c.width), Math.round(c.height)], vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth };
    });
    expect(Math.abs(m.canvas[0]! - m.scene[0]!), `${what}: canvas width vs scene ${JSON.stringify(m)}`).toBeLessThanOrEqual(2);
    expect(Math.abs(m.canvas[1]! - m.scene[1]!), `${what}: canvas height vs scene ${JSON.stringify(m)}`).toBeLessThanOrEqual(2);
    expect(m.scrollW, `${what}: the page scrolls sideways`).toBeLessThanOrEqual(m.vw + 1);
    expect((await session(page)).playing, `${what}: still playing`).toBe(true);
  };
  await fits('portrait');
  for (const [w, h] of [[915, 412], [412, 915], [844, 390], [360, 640]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await fits(`${w}x${h}`);
    await expect(page.getByTestId('layers-panel')).toBeVisible();
  }
  // A screen open while it rotates.
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
  await page.setViewportSize({ width: 915, height: 412 });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('datasets-screen')).toHaveCount(0);
  await fits('after closing the screen');
});

// ───────────── building: cancelled builds, double taps, failing services, places away from the demo sites ─────────────

/** Count the workers the page starts and ends (a cancelled or replaced build must not leave one running). */
async function trackWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const all: { ended: boolean }[] = [];
    (window as unknown as { __workers: typeof all }).__workers = all;
    const Original = window.Worker;
    window.Worker = class extends Original {
      private readonly rec = { ended: false };
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        all.push(this.rec);
      }
      override terminate(): void {
        this.rec.ended = true;
        super.terminate();
      }
    } as typeof Worker;
  });
}
const liveWorkers = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __workers: { ended: boolean }[] }).__workers.filter((w) => !w.ended).length);
const sceneCanvases = (page: Page): Promise<number> => page.locator('[data-testid=scene] canvas').count();

/** Setup form for the real builder: the Katoomba demo, preset weather, offline (the build then takes seconds). */
async function setupKatoombaOffline(page: Page, query = ''): Promise<void> {
  await page.goto(`/?debug=1${query}`);
  await page.getByTestId('setup').waitFor();
  await page.waitForTimeout(1200);
  if (await page.getByTestId('notice').count()) await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
}

test('a build cancelled at any moment (Cancel, Back, "New scenario") leaves no model, no worker and no 3-D view behind; the next build works', async ({ page }) => {
  test.setTimeout(300_000);
  await trackWorkers(page);
  await setupKatoombaOffline(page);
  expect(await sceneCanvases(page)).toBe(0);
  for (const delay of [700, 1000, 1800, 2600, 3400]) { // (a Cancel in the first 600 ms is ignored on purpose: see the double-tap test)
    await page.getByTestId('build').click();
    await page.waitForTimeout(delay);
    const cancel = page.getByTestId('cancel-build');
    if (await cancel.count()) await cancel.click();
    else if (await page.getByTestId('sim').count()) {
      // The build finished first: leaving the simulation is the same wish.
      await page.getByTestId('menu').click();
      await page.getByTestId('menu-new').click();
    }
    await expect(page.getByTestId('setup')).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => liveWorkers(page), { timeout: 15_000, message: `a worker is still running after cancelling at ${delay} ms` }).toBe(0);
    await page.waitForTimeout(400); // a late result of the cancelled build must not bring the simulation back
    await expect(page.getByTestId('sim')).toHaveCount(0);
    expect(await sceneCanvases(page), `a 3-D view is left behind after cancelling at ${delay} ms`).toBe(0);
  }
  // Back during the build cancels it too.
  await page.getByTestId('build').click();
  await page.waitForTimeout(300);
  if (await page.getByTestId('building').count()) {
    await page.goBack();
    await expect(page.getByTestId('setup')).toBeVisible();
  }
  await expect.poll(() => liveWorkers(page), { timeout: 15_000 }).toBe(0);
  // And a build after all that works: one simulation, one worker, one 3-D view.
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  expect(await liveWorkers(page)).toBe(1);
  expect(await sceneCanvases(page)).toBe(1);
  expect((await session(page)).error).toBeNull();
});

test('double taps on Build and on Cancel: a double tap on Build does not cancel its own build; a double tap on Cancel cancels and does not start another one', async ({ page }) => {
  test.setTimeout(300_000);
  await trackWorkers(page);
  await setupKatoombaOffline(page);
  // Build: the second tap lands where Cancel appears: it must not cancel.
  await page.getByTestId('build').dblclick();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => liveWorkers(page), { timeout: 15_000 }).toBe(1);
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-new').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  // Cancel: the second tap lands where Build is: it must not start a build again.
  await page.getByTestId('build').click();
  await page.waitForTimeout(900);
  const tapped = await page.evaluate(() => {
    // A double tap in one task: the second tap lands wherever the first one left the screen.
    const b = document.querySelector('[data-testid=cancel-build]') as HTMLElement | null;
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    b.click();
    (document.elementFromPoint(x, y) as HTMLElement | null)?.click();
    return true;
  });
  if (tapped) {
    await expect(page.getByTestId('setup')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('building')).toHaveCount(0);
    await expect(page.getByTestId('sim')).toHaveCount(0);
    await expect.poll(() => liveWorkers(page), { timeout: 15_000 }).toBe(0);
  }
  // And Build still works a moment later.
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
});

test('double taps: Build twice makes one simulation; Play twice plays then pauses; Settings opened twice is one screen', async ({ page }) => {
  test.setTimeout(300_000);
  await trackWorkers(page);
  await setupKatoombaOffline(page);
  await page.getByTestId('build').dblclick();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('sim')).toHaveCount(1);
  await expect(page.getByTestId('setup')).toHaveCount(0);
  await expect(page.getByTestId('building')).toHaveCount(0);
  await expect.poll(() => liveWorkers(page), { timeout: 15_000 }).toBe(1);
  expect(await sceneCanvases(page)).toBe(1);
  // Play, double tap: on then off (two clean toggles), never a half state.
  await markFire(page);
  await setSpeed(page, 600);
  await page.getByTestId('play').dblclick();
  await page.waitForTimeout(300);
  expect((await session(page)).playing).toBe(false);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(true);
  // The main menu and a screen: two quick taps on the same row open one screen.
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-settings').dblclick();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('settings')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('settings')).toHaveCount(0);
  expect((await session(page)).playing).toBe(true);
});

/** Hosts of the data services (all of them are called straight from the browser: CORS-enabled). */
const SERVICE_PATTERNS = [
  'https://api.open-meteo.com/**',
  'https://archive-api.open-meteo.com/**',
  'https://s3.amazonaws.com/**',
  'https://mapprod3.environment.nsw.gov.au/**',
  'https://portal.spatial.nsw.gov.au/**',
  'https://www.rfs.nsw.gov.au/**',
  'https://dataforgood-fb-data.s3.amazonaws.com/**',
  '**/proxy/**',
];

/** Type a place away from the demo sites and take the live weather source (so that every service is asked). */
async function setupAwayLive(page: Page, coords = '-33.70, 149.86', online = true): Promise<void> {
  await page.goto('/?debug=1');
  await page.getByTestId('setup').waitFor();
  await page.waitForTimeout(1200);
  if (await page.getByTestId('notice').count()) await acceptNotice(page);
  await page.getByTestId('manual-coords').fill(coords);
  await page.getByTestId('weather-source').getByRole('radio', { name: online ? 'Now' : 'Preset' }).check();
  const sw = page.getByTestId('online').getByRole('switch');
  if ((await sw.isChecked()) !== online) await page.getByTestId('online').click();
}

const scenarioFacts = (page: Page): Promise<{ ds: Record<string, string>; roads: number; homes: number }> =>
  page.evaluate(() => {
    const sc = (window as unknown as { __firesim: { scenario: { datasets?: { id: string; status: string }[]; context?: { roads: unknown[]; fireTrails: unknown[]; homes: unknown[] } | null } } }).__firesim.scenario;
    return {
      ds: Object.fromEntries((sc.datasets ?? []).map((d) => [d.id, d.status])),
      roads: (sc.context?.roads.length ?? 0) + (sc.context?.fireTrails.length ?? 0),
      homes: sc.context?.homes.length ?? 0,
    };
  });

for (const mode of ['500', 'refused'] as const) {
  test(`a place away from the demo sites while every data service fails (${mode === '500' ? 'HTTP 500' : 'connection refused'}): the build still completes, with warnings, and the screens say what was not real data`, async ({ page }) => {
    test.setTimeout(300_000);
  test.info().annotations.push({ type: 'network-failures' });
    for (const pattern of SERVICE_PATTERNS) {
      await page.route(pattern, (route) => (mode === '500' ? route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'Internal error' }) : route.abort('connectionrefused')));
    }
    await setupAwayLive(page);
    await page.getByTestId('build').click();
    await expect(page.getByTestId('sim')).toBeVisible({ timeout: 200_000 });
    const f = await scenarioFacts(page);
    // The warnings of the build wait in the Stats tab (nothing pops up).
    await page.getByTestId('tab-stats').click();
    await expect(page.getByTestId('dock').locator('.callout-warn').first()).toBeVisible();
    expect(await page.getByTestId('dock').locator('.callout-warn').allInnerTexts()).toEqual(expect.arrayContaining([expect.stringMatching(/SYNTHETIC TERRAIN/i)]));
    await page.getByTestId('tab-stats').click();
    // Nothing the failing services should have provided is claimed as real.
    for (const id of ['terrain', 'weather', 'roads', 'fire-trails', 'homes', 'zones', 'place-names', 'vegetation-svtm', 'fire-history']) expect(['used', 'partial'], `${id} claimed as real data`).not.toContain(f.ds[id]);
    // The Data sets screen lists what was not real, and the Layers panel explains why a layer cannot be shown.
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-datasets').click();
    const screen = page.getByTestId('datasets-screen');
    await expect(screen).toBeVisible();
    await expect(screen.getByTestId('datasets-fallbacks')).toContainText(/Ground height|terrain|synthetic/i);
    await expect(screen.getByTestId('datasets-fallbacks')).toContainText(/Roads and tracks/);
    expect(await screen.innerText()).not.toMatch(/\b(undefined|NaN|Infinity|\[object)\b/);
    await page.keyboard.press('Escape');
    await pickTool(page, 'layers');
    await expect(page.getByTestId('layer-homes')).toBeVisible();
    expect((await session(page)).error).toBeNull();
  });
}

test('a rate-limited weather service (HTTP 429): the build says it is waiting, and Cancel stops it at once (no request after Cancel)', async ({ page }) => {
  test.setTimeout(180_000);
  test.info().annotations.push({ type: 'network-failures' });
  let weatherCalls = 0;
  for (const pattern of SERVICE_PATTERNS) {
    await page.route(pattern, (route) => {
      if (route.request().url().includes('open-meteo')) weatherCalls++;
      return route.fulfill({ status: 429, headers: { 'access-control-allow-origin': '*', 'retry-after': '1' }, body: 'Too many requests' });
    });
  }
  await setupAwayLive(page);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('building')).toContainText(/rate limit|busy/i, { timeout: 60_000 });
  const before = weatherCalls;
  await page.getByTestId('cancel-build').click();
  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(3000);
  expect(weatherCalls, 'weather requests after Cancel').toBe(before);
  await expect(page.getByTestId('building')).toHaveCount(0);
});

test('a place away from the demo sites with the network off: synthetic terrain, layers that are not available say why, and the Data sets screen says what was not real', async ({ page }) => {
  test.setTimeout(240_000);
  test.info().annotations.push({ type: 'network-failures' });
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort('internetdisconnected'));
  await setupAwayLive(page, '-33.70, 149.86', false);
  await expect(page.getByTestId('plan-total')).toContainText(/Offline/);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  const f = await scenarioFacts(page);
  await page.getByTestId('tab-stats').click();
  expect(await page.getByTestId('dock').locator('.callout-warn').allInnerTexts()).toEqual(expect.arrayContaining([expect.stringMatching(/SYNTHETIC TERRAIN/i)]));
  await page.getByTestId('tab-stats').click();
  expect(f.ds['terrain']).not.toBe('used');
  expect(f.roads + f.homes).toBe(0);
  await pickTool(page, 'layers');
  const panel = page.getByTestId('layers-panel');
  for (const id of ['roads', 'fireTrails', 'homes', 'zones']) {
    const tile = panel.getByTestId(`layer-${id}`);
    await expect(tile, `${id} says why it cannot be shown`).toContainText(/No .* data for this place/i);
    await expect(tile).toHaveAttribute('aria-pressed', 'false'); // never shown as on without data
  }
  await expect(panel.getByTestId('layer-roads-show')).toBeDisabled();
  await expect(panel.getByTestId('layer-homes-show')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId('datasets-fallbacks')).toContainText(/Ground height|terrain/i);
  await expect(screen.getByTestId('datasets-fallbacks')).toContainText(/Roads and tracks/);
  await expect(screen.getByTestId('origin-mix')).toBeVisible();
  expect(await screen.innerText()).not.toMatch(/\b(undefined|NaN|Infinity|\[object)\b/);
});

// ───────────── storage: saved areas ─────────────

const PACK_ID = 'e2e-area';

/** A saved area as the app stores one (IndexedDB 'firesim' / 'kv': 'pack/meta/<id>' and 'pack/item/<id>/<name>'); the items are damaged on purpose when `damaged`. */
async function seedPack(page: Page, centre: { lat: number; lon: number }, damaged: boolean): Promise<void> {
  await page.evaluate(
    ([id, c, bad]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('firesim', 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const names = ['dem10', 'canopy', 'vegetation', 'fireHistory', 'context', 'weather', 'daily'];
          const itemBytes = Object.fromEntries(names.map((n) => [n, 100_000]));
          const tx = open.result.transaction('kv', 'readwrite');
          const store = tx.objectStore('kv');
          store.put({ id, name: 'E2E test area', centre: c, extent: 12_000, createdAt: Date.now(), itemNames: names, bytes: 700_000, itemBytes }, `pack/meta/${id}`);
          const junk: Record<string, unknown> = {
            dem10: 'not a DEM',
            canopy: { grid: 7, height: 'x' },
            vegetation: 12345,
            fireHistory: { type: 'FeatureCollection', features: 'nope' },
            context: { version: 1, roads: 'broken' },
            weather: { hourly: null },
            daily: [],
          };
          for (const n of names) store.put(bad ? junk[n] : { ok: true }, `pack/item/${id}/${n}`);
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
    [PACK_ID, centre, damaged] as const,
  );
}

const packStored = (page: Page): Promise<{ meta: boolean; items: number }> =>
  page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('firesim', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('kv')) return resolve({ meta: false, items: 0 });
          const store = db.transaction('kv').objectStore('kv');
          const keys = store.getAllKeys();
          keys.onsuccess = () => {
            const all = (keys.result as string[]).map(String);
            db.close();
            resolve({ meta: all.includes(`pack/meta/${id}`), items: all.filter((k) => k.startsWith(`pack/item/${id}/`)).length });
          };
          keys.onerror = () => reject(keys.error);
        };
      }),
    PACK_ID,
  );

test('storage: deleting a saved area asks first (Cancel, Escape and Back keep it); Delete removes that area and its items and nothing else, in Setup and in the Data sets screen', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await seedPack(page, { lat: -33.7, lon: 149.86 }, false);
  expect(await packStored(page)).toEqual({ meta: true, items: 7 });
  await page.reload();
  await expect(page.getByTestId('setup')).toBeVisible();
  const del = page.getByTestId(`delete-pack-${PACK_ID}`);
  await del.scrollIntoViewIfNeeded();
  await expect(del).toBeVisible({ timeout: 15_000 });

  // Setup: Cancel, Escape and Back each keep it.
  await del.click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('E2E test area');
  await expect(page.getByTestId('confirm-cancel')).toBeFocused();
  await page.getByTestId('confirm-cancel').click();
  await expect(dialog).toHaveCount(0);
  await del.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await del.click();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('setup')).toBeVisible();
  expect(await packStored(page)).toEqual({ meta: true, items: 7 });

  // Data sets screen (outside a run): the same; Cancel keeps, Delete removes this area only.
  await page.getByTestId('open-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  const dsDel = screen.getByTestId(`delete-pack-${PACK_ID}`);
  await expect(dsDel).toBeVisible({ timeout: 15_000 });
  await dsDel.scrollIntoViewIfNeeded();
  await dsDel.click();
  await expect(page.getByTestId('confirm-delete-pack')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  expect(await packStored(page)).toEqual({ meta: true, items: 7 });
  await dsDel.click();
  await page.getByTestId('confirm-ok').click();
  await expect(screen.getByTestId('storage-result')).toContainText(/Deleted/, { timeout: 15_000 });
  expect(await packStored(page)).toEqual({ meta: false, items: 0 });
  await expect(screen.getByTestId(`delete-pack-${PACK_ID}`)).toHaveCount(0);
});

test('storage: a damaged saved area that covers the place does not break the build, and deleting it while its model runs is harmless', async ({ page }) => {
  test.setTimeout(240_000);
  test.info().annotations.push({ type: 'network-failures' });
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort('internetdisconnected'));
  await page.goto('/?debug=1');
  await page.getByTestId('setup').waitFor();
  await page.waitForTimeout(1200);
  if (await page.getByTestId('notice').count()) await acceptNotice(page);
  await seedPack(page, { lat: -33.7, lon: 149.86 }, true);
  await setupAwayLive(page, '-33.70, 149.86', false);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 150_000 });
  const f = await scenarioFacts(page);
  expect(f.ds['terrain']).not.toBe('used'); // the damaged DEM was not trusted
  await markFire(page);
  await setSpeed(page, 600);
  await page.getByTestId('play').click();
  // The area this model was built from is deleted from the Data sets screen while the run plays.
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  const dsDel = screen.getByTestId(`delete-pack-${PACK_ID}`);
  await dsDel.scrollIntoViewIfNeeded();
  await dsDel.click();
  await page.getByTestId('confirm-ok').click();
  await expect(screen.getByTestId('storage-result')).toContainText(/Deleted/, { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 60_000 }).toBeGreaterThan(600);
  expect((await session(page)).error).toBeNull();
  expect((await session(page)).playing).toBe(true);
});

// ───────────── Settings changed in the middle of a run ─────────────

test('real engine: Settings changed mid-run (performance mode, picture interval, solver step, theme, high contrast) never pause the run and leave no error', async ({ page }) => {
  test.setTimeout(420_000);
  await watchPopups(page);
  await buildKatoomba(page);
  await armPopupWatch(page);
  await markFire(page);
  const D = await scenarioDuration(page);
  await setSpeed(page, 300);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime).toBeGreaterThan(300);
  const choose = async (testId: string, name: RegExp): Promise<void> => {
    await page.getByTestId('menu').click();
    await page.getByTestId('menu-settings').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.getByTestId(testId).getByRole('radio', { name }).check({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings')).toHaveCount(0);
  };
  const steady = async (what: string): Promise<void> => {
    await page.waitForTimeout(700);
    const s = await expectStillPlaying(page, D);
    expect(s.error, `engine error after ${what}`).toBeNull();
  };
  await choose('performance', /Saver/);
  await steady('performance: Saver');
  await choose('performance', /Detail/);
  await steady('performance: Detail');
  await choose('performance', /Balanced/);
  await steady('performance: Balanced');
  await choose('time-step', /30/);
  await steady('picture interval 30 s');
  await choose('time-step', /1 min|60/);
  await steady('picture interval 1 min');
  await choose('solver-step', /5/);
  await steady('solver step 5 s');
  await choose('solver-step', /Automatic/);
  await steady('solver step automatic');
  await choose('theme', /Night/);
  await choose('theme', /Light/);
  await steady('theme');
  expect(await popups(page)).toEqual([]);
  // The run goes on to produce results after all of that.
  const before = (await session(page)).headTime;
  await expect.poll(async () => (await session(page)).headTime, { timeout: 90_000 }).toBeGreaterThan(before);
});

// ───────────── live places data (the recorded NSW Spatial Services answers), away from the demo sites ─────────────

test('a place away from the demo sites with live roads, trails, homes and zones: every places layer shows, the heat maps work, and the Data sets screen says where the data came from', async ({ page }) => {
  test.setTimeout(300_000);
  test.info().annotations.push({ type: 'network-failures' });
  const fake = fakeNswServer();
  const answer = async (route: import('@playwright/test').Route): Promise<void> => {
    const req = route.request();
    const url = req.url().split('?')[0]!;
    try {
      const res = await fake.fetch(url, { method: req.method(), headers: req.headers(), body: req.postData() ?? undefined });
      await route.fulfill({ status: res.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: await res.text() });
    } catch {
      await route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    }
  };
  await page.route('https://portal.spatial.nsw.gov.au/**', answer);
  await page.route('https://mapprod3.environment.nsw.gov.au/**', answer);
  for (const pattern of SERVICE_PATTERNS.filter((x) => !/portal\.spatial|mapprod3/.test(x))) await page.route(pattern, (route) => route.abort('internetdisconnected'));
  await setupAwayLive(page, `${BLACKHEATH.lat}, ${BLACKHEATH.lon}`, true);
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 200_000 });
  const f = await scenarioFacts(page);
  expect(f.roads, 'live roads and fire trails').toBeGreaterThan(5);
  expect(f.homes, 'live home addresses').toBeGreaterThan(5);
  for (const id of ['roads', 'fire-trails', 'homes']) expect(['used', 'partial'], `${id} should be live data`).toContain(f.ds[id]);

  await pickTool(page, 'layers');
  const panel = page.getByTestId('layers-panel');
  const state = (): Promise<Record<string, unknown>> => layerState(page);
  for (const [id, key] of [['roads', 'roads'], ['fireTrails', 'fireTrails'], ['homes', 'homes'], ['zones', 'zones'], ['placeNames', 'placeNames']] as const) {
    const tile = panel.getByTestId(`layer-${id}`);
    await expect(tile, `${id} is available`).toBeEnabled();
    const was = (await state())[key];
    await tile.click();
    await expect.poll(async () => (await state())[key]).toBe(!was);
    await tile.click();
    await expect.poll(async () => (await state())[key]).toBe(was);
  }
  for (const kind of ['roadAccess', 'homeDensity']) {
    await panel.getByTestId('layer-group-places').evaluate((e) => e.getAttribute('aria-expanded') === 'false' && (e as HTMLElement).click());
    await panel.getByTestId(`overlay-${kind}`).click();
    await expect.poll(async () => (await state()).overlay).toBe(kind);
    await expect(panel.getByTestId('legend')).toBeVisible();
    await panel.getByTestId(`overlay-${kind}`).click();
    await expect.poll(async () => (await state()).overlay).toBe('none');
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  await expect(screen).toBeVisible();
  await expect(screen.getByTestId('dataset-row-roads')).toContainText(/Live/);
  await expect(screen.getByTestId('dataset-row-homes')).toContainText(/Live/);
  expect(await screen.innerText()).not.toMatch(/\b(undefined|NaN|Infinity|\[object)\b/);
});

// ───────────── opening and closing screens leaks nothing ─────────────

test('every screen opened and closed 30 times leaks no DOM nodes, event listeners or memory', async ({ page, context }) => {
  test.setTimeout(420_000);
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  await markFire(page); // the model is paused with its first pictures: what the heap does now is the screens' doing, not the run's history growing
  const cdp = await context.newCDPSession(page);
  await cdp.send('Memory.getDOMCounters');
  const cycle = async (): Promise<void> => {
    for (const [row, screen] of MENU_SCREENS) {
      await page.getByTestId('menu').click();
      await page.getByTestId(row).click();
      await expect(page.getByTestId(screen)).toBeVisible();
      if (screen === 'datasets-screen') await page.locator('[data-testid^=dataset-row-]').first().click(); // and one data set's page
      await page.keyboard.press('Escape');
      if (screen === 'datasets-screen' && (await page.getByTestId(screen).count())) await page.keyboard.press('Escape');
      await expect(page.getByTestId(screen)).toHaveCount(0);
    }
    await pickTool(page, 'layers');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('layers-panel')).toHaveCount(0);
  };
  const read = async (): Promise<{ nodes: number; listeners: number; heapMB: number }> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const c = (await cdp.send('Memory.getDOMCounters')) as { nodes: number; jsEventListeners: number };
    const heapMB = await page.evaluate(() => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576);
    return { nodes: c.nodes, listeners: c.jsEventListeners, heapMB };
  };
  for (let i = 0; i < 10; i++) await cycle(); // warm-up: lazy modules, caches, the panels' first rendering
  const base = await read();
  const marks: unknown[] = [];
  for (let i = 0; i < 30; i++) {
    await cycle();
    if (i % 10 === 9) marks.push(await read());
  }
  const end = await read();
  console.log('LEAK base', JSON.stringify(base), 'every 10 cycles', JSON.stringify(marks), 'end', JSON.stringify(end));
  expect(end.nodes, 'DOM nodes').toBeLessThanOrEqual(base.nodes + 60);
  expect(end.listeners, 'event listeners').toBeLessThanOrEqual(base.listeners + 15);
  expect(end.heapMB - base.heapMB, 'JS heap growth (MB)').toBeLessThan(6);
});

test('real engine at Max speed: every layer and heat map switched while the engine computes at full speed to the end of 6 h, and again while the history replays: never pauses, never errors', async ({ page }) => {
  test.setTimeout(600_000);
  await watchPopups(page);
  await buildKatoomba(page);
  await armPopupWatch(page);
  const D = await scenarioDuration(page);
  await markFire(page);
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await pickTool(page, 'layers');
  const controls = await layerControls(page);
  const all = [...controls.scene, ...controls.heat];
  let toggled = 0;
  // Pass 1: while the engine computes (Max: it plays at the pace of the computation).
  for (const id of all) {
    const s = await session(page);
    if (s.viewTime >= D - 5) break;
    await expectStillPlaying(page, D);
    await domClick(page, id);
    toggled++;
  }
  // Put every layer back (Reset) and let the run finish.
  await page.getByTestId('layers-reset').click();
  await expect.poll(async () => { const s = await session(page); return s.viewTime >= D - 1 && !s.playing && s.seekTarget === null; }, { timeout: 420_000, intervals: [1000] }).toBe(true);
  expect(toggled, 'the run lasted long enough to switch layers while computing').toBeGreaterThan(5);
  expect((await session(page)).error).toBeNull();
  // Pass 2: replay the computed history from the start at the fastest speed (the clock replays at 10 800 x) with heat maps switching.
  await page.keyboard.press('Escape');
  await page.getByTestId('time-btn').click();
  await page.getByTestId('time-start').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(page)).viewTime).toBeLessThan(5);
  await page.getByTestId('play').click();
  await pickTool(page, 'layers');
  let replayToggles = 0;
  for (const id of controls.heat) {
    const s = await session(page);
    if (s.viewTime >= D - 60) break;
    await expectStillPlaying(page, D);
    await domClick(page, id);
    replayToggles++;
  }
  console.log('MAX toggled while computing', toggled, 'while replaying', replayToggles);
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 300_000 }).toBeGreaterThanOrEqual(D - 1);
  expect((await session(page)).error).toBeNull();
  expect(await popups(page)).toEqual([]);
});

test('storage: when the phone refuses to delete a saved area or a stored copy, Setup says so (it never reports a delete that did not happen)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await seedPack(page, { lat: -33.7, lon: 149.86 }, false);
  await page.reload();
  await expect(page.getByTestId('setup')).toBeVisible();
  const del = page.getByTestId(`delete-pack-${PACK_ID}`);
  await del.scrollIntoViewIfNeeded();
  await expect(del).toBeVisible({ timeout: 15_000 });
  // The device refuses every delete from now on (a full or damaged store).
  await page.evaluate(() => {
    IDBObjectStore.prototype.delete = function () {
      throw new DOMException('The phone refused', 'InvalidStateError');
    };
  });
  await del.click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText(/Could not delete .E2E test area/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^Deleted /)).toHaveCount(0);
  expect(await packStored(page)).toEqual({ meta: true, items: 7 });
});

test('double tap on "Clear" (a stored copy) opens its question and keeps it open: the second tap must not dismiss it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?mock=1&debug=1&theme=light');
  await acceptNotice(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('firesim', 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ t: Date.now(), n: 40_000, url: 'e2e' }, 'openmeteo/e2e-seed');
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.getByTestId('open-datasets').click();
  const screen = page.getByTestId('datasets-screen');
  const clear = screen.getByTestId('clear-cache-weather');
  await expect(clear).toBeVisible({ timeout: 15_000 });
  await clear.scrollIntoViewIfNeeded();
  await clear.dblclick();
  await page.waitForTimeout(700);
  await expect(page.getByTestId('confirm-clear-cache')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('confirm-clear-cache')).toHaveCount(0);
});
