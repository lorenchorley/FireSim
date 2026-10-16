/**
 * The Air slice as a whole, in the real app (plan section 8.8; bundled Katoomba demo, offline, real worker, Pixel 7 profile): the tool, the
 * scene's curtain and the side-view panel working together, on BOTH tiers. The lane specs (air-tool, airslice-panel, air-view) check each
 * part on its own; this one checks the seams between them:
 *
 *   - the tool opens with nothing placed: the words and the controls are in view, no chips or empty legend in the way
 *   - A and B placed with the crosshair after a REAL touch pan, then a tap (the two-step confirm); the line the scene computes is the
 *     one that was placed, and the side view draws it
 *   - every preset (along, across, up the slope; "Me to fire" off with its reason): the geometry the scene resolved, the marks on the map
 *   - the chips: six on the 3-D air; Temp and Smoke off on the fast tier with the scene's reason and the "Use the 3-D atmosphere"
 *     button in view; the panel's chips and the Layers panel's chips are one state, both ways
 *   - the probe: a tap and the arrow keys, the readout, and the pin on the map moving along the line (A at the left end, B at the right)
 *   - "Show model cells", the honest footer ("air from" and the kind of air), landscape 844x390, Escape / Back / focus return, and
 *     that closing the tool leaves the curtain
 *   - one-finger pan and the pinch still move the camera with the tool open, also while a point is being placed
 *   - the fast tier's button switches the run to the 3-D atmosphere and the chips follow
 *   - reduced motion, high contrast and the dark look; the 2-D stand-in map draws the line that was placed
 *   - the time-lapse recorder (0.4.1), on both tiers: Keep this line freezes a preset, the recorder fills while the run plays, a scrubbed picture reads the
 *     recorded air ("recorded air from"), a time before the start does not, Swap drops the recording, Clear recording empties it, and the words say each of these
 * Nothing in the console (the guard of ./fixtures) and nothing pops up by itself.
 */
import type { CDPSession, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, openMenu, popups, session, setSpeed, tapTimeline, watchPopups } from './helpers';

// The software-GL test browser draws about one frame per second whatever the resolution; the smaller canvas keeps each frame cheap.
test.use({ deviceScaleFactor: 1, actionTimeout: 45_000 });

type Pt = [number, number];
interface CamState {
  target: Pt;
  distance: number;
  azimuthDeg: number;
  polarDeg: number;
}
type View = {
  cameraState(): CamState;
  pickGround(x: number, y: number): Pt | null;
  projectToScreen(x: number, y: number): Pt | null;
  lookAt(x: number, y: number, d: number, az: number, tilt: number, animate?: boolean): void;
  setLayers(l: Record<string, unknown>): void;
  getLayers(): { crossSection: { enabled: boolean; a?: Pt; b?: Pt; preset?: string | null; field?: string } };
  slice?(): unknown;
  rig: { update(now: number): boolean };
};
type Handle = { __firesim: { view: View; session: { state: { get(): { snapshot: { atmosphere?: { kind?: string; time?: number }; stats?: { weather?: { windDir10: number } } } | null } }; controller: { setQuality(t: string): void } } } };

/** What the scene computed for the section, as plain numbers (the typed arrays stay in the page). */
interface Slice {
  field: string;
  kind: string | null;
  preset: string | null;
  source: string;
  line: { a: Pt; b: Pt; dir: Pt; length: number } | null;
  groundA: number | null;
  groundB: number | null;
  seq: number | null;
  airTime: number | null;
  shownTime: number | null;
  fields: Record<string, { ok: boolean; reason?: string; action?: string }>;
  windDir10: number | null;
}

const sliceOf = (page: Page): Promise<Slice | null> =>
  page.evaluate(() => {
    const w = window as unknown as Handle;
    const u = w.__firesim.view.slice?.() as
      | { field: string; fields: Slice['fields']; resolved: { preset: string | null; source: string; line: Slice['line'] }; data: { kind: string; seq: number; ground: Float32Array; airTime: number | null; shownTime: number } | null }
      | null
      | undefined;
    if (!u) return null;
    const d = u.data;
    return {
      field: u.field,
      kind: d?.kind ?? null,
      preset: u.resolved.preset,
      source: u.resolved.source,
      line: u.resolved.line ? { a: [...u.resolved.line.a] as Pt, b: [...u.resolved.line.b] as Pt, dir: [...u.resolved.line.dir] as Pt, length: u.resolved.line.length } : null,
      groundA: d ? d.ground[0]! : null,
      groundB: d ? d.ground[d.ground.length - 1]! : null,
      seq: d?.seq ?? null,
      airTime: d?.airTime ?? null,
      shownTime: d?.shownTime ?? null,
      fields: u.fields,
      windDir10: w.__firesim.session.state.get().snapshot?.stats?.weather?.windDir10 ?? null,
    };
  });

/** The time-lapse recorder as the scene reports it (its own status, asked now), and whether the slice on screen was read from it. */
interface RecStatus {
  state: string;
  offFor: string | null;
  count: number;
  from: number | null;
  to: number | null;
  spacingS: number;
  bytes: number;
  budgetBytes: number;
  dropped: string | null;
}
interface Rec {
  status: RecStatus | null;
  /** When the slice on screen was sampled, if it was read from the recording; null for a slice sampled from the picture's own air. */
  recordedAt: number | null;
  /** The time of the air of the picture on screen (a recorded slice carries the air time of its own sample, so this is read from the picture). */
  pictureAirTime: number | null;
  shownTime: number | null;
}
const recOf = (page: Page): Promise<Rec> =>
  page.evaluate(() => {
    const w = window as unknown as Handle;
    const u = w.__firesim.view.slice?.() as { data: { recordedAt?: number; shownTime: number } | null } | null | undefined;
    const rec = (w.__firesim.view as unknown as { sliceRecording?: { status(): RecStatus } }).sliceRecording;
    const air = w.__firesim.session.state.get().snapshot?.atmosphere?.time;
    return { status: rec ? rec.status() : null, recordedAt: u?.data?.recordedAt ?? null, pictureAirTime: air ?? null, shownTime: u?.data?.shownTime ?? null };
  });
/** The screen-reader live region (the app's one polite announcer). */
const liveRegion = (page: Page): Locator => page.locator('div.sr-only[aria-live="polite"]');

const airKind = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as Handle).__firesim.session.state.get().snapshot?.atmosphere?.kind ?? null);
const cam = (page: Page): Promise<CamState> => page.evaluate(() => (window as unknown as Handle).__firesim.view.cameraState());
const frame = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

async function build(page: Page, detail: 'Fast' | 'Normal'): Promise<void> {
  await page.goto('/?debug=1');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('extent').getByRole('radio', { name: '6 km' }).check({ force: true });
  await page.getByTestId('detail').getByRole('radio', { name: new RegExp(`^${detail}`) }).check({ force: true });
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => airKind(page), { timeout: 60_000 }).not.toBeNull();
}

/** Auto keeps the 3-D air unless the machine is far too slow for it: switch the run to the 3-D atmosphere if it chose the fast tier. */
async function ensureKind(page: Page, kind: 'prognostic' | 'diagnosed'): Promise<void> {
  if ((await airKind(page)) === kind) return;
  await page.evaluate(() => (window as unknown as Handle).__firesim.session.controller.setQuality('standard'));
  await expect.poll(() => airKind(page), { timeout: 400_000 }).toBe(kind);
}

/** The gestures and the placement do not depend on trees, roads or particles: switch them off so a frame is cheap in the software-GL browser. */
async function lightScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const v = (window as unknown as Handle).__firesim.view;
    v.setLayers({ vegetation: false, understorey: false, wind: 'off', flames: false, smoke: false, embers: false, roads: false, fireTrails: false, placeNames: false, imagery: false, insightMarkers: false, windSway: false });
    v.lookAt(0, 0, 4500, 200, 52, false);
  });
}

/** Let the camera come to rest (the rig's per-frame update, run many times without drawing), as the gesture specs do. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const rig = (window as unknown as Handle).__firesim.view.rig;
    const t0 = performance.now() + 4000;
    for (let i = 0; i < 100; i++) rig.update(t0 + i * 16);
  });
  await frame(page);
}

/** Fingers on a touch screen, through the DevTools protocol, so the browser makes real pointer events (pointerType 'touch'). */
class Hand {
  private readonly pts = new Map<number, Pt>();
  constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}
  private points(): { x: number; y: number; id: number; radiusX: number; radiusY: number; force: number }[] {
    return [...this.pts].map(([id, [x, y]]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 }));
  }
  async down(id: number, x: number, y: number): Promise<void> {
    this.pts.set(id, [x, y]);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.points() });
    await frame(this.page);
  }
  async drag(to: Record<number, Pt>, steps = 8): Promise<void> {
    const from = new Map([...this.pts]);
    for (let s = 1; s <= steps; s++) {
      for (const [id, p] of Object.entries(to)) {
        const a = from.get(Number(id))!;
        this.pts.set(Number(id), [a[0] + ((p[0] - a[0]) * s) / steps, a[1] + ((p[1] - a[1]) * s) / steps]);
      }
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() });
      await frame(this.page);
    }
  }
  async upAll(): Promise<void> {
    for (const [id, [x, y]] of [...this.pts]) {
      this.pts.delete(id);
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x, y, id, radiusX: 4, radiusY: 4, force: 1 }] });
      await frame(this.page);
    }
  }
}
const newHand = async (page: Page): Promise<Hand> => new Hand(page, await page.context().newCDPSession(page));

/** One finger from `from` to `to` (real touch). */
async function touchDrag(hand: Hand, from: Pt, to: Pt): Promise<void> {
  await hand.down(1, ...from);
  await hand.drag({ 1: to });
  await hand.upAll();
}

const crosshair = async (page: Page): Promise<Pt> => {
  const b = (await page.locator('.sim-screen .crosshair').boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};
const groundAt = (page: Page, p: Pt): Promise<Pt | null> => page.evaluate(([x, y]) => (window as unknown as Handle).__firesim.view.pickGround(x!, y!), p);
const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function openAirTool(page: Page): Promise<void> {
  await openMenu(page, 'tools');
  await page.getByTestId('tool-air').click();
  await expect(page.getByTestId('air-panel')).toBeVisible();
}

async function choosePreset(page: Page, id: 'along' | 'across' | 'slope' | 'me'): Promise<void> {
  const toggle = page.getByTestId('slice-presets-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByTestId(`slice-preset-${id}`).click();
}

const canvasOf = (page: Page): Locator => page.getByTestId('slice-canvas');
const seqOf = async (page: Page): Promise<string> => (await canvasOf(page).getAttribute('data-seq')) ?? '';

/** How much of the canvas is painted, a checksum of its pixels, and the darkest text-sized mark in its left margin (the height labels). */
async function paint(canvas: Locator): Promise<{ painted: number; sum: number; darkest: number; topPainted: number }> {
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const copy = document.createElement('canvas'); // a copy: repeated getImageData on the panel's own canvas makes Chromium warn
    copy.width = c.width;
    copy.height = c.height;
    const g = copy.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    let sum = 0;
    let n = 0;
    for (let y = 0; y < c.height; y += 3) {
      for (let x = 0; x < c.width; x += 5) {
        const k = (y * c.width + x) * 4;
        n++;
        if (d[k + 3]! > 0) painted++;
        sum = (sum * 31 + d[k]! + 3 * d[k + 1]! + 7 * d[k + 2]! + 11 * d[k + 3]!) % 1_000_003;
      }
    }
    // the height labels live in the first 40 px: the darkest opaque pixel there is the text colour
    let darkest = 255;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < Math.min(40, c.width); x++) {
        const k = (y * c.width + x) * 4;
        if (d[k + 3]! > 200) darkest = Math.min(darkest, (d[k]! + d[k + 1]! + d[k + 2]!) / 3);
      }
    }
    // any painted pixel in the top 6 CSS px of the box is the top of the picture: no empty band above it
    let topPainted = 0;
    const ratio = c.width / c.getBoundingClientRect().width;
    for (let y = 0; y < Math.round(14 * ratio); y++) for (let x = Math.round(50 * ratio); x < c.width; x += 4) if (d[(y * c.width + x) * 4 + 3]! > 0) topPainted++;
    return { painted: painted / n, sum, darkest, topPainted };
  });
}

const press = async (page: Page, canvas: Locator, fx: number, fy: number): Promise<void> => {
  const b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
};

/** The marks on the map, from the annotation layer: the A / B ends and the probe pin (centres, px in the scene host). */
const marks = (page: Page): Promise<{ a: Pt | null; b: Pt | null; pin: Pt | null }> =>
  page.evaluate(() => {
    const at = (el: Element | null | undefined): Pt | null => {
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(el?.getAttribute('transform') ?? '');
      return m ? ([Number(m[1]), Number(m[2])] as Pt) : null;
    };
    const ends = [...document.querySelectorAll('.annotations .ann-slice-end')];
    return {
      a: at(ends.find((e) => e.querySelector('text')?.textContent === 'A')),
      b: at(ends.find((e) => e.querySelector('text')?.textContent === 'B')),
      pin: at(document.querySelector('.annotations .ann-slice-probe')),
    };
  });

/** The compass bearing (degrees) a unit direction (east, north) points to. */
const bearing = (d: Pt): number => ((Math.atan2(d[0], d[1]) * 180) / Math.PI + 360) % 360;
const angleBetween = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

/**
 * The wind the slice itself holds where its line is centred (the fire, else the map centre: the camera's target), 30 m above the ground there, read
 * from its own lattice: the wind's speed, and its direction relative to the line (degrees clockwise from the line's own direction, so 0 is a wind along
 * the line towards B and 90 is a wind blowing to the right of A to B). Also the forecast's own direction (towards) for the same time.
 */
const windAtCentre = (page: Page): Promise<{ speed: number; rel: number; forecastTowards: number | null }> =>
  page.evaluate(() => {
    const w = window as unknown as Handle;
    const u = w.__firesim.view.slice?.() as { resolved: { line: { a: Pt; dir: Pt; length: number } }; data: { columns: number; rows: number; zMin: number; zMax: number; ground: Float32Array; values: Record<string, Float32Array> } };
    const d = u.data;
    const L = u.resolved.line;
    const c = w.__firesim.view.cameraState().target;
    const fc = Math.min(d.columns - 1, Math.max(0, ((((c[0] - L.a[0]) * L.dir[0] + (c[1] - L.a[1]) * L.dir[1]) / L.length) * (d.columns - 1))));
    const c0 = Math.min(d.columns - 2, Math.floor(fc));
    const tc = fc - c0;
    const z = d.ground[c0]! * (1 - tc) + d.ground[c0 + 1]! * tc + 30;
    const fr = Math.min(d.rows - 1, Math.max(0, ((z - d.zMin) / (d.zMax - d.zMin)) * (d.rows - 1)));
    const r0 = Math.min(d.rows - 2, Math.floor(fr));
    const tr = fr - r0;
    const at = (a: Float32Array): number => {
      const g = (r: number, k: number): number => a[r * d.columns + k]!;
      return (g(r0, c0) * (1 - tc) + g(r0, c0 + 1) * tc) * (1 - tr) + (g(r0 + 1, c0) * (1 - tc) + g(r0 + 1, c0 + 1) * tc) * tr;
    };
    const along = at(d.values.along!);
    const across = at(d.values.across!);
    const dir = w.__firesim.session.state.get().snapshot?.stats?.weather?.windDir10;
    return { speed: Math.hypot(along, across), rel: (Math.atan2(across, along) * 180) / Math.PI, forecastTowards: dir === undefined ? null : (dir + 180) % 360 };
  });

// ─────────────────────────────────────────────────────────────────────────────
// The whole flow, on either tier
// ─────────────────────────────────────────────────────────────────────────────

async function exercise(page: Page, tier: 'diagnosed' | 'prognostic'): Promise<void> {
  const canvas = canvasOf(page);
  const fastTier = tier === 'diagnosed';
  await lightScene(page);
  await settle(page);
  await armPopupWatch(page);
  const hand = await newHand(page);

  // ───────── 1. the tool opens with nothing placed: words and controls in view ─────────
  await test.step('opens with the words and the controls in view, and no chips in the way', async () => {
    await openAirTool(page);
    await expect(page.getByTestId('slice-empty')).toHaveText('Choose a preset, or set A and B.');
    await expect(page.getByTestId('slice-set-a')).toBeInViewport();
    await expect(page.getByTestId('slice-presets-toggle')).toBeInViewport();
    await expect(page.getByTestId('slice-chip-speed')).toBeHidden();
    await expect(page.getByTestId('slice-footer')).toBeHidden();
    const b = (await canvas.boundingBox())!;
    expect(b.height, 'the empty canvas is only as tall as its words need').toBeLessThanOrEqual(140);
    expect(await sliceOf(page), 'opening the tool draws no section').toBeNull();
  });

  // ───────── 2. A and B with the crosshair, after a real touch pan, then a tap ─────────
  const placed = await test.step('places A and B with the crosshair (real touch pan, then a tap) and the scene computes that line', async () => {
    await page.getByTestId('slice-set-a').click();
    await expect(page.locator('.sim-screen .crosshair')).toBeVisible();
    const c0 = await crosshair(page);
    const under0 = await groundAt(page, c0);
    expect(under0).not.toBeNull();
    await touchDrag(hand, [c0[0] + 40, c0[1] + 110], [c0[0] - 20, c0[1] - 110]);
    await settle(page);
    await expect.poll(async () => (await groundAt(page, c0)) ?? [NaN, NaN], { message: 'the one-finger pan moved the map under the cross' }).not.toEqual(under0);
    // the two-step confirm of a wet screen or a glove: a tap sets the point, "Place A here" keeps THAT point
    const tapA: Pt = [c0[0] + 35, c0[1] - 25];
    const aPoint = (await groundAt(page, tapA))!;
    await page.touchscreen.tap(...tapA);
    await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(1);
    await page.getByTestId('slice-place').click();
    await expect(page.getByTestId('slice-note')).toHaveText('Start (A) is set. Now set the end (B).');
    await page.getByTestId('slice-set-b').click();
    await touchDrag(hand, [c0[0] + 30, c0[1] - 100], [c0[0] - 10, c0[1] + 120]);
    await settle(page);
    await expect(page.getByTestId('slice-place')).toBeEnabled();
    const bPoint = (await groundAt(page, await crosshair(page)))!;
    expect(dist(aPoint, bPoint)).toBeGreaterThan(300);
    await page.getByTestId('slice-place').click();
    await expect(canvas).not.toHaveAttribute('data-seq', '', { timeout: 30_000 });
    const s = (await sliceOf(page))!;
    expect(s.source).toBe('endpoints');
    expect(s.preset).toBeNull();
    expect(dist(s.line!.a, aPoint), 'A is the tapped point (m)').toBeLessThan(1);
    expect(dist(s.line!.b, bPoint), 'B is the point under the cross (m)').toBeLessThan(1);
    expect(s.kind).toBe(tier);
    expect(s.field, 'the first line is coloured by wind speed').toBe('speed');
    expect((await paint(canvas)).painted).toBeGreaterThan(0.3);
    return s;
  });

  // ───────── 3. the panel is the picture of that line: the footer, the legend, no empty band above the picture ─────────
  await test.step('the footer tells the kind of air, the grid and the time of the air; the picture starts at the top of its box', async () => {
    const footer = page.getByTestId('slice-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(fastTier ? 'Diagnosed wind: terrain effects only' : '3-D time-stepped air');
    await expect(footer).toContainText(/model grid \d+ m/);
    await expect(footer).toContainText(/air from \d\d:\d\d/);
    await expect(footer).not.toContainText('before the time shown'); // the air is as new as the picture here
    await expect(footer).toBeInViewport();
    await expect(page.getByTestId('slice-legend')).toBeVisible();
    await expect(page.getByTestId('slice-scale')).toContainText(/Heights are above sea level/);
    const p = await paint(canvas);
    expect(p.topPainted, 'the picture reaches the top of the canvas: no empty band above it').toBeGreaterThan(0);
    expect(placed.line!.length).toBeGreaterThan(300);
  });

  // ───────── 4. the probe: by tap and by keys, with the readout and the pin on the map ─────────
  await test.step('probe: a tap reads the air, the arrow keys move it, and the pin on the map follows along the line', async () => {
    const readout = page.getByTestId('slice-readout');
    const text = page.getByTestId('slice-readout-text');
    await expect(readout).toBeHidden();
    await expect(page.locator('.annotations .ann-slice-probe')).toHaveCount(0);
    await press(page, canvas, 0.3, 0.3);
    await expect(readout).toBeVisible();
    await expect(text).toContainText(/^(Wind about|Calm)/);
    if (fastTier) await expect(text).not.toContainText(/warmer|cooler|average temperature/);
    await expect(page.locator('.annotations .ann-slice-probe')).toHaveCount(1);
    const first = await text.innerText();
    await press(page, canvas, 0.8, 0.45);
    await expect.poll(() => text.innerText()).not.toBe(first);
    // the arrow keys: Shift+Left four times is the A end (a quarter of the line each), Shift+Right four times the B end
    await canvas.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => { const k = await marks(page); return k.pin && k.a ? dist(k.pin, k.a) : 999; }, { message: 'the pin is at A' }).toBeLessThan(4);
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
    // The pin is re-projected once per drawn frame and the software-GL browser draws about one a second, so it may show the first key's quarter
    // for a while: wait until it shows the half (it was read after "moved more than 30 px", which a quarter already is, and failed under load).
    await expect
      .poll(async () => {
        const k = await marks(page);
        return k.pin && k.a && k.b ? dist(k.pin, k.b) / Math.max(1, dist(k.pin, k.a)) : 999;
      }, { message: 'half way: about as far from B as from A' })
      .toBeLessThan(1.6);
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => dist((await marks(page)).pin!, (await marks(page)).b!)).toBeLessThan(4);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown'); // a lattice step down each: the reading changes, the pin does not leave the line
    await expect(text).toContainText(/above ground|ground level|Inside the ground|Below the model/);
    // tap again, then the clear button (a 44 px target) takes the pin off the map
    await press(page, canvas, 0.5, 0.25);
    const clear = page.getByTestId('slice-probe-clear');
    const cbox = (await clear.boundingBox())!;
    expect(Math.min(cbox.width, cbox.height), 'the clear button is a 44 px target').toBeGreaterThanOrEqual(40);
    await clear.click();
    await expect(readout).toBeHidden();
    await expect(page.locator('.annotations .ann-slice-probe')).toHaveCount(0);
    // the time-stepped air has a temperature clause
    if (!fastTier) {
      await press(page, canvas, 0.5, 0.25);
      await expect(text).toContainText(/warmer|cooler|average temperature/);
      await clear.click();
    }
  });

  // ───────── 5. model cells ─────────
  await test.step('Show model cells draws the model\'s own blocks and goes back', async () => {
    // under reduced motion the picture holds still, so a changed checksum means the picture was redrawn, not that a streak moved
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(canvas).toHaveAttribute('data-motion', 'arrows');
    await expect
      .poll(async () => {
        const a = (await paint(canvas)).sum;
        await page.waitForTimeout(400);
        return a === (await paint(canvas)).sum;
      }, { timeout: 30_000 })
      .toBe(true);
    const smooth = (await paint(canvas)).sum;
    await page.getByTestId('slice-cells').click();
    await expect(page.getByTestId('slice-cells').getByRole('switch')).toBeChecked();
    await expect.poll(async () => (await paint(canvas)).sum).not.toBe(smooth);
    await page.getByTestId('slice-cells').click();
    await expect(page.getByTestId('slice-cells').getByRole('switch')).not.toBeChecked();
    await expect.poll(async () => (await paint(canvas)).sum).toBe(smooth);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(canvas).toHaveAttribute('data-motion', 'streaks');
  });

  // ───────── 6. each preset: what the scene resolved, the marks on the map ─────────
  await test.step('presets: along, across and up the slope resolve to the right geometry; Me to fire says why it is off', async () => {
    const toward = (await sliceOf(page))!.windDir10;
    expect(toward).not.toBeNull();
    const windTowards = ((toward! + 180) % 360 + 360) % 360;
    for (const id of ['along', 'across', 'slope'] as const) {
      const before = await seqOf(page);
      await choosePreset(page, id);
      await expect.poll(() => seqOf(page)).not.toBe(before);
      const s = (await sliceOf(page))!;
      expect(s.preset, id).toBe(id);
      expect(s.source).toBe('preset');
      expect(s.line!.length, `${id}: a long line through the fire or the map centre`).toBeGreaterThan(1500);
      const b = bearing(s.line!.dir);
      if (id !== 'slope') {
        // The model's own wind where the line is centred, 30 m up (the forecast's 10 m wind is only the fallback: after a wind edit the two differ by tens
        // of degrees, and in rough ground by several): 'along' lies along it, A upwind and B downwind, and 'across' has it blowing to the right of A to B.
        const w = await windAtCentre(page);
        if (w.speed >= 0.2) expect(angleBetween(w.rel, id === 'along' ? 0 : 90), `${id}: the model's wind at the centre, ${w.speed.toFixed(1)} m/s, is ${w.rel.toFixed(1)} degrees round from the line`).toBeLessThan(3);
        else expect(angleBetween(b, id === 'along' ? windTowards : (windTowards - 90 + 360) % 360), `${id}: calm in the model there, so the forecast's direction`).toBeLessThan(2);
      }
      if (id === 'slope') expect(s.groundB! - s.groundA!, 'up the slope: A downhill, B uphill').toBeGreaterThan(5);
      expect((await paint(canvas)).painted).toBeGreaterThan(0.3);
    }
    const toggle = page.getByTestId('slice-presets-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(page.getByTestId('slice-preset-me')).toBeDisabled();
    await expect(page.getByTestId('slice-controls')).toContainText('This run has no position for you');
    await toggle.click();
    await choosePreset(page, 'along'); // the line for the rest of the flow: along the wind
    await expect.poll(async () => (await sliceOf(page))?.preset).toBe('along');
  });

  // ───────── 6b. the panel repaints in a frame of its own ─────────
  await test.step('a new slice is drawn in the next frame, not inside the update that made it', async () => {
    // (at 4x CPU the panel's repaint inside the update was two thirds of it: the update is the scene's, the repaint is the panel's frame)
    const r = await page.evaluate(async () => {
      const v = (window as unknown as Handle).__firesim.view;
      const c = document.querySelector('[data-testid="slice-canvas"]') as HTMLElement;
      const made = (): number => (v.slice?.() as unknown as { data: { seq: number } | null }).data?.seq ?? -1;
      v.setLayers({ crossSection: { ...v.getLayers().crossSection, enabled: true, a: [-1500, 200], b: [1400, -300], preset: null } });
      const seq = made();
      const atOnce = c.dataset.seq;
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      return { seq, atOnce, after: c.dataset.seq };
    });
    expect(r.atOnce, 'the picture was not redrawn inside the call that changed the line').not.toBe(String(r.seq));
    expect(r.after, 'it is redrawn by the next frame').toBe(String(r.seq));
    await choosePreset(page, 'along'); // the line for the rest of the flow
    await expect.poll(async () => (await sliceOf(page))?.preset).toBe('along');
  });

  // ───────── 7. chips: tier by tier, and one state with the Layers panel ─────────
  await test.step('chips: the tier decides which are open, a disabled one says why, and the Layers chips are the same state', async () => {
    const ids = ['speed', 'along', 'up', 'across', 'theta', 'smoke'];
    if (fastTier) {
      for (const id of ['speed', 'along', 'up', 'across']) await expect(page.getByTestId(`slice-chip-${id}`)).not.toHaveAttribute('aria-disabled', 'true');
      for (const id of ['theta', 'smoke']) await expect(page.getByTestId(`slice-chip-${id}`)).toHaveAttribute('aria-disabled', 'true');
      const s = (await sliceOf(page))!;
      const reasons = page.getByTestId('slice-reasons');
      await expect(reasons).toBeVisible();
      await expect(reasons).toContainText(s.fields.theta!.reason!); // the scene's words, word for word
      await expect(reasons).toContainText(s.fields.smoke!.reason!);
      expect(s.fields.theta!.action).toBe('use-3d');
      const button = page.getByTestId('slice-use3d');
      await expect(button).toBeVisible();
      await expect(button).toHaveText('Use the 3-D atmosphere');
      await page.evaluate(() => ((document.querySelector('.slice-tool-body') as HTMLElement).scrollTop = 0)); // (the earlier steps scrolled to the controls)
      await expect(button, 'the button is in view without scrolling').toBeInViewport();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      await page.getByTestId('slice-chip-theta').click({ force: true });
      await expect(canvas).toHaveAttribute('data-field', 'speed');
      await expect(page.getByTestId('slice-chip-theta')).toHaveAttribute('aria-pressed', 'false');
    } else {
      for (const id of ids) await expect(page.getByTestId(`slice-chip-${id}`)).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('slice-use3d')).toHaveCount(0);
      await expect(page.getByTestId('slice-reasons')).toBeHidden();
    }
    // every open chip colours the picture and changes the legend
    const open = fastTier ? ['along', 'up', 'across', 'speed'] : ['along', 'up', 'across', 'theta', 'smoke', 'speed'];
    let legend = await page.getByTestId('slice-legend').innerText();
    for (const id of open) {
      await page.getByTestId(`slice-chip-${id}`).click();
      await expect(canvas).toHaveAttribute('data-field', id);
      await expect(page.getByTestId(`slice-chip-${id}`)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await sliceOf(page))?.field).toBe(id);
      const now = await page.getByTestId('slice-legend').innerText();
      if (id !== 'speed') expect(now, `${id} has its own legend`).not.toBe(legend);
      legend = now;
    }
    // the same state in the Layers panel: a chip chosen here is the pressed one there, and a chip chosen there is the pressed one here
    await page.getByTestId('slice-chip-across').click();
    // a probe on this line: it must be gone when the line is changed from outside the tool (the compass below)
    await canvas.scrollIntoViewIfNeeded();
    await press(page, canvas, 0.5, 0.25);
    await expect(page.getByTestId('slice-readout')).toBeVisible();
    await page.getByTestId('layers-fab').click(); // (the Tools menu is put away while a tool is open)
    const layers = page.getByTestId('layers-panel');
    await expect(layers.getByTestId('slice-field-across')).toHaveAttribute('aria-pressed', 'true');
    await expect(layers.getByTestId('slice-field-speed')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('map-legend')).toContainText(/across the line/i);
    if (fastTier) {
      await expect(layers.getByTestId('slice-field-theta')).toBeDisabled();
      await expect(layers.getByTestId('slice-diagnosed')).toBeVisible();
    } else {
      await expect(layers.getByTestId('slice-field-theta')).toBeEnabled();
      await expect(layers.getByTestId('slice-diagnosed')).toBeHidden();
    }
    await layers.getByTestId('slice-field-up').click();
    await expect.poll(async () => (await sliceOf(page))?.field).toBe('up');
    await expect(layers.getByTestId('slice-line-hint')).toBeVisible(); // "The slice follows the line you placed with Air slices ..."
    // The compass shows the line the section really has (it read "Towards N 0" with a line placed), and turning it swings THAT line about its middle
    // (it jumped to the stored centre, the origin or the last ignition)
    const dial = layers.getByRole('slider', { name: 'Slice direction' });
    const placedLine = (await sliceOf(page))!.line!;
    const shownDeg = Number(await dial.getAttribute('aria-valuenow'));
    expect(angleBetween(shownDeg, bearing(placedLine.dir)), `the compass shows the line's own bearing (${bearing(placedLine.dir).toFixed(1)})`).toBeLessThan(1);
    const middle: Pt = [(placedLine.a[0] + placedLine.b[0]) / 2, (placedLine.a[1] + placedLine.b[1]) / 2];
    await dial.focus();
    await page.keyboard.press('ArrowRight'); // 5 degrees round, to a multiple of 5
    await expect.poll(async () => (await sliceOf(page))?.source, { message: 'the compass writes the centre rule' }).toBe('centre');
    const swung = (await sliceOf(page))!.line!;
    expect(angleBetween(bearing(swung.dir), Math.round((shownDeg + 5) / 5) * 5), 'the line turned by the step').toBeLessThan(0.5);
    const off = Math.abs((middle[0] - swung.a[0]) * swung.dir[1] - (middle[1] - swung.a[1]) * swung.dir[0]);
    expect(off, 'the turned line passes through the middle of the line it was (m)').toBeLessThan(1);
    // "Centre on the fire" puts the line back on the centre rule: a preset must not hide the change; the section can be switched off and on
    await layers.getByRole('button', { name: 'Centre on the fire' }).click();
    await expect.poll(async () => (await sliceOf(page))?.source).toBe('centre');
    const centred = await page.evaluate(() => (window as unknown as Handle).__firesim.view.getLayers().crossSection);
    expect(centred.preset ?? null).toBeNull();
    expect(centred.a).toBeUndefined();
    expect(centred.b).toBeUndefined();
    await expect(layers.getByTestId('slice-line-hint')).toBeHidden();
    await layers.getByTestId('cross-section').click();
    await expect.poll(() => sliceOf(page)).toBeNull();
    await expect(page.getByTestId('map-legend')).not.toContainText(/going up or down/i); // (the wind streaks' own legend may stand there instead)
    await layers.getByTestId('cross-section').click();
    await expect.poll(async () => (await sliceOf(page))?.field).toBe('up'); // the chip survives
    await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
    await openAirTool(page);
    await expect(page.getByTestId('slice-readout'), 'the probe went when the compass changed the line').toBeHidden();
    await expect(page.locator('.annotations .ann-slice-probe')).toHaveCount(0);
    await expect(page.getByTestId('slice-chip-up')).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas).toHaveAttribute('data-field', 'up');
    await page.getByTestId('slice-chip-speed').click();
    await expect(canvas).toHaveAttribute('data-field', 'speed');
    await choosePreset(page, 'along'); // (the line for the rest of the flow)
    await expect.poll(async () => (await sliceOf(page))?.preset).toBe('along');
  });

  // ───────── 8. landscape 844x390 ─────────
  await test.step('landscape 844x390: the picture and the footer stay in view, the controls are reached by scrolling', async () => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(900);
    await expect(canvas).toBeInViewport();
    await expect(page.getByTestId('slice-footer')).toBeInViewport();
    const cb = (await canvas.boundingBox())!;
    expect(cb.height).toBeGreaterThanOrEqual(80);
    expect(cb.width).toBeGreaterThan(300);
    await expect(page.getByTestId('slice-footer')).toContainText(/air from \d\d:\d\d/);
    // the window between the pinned picture and the pinned footer is big enough to use (a chip row and a bit)
    const fb = (await page.getByTestId('slice-footer').boundingBox())!;
    expect(fb.y - (cb.y + cb.height), 'the scrolling window between the picture and the footer (px)').toBeGreaterThanOrEqual(52);
    const toggle = page.getByTestId('slice-presets-toggle');
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toBeInViewport();
    expect(Math.abs((await canvas.boundingBox())!.y - cb.y), 'the picture does not move while the controls scroll').toBeLessThan(2);
    await expect(canvas).toBeInViewport();
    await expect(page.getByTestId('slice-footer')).toBeInViewport();
    await page.getByTestId('slice-chip-along').scrollIntoViewIfNeeded();
    await page.getByTestId('slice-chip-along').click();
    await expect(canvas).toHaveAttribute('data-field', 'along');
    // a plain click on a control further down: the window scrolls it clear of the pinned picture and the pinned footer (scroll-padding)
    await page.getByTestId('slice-set-a').click();
    await expect(page.locator('.sim-screen .crosshair')).toBeVisible();
    await page.getByTestId('slice-cancel').click();
    await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
    await press(page, canvas, 0.4, 0.3);
    const readout = page.getByTestId('slice-readout');
    await expect(readout).toBeVisible();
    // the reading is all in view (it was cut off by the footer): it takes the footer's line, and the footer is back when it is cleared
    const rb = (await readout.boundingBox())!;
    const pb = (await page.getByTestId('air-panel').boundingBox())!;
    expect(rb.y + rb.height, 'the whole reading is inside the panel').toBeLessThanOrEqual(pb.y + pb.height + 1);
    await expect(page.getByTestId('slice-footer')).toBeHidden();
    // The reading is under the pinned picture and scrolls with the controls: with it on, the chips, Presets and the 3-D button can still be reached and
    // tapped (it was pinned and covered the whole window, so nothing could be reached until the X had cleared it)
    const onTop = (loc: Locator): Promise<boolean> =>
      loc.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && (el === hit || el.contains(hit));
      });
    // (scrolled the way a focus or a tap scrolls: to the nearest edge, clear of the pinned picture and footer by the body's scroll-padding)
    const reach = (loc: Locator): Promise<void> => loc.evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
    const chipUp = page.getByTestId('slice-chip-up');
    await reach(chipUp);
    await expect(chipUp).toBeInViewport();
    expect(await onTop(chipUp), 'the chip is not under the reading or the pinned picture').toBe(true);
    await chipUp.click();
    await expect(canvas).toHaveAttribute('data-field', 'up');
    const presetsToggle = page.getByTestId('slice-presets-toggle');
    await reach(presetsToggle);
    expect(await onTop(presetsToggle), 'Presets is reachable with the reading on').toBe(true);
    if (fastTier) {
      const use3d = page.getByTestId('slice-use3d');
      await reach(use3d);
      expect(await onTop(use3d), 'the 3-D button is reachable with the reading on').toBe(true);
    }
    // a new tap on the picture brings the reading back under it, whatever the body was scrolled to
    await press(page, canvas, 0.6, 0.3);
    const again = (await readout.boundingBox())!;
    const picture = (await canvas.boundingBox())!;
    expect(again.y, 'the reading is right under the picture').toBeLessThan(picture.y + picture.height + 8);
    expect(again.y + again.height).toBeLessThanOrEqual((await page.getByTestId('air-panel').boundingBox())!.y + (await page.getByTestId('air-panel').boundingBox())!.height + 1);
    await page.getByTestId('slice-probe-clear').click();
    await expect(page.getByTestId('slice-footer')).toBeInViewport();
    await page.getByTestId('slice-chip-speed').click();
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(900);
    await expect(canvas).toBeInViewport();
  });

  // ───────── 9. one-finger pan and pinch with the tool open ─────────
  await test.step('one-finger pan and the pinch still move the camera with the tool open', async () => {
    await lookAtCentre(page, 3000);
    const t0 = await cam(page);
    const centre = (await page.evaluate(([x, y]) => (window as unknown as Handle).__firesim.view.projectToScreen(x!, y!), t0.target))!;
    const above = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, centre);
    expect(above, 'the map is under that point (not the panel)').toBe('CANVAS');
    await touchDrag(hand, [centre[0] + 40, centre[1] + 60], [centre[0] - 50, centre[1] - 40]);
    await settle(page);
    const t1 = await cam(page);
    expect(dist(t1.target, t0.target), 'the one-finger pan moved the view (m)').toBeGreaterThan(50);
    // (the distance to the target may change a little: the camera keeps its height while the ground under the target rises or falls)
    expect(Math.abs(t1.azimuthDeg - t0.azimuthDeg), 'a pan does not turn the view').toBeLessThan(0.5);
    expect(Math.abs(t1.polarDeg - t0.polarDeg), 'a pan does not tilt it').toBeLessThan(0.5);
    await hand.down(1, centre[0] - 50, centre[1]);
    await hand.down(2, centre[0] + 50, centre[1]);
    await hand.drag({ 1: [centre[0] - 100, centre[1]], 2: [centre[0] + 100, centre[1]] }, 8);
    await settle(page);
    const t2 = await cam(page);
    expect(t2.distance / t1.distance, 'the pinch zooms in (spacing x2: about half the distance)').toBeLessThan(0.7);
    await hand.upAll();
    await settle(page);
    await expect(page.getByTestId('air-panel')).toBeVisible(); // and the tool is still there
    expect((await sliceOf(page))?.preset).toBe('along');
  });

  // ───────── 10. Escape, Back, focus, and the curtain staying ─────────
  await test.step('Escape clears the probe, then drops a placement, then closes the tool; focus returns; the curtain stays', async () => {
    await press(page, canvas, 0.5, 0.3);
    await expect(page.getByTestId('slice-readout')).toBeVisible();
    await canvas.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('slice-readout')).toBeHidden();
    await expect(page.getByTestId('air-panel')).toBeVisible(); // the first Escape went to the probe only
    await page.getByTestId('slice-set-a').click();
    await expect(page.locator('.sim-screen .crosshair')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.sim-screen .crosshair')).toBeHidden();
    await expect(page.getByTestId('air-panel')).toBeVisible();
    await page.getByTestId('slice-set-b').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('air-panel')).toHaveCount(0);
    await expect(page.getByTestId('tools-menu')).toBeFocused();
    await expect(page.locator('.annotations .ann-slice-end')).toHaveCount(0); // the marks belong to the open tool
    await expect(page.locator('.annotations path.ann-stroke')).toHaveCount(0);
    const layers = await page.evaluate(() => (window as unknown as Handle).__firesim.view.getLayers().crossSection);
    expect(layers.enabled, 'closing the tool leaves the curtain').toBe(true);
    expect(layers.preset).toBe('along');
    expect((await sliceOf(page))?.preset).toBe('along');
    // open again: the line, the chip and the switch are as they were
    await openAirTool(page);
    await expect(canvas).toHaveAttribute('data-field', 'speed');
    await expect(page.getByTestId('slice-footer')).toBeVisible();
    await page.getByTestId('air-close').click();
    await expect(page.getByTestId('air-panel')).toHaveCount(0);
    expect(await popups(page), 'nothing pops up by itself').toEqual([]);
  });
}

async function lookAtCentre(page: Page, distance: number): Promise<void> {
  await page.evaluate((d) => (window as unknown as Handle).__firesim.view.lookAt(0, 0, d, 200, 52, false), distance);
  await settle(page);
}

// ─────────────────────────────────────────────────────────────────────────────

test('fast tier: place, presets, chips with Temp and Smoke off, probe, cells, footer, landscape, gestures, Escape, then the 3-D button switches the tier', async ({ page }) => {
  test.setTimeout(900_000);
  await watchPopups(page);
  await build(page, 'Fast');
  await expect.poll(() => airKind(page)).toBe('diagnosed');
  await exercise(page, 'diagnosed');

  await test.step('the "Use the 3-D atmosphere" button switches the run, and Temp and Smoke open', async () => {
    await openAirTool(page);
    const button = page.getByTestId('slice-use3d');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByTestId('slice-note')).toContainText('Re-computing with the 3-D atmosphere');
    await expect(page.getByTestId('slice-note')).toContainText('Press Play to continue');
    // nothing was played yet, so the engine has nothing to re-run until the person presses Play, as the note says
    await page.getByTestId('play').click();
    await expect.poll(() => airKind(page), { timeout: 400_000 }).toBe('prognostic');
    await page.getByTestId('play').click(); // pause
    await expect(page.getByTestId('slice-use3d')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('slice-chip-theta')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('slice-chip-smoke')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('slice-footer')).toContainText('3-D time-stepped air', { timeout: 30_000 });
    await page.getByTestId('slice-chip-theta').click();
    await expect(canvasOf(page)).toHaveAttribute('data-field', 'theta');
    await expect.poll(async () => (await sliceOf(page))?.field).toBe('theta');
    await expect(page.getByTestId('slice-legend')).toContainText(/Warmer or cooler than the average of the slice at that height/);
    await page.getByTestId('air-close').click();
  });
});

test('3-D tier: the same flow on the time-stepped air, all six chips open', async ({ page }) => {
  test.setTimeout(900_000);
  await watchPopups(page);
  await build(page, 'Normal');
  await ensureKind(page, 'prognostic');
  await exercise(page, 'prognostic');
});

test('fast tier: the slice follows playback, and the footer says how old the air is when the time is scrubbed back', async ({ page }) => {
  test.setTimeout(600_000);
  await build(page, 'Fast');
  await lightScene(page);
  // a fire at the crosshair, played to a little past six minutes (the air is kept every few minutes, so a picture in between has older air)
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 240_000 }).toBeGreaterThan(370);
  await page.getByTestId('play').click(); // pause
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  await openAirTool(page);
  await choosePreset(page, 'along');
  const canvas = canvasOf(page);
  await expect(canvas).not.toHaveAttribute('data-seq', '', { timeout: 30_000 });
  const footer = page.getByTestId('slice-footer');
  // playback: the slice is recomputed for every new picture, and the shown time moves with it
  const s0 = (await sliceOf(page))!;
  await setSpeed(page, 600);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await sliceOf(page))?.shownTime ?? 0, { timeout: 120_000, message: 'the slice follows the pictures while playing' }).toBeGreaterThan(s0.shownTime! + 60);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  expect((await sliceOf(page))!.seq!, 'new air, new slice').toBeGreaterThan(s0.seq!);
  // scrubbed back: the footer says how old the air is against the time shown, and only when it is more than 90 s
  let older = 0;
  for (const t of [250, 200, 150, 290]) {
    await tapTimeline(page, t);
    await expect.poll(async () => Math.abs((await session(page)).viewTime - t), { timeout: 60_000 }).toBeLessThan(40);
    await expect.poll(async () => Math.abs(((await sliceOf(page))?.shownTime ?? 0) - (await session(page)).viewTime), { timeout: 30_000 }).toBeLessThan(40);
    const s = (await sliceOf(page))!;
    const age = s.shownTime! - s.airTime!;
    expect(age, 'the air is never newer than the picture').toBeGreaterThanOrEqual(0);
    if (age > 90) {
      older++;
      await expect(footer).toContainText(new RegExp(`\\(${Math.max(1, Math.round(age / 60))} min before the time shown\\)`));
    } else await expect(footer).not.toContainText('before the time shown');
    await expect(footer).toContainText(/air from \d\d:\d\d/);
    await expect(footer).toBeInViewport();
  }
  expect(older, 'at least one of the pictures shown has air older than 90 s').toBeGreaterThan(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// The time-lapse recorder (0.4.1), on both tiers. It reads `view.sliceRecording`, which the scene gets from lane R-core.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fire at the crosshair, played until the run is past `until` s, then paused. At 120 x the worker computes only an hour ahead of the view (`runTarget`), so
 * the run is not computed to its end before a line is kept: the recorder sees every picture the worker makes after that, whatever the speed of the machine.
 */
async function fireAndRunTo(page: Page, until: number): Promise<void> {
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('tool-fire').click();
  await page.getByTestId('use-crosshair').click();
  await page.getByTestId('confirm-fire').click();
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await setSpeed(page, 120);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).viewTime, { timeout: 400_000 }).toBeGreaterThan(until);
  await page.getByTestId('play').click(); // pause
  await expect.poll(async () => (await session(page)).playing).toBe(false);
}

/** Back to the head of the run if the view is in the past, then play at 120 x until the recorder holds `count` pictures over `spanS` s or more, then pause. */
async function recordUntil(page: Page, count: number, spanS: number): Promise<RecStatus> {
  const s = await session(page);
  if (s.viewTime < s.headTime - 1) {
    await tapTimeline(page, s.headTime);
    await expect.poll(async () => Math.abs((await session(page)).viewTime - s.headTime), { timeout: 120_000 }).toBeLessThan(60);
  }
  await setSpeed(page, 120);
  await page.getByTestId('play').click();
  await expect
    .poll(
      async () => {
        const st = (await recOf(page)).status;
        return !!st && st.count >= count && st.to! - st.from! >= spanS;
      },
      { timeout: 400_000, intervals: [500] },
    )
    .toBe(true);
  await page.getByTestId('play').click(); // pause
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  // The worker is up to an hour ahead of the view and the recording is of what it made after the line was kept: the view may still be before the first picture.
  const st = (await recOf(page)).status!;
  if ((await session(page)).viewTime < st.from!) await scrubTo(page, st.to!);
  return (await recOf(page)).status!;
}

/** Jump to time t (s), wait until the picture and its slice are for it, and say what the scene reports about the slice. */
async function scrubTo(page: Page, t: number): Promise<Rec> {
  await tapTimeline(page, t);
  await expect.poll(async () => Math.abs((await session(page)).viewTime - t), { timeout: 60_000 }).toBeLessThan(45);
  await expect.poll(async () => Math.abs(((await recOf(page)).shownTime ?? 0) - (await session(page)).viewTime), { timeout: 30_000 }).toBeLessThan(45);
  return recOf(page);
}

/** A time inside a recording, the fraction k of the way along it, moved off the 5-minute keyframes (at one the picture's own air is as new as the recording). */
function insideSpan(from: number, to: number, k: number): number {
  const raw = from + (to - from) * k;
  return Math.min(to - 30, Math.max(from + 30, raw - (raw % 300) + 150));
}

async function recordFlow(page: Page, tier: 'diagnosed' | 'prognostic'): Promise<void> {
  await lightScene(page);
  await fireAndRunTo(page, tier === 'diagnosed' ? 370 : 250);
  await armPopupWatch(page);
  const canvas = canvasOf(page);
  const footer = page.getByTestId('slice-footer');
  const status = page.getByTestId('slice-recording');
  const keep = page.getByTestId('slice-keep');
  const clear = page.getByTestId('slice-recording-clear');

  await test.step('a live preset is not recorded: the status line says why and Keep this line is offered', async () => {
    await openAirTool(page);
    await choosePreset(page, 'along');
    await expect(canvas).not.toHaveAttribute('data-seq', '', { timeout: 30_000 });
    await expect(status).toHaveText('This preset follows the wind and the fire, so it is not recorded. Press Keep this line to record it.');
    await expect(keep).toBeVisible();
    expect((await keep.boundingBox())!.height, 'a button of the tool: 40 px drawn, a 44 px target').toBeGreaterThanOrEqual(40);
    await expect(clear).toBeHidden();
    expect((await recOf(page)).status).toMatchObject({ state: 'off', offFor: 'preset', count: 0 });
    await expect(footer).toContainText(/ · air from \d\d:\d\d/);
    await expect(footer).not.toContainText('recorded');
  });

  await test.step('Keep this line freezes the preset into a hand-placed line and the recorder waits for the next picture', async () => {
    const before = (await sliceOf(page))!.line!;
    await keep.scrollIntoViewIfNeeded();
    await keep.click();
    const cs = await page.evaluate(() => (window as unknown as Handle).__firesim.view.getLayers().crossSection);
    expect(cs.preset ?? null).toBeNull();
    expect(cs.a, 'A is where the preset had it').toBeDefined();
    expect(dist(cs.a!, before.a)).toBeLessThan(0.2);
    expect(dist(cs.b!, before.b)).toBeLessThan(0.2);
    await expect(keep, 'a fixed line cannot be kept again').toBeHidden();
    await expect(liveRegion(page)).toHaveText('Line kept. Recording from the next picture.');
    // paused at the head: nothing arrives unless the worker is still computing ahead, so "waiting" or already a picture
    await expect(status).toHaveText(/^(Recording starts with the next picture\.|Recorded from \d\d:\d\d)/);
    expect((await recOf(page)).status!.state).toMatch(/^(waiting|recording)$/);
    expect((await sliceOf(page))!.source).toBe('endpoints');
    expect(await popups(page), 'nothing pops up by itself').toEqual([]);
  });

  await test.step('plays on: the recorder fills, the status says from when to when, Clear recording appears', async () => {
    const rec = await recordUntil(page, 4, 150);
    expect(rec.state).toBe('recording');
    expect(rec.bytes).toBeGreaterThan(0);
    expect(rec.bytes).toBeLessThanOrEqual(rec.budgetBytes);
    await expect(status).toHaveText(/^Recorded from \d\d:\d\d to \d\d:\d\d, (every picture|about every .+)\.$/);
    await expect(clear).toBeVisible();
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await expect(keep).toBeHidden();
  });

  await test.step('scrubbed inside the span, the picture reads the recorded air: the footer says "recorded air from" and how old', async () => {
    const { from, to, spacingS } = (await recOf(page)).status!;
    const step = (await session(page)).timeStep;
    let recorded = 0;
    for (const k of [0.25, 0.5, 0.75]) {
      const t = insideSpan(from!, to!, k);
      await scrubTo(page, t);
      // The rule: the recorded air is read unless the picture's own air is already as new (a keyframe). The slice is recomputed a moment after the picture
      // changes, so give it that moment before the rule is judged.
      await expect
        .poll(
          async () => {
            const x = await recOf(page);
            return x.recordedAt !== null || x.shownTime! - x.pictureAirTime! <= 0.5;
          },
          { timeout: 10_000, message: `at ${t}: no recorded air, and the picture's own air is not exact either` },
        )
        .toBe(true);
      const r = await recOf(page);
      if (r.recordedAt === null) {
        // the 0.4.0 path: only where the picture's own air is as new as anything recorded (a keyframe)
        expect(r.shownTime! - r.pictureAirTime!, `no recorded air at ${t}: the picture's own air is exact (${JSON.stringify(r)})`).toBeLessThanOrEqual(0.5);
        await expect(footer).not.toContainText('recorded');
        continue;
      }
      recorded++;
      const age = r.shownTime! - r.recordedAt;
      expect(r.recordedAt, 'a sample at or before the time shown').toBeLessThanOrEqual(r.shownTime! + 0.5);
      expect(r.recordedAt, "newer than the picture's own air").toBeGreaterThan(r.pictureAirTime! + 0.5);
      expect(age, 'at most one gap behind').toBeLessThanOrEqual(Math.max(2 * spacingS, 1.5 * step));
      await expect(footer).toContainText(/recorded air from \d\d:\d\d/);
      if (age > 90) await expect(footer).toContainText(new RegExp(`\\(${Math.max(1, Math.round(age / 60))} min before the time shown\\)`));
      else await expect(footer).not.toContainText('before the time shown');
      await expect(footer).toBeInViewport();
      await expect(page.getByTestId('slice-cells-note')).toBeHidden();
    }
    expect(recorded, 'most scrubbed pictures read the recording').toBeGreaterThanOrEqual(2);
    // "Show model cells" on a recorded slice: the recording keeps no cells, and says so
    await page.getByTestId('slice-cells').click();
    await expect(page.getByTestId('slice-cells-note')).toHaveText("The recording does not keep the model's own cells, so the smooth picture is shown.");
    await page.getByTestId('slice-cells').click();
    await expect(page.getByTestId('slice-cells-note')).toBeHidden();
  });

  await test.step("a time before the first picture uses the history's air and says so", async () => {
    const { from } = (await recOf(page)).status!;
    const r = await scrubTo(page, Math.max(30, from! - 150));
    expect(r.recordedAt, 'the 0.4.0 slice').toBeNull();
    await expect(footer).not.toContainText('recorded');
    await expect(footer).toContainText(/air from \d\d:\d\d/);
    await expect(status).toHaveText(/^Recorded from \d\d:\d\d\. This time is earlier, so it uses the history's saved air, which can be older\.$/);
  });

  await test.step('the Layers panel says what turning the line or switching the slice off does to the recording', async () => {
    await page.getByTestId('air-close').click();
    await page.getByTestId('layers-fab').click();
    const layers = page.getByTestId('layers-panel');
    await expect(layers.getByTestId('slice-line-hint')).toContainText('Turning the compass or Centre on the fire starts a new line, so its recording is dropped.');
    await expect(layers.getByTestId('cross-section')).toContainText('Switching the slice off clears its recording.');
    await layers.getByRole('button', { name: 'Close' }).click();
    await openAirTool(page);
  });

  await test.step('Swap changes the line, so the old recording is dropped and the status says so', async () => {
    await page.getByTestId('slice-swap').click();
    await expect(status).toContainText('The line changed, so the old recording was dropped.');
    expect((await recOf(page)).status).toMatchObject({ dropped: 'line' });
    expect((await recOf(page)).recordedAt, 'the picture is the 0.4.0 slice again').toBeNull();
    // recording again from the head
    const again = await recordUntil(page, 4, 150);
    expect(again.dropped).toBe('line');
    expect(again.count).toBeGreaterThanOrEqual(4);
    await expect(status).toHaveText(/^The line changed, so the old recording was dropped\. Recording again from \d\d:\d\d( to \d\d:\d\d, (every picture|about every .+))?\.$/);
  });

  await test.step('Clear recording empties the recorder at once, says so, and the line stays', async () => {
    // a picture that reads the new recording, so the clear has something to take away from the slice on screen
    const now0 = (await recOf(page)).status!;
    const shown = await scrubTo(page, insideSpan(now0.from!, now0.to!, 0.5));
    const line = (await sliceOf(page))!.line!;
    await expect(clear).toBeVisible();
    await clear.scrollIntoViewIfNeeded();
    await clear.click();
    await expect(liveRegion(page)).toHaveText('Recording cleared. Recording again from the next picture.');
    await expect(clear).toBeHidden();
    await expect(status).toHaveText(/^Recording cleared\. (Recording starts with the next picture\.|Recording again from \d\d:\d\d\.)/);
    const r = await recOf(page);
    expect(r.status).toMatchObject({ dropped: 'cleared', count: 0 });
    expect(r.recordedAt, `the slice shown (recorded at ${shown.recordedAt}) is a live one again`).toBeNull();
    const now = (await sliceOf(page))!.line!;
    expect(dist(now.a, line.a) + dist(now.b, line.b), 'Clear recording does not move the line').toBeLessThan(0.2);
    await expect(footer).not.toContainText('recorded');
  });

  await test.step('switching the slice off in the Layers panel clears the recording, and nothing popped up on the way', async () => {
    await recordUntil(page, 2, 30);
    expect((await recOf(page)).status!.count).toBeGreaterThanOrEqual(2);
    await page.getByTestId('air-close').click();
    await page.getByTestId('layers-fab').click();
    await page.getByTestId('layers-panel').getByTestId('cross-section').click();
    await expect.poll(() => sliceOf(page)).toBeNull();
    expect((await recOf(page)).status!.count, 'the recording went with the slice').toBe(0);
    await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
    expect(await popups(page), 'nothing pops up by itself').toEqual([]);
  });
}

test('fast tier: Keep this line records the air; scrubbed pictures read it back; Swap drops it; Clear recording empties it', async ({ page }) => {
  test.setTimeout(900_000);
  await watchPopups(page);
  await build(page, 'Fast');
  await expect.poll(() => airKind(page)).toBe('diagnosed');
  await recordFlow(page, 'diagnosed');
});

test('3-D tier: the same recording flow on the time-stepped air', async ({ page }) => {
  test.setTimeout(900_000);
  await watchPopups(page);
  await build(page, 'Normal');
  await ensureKind(page, 'prognostic');
  await recordFlow(page, 'prognostic');
});

test('reduced motion, high contrast, the dark look and the vertical exaggeration', async ({ page }) => {
  test.setTimeout(600_000);
  await build(page, 'Fast');
  await lightScene(page);
  await openAirTool(page);
  await choosePreset(page, 'along');
  const canvas = canvasOf(page);
  await expect(canvas).not.toHaveAttribute('data-seq', '', { timeout: 30_000 });
  await expect(canvas).toHaveAttribute('data-motion', 'streaks');
  const streaks = (await paint(canvas)).sum;
  await expect.poll(async () => (await paint(canvas)).sum, { timeout: 8000, message: 'streaks move' }).not.toBe(streaks);
  // a narrow phone: the six chips are in two rows of three, all inside the screen, and the button that switches the tier is in view
  for (const [w, h] of [[390, 844], [360, 640]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    await page.evaluate(() => ((document.querySelector('.slice-tool-body') as HTMLElement).scrollTop = 0));
    for (const id of ['speed', 'along', 'up', 'across', 'theta', 'smoke']) {
      const b = (await page.getByTestId(`slice-chip-${id}`).boundingBox())!;
      expect(b.x, `${id} at ${w} px`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${id} at ${w} px`).toBeLessThanOrEqual(w);
      expect(b.height).toBeGreaterThanOrEqual(30); // (32 px, in a 44 px row)
    }
    await expect(canvas).toBeInViewport();
    await expect(page.getByTestId('slice-chip-smoke')).toBeInViewport();
    // The placement controls come right after the chips (they were under the notes of the chips that are off and the legend, below the fold): on a
    // 390 x 844 phone both rows of buttons are in view; on a 360 x 640 one the first row is within a short scroll (the window is 230 px: the picture and
    // the chips fill it). The 3-D button comes with the notes after them, a scroll away: a tap on a chip that is off scrolls to it.
    if (w === 390) {
      await expect(page.getByTestId('slice-set-a'), 'Set start is in view on a 390 x 844 phone').toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('slice-presets-toggle'), 'Presets is in view on a 390 x 844 phone').toBeInViewport({ ratio: 1 });
    }
    const lastChip = (await page.getByTestId('slice-chip-smoke').boundingBox())!;
    const setA = (await page.getByTestId('slice-set-a').boundingBox())!;
    expect(setA.y - (lastChip.y + lastChip.height), `Set start follows the chips directly at ${w} px (px between them)`).toBeLessThan(40);
    await page.getByTestId('slice-chip-theta').click({ force: true });
    await expect(page.getByTestId('slice-reasons'), 'a tap on a chip that is off brings its reason into view').toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('slice-use3d'), 'and the 3-D button').toBeInViewport({ ratio: 1 });
    await expect(canvas).toHaveAttribute('data-field', 'speed');
    // Scrolled down to the controls, "Presets, Across the wind" brings the picture back into view (the panel's focus does not scroll it there)
    await page.getByTestId('slice-presets-toggle').evaluate((el) => el.scrollIntoView({ block: 'start' })); // (the controls at the top of the window: the person scrolled down to them)
    const pictureBefore = (await canvas.boundingBox())!;
    expect(pictureBefore.y + pictureBefore.height, 'the picture is scrolled out of view above the controls before the tap').toBeLessThanOrEqual((await page.locator('.slice-tool-body').boundingBox())!.y + 1);
    await choosePreset(page, 'across');
    await expect.poll(async () => (await sliceOf(page))?.preset).toBe('across');
    await expect(canvas, `the picture is in view after a preset tapped from the controls at ${w} px`).toBeInViewport({ ratio: 1 });
    await choosePreset(page, 'along');
    await expect.poll(async () => (await sliceOf(page))?.preset).toBe('along');
    await page.evaluate(() => ((document.querySelector('.slice-tool-body') as HTMLElement).scrollTop = 0));
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(800);
  // reduced motion, switched on while the panel is open: static arrows, a picture that holds still, and back to streaks when it goes
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-motion', 'arrows');
  await expect
    .poll(async () => {
      const a = (await paint(canvas)).sum;
      await page.waitForTimeout(500);
      return a === (await paint(canvas)).sum;
    }, { timeout: 30_000 })
    .toBe(true);
  const still = await paint(canvas);
  expect(still.painted).toBeGreaterThan(0.3);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(canvas).toHaveAttribute('data-motion', 'streaks');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-motion', 'arrows');
  await expect.poll(async () => (await paint(canvas)).sum).toBe(still.sum);
  // high contrast: the root carries data-contrast, the chips get the heavier outline and type, the axis text gets darker, and the picture is redrawn
  const chip = page.getByTestId('slice-chip-speed');
  const normal = await chip.evaluate((e) => ({ border: getComputedStyle(e).borderTopWidth, size: parseFloat(getComputedStyle(e).fontSize) }));
  const lightLabels = (await paint(canvas)).darkest;
  await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
  await expect.poll(() => chip.evaluate((e) => getComputedStyle(e).borderTopWidth)).not.toBe(normal.border);
  const hc = await chip.evaluate((e) => ({ border: getComputedStyle(e).borderTopWidth, size: parseFloat(getComputedStyle(e).fontSize) }));
  expect(parseFloat(hc.border)).toBeGreaterThanOrEqual(2);
  expect(hc.size).toBeGreaterThanOrEqual(normal.size);
  expect(hc.size).toBeGreaterThanOrEqual(14);
  await expect.poll(async () => (await paint(canvas)).darkest, { message: 'the axis text is redrawn darker' }).toBeLessThan(lightLabels);
  await expect(page.getByTestId('slice-footer')).toBeVisible();
  // the dark look (with and without high contrast): the picture is redrawn with the light axis text
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect.poll(async () => (await paint(canvas)).darkest, { message: 'light text on the dark surface' }).toBeGreaterThan(150);
  await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
  await expect.poll(async () => (await paint(canvas)).darkest).toBeGreaterThan(150);
  await expect(page.getByTestId('slice-footer')).toBeVisible();
  const darkChip = await chip.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(darkChip).not.toBe('rgb(255, 255, 255)');
  // the vertical exaggeration of the Layers panel reaches the side view: at x1 the picture is at true scale and the box is only as tall as it
  // needs; at x3 the picture is stretched (fitted to the box) and the caption says so
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByTestId('slice-scale')).toContainText('to the same scale as distance');
  const flat = (await canvas.boundingBox())!.height;
  await page.getByTestId('air-close').click();
  await page.getByTestId('layers-fab').click();
  await page.getByTestId('vertical-exaggeration').evaluate((e: HTMLInputElement) => {
    e.value = '3';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByTestId('layers-panel').getByRole('button', { name: 'Close' }).click();
  await openAirTool(page);
  await expect(canvasOf(page)).not.toHaveAttribute('data-seq', '', { timeout: 30_000 });
  await expect(page.getByTestId('slice-scale')).toContainText(/stretched about/);
  expect((await canvasOf(page).boundingBox())!.height, 'a stretched picture needs more of the box').toBeGreaterThan(flat + 20);
});

test('2-D stand-in map: a placed section line is drawn', async ({ page }) => {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
  const whitePixels = (): Promise<number[]> =>
    page.evaluate(() => {
      const c = document.querySelector('canvas.mock-scene') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = c.width;
      copy.height = c.height;
      const g = copy.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const out: number[] = [];
      for (let k = 0; k < d.length; k += 4) if (d[k]! > 245 && d[k + 1]! > 245 && d[k + 2]! > 245) out.push(k / 4);
      return out;
    });
  const set = async (cs: Record<string, unknown>): Promise<Pt[]> => {
    await page.evaluate((v) => (window as unknown as Handle).__firesim.view.setLayers({ crossSection: v }), cs);
    await page.waitForTimeout(600);
    const px = await whitePixels();
    const w = await page.evaluate(() => (document.querySelector('canvas.mock-scene') as HTMLCanvasElement).width);
    return px.map((i) => [i % w, Math.floor(i / w)] as Pt);
  };
  const off = await set({ enabled: false, azimuth: 0, centre: [0, 0] });
  const extent = (pts: Pt[]): { w: number; h: number } => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const offKeys = new Set(off.map((p) => `${p[0]},${p[1]}`));
  const added = (pts: Pt[]): Pt[] => pts.filter((p) => !offKeys.has(`${p[0]},${p[1]}`));
  // A to B: a hand-placed line, short and in one corner of the map: what is drawn is only that line
  const ab = added(await set({ enabled: true, azimuth: 0, centre: [0, 0], a: [-1500, -1500], b: [-500, -1000], preset: null }));
  expect(ab.length, 'the A to B line is drawn').toBeGreaterThan(40);
  const abBox = extent(ab);
  expect(Math.max(abBox.w, abBox.h)).toBeLessThan(450); // not the chord through the centre
  // a preset: a long line through the map centre
  const along = added(await set({ enabled: true, azimuth: 0, centre: [0, 0], a: undefined, b: undefined, preset: 'along' }));
  expect(along.length, 'the preset line is drawn').toBeGreaterThan(100);
  expect(Math.max(extent(along).w, extent(along).h), 'a preset runs far across the map').toBeGreaterThan(Math.max(abBox.w, abBox.h) * 1.5);
  // put back on the centre rule (a, b and preset cleared): the chord along the azimuth, a different line from the preset's
  const chord = added(await set({ enabled: true, azimuth: 0, centre: [0, 0], a: undefined, b: undefined, preset: null }));
  expect(chord.length).toBeGreaterThan(100);
  expect(extent(chord).h, 'azimuth 0: the chord runs north to south').toBeGreaterThan(extent(chord).w * 3);
});
