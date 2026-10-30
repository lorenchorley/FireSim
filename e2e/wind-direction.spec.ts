/**
 * The Wind direction tool (0.6.0 item 4), mock engine (?mock=1). It asserts what the UI itself does: the tool's name and its
 * lack of any map placement, the dial, the When choices and the status lines, Apply (the edit in `session.state.edits`, the list
 * entry, the announcement), a change that is under way and done, Remove, the "At a time" field and its messages, the note for a
 * person who is viewing the past, and the layout at three phone sizes. The mock engine and the simulation engine decide what the
 * wind then DOES to the fire; that is for the simulation's own tests, and the chip is checked against the wind the session
 * reports (`windWeather()`), so it also turns by itself once the engine applies the change.
 * Needs the production build (`npx playwright test` builds and serves it).
 */
import type { Locator, Page } from '@playwright/test';
import { compassName } from '../src/core/units';
import { WIND_TURN_S } from '../src/scenario/windDirection';
import { expect, test } from './fixtures';
import { acceptNotice, armPopupWatch, jumpWithPopover, openMenu, pickTool, popups, scenarioDuration, tapTimeline, waitForSeekEnd, watchPopups } from './helpers';

async function buildMock(page: Page): Promise<void> {
  await page.goto('/?mock=1&theme=light');
  await acceptNotice(page);
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 60_000 });
}

interface WindState {
  viewTime: number;
  headTime: number;
  playing: boolean;
  reviewing: boolean;
  /** The Wind direction changes of `state.edits`, with the time the entry is stored at. */
  edits: { id: string; dir: number; time: number; entryTime: number }[];
}

const windState = (page: Page): Promise<WindState> =>
  page.evaluate(() => {
    type Edit = { edit: { kind: string; id: string; dir?: number; time?: number }; time: number };
    const s = (window as unknown as { __firesim: { session: { state: { get(): { viewTime: number; headTime: number; playing: boolean; reviewing: boolean; edits: Edit[] } } } } }).__firesim.session.state.get();
    return {
      viewTime: s.viewTime,
      headTime: s.headTime,
      playing: s.playing,
      reviewing: s.reviewing,
      edits: s.edits.filter((e) => e.edit.kind === 'windDirection').map((e) => ({ id: e.edit.id, dir: e.edit.dir ?? NaN, time: e.edit.time ?? NaN, entryTime: e.time })),
    };
  });

/** The clock ("14:41") the app shows for a simulation time, in the scenario's own time zone. */
async function clockAt(page: Page, t: number): Promise<string> {
  const sc = await page.evaluate(() => (window as unknown as { __firesim: { scenario: { startTime: number; weather: { timezone?: string } } } }).__firesim.scenario);
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: sc.weather.timezone || 'Australia/Sydney' }).format(new Date(sc.startTime + t * 1000));
}

/**
 * The 10 m wind direction (from) at a simulation time (default the view time) in the forecast, or in the wind the session reports (the
 * forecast with the changes), and how many stamps that series has.
 */
async function seriesDir(page: Page, which: 'forecast' | 'changed', at?: number): Promise<{ dir: number; stamps: number }> {
  return page.evaluate(([w, when]) => {
    type Hour = { time: number; windSpeed10: number; windDir10: number };
    const fs = (window as unknown as { __firesim: { scenario: { startTime: number; weather: { hours: Hour[] } }; session: { windWeather(): { hours: Hour[] }; state: { get(): { viewTime: number } } } } }).__firesim;
    const hours = w === 'forecast' ? fs.scenario.weather.hours : fs.session.windWeather().hours;
    const t = fs.scenario.startTime + (when ?? fs.session.state.get().viewTime) * 1000;
    let i = 0;
    while (i < hours.length - 2 && hours[i + 1]!.time <= t) i++;
    const a = hours[Math.min(i, hours.length - 1)]!;
    const b = hours[Math.min(i + 1, hours.length - 1)]!;
    const f = b.time === a.time ? 0 : Math.min(1, Math.max(0, (t - a.time) / (b.time - a.time)));
    // Vector interpolation of the wind, as ui/weatherSeries.ts does (the wind comes FROM dir: u, v are where it blows to).
    const uv = (h: Hour): [number, number] => [-h.windSpeed10 * Math.sin((h.windDir10 * Math.PI) / 180), -h.windSpeed10 * Math.cos((h.windDir10 * Math.PI) / 180)];
    const [ua, va] = uv(a);
    const [ub, vb] = uv(b);
    const u = ua + (ub - ua) * f;
    const v = va + (vb - va) * f;
    const dir = Math.hypot(u, v) > 1e-6 ? (((Math.atan2(-u, -v) * 180) / Math.PI) % 360 + 360) % 360 : a.windDir10;
    return { dir, stamps: hours.length };
  }, [which, at ?? null] as const);
}

/** The probe points (21 px each way from the centre, 15 px on the diagonals) that land on something other than the control: a hit area under 44 x 44 px, as scripts/audit-tap-targets.mjs measures it. */
const hitArea = (loc: Locator): Promise<string[]> =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const missed: string[] = [];
    for (const [dx, dy] of [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]] as const) {
      const hit = document.elementFromPoint(r.left + r.width / 2 + dx, r.top + r.height / 2 + dy);
      if (!(hit && (el === hit || el.contains(hit)))) missed.push(`${dx},${dy}`);
    }
    return missed;
  });
const liveRegion = (page: Page) => page.locator('div.sr-only[aria-live="polite"]');
const chipDir = (page: Page) => page.getByTestId('weather-chip').locator('.wx-dir');
const dialValue = async (page: Page): Promise<number> => Number(await page.getByTestId('wind-dial').getAttribute('aria-valuenow'));
const choose = (page: Page, label: string) => page.getByTestId('wind-when').getByRole('radio', { name: label }).check();
const STARTS = /^Starts turning at (\d\d:\d\d) and reaches ([A-Z]+) \((\d+)°\) by (\d\d:\d\d)\.$/;

test('the tool is called Wind direction and has no map placement: a dial, when, a status, Apply, the list and the announcement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await watchPopups(page);
  await buildMock(page);
  await armPopupWatch(page);

  // The Tools menu names it, and the panel has the same title.
  await openMenu(page, 'tools');
  await expect(page.getByTestId('tool-wind')).toContainText('Wind direction');
  await page.keyboard.press('Escape');
  await pickTool(page, 'wind');
  const panel = page.getByTestId('wind-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Wind direction' })).toBeVisible();

  // It is for the whole scenario: no crosshair, no "place at", no speed or radius sliders, nothing to tap on the map.
  await expect(page.locator('.crosshair')).toBeHidden();
  await expect(page.getByTestId('use-crosshair')).toHaveCount(0);
  await expect(panel.locator('input[type=range]')).toHaveCount(0);
  await expect(panel).not.toContainText(/crosshair|At my position|Applies within/i);
  await expect(panel).toContainText('Choose where the wind comes from. It turns over 15 minutes and then holds that direction');
  await expect(panel).toContainText('Wind speed stays as forecast.');

  // The dial opens at the direction the wind has now (to 5 degrees); Page Up turns it by 45 degrees.
  const dial = page.getByTestId('wind-dial');
  const forecast = (await seriesDir(page, 'forecast')).dir;
  const opened = await dialValue(page);
  expect(opened % 5).toBe(0);
  expect(Math.abs(((opened - forecast + 540) % 360) - 180)).toBeLessThanOrEqual(3); // within 3 degrees of the forecast direction
  await dial.focus();
  await page.keyboard.press('PageUp');
  expect(await dialValue(page)).toBe((opened + 45) % 360);
  await expect(dial).toHaveAttribute('aria-label', 'Wind comes from. Drag the arrow, or use the arrow keys.');
  const chosen = await dialValue(page);
  await expect(page.getByTestId('apply-wind')).toHaveText(`Turn wind to ${compassName(chosen)}`);

  // "In 10 min": the status says where the turn starts and ends (a whole minute, 15 minutes apart).
  const view = (await windState(page)).viewTime;
  const start = Math.ceil((view + 600) / 60) * 60;
  await choose(page, 'In 10 min');
  const status = page.getByTestId('wind-status');
  await expect(status.locator('p').first()).toHaveText(/^Before the change: from [A-Z]+ \(\d+°\)\.$/);
  await expect(status.locator('p').nth(1)).toHaveText(STARTS);
  await expect(status.locator('p').nth(1)).toHaveText(`Starts turning at ${await clockAt(page, start)} and reaches ${compassName(chosen)} (${chosen}°) by ${await clockAt(page, start + WIND_TURN_S)}.`);
  await expect(page.getByTestId('wind-list').locator('li')).toHaveCount(0);

  // Apply: one change in the session, one line in the list, the announcement; the panel stays open with its choices.
  await page.getByTestId('apply-wind').click();
  const s = await windState(page);
  expect(s.edits).toHaveLength(1);
  expect(s.edits[0]!.time % 60).toBe(0);
  expect(s.edits[0]!.time).toBe(start);
  expect(s.edits[0]!.entryTime).toBe(start);
  expect(s.edits[0]!.dir).toBe(chosen);
  const item = page.getByTestId('wind-list').locator('li');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveText(`Wind from ${compassName(chosen)} · starts ${await clockAt(page, start)} (in 10 min)`);
  const removeBtn = page.getByTestId('remove-wind-direction');
  await expect(removeBtn).toHaveAccessibleName(`Remove the wind change to ${compassName(chosen)} at ${await clockAt(page, start)}`);
  await removeBtn.scrollIntoViewIfNeeded();
  expect(await hitArea(removeBtn)).toEqual([]);
  await expect(liveRegion(page)).toHaveText(
    `Wind direction change set. The wind turns to come from ${compassName(chosen)}, starting at ${await clockAt(page, start)} and done by ${await clockAt(page, start + WIND_TURN_S)}.`,
  );
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('wind-when').getByRole('radio', { name: 'In 10 min' })).toBeChecked();
  // The status now counts the change as "before": the next one starts from where this one will have turned the wind.
  await choose(page, 'In 1 h');
  const later = await seriesDir(page, 'changed', Math.ceil((view + 3600) / 60) * 60); // where "In 1 h" starts the next change
  const laterDeg = Math.round(later.dir) % 360;
  await expect(status.locator('p').first()).toHaveText(`Before the change: from ${compassName(laterDeg)} (${laterDeg}°).`);
  if (later.stamps > (await seriesDir(page, 'forecast')).stamps) expect(laterDeg).toBe(chosen); // the engine applies it: this change has turned the wind by then

  expect(await popups(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a change that is done says so, the top bar follows the wind the session reports, and Remove takes it away', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await watchPopups(page);
  await buildMock(page);
  await armPopupWatch(page);

  await pickTool(page, 'wind');
  const dial = page.getByTestId('wind-dial');
  await dial.focus();
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp'); // a quarter turn from where the wind is
  const to = await dialValue(page);
  await choose(page, 'In 10 min');
  await page.getByTestId('apply-wind').click();
  const made = (await windState(page)).edits[0]!;
  expect(made.time % 60).toBe(0);
  const item = page.getByTestId('wind-list').locator('li');
  await expect(item).toContainText('starts');

  // Go past the end of the turn (a jump: the mock engine computes it at once).
  const past = made.time + WIND_TURN_S + 600;
  await jumpWithPopover(page, past);
  await waitForSeekEnd(page);
  await expect.poll(async () => (await windState(page)).viewTime).toBe(past);
  await expect(item).toHaveText(`Wind from ${compassName(to)} · done at ${await clockAt(page, made.time + WIND_TURN_S)}`);

  // Back to the middle of the turn: the same change reads "turning".
  await tapTimeline(page, made.time + WIND_TURN_S / 2);
  await expect.poll(async () => Math.abs((await windState(page)).viewTime - (made.time + WIND_TURN_S / 2))).toBeLessThan(200);
  await expect(item).toHaveText(`Wind from ${compassName(to)} · turning, done by ${await clockAt(page, made.time + WIND_TURN_S)}`);

  // The chip is the wind the session reports at the view time (the forecast with the change in it).
  await jumpWithPopover(page, past);
  await waitForSeekEnd(page);
  await expect.poll(async () => (await windState(page)).viewTime).toBe(past);
  const changed = await seriesDir(page, 'changed');
  await expect(chipDir(page)).toHaveText(compassName(changed.dir));
  const forecastStamps = (await seriesDir(page, 'forecast')).stamps;
  if (changed.stamps > forecastStamps) {
    // The engine applies the change (applyWindDirection is real): the wind has turned all the way to the new direction.
    await expect(chipDir(page)).toHaveText(compassName(to));
    expect(Math.abs(((changed.dir - to + 540) % 360) - 180)).toBeLessThanOrEqual(1);
  } else test.info().annotations.push({ type: 'wind-engine', description: 'applyWindDirection is still the C0 stub: only the chip reading windWeather() was checked' });

  // Remove: the list empties, the session has no change, the chip reads the forecast again, and the announcement says it.
  const before = await windState(page);
  await page.getByTestId('remove-wind-direction').click();
  await expect(item).toHaveCount(0);
  expect((await windState(page)).edits).toHaveLength(0);
  const after = await seriesDir(page, 'changed');
  expect(after.stamps).toBe(forecastStamps);
  await expect(chipDir(page)).toHaveText(compassName((await seriesDir(page, 'forecast')).dir));
  await expect(liveRegion(page)).toHaveText(
    before.headTime > made.time ? `Wind change removed. The simulation re-runs from ${await clockAt(page, made.time)} without it.` : 'Wind change removed.',
  );
  expect(before.headTime).toBeGreaterThan(made.time);

  expect(await popups(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('"At a time": an empty field, a time that has passed and a time that is not in the scenario say so; a good time is applied', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buildMock(page);
  const D = await scenarioDuration(page);

  // Look at 30 minutes in, so there is a "before now" inside the scenario.
  await jumpWithPopover(page, 1800);
  await waitForSeekEnd(page);
  await expect.poll(async () => (await windState(page)).viewTime).toBe(1800);
  await pickTool(page, 'wind');
  const panel = page.getByTestId('wind-panel');
  const field = page.getByTestId('wind-time');
  const msg = page.getByTestId('wind-time-msg');
  const apply = page.getByTestId('apply-wind');
  await expect(field).toBeHidden();
  await choose(page, 'At a time');
  await expect(field).toBeVisible();
  await expect(panel.getByText('Local time')).toBeVisible();
  await expect(field).toHaveAccessibleName(/^Local time/);
  await expect(field).toHaveValue(await clockAt(page, 1800 + 600)); // the "Now" start plus 10 minutes
  await expect(apply).toBeEnabled();
  await expect(msg).toBeHidden();

  await field.fill('');
  await expect(msg).toHaveText('Enter a time such as 14:35.');
  await expect(msg).toHaveAttribute('role', 'status');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', (await msg.getAttribute('id'))!);
  await expect(apply).toBeDisabled();
  await expect(msg).toBeInViewport(); // the reason is on screen, not left under the fold

  await field.fill(await clockAt(page, 600)); // before the view time
  await expect(msg).toHaveText(`That time has passed. Choose a time after ${await clockAt(page, 1800)}.`);
  await expect(apply).toBeDisabled();

  await field.fill(await clockAt(page, D + 3 * 3600)); // after the end (or the same clock on another day: not in the scenario)
  await expect(msg).toContainText(/not in this scenario|The last time you can choose|has passed/);
  await expect(apply).toBeDisabled();

  await field.fill(await clockAt(page, 3600));
  await expect(msg).toBeHidden();
  await expect(field).toHaveAttribute('aria-invalid', 'false');
  await expect(apply).toBeEnabled();
  await expect(page.getByTestId('wind-status').locator('p').nth(1)).toHaveText(new RegExp(`^Starts turning at ${await clockAt(page, 3600)} and reaches `));
  await apply.click();
  const made = (await windState(page)).edits;
  expect(made).toHaveLength(1);
  expect(made[0]!.time).toBe(3600);
  await expect(page.getByTestId('wind-list').locator('li')).toContainText(`starts ${await clockAt(page, 3600)}`);

  // A time before the first change counts the first change as "before": Enter in the field applies a second one.
  await field.fill(await clockAt(page, 5400));
  await field.press('Enter');
  await expect(page.getByTestId('wind-list').locator('li')).toHaveCount(2);
  expect((await windState(page)).edits.map((e) => e.time)).toEqual([3600, 5400]);

  expect(errors).toEqual([]);
});

test('viewing the past: the note shows, and applying cuts what was computed back to the view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buildMock(page);

  await jumpWithPopover(page, 3600);
  await waitForSeekEnd(page);
  await expect.poll(async () => (await windState(page)).viewTime).toBe(3600);
  await tapTimeline(page, 1200);
  await expect.poll(async () => Math.abs((await windState(page)).viewTime - 1200)).toBeLessThan(200);
  const back = await windState(page);
  expect(back.reviewing).toBe(true);
  expect(back.headTime).toBeGreaterThanOrEqual(3600);

  await pickTool(page, 'wind');
  const note = page.getByTestId('wind-reviewing');
  await expect(note).toBeVisible();
  await expect(note).toHaveText(`You are viewing ${await clockAt(page, back.viewTime)}. Applying re-runs the simulation from then.`);
  await page.getByTestId('apply-wind').click();
  const after = await windState(page);
  expect(after.edits).toHaveLength(1);
  expect(after.edits[0]!.time).toBeGreaterThanOrEqual(back.viewTime);
  expect(after.edits[0]!.time).toBeLessThan(back.viewTime + 60);
  expect(after.headTime).toBeLessThan(3600); // what was computed after the view was dropped
  expect(after.headTime).toBeLessThanOrEqual(after.viewTime + 600);
  await expect(note).toBeHidden();

  expect(errors).toEqual([]);
});

/** The panel at a phone size: Apply on screen and a tap target, the dial whole when it opens, the time field within reach, nothing too small, nothing wider than the screen. */
for (const [width, height] of [
  [360, 640],
  [412, 915],
  [844, 390],
] as const) {
  test(`layout at ${width}x${height}: Apply, the dial and the time field are all within reach and every control is a tap target`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await watchPopups(page);
    await buildMock(page);
    await armPopupWatch(page);
    await pickTool(page, 'wind');
    const panel = page.getByTestId('wind-panel');
    await expect(panel).toBeVisible();
    await page.waitForTimeout(600); // the panel slides in, and the layout settles after it

    const geometry = (): Promise<{ apply: DOMRect; dial: DOMRect; readout: DOMRect; body: DOMRect; scrollW: number; innerW: number; innerH: number }> =>
      page.evaluate(() => {
        const q = (id: string): HTMLElement => document.querySelector(`[data-testid=${id}]`) as HTMLElement;
        const body = q('wind-panel').querySelector('.panel-body') as HTMLElement;
        const readout = q('wind-panel').querySelector('.rose-readout-text') as HTMLElement;
        const box = (e: HTMLElement): DOMRect => e.getBoundingClientRect().toJSON();
        return { apply: box(q('apply-wind')), dial: box(q('wind-dial')), readout: box(readout), body: box(body), scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight };
      });

    // On open: Apply is on screen and at least 44 px high, the dial (and its read-out) is whole inside the scrolling body, nothing is wider than the screen.
    const g = await geometry();
    expect(g.apply.top).toBeGreaterThanOrEqual(0);
    expect(g.apply.bottom).toBeLessThanOrEqual(g.innerH);
    expect(g.apply.left).toBeGreaterThanOrEqual(0);
    expect(g.apply.right).toBeLessThanOrEqual(g.innerW);
    expect(g.apply.height).toBeGreaterThanOrEqual(44);
    expect(g.dial.top).toBeGreaterThanOrEqual(g.body.top - 0.5);
    expect(g.dial.bottom).toBeLessThanOrEqual(g.body.bottom + 0.5);
    expect(g.readout.bottom).toBeLessThanOrEqual(g.body.bottom + 0.5);
    expect(g.dial.width).toBeGreaterThanOrEqual(44);
    expect(g.scrollW).toBeLessThanOrEqual(g.innerW);

    // "At a time": the field is reached by scrolling the body alone, Apply stays where it was.
    await choose(page, 'At a time');
    const field = page.getByTestId('wind-time');
    await field.scrollIntoViewIfNeeded();
    const g2 = await geometry();
    const fieldBox = (await field.boundingBox())!;
    expect(fieldBox.y).toBeGreaterThanOrEqual(g2.body.top - 0.5);
    expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(g2.body.bottom + 0.5);
    expect(fieldBox.height).toBeGreaterThanOrEqual(44);
    expect(g2.apply.top).toBe(g.apply.top);
    expect(g2.scrollW).toBeLessThanOrEqual(g2.innerW);

    // Every button, radio label and input in the body and the foot is at least 44 x 44 px; the header's Close has a 44 px hit area (probed as scripts/audit-tap-targets.mjs does).
    const small = await panel.evaluate((root) => {
      const out: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>('.panel-body button, .panel-foot button, .panel-body input, .segmented-option, .rose')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (el instanceof HTMLInputElement && el.closest('.segmented-option')) continue; // the radio is inside its label: the label is the target
        if (b.height < 44 - 0.5 || b.width < 44 - 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      return out;
    });
    expect(small).toEqual([]);
    expect(await hitArea(panel.getByRole('button', { name: 'Close tool' })), 'the Close button has a 44 px hit area').toEqual([]);

    expect(await popups(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
