/**
 * Setup → Where → "Or paste a Google Maps link or coordinates": the real app on the Pixel 7 profile.
 *   a long Mount Tomah link → the result row (pin, numbers, name, chips, Selected, Clear), Build enabled, the plan follows;
 *   Google's share text (a name line, an address line, then the link) → the name of the place; the Paste button reads the clipboard;
 *   a short link under the emulated Android runtime (the native HTTP plugin answers with a faked 302; no real network) → "Looking
 *   up…", then the place, from the PIN of the address (not the map view); in the plain web build it says short links need the app
 *   and asks nothing; rubbish and a route link → a plain message and Build stays off; Clear; the remembered setup holds
 *   coordinates only; labels, hint, live region, 44 px targets; a picture (docs/screenshots/27-maps-link*.png).
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { emulateCapacitorAndroid, type FakeHttpRoute } from './androidBridge';
import { acceptNotice, animationsDone } from './helpers';

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

/** The address Google's Maps app makes for the garden: the pin (!3d!4d) is the place, the @ pair is only where the map was centred. */
const GARDEN_LINK =
  'https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5400,150.4000,15z/data=!3m1!4b1!4m6!3m5!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!8m2!3d-33.5447!4d150.4097!16s%2Fm%2F0gxk9xn?entry=ttu&g_ep=EgoyMDI2MDYyOS4wIPu8ASoASAFQAw%3D%3D';
const SHARE_TEXT = `Mount Tomah Botanic Garden\nBells Line of Road, Mount Tomah NSW 2758\n${GARDEN_LINK}`;
const SHORT_LINK = 'https://maps.app.goo.gl/TomahGarden1';
const GARDEN_LATLON = '33.5447° S, 150.4097° E';
const LABEL = 'Or paste a Google Maps link or coordinates';

async function open(page: Page, query = 'mock=1&theme=light'): Promise<void> {
  await page.goto(`/?${query}`);
  await acceptNotice(page);
  await expect(page.getByTestId('manual-coords')).toBeVisible();
}

/** What the phone does on a paste: the paste event carries the text with its line breaks, the one-line box then holds it as one line. */
async function pasteInto(page: Page, text: string): Promise<void> {
  await page.getByTestId('manual-coords').focus();
  await page.evaluate((t) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid=manual-coords]')!;
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    input.value = t.replace(/[\r\n]+/g, ' ');
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', data: t, bubbles: true }));
  }, text);
}

const stored = (page: Page): Promise<string> => page.evaluate(() => localStorage.getItem('firesim.lastSetup') ?? '');
const nativeHttp = (page: Page): Promise<{ url: string; method: string; headers: Record<string, string>; disableRedirects: boolean }[]> =>
  page.evaluate(() => (window as unknown as { __nativeHttp: { url: string; method: string; headers: Record<string, string>; disableRedirects: boolean }[] }).__nativeHttp ?? []);

const shortRoute = (extra: Partial<FakeHttpRoute> = {}): FakeHttpRoute => ({ match: SHORT_LINK, location: GARDEN_LINK, ...extra });

test('a long Mount Tomah link: the result row, the chips, Build on, and the plan follows the place', async ({ page }) => {
  await open(page);
  const plan = page.getByTestId('plan-total');
  await page.getByTestId('site-katoomba').click();
  await expect(plan).toContainText('Works offline: yes');
  await page.waitForTimeout(600);

  await page.getByTestId('manual-coords').fill(GARDEN_LINK);
  const fix = page.getByTestId('manual-fix');
  await expect(fix).toBeVisible();
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON); // the pin, not the @ view centre
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  await expect(fix).toContainText('Google Maps link');
  await expect(fix).toContainText('In NSW');
  await expect(fix).toContainText('Bundled data: Mount Tomah');
  await expect(fix).toContainText('Selected');
  await expect(fix).toHaveClass(/selected/);
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('.footer-summary')).toContainText('Mount Tomah Botanic Garden');
  await expect(page.getByTestId('site-katoomba')).toHaveAttribute('aria-checked', 'false');
  // The link goes in the box as pasted; the place is what the form keeps.
  await expect(page.getByTestId('manual-coords')).toHaveValue(GARDEN_LINK);

  // The plan follows the new place: at 3 km the whole square lies inside the bundled Mount Tomah site, so nothing is downloaded.
  await page.getByTestId('extent').getByRole('radio', { name: '3 km' }).check({ force: true });
  await expect(plan).toContainText('Works offline: yes');
  await expect(plan).toContainText('Nothing to download');
  await expect(page.getByTestId('plan-terrain')).toContainText(/Bundled/);
  // And a place far from every site needs a download and does not work offline: the same box, a plain pair of coordinates.
  await page.getByTestId('manual-coords').fill('-33.70, 149.86');
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.7000° S, 149.8600° E');
  await expect(plan).toContainText('Works offline: no');
  await expect(page.getByTestId('manual-name')).toHaveCount(0);
  await expect(page.getByTestId('manual-fix')).toContainText('Coordinates');
});

test('Google share text: the name is the first line, not the address', async ({ page }) => {
  await open(page);
  await pasteInto(page, SHARE_TEXT);
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await expect(page.locator('.footer-summary')).toContainText('Mount Tomah Botanic Garden');
  // The one-line box shows the lines as one; typing on does not lose the name or the place.
  await expect(page.getByTestId('manual-coords')).toHaveValue(SHARE_TEXT.replace(/\n/g, ' '));
});

test('the Paste button reads the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.evaluate((t) => navigator.clipboard.writeText(t), SHARE_TEXT);
  await page.getByTestId('manual-paste').click();
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'false');
});

test('the Paste button when the phone refuses: a plain message and the box is ready for a long-press paste', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError')) } });
  });
  await page.getByTestId('manual-paste').click();
  await expect(page.getByTestId('manual-message')).toContainText('Touch and hold the box, then choose Paste.');
  await expect(page.getByTestId('manual-coords')).toBeFocused();
  // The message goes with the next thing typed.
  await page.getByTestId('manual-coords').fill('-33.5447, 150.4097');
  await expect(page.getByTestId('manual-message')).toHaveCount(0);
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
});

test('a short link under the Android app: "Looking up…", then the place from the address Google redirects to', async ({ page }) => {
  await emulateCapacitorAndroid(page, { httpRoutes: [shortRoute({ delayMs: 900 })], persistPreferences: true });
  await open(page);
  await pasteInto(page, `Mount Tomah Botanic Garden\n${SHORT_LINK}`);
  await expect(page.getByTestId('manual-looking')).toContainText('Looking up the place with Google Maps…');
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'true'); // no place yet
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON, { timeout: 10_000 });
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  await expect(page.getByTestId('manual-fix')).toContainText('Google Maps short link');
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'false');
  // One request, to the short link only, asking for the redirect and nothing else: no headers, no redirect following.
  const calls = await nativeHttp(page);
  expect(calls).toEqual([{ url: SHORT_LINK, method: 'GET', headers: {}, disableRedirects: true }]);
  // What the phone remembers is the coordinates: neither the short link nor the place id nor the name.
  await page.waitForTimeout(300);
  const prefs = await page.evaluate(() => sessionStorage.getItem('__nativePrefs') ?? '');
  expect(prefs).toContain('-33.54470, 150.40970');
  expect(prefs).not.toMatch(/goo\.gl|google|0x6b1292|Botanic/i);
});

test('a short link: editing the text while it looks up cancels it', async ({ page }) => {
  await emulateCapacitorAndroid(page, { httpRoutes: [shortRoute({ delayMs: 1500 })] });
  await open(page);
  await pasteInto(page, SHORT_LINK);
  await expect(page.getByTestId('manual-looking')).toBeVisible();
  await page.getByTestId('manual-coords').fill('-33.70, 149.86');
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.7000° S, 149.8600° E');
  await page.waitForTimeout(2200); // the lookup's answer arrives and is ignored
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.7000° S, 149.8600° E');
  await expect(page.getByTestId('manual-name')).toHaveCount(0);
});

test('a short link that Google no longer knows, and one that leads nowhere useful: the friendly message', async ({ page }) => {
  await emulateCapacitorAndroid(page, { httpRoutes: [{ match: 'https://maps.app.goo.gl/Gone1', status: 404, body: '' }, { match: 'https://maps.app.goo.gl/Odd1', location: 'https://www.google.com/maps/place/Nowhere+Cafe/data=!4m2!3m1!1s0x1:0x2' }, { match: 'https://www.google.com/maps/place/Nowhere+Cafe', body: '<html><head></head><body>Maps</body></html>' }] });
  await open(page);
  await pasteInto(page, 'https://maps.app.goo.gl/Gone1');
  await expect(page.getByTestId('manual-message')).toContainText('Google Maps does not know this short link any more');
  await pasteInto(page, 'Nowhere Cafe\nhttps://maps.app.goo.gl/Odd1');
  await expect(page.getByTestId('manual-message')).toContainText('names a place but does not say where it is');
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'true');
});

test('a short link in the plain web build: it says short links need the app and asks Google nothing', async ({ page }) => {
  let asked = 0;
  await page.route(/goo\.gl/, (route) => {
    asked++;
    return route.abort();
  });
  await open(page);
  await pasteInto(page, SHORT_LINK);
  await expect(page.getByTestId('manual-message')).toContainText('Short links only work inside the Android app. Open the link in a browser and paste the long address, or paste the coordinates.');
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'true');
  expect(asked).toBe(0);
});

test('rubbish and a route link: a plain message, Build stays off, and the message goes when a place is typed', async ({ page }) => {
  await open(page);
  const box = page.getByTestId('manual-coords');
  await box.fill('the shed behind the hall');
  await expect(page.getByTestId('manual-message')).toContainText('Not recognised yet. Paste a Google Maps link, or type coordinates such as -33.715, 150.285.');
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.footer-errors')).toContainText('Paste a Google Maps link or enter coordinates');

  await box.fill('https://www.google.com/maps/dir/Sydney/Katoomba/@-33.7,150.5,9z');
  await expect(page.getByTestId('manual-message')).toContainText('This link is a route. Open the place and share that.');
  await box.fill('https://example.com/where');
  await expect(page.getByTestId('manual-message')).toContainText('That link is not from Google Maps.');
  await box.fill('95, 150');
  await expect(page.getByTestId('manual-message')).toContainText('Latitude must be between -90 and 90');
  await box.fill('-33,5447 150,4097');
  await expect(page.getByTestId('manual-message')).toContainText('Use a dot for decimals');

  await box.fill('-33.5447, 150.4097');
  await expect(page.getByTestId('manual-message')).toHaveCount(0);
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'false');
});

test('while typing, the "not recognised" message waits for a pause; Enter shows it at once and puts the keyboard away', async ({ page }) => {
  await open(page);
  const box = page.getByTestId('manual-coords');
  await box.focus();
  await page.keyboard.type('-33.5', { delay: 20 });
  await expect(page.getByTestId('manual-latlon')).toHaveCount(0);
  await expect(page.getByTestId('manual-message')).toHaveCount(0);
  await page.keyboard.press('Enter'); // one number is not a place: say so now
  await expect(page.getByTestId('manual-message')).toContainText('Not recognised yet');
  await expect(box).not.toBeFocused();
  await box.focus();
  await page.keyboard.type(', 150.4097');
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.5000° S, 150.4097° E');
});

test('Clear empties the box and goes back to the demo site; the hint comes back', async ({ page }) => {
  await open(page);
  await page.getByTestId('manual-coords').fill(GARDEN_LINK);
  await expect(page.getByTestId('manual-fix')).toBeVisible();
  await expect(page.getByTestId('manual-hint')).toBeHidden();
  await page.getByTestId('manual-clear').click();
  await expect(page.getByTestId('manual-fix')).toHaveCount(0);
  await expect(page.getByTestId('manual-coords')).toHaveValue('');
  await expect(page.getByTestId('manual-coords')).toBeFocused();
  await expect(page.getByTestId('manual-hint')).toBeVisible();
  await expect(page.getByTestId('manual-hint')).toHaveText('Share a place from Google Maps and paste it here — a link, or lat, lon');
  await expect(page.getByTestId('site-katoomba')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'false');
  expect(await stored(page)).not.toMatch(/Botanic|google/i);
});

test('another choice after a pasted place: the row stays, offers "Use this place", and takes the place back', async ({ page }) => {
  await open(page);
  await page.getByTestId('manual-coords').fill(GARDEN_LINK);
  await expect(page.getByTestId('manual-fix')).toContainText('Selected');
  await page.getByTestId('site-grose').click();
  await expect(page.getByTestId('manual-fix')).not.toContainText('Selected');
  await expect(page.getByTestId('manual-fix')).not.toHaveClass(/selected/);
  await page.getByTestId('manual-use').click();
  await expect(page.getByTestId('manual-fix')).toContainText('Selected');
  await expect(page.getByTestId('site-grose')).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.footer-summary')).toContainText('Mount Tomah Botanic Garden');
});

test('outside NSW and a latitude without its minus sign: the row says so', async ({ page }) => {
  await open(page);
  await page.getByTestId('manual-coords').fill('https://www.google.com/maps/@-37.8136,144.9631,15z');
  await expect(page.getByTestId('manual-fix')).toContainText('Outside NSW');
  await expect(page.getByTestId('manual-fix')).toContainText('NSW-only');
  await page.getByTestId('manual-coords').fill('33.5447, 150.4097');
  await expect(page.getByTestId('manual-fix')).toContainText('Outside NSW');
  await expect(page.getByTestId('manual-fix')).toContainText('latitude is negative');
});

test('the last setup holds coordinates only: a pasted link is never stored, and the place comes back after a reload', async ({ page }) => {
  await open(page);
  await page.getByTestId('manual-coords').fill(SHARE_TEXT);
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await page.waitForTimeout(400);
  const raw = await stored(page);
  expect(raw).not.toBe('');
  const saved = JSON.parse(raw) as { manualText: string; manualName: string; where: string };
  expect(saved).toMatchObject({ manualText: '-33.54470, 150.40970', manualName: '', where: 'manual' });
  expect(raw).not.toMatch(/google|goo\.gl|0x6b1292|Botanic|https?:/i);

  await page.reload();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('manual-coords')).toHaveValue('-33.54470, 150.40970');
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await expect(page.getByTestId('build')).toHaveAttribute('aria-disabled', 'false');
  // Typed coordinates are kept exactly as typed.
  await page.getByTestId('manual-coords').fill('-33.70, 149.86');
  await page.waitForTimeout(400);
  expect(JSON.parse(await stored(page)).manualText).toBe('-33.70, 149.86');
});

test('labels, hint and live region for the keyboard and a screen reader; 44 px targets; text of at least 14 px', async ({ page }) => {
  await open(page);
  const box = page.getByLabel(LABEL);
  await expect(box).toHaveAttribute('data-testid', 'manual-coords');
  await expect(box).toHaveAttribute('placeholder', 'Google Maps link, or -33.715, 150.285');
  await expect(box).toHaveAttribute('autocomplete', 'off');
  const hintId = await box.getAttribute('aria-describedby');
  expect(hintId).toBe('manual-hint');
  await expect(page.locator('#manual-hint')).toHaveText('Share a place from Google Maps and paste it here — a link, or lat, lon');
  await expect(page.getByTestId('manual-result')).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('button', { name: 'Paste a Google Maps link from the clipboard' })).toBeVisible();

  // Keyboard: the box, then the Paste button, in that order.
  await box.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('manual-paste')).toBeFocused();

  await box.fill(GARDEN_LINK);
  await expect(page.getByTestId('manual-fix')).toBeVisible();
  const result = await page.evaluate(() => {
    const out: { target: string; w: number; h: number; hit: boolean }[] = [];
    for (const id of ['manual-paste', 'manual-clear']) {
      const el = document.querySelector(`[data-testid=${id}]`) as HTMLElement;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      let hit = true;
      // every point of the 44 x 44 px square around the centre is the button or inside it
      for (const [dx, dy] of [[-21, -21], [21, -21], [-21, 21], [21, 21], [0, 0]] as const) {
        const e = document.elementFromPoint(r.left + r.width / 2 + dx, r.top + r.height / 2 + dy);
        if (!e || !(el === e || el.contains(e))) hit = false;
      }
      out.push({ target: id, w: r.width, h: r.height, hit });
    }
    const small: string[] = [];
    for (const el of document.querySelectorAll('.manual-box *, .manual-fix *')) {
      if (!(el as HTMLElement).childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 14) small.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)} ${fs}px`);
    }
    return { out, small };
  });
  for (const t of result.out) {
    expect(t.hit, `${t.target} takes a 44 px tap`).toBe(true);
    expect(Math.max(t.w, t.h), t.target).toBeGreaterThanOrEqual(36);
  }
  expect(result.small).toEqual([]);
  // The field is 44 px tall.
  expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('the picture: the result row of a pasted Mount Tomah link, in light, night and high contrast', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.getByTestId('site-katoomba').click();
  await pasteInto(page, SHARE_TEXT);
  await expect(page.getByTestId('manual-fix')).toContainText('Bundled data: Mount Tomah');
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  await page.getByTestId('manual-coords').blur();
  await page.evaluate(() => {
    const where = document.getElementById('setup-where')!;
    where.scrollIntoView({ block: 'start' });
    const main = where.closest('.screen-main');
    if (main) main.scrollTop -= 8;
  });
  for (const look of ['light', 'dark', 'high-contrast'] as const) {
    await page.evaluate((l) => {
      const r = document.documentElement;
      r.dataset.theme = l === 'dark' ? 'dark' : 'light';
      if (l === 'high-contrast') r.dataset.contrast = 'high';
      else delete r.dataset.contrast;
    }, look);
    await animationsDone(page);
    await page.screenshot({ path: `${SHOTS}/27-maps-link${look === 'light' ? '' : `-${look}`}.png`, scale: 'css' });
  }
});
