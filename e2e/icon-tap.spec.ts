/**
 * Tapping an icon on the map (workstream I of docs/plans/air-slice-wind-detail-honest-speed.md, section 9e): the Why here?
 * panel opens with a row at the top that shows the icon as the map draws it, its name and one line of detail, and it asks
 * about the icon's own spot, not about wherever the finger's ray meets the ground. A tap beside an icon is a plain ground tap.
 *
 * `?debug=1` exposes window.__firesim; the specs find an icon with `projectToScreen` (a pin stands above its tip, so a tap
 * "on the icon" is half the pin's height above the projected point), and read the view's own `pickMarker` and `pickGround`
 * to say what the tap should have found. First on the 2-D mock map (fast), then on the real engine and the 3-D view.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, pickTool, popups, session, setSpeed, watchPopups } from './helpers';

type Pt = [number, number];
/** What `view.pickMarker` returns, as far as the specs read it. */
interface Picked {
  kind: string;
  x: number;
  y: number;
  others: number;
  insight?: { title: string };
}
interface Handle {
  view: {
    projectToScreen(x: number, y: number): Pt | null;
    pickGround(x: number, y: number): Pt | null;
    pickMarker?(x: number, y: number): Picked | null;
    flyTo(x: number, y: number, d: number): void;
    setLayers(p: Record<string, unknown>): void;
  };
  scenario: { terrain: { grid: { x0: number; y0: number; nx: number; ny: number; cellSize: number } }; context?: { homes: Float32Array } | null };
  session: {
    state: { get(): { ignitions: { points: Pt[] }[]; forecastInsights: unknown[] } };
    mapInsights(): { x: number; y: number; time: number; title: string; kind: string; severity: string }[];
  };
}
/** The debug handle, as the page sees it (every page.evaluate below writes the cast inline: its body runs in the browser). */
type W = { __firesim: Handle };

/** Half the ignition pin's height (34 px): the picture's centre stands this far above the tip, which is the projected point. */
const PIN_HALF = 17;

/** The projected point of a ground spot, once the camera has settled (two reads 250 ms apart agree). */
async function settled(page: Page, x: number, y: number): Promise<Pt> {
  let last: Pt | null = null;
  let found: Pt | null = null;
  await expect
    .poll(
      async () => {
        const p = await page.evaluate(([px, py]) => (window as unknown as W).__firesim.view.projectToScreen(px!, py!), [x, y]);
        const ok = !!p && !!last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5;
        if (ok) found = p;
        last = p;
        return ok;
      },
      { timeout: 20_000, intervals: [250] },
    )
    .toBe(true);
  return found!;
}

const pickMarkerAt = (page: Page, p: Pt): Promise<Picked | null> => page.evaluate(([px, py]) => (window as unknown as W).__firesim.view.pickMarker?.(px!, py!) ?? null, p);
const pickGroundAt = (page: Page, p: Pt): Promise<Pt | null> => page.evaluate(([px, py]) => (window as unknown as W).__firesim.view.pickGround(px!, py!), p);

/** The marked fire's own spot (the first ignition of the session). */
const markedPoint = (page: Page): Promise<Pt> => page.evaluate(() => (window as unknown as W).__firesim.session.state.get().ignitions[0]!.points[0]!);

/** Mark a fire at the crosshair (the gloved-hand path) and close the panel; `aim` moves the camera once the panel is open. */
async function markFire(page: Page, aim?: () => Promise<void>): Promise<void> {
  await pickTool(page, 'fire');
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await aim?.();
  await page.getByTestId('use-crosshair').click();
  await expect(page.getByTestId('confirm-fire')).toBeInViewport();
  await page.getByTestId('confirm-fire').click();
  await expect(page.getByTestId('fire-panel')).toContainText('Marked');
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect(page.getByTestId('fire-panel')).toHaveCount(0);
}

/** Where the Why ring is drawn, in page coordinates (null when it is not on the map). */
async function ringAt(page: Page): Promise<Pt | null> {
  const t = await page.locator('.annotations .ann-why').first().getAttribute('transform', { timeout: 2000 }).catch(() => null);
  const m = t ? /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(t) : null;
  const box = await page.getByTestId('scene').boundingBox();
  return m && box ? [box.x + Number(m[1]), box.y + Number(m[2])] : null;
}

async function setUp(page: Page, url: string, real: boolean): Promise<void> {
  await watchPopups(page);
  await page.goto(url);
  await expect(page.getByTestId('training-badge')).toBeVisible();
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  if (real) {
    await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
    await page.getByTestId('preset-hot-nw-sw-change').click();
    const online = page.getByTestId('online').getByRole('switch');
    if (await online.isChecked()) await page.getByTestId('online').click(); // fully offline: bundled demo data only
  }
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await armPopupWatch(page);
}

test('2-D map: tap an ignition icon and the Why here? panel opens with its row; 60 px away there is none', async ({ page }) => {
  await setUp(page, '/?mock=1&debug=1&theme=light', false);
  await markFire(page);
  const ig = await markedPoint(page);
  const icon = await settled(page, ig[0], ig[1]);
  // What the map says is under the finger (another icon may lie close by on the mock map: then the row says so).
  const hit = await pickMarkerAt(page, icon);
  expect(hit).toMatchObject({ kind: 'ignition', x: ig[0], y: ig[1] });

  await page.mouse.click(icon[0], icon[1]);
  const why = page.getByTestId('why-panel');
  await expect(why).toBeVisible();
  const row = page.getByTestId('why-marker');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-kind', 'ignition');
  await expect(row).toContainText('Ignition point');
  await expect(row).toContainText('Fire you marked, lit at');
  await expect(row.locator('img.why-marker-pic')).toHaveAttribute('aria-hidden', 'true');
  if (hit!.others > 0) await expect(page.getByTestId('why-marker-more')).toContainText(`+${hit!.others} more`);
  else await expect(page.getByTestId('why-marker-more')).toHaveCount(0);

  // 60 px beside the icon is the ground: no row, the ordinary explanation.
  const beside = await settled(page, ig[0], ig[1]);
  const away: Pt = [beside[0] + 60, beside[1]];
  expect(await pickMarkerAt(page, away)).toBeNull();
  await page.mouse.click(away[0], away[1]);
  await expect(page.locator('.why-place, .narrative li').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('why-marker')).toHaveCount(0);

  expect(await popups(page)).toEqual([]);
});

test('real engine, 3-D view: tap the ignition pin, an insight marker, the ground beside them; the other tools keep the ground', async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  await setUp(page, '/?debug=1', true);

  // ── Mark a fire on the escarpment, at the crosshair (the view centres the fly-to in the map above the open panel) ──
  await markFire(page, async () => {
    await page.evaluate(() => (window as unknown as W).__firesim.view.flyTo(-2170, 900, 2500));
    await page.waitForTimeout(1500);
  });
  const ig = await markedPoint(page);
  await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.flyTo(x!, y!, 2500), ig);

  // ── Tap the pin: on its body, allowing for the pin standing above its tip ──
  const anchor = await settled(page, ig[0], ig[1]);
  const body: Pt = [anchor[0], anchor[1] - PIN_HALF];
  const found = await pickMarkerAt(page, body);
  expect(found, 'the view finds the ignition pin at the centre of its picture').toMatchObject({ kind: 'ignition', x: ig[0], y: ig[1] });
  // The finger's ray meets the ground well away from the pin's tip (the pin stands above it): that is the old behaviour.
  const ray = await pickGroundAt(page, body);
  expect(ray).not.toBeNull();
  expect(Math.hypot(ray![0] - ig[0], ray![1] - ig[1])).toBeGreaterThan(5);

  await page.mouse.click(body[0], body[1]);
  const why = page.getByTestId('why-panel');
  await expect(why).toBeVisible();
  const row = page.getByTestId('why-marker');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-kind', 'ignition');
  await expect(row).toContainText('Ignition point');
  await expect(row).toContainText('Fire you marked, lit at');
  await expect(row.locator('img.why-marker-pic')).toHaveAttribute('src', /^data:image\/png/);
  await expect(row.locator('.why-marker-pic')).toHaveAttribute('aria-hidden', 'true');
  // The row is the first thing in the panel, in the loading state and when the explanation is there.
  await expect(why.locator('.panel-body > :first-child')).toHaveAttribute('data-testid', 'why-marker');
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 60_000 });
  await expect(why.locator('.panel-body > :first-child')).toHaveAttribute('data-testid', 'why-marker');

  // The ring jumped onto the icon's own spot (the pin's tip), not onto the ground under the finger.
  await expect
    .poll(
      async () => {
        const [ring, tip] = [await ringAt(page), await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.projectToScreen(x!, y!), ig)];
        return ring && tip ? Math.hypot(ring[0] - tip[0], ring[1] - tip[1]) : Infinity;
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(3);
  const shot = testInfo.outputPath('why-icon-row.png');
  await page.screenshot({ path: shot });
  await testInfo.attach('why-icon-row', { path: shot, contentType: 'image/png' });

  // ── The tip counts too; 30 px below the tip does not ──
  const tip = await settled(page, ig[0], ig[1]);
  expect(await pickMarkerAt(page, tip)).toMatchObject({ kind: 'ignition' });
  expect(await pickMarkerAt(page, [tip[0], tip[1] + 30])).toBeNull();

  // ── Tap 60 px away from the icon: the ground, no row, the ordinary explanation ──
  const centre: Pt = [tip[0], tip[1] - PIN_HALF];
  const away: Pt = [centre[0] + 60, centre[1]];
  expect(await pickMarkerAt(page, away)).toBeNull();
  await page.mouse.click(away[0], away[1]);
  await expect(page.getByTestId('why-marker')).toHaveCount(0);
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 60_000 });
  const ground = await pickGroundAt(page, away);
  expect(ground).not.toBeNull();
  await expect
    .poll(async () => {
      const ring = await ringAt(page);
      return ring ? Math.hypot(ring[0] - away[0], ring[1] - away[1]) : Infinity;
    })
    .toBeLessThan(4); // the ring is where the finger was: ground behaviour
  await why.getByRole('button', { name: 'Close' }).click();
  await expect(why).toBeHidden();

  // ── The other tools keep the ground: the pending mark lands under the finger, not on the pin's tip ──
  await pickTool(page, 'fire');
  await expect(page.getByTestId('fire-panel')).toBeVisible();
  await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.flyTo(x!, y!, 2500), ig); // centre it in the map above the panel
  await page.waitForTimeout(1500);
  const anchor2 = await settled(page, ig[0], ig[1]);
  const body2: Pt = [anchor2[0], anchor2[1] - PIN_HALF];
  expect(await pickMarkerAt(page, body2)).toMatchObject({ kind: 'ignition' }); // an icon is there, and the fire tool ignores it
  const underFinger = await pickGroundAt(page, body2); // the ground point the fire tool takes
  expect(underFinger).not.toBeNull();
  await page.mouse.click(body2[0], body2[1]);
  await expect(page.getByTestId('confirm-fire')).toBeVisible();
  await expect(page.getByTestId('why-marker')).toHaveCount(0);
  await expect(page.getByTestId('why-panel')).toHaveCount(0);
  const pin = page.locator('.annotations .ann-pin').first();
  await expect(pin).toBeAttached();
  // The pending mark stands on that ground point and not on the pin's tip. (The confirm bar that appears under the panel's
  // controls can shift the map a little, so compare in the view as it is now, not with where the finger was.)
  const pendingAt = async (): Promise<Pt> => {
    const box = await page.getByTestId('scene').boundingBox();
    const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec((await pin.getAttribute('transform')) ?? '');
    return [box!.x + Number(m![1]), box!.y + Number(m![2])];
  };
  const screenOf = (g: Pt): Promise<Pt | null> => page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.projectToScreen(x!, y!), g);
  await expect
    .poll(
      async () => {
        const [a, b] = [await pendingAt(), await screenOf(underFinger!)];
        return b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity;
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(3);
  const [pendingNow, tipNow] = [await pendingAt(), await screenOf(ig)];
  expect(Math.hypot(pendingNow[0] - tipNow![0], pendingNow[1] - tipNow![1])).toBeGreaterThan(10);
  await page.getByTestId('fire-panel').getByRole('button', { name: 'Close tool' }).click();
  await expect(page.getByTestId('fire-panel')).toHaveCount(0);

  // ── Homes: with the layer on a house is an icon too (a tight radius); with it off the tap is the ground's ──
  const home = await page.evaluate(() => {
    const sc = (window as unknown as W).__firesim.scenario;
    const homes = sc.context?.homes;
    const g = sc.terrain.grid;
    const [x0, x1] = [g.x0 + 600, g.x0 + (g.nx - 1) * g.cellSize - 600];
    const [y0, y1] = [g.y0 + 600, g.y0 + (g.ny - 1) * g.cellSize - 600];
    // the places data may reach beyond the terrain: take a house well inside it, where the camera can look at it
    for (let i = 0; homes && i + 1 < homes.length; i += 2) if (homes[i]! > x0 && homes[i]! < x1 && homes[i + 1]! > y0 && homes[i + 1]! < y1) return [homes[i]!, homes[i + 1]!] as Pt;
    return null;
  });
  expect(home, 'the Katoomba demo has homes inside its terrain').not.toBeNull();
  await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.flyTo(x!, y!, 800), home!);
  await page.waitForTimeout(1500);
  const house = await settled(page, home![0], home![1]);
  expect((await pickMarkerAt(page, house))?.kind).not.toBe('home'); // the Homes layer is off: houses are not icons
  await page.evaluate(() => (window as unknown as W).__firesim.view.setLayers({ homes: true }));
  expect(await pickMarkerAt(page, house)).toMatchObject({ kind: 'home' });
  await page.mouse.click(house[0], house[1]);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-kind', 'home');
  await expect(row.locator('.why-marker-name')).toHaveText('Home');
  await expect(row.locator('.why-marker-detail')).toHaveText('One marker per address');
  await expect(row.locator('.why-marker-pic svg')).toBeVisible(); // the UI house, not a picture from the map's atlas
  await expect(row.locator('.why-marker-pic')).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => (window as unknown as W).__firesim.view.setLayers({ homes: false }));
  await why.getByRole('button', { name: 'Close' }).click();
  await expect(why).toBeHidden();

  // ── Play until a fire card is on the map, pause, tap its marker ──
  await setSpeed(page, Infinity);
  await page.getByTestId('play').click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const fs = (window as unknown as W).__firesim;
          const forecast = new Set(fs.session.state.get().forecastInsights);
          return fs.session.mapInsights().filter((i) => !forecast.has(i)).length;
        }),
      { timeout: 180_000, intervals: [1000] },
    )
    .toBeGreaterThan(0);
  await page.getByTestId('play').click();
  await expect.poll(async () => (await session(page)).playing).toBe(false);
  const card = await page.evaluate(() => {
    const fs = (window as unknown as W).__firesim;
    const forecast = new Set(fs.session.state.get().forecastInsights);
    const i = fs.session.mapInsights().filter((c) => !forecast.has(c))[0]!;
    return { x: i.x, y: i.y, time: i.time };
  });
  await page.evaluate(([x, y]) => (window as unknown as W).__firesim.view.flyTo(x!, y!, 1500), [card.x, card.y]);
  const marker = await settled(page, card.x, card.y);
  const hit = await pickMarkerAt(page, marker);
  expect(hit, 'the view finds an insight marker where the card is').toMatchObject({ kind: 'insight' });
  await page.mouse.click(marker[0], marker[1]);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-kind', 'insight');
  await expect(row.locator('.why-marker-name')).toHaveText(/^(Danger|Watch out|Insight): \S/);
  await expect(row.locator('.why-marker-detail')).toHaveText(hit!.insight!.title);
  if (hit!.others > 0) await expect(page.getByTestId('why-marker-more')).toHaveText(`+${hit!.others} more ${hit!.others === 1 ? 'icon' : 'icons'} here, zoom in to tell them apart`);
  else await expect(page.getByTestId('why-marker-more')).toHaveCount(0);
  await expect(why.locator('.narrative li').first()).toBeVisible({ timeout: 60_000 });

  // ── The clock goes back before the card existed: its row goes (the panel is still about the spot) ──
  if (card.time > 1) {
    await page.getByTestId('time-btn').click();
    await page.getByTestId('time-start').click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await session(page)).viewTime).toBe(0);
    await expect(page.getByTestId('why-marker')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('why-panel')).toBeVisible();
  }

  // Nothing popped up at any point.
  expect(await popups(page)).toEqual([]);
});
