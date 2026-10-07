/**
 * Audit of "paste a Google Maps link or coordinates" in the real app (Pixel 7 profile): hostile and odd names shown as text,
 * right-to-left names, layouts at 360x640 / 844x390 / 200 % text, a late short-link answer that must not take the choice back,
 * two pastes in a row, IME and paste events, what is stored and logged, the live region, and "nothing pops up".
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { emulateCapacitorAndroid, type FakeHttpRoute } from './androidBridge';
import { acceptNotice, animationsDone, armPopupWatch, popups, watchPopups } from './helpers';

const SHOTS = process.env.AUDIT_SHOTS ?? 'test-results/maps-link-audit';
mkdirSync(SHOTS, { recursive: true });

const PLACE = (lat: number, lon: number, name = 'Place'): string => `https://www.google.com/maps/place/${name}/@${lat + 0.002},${lon + 0.002},15z/data=!3m1!4b1!4m6!3m5!1s0x6b1292f3c1e5d9e1:0x5017d681632a3b0!8m2!3d${lat}!4d${lon}!16s%2Fm%2F0gxk9xn`;
const GARDEN = PLACE(-33.5447, 150.4097, 'Mount+Tomah+Botanic+Garden');
const GARDEN_LATLON = '33.5447° S, 150.4097° E';

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

/** Android's font scale at `k`: every font-size and line-height token times k (the same device the integration spec uses). */
async function fontScale(page: Page, k: number): Promise<void> {
  await page.evaluate((scale) => {
    document.getElementById('font-scale')?.remove();
    const cs = getComputedStyle(document.documentElement);
    const decl: string[] = [];
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) decl.push(`--fs-${n}: ${parseFloat(cs.getPropertyValue(`--fs-${n}`)) * scale}px !important`);
    for (const n of ['xs', 'sm', 'md', 'lg', 'xl']) {
      const v = parseFloat(cs.getPropertyValue(`--lh-${n}`));
      if (Number.isFinite(v)) decl.push(`--lh-${n}: ${v * scale}px !important`);
    }
    const st = document.createElement('style');
    st.id = 'font-scale';
    st.textContent = `:root { ${decl.join('; ')} }`;
    document.head.append(st);
  }, k);
  await page.waitForTimeout(150);
}

const noHorizontalScroll = (page: Page): Promise<{ scrollW: number; clientW: number; wide: string[] }> =>
  page.evaluate(() => {
    const de = document.documentElement;
    const wide: string[] = [];
    for (const el of document.querySelectorAll('.manual-box, .manual-box *, .manual-fix, .manual-fix *')) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) wide.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, wide };
  });

test('hostile text in a name is shown as TEXT: no element, no script, in the row and in the footer', async ({ page }) => {
  await page.addInitScript(() => ((window as unknown as { __pwned: number }).__pwned = 0));
  await open(page);
  const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  await pasteInto(page, `${evil}\n${GARDEN}`);
  await expect(page.getByTestId('manual-name')).toContainText('<img src=x onerror="window.__pwned=1"><script>');
  await expect(page.locator('.manual-result img, .manual-result script, .footer-summary img, .footer-summary script')).toHaveCount(0);
  await expect(page.locator('.footer-summary')).toContainText('<img src=x');
  // a name that arrives through the place path of the link is text as well
  await page.getByTestId('manual-coords').fill(PLACE(-33.5447, 150.4097, '%3Cimg+src%3Dx+onerror%3D%22window.__pwned%3D3%22%3E'));
  await expect(page.getByTestId('manual-name')).toContainText('<img src=x');
  await expect(page.locator('.manual-result img')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __pwned: number }).__pwned)).toBe(0);
});

test('a name in a right-to-left script and a very long name: the row stays inside the screen, at 360 px and at 200 % text', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page);
  await pasteInto(page, `حديقة النباتات الملكية في جبل تومة\n${GARDEN}`);
  await expect(page.getByTestId('manual-name')).toContainText('حديقة');
  await expect(page.getByTestId('manual-name')).toHaveAttribute('dir', 'auto');
  // the footer line "<name> · 6 km · 6 h · …" isolates the name, so a right-to-left name cannot reorder what follows it
  expect(await page.locator('.footer-summary').innerText()).toMatch(/\u2068.*حديقة.*\u2069 · \d+ km/u);
  let m = await noHorizontalScroll(page);
  expect(m.wide).toEqual([]);
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
  await page.getByTestId('manual-fix').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/rtl-360.png`, scale: 'css' });

  const long = 'Mount Tomah Botanic Garden and Arboretum Visitor Centre Car Park Overflow'.repeat(2);
  await pasteInto(page, `${long}\n${GARDEN}`);
  await expect(page.getByTestId('manual-name')).toBeVisible();
  await fontScale(page, 2);
  await animationsDone(page);
  m = await noHorizontalScroll(page);
  expect(m.wide).toEqual([]);
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW);
  await page.getByTestId('manual-fix').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/long-360-200.png`, scale: 'css' });
  // an unbroken name with no spaces cannot push the row off the screen either
  await pasteInto(page, `${'W'.repeat(80)}\n${GARDEN}`);
  m = await noHorizontalScroll(page);
  expect(m.wide).toEqual([]);

  await page.setViewportSize({ width: 844, height: 390 });
  await fontScale(page, 1);
  await animationsDone(page);
  await page.getByTestId('manual-fix').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/landscape.png`, scale: 'css' });
  m = await noHorizontalScroll(page);
  expect(m.wide).toEqual([]);
});

test('a short link answer that arrives late does not take the choice back from a demo site picked meanwhile', async ({ page }) => {
  const SHORT = 'https://maps.app.goo.gl/Late123';
  await emulateCapacitorAndroid(page, { httpRoutes: [{ match: SHORT, location: GARDEN, delayMs: 800 }] });
  await open(page);
  await pasteInto(page, SHORT);
  await expect(page.getByTestId('manual-looking')).toBeVisible();
  await page.getByTestId('site-grose').click();
  await expect(page.getByTestId('site-grose')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON, { timeout: 8000 });
  await expect(page.getByTestId('site-grose')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('manual-fix')).not.toContainText('Selected');
  await expect(page.getByTestId('manual-use')).toBeVisible();
  await expect(page.locator('.footer-summary')).not.toContainText('Coordinates');
  await page.getByTestId('manual-use').click();
  await expect(page.getByTestId('manual-fix')).toContainText('Selected');
});

test('two pastes in a row: the second place wins, and the first answer (late) is ignored', async ({ page }) => {
  const A = 'https://maps.app.goo.gl/AAAA1111';
  const B = 'https://maps.app.goo.gl/BBBB2222';
  const routes: FakeHttpRoute[] = [
    { match: A, location: PLACE(-33.1, 150.1, 'Place+A'), delayMs: 1500 },
    { match: B, location: PLACE(-33.2, 150.2, 'Place+B'), delayMs: 100 },
  ];
  await emulateCapacitorAndroid(page, { httpRoutes: routes });
  await open(page);
  await pasteInto(page, A);
  await pasteInto(page, B);
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.2000° S, 150.2000° E');
  await expect(page.getByTestId('manual-name')).toHaveText('Place B');
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.2000° S, 150.2000° E');
  await expect(page.getByTestId('manual-name')).toHaveText('Place B');
  await expect(page.locator('.footer-summary')).toContainText('Place B');
});

test('Clear while a lookup runs: nothing comes back later', async ({ page }) => {
  const SHORT = 'https://maps.app.goo.gl/Clr123';
  await emulateCapacitorAndroid(page, { httpRoutes: [{ match: SHORT, location: GARDEN, delayMs: 700 }] });
  await open(page);
  await pasteInto(page, SHORT);
  await expect(page.getByTestId('manual-looking')).toBeVisible();
  await page.getByTestId('manual-clear').click();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('manual-fix')).toHaveCount(0);
  await expect(page.getByTestId('manual-looking')).toHaveCount(0);
  await expect(page.getByTestId('site-katoomba')).toHaveAttribute('aria-checked', 'true');
});

test('IME composition and typing character by character end in the right place', async ({ page }) => {
  await open(page);
  const box = page.getByTestId('manual-coords');
  await box.focus();
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid=manual-coords]')!;
    const text = '−33.5447, 150.4097';
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    let v = '';
    for (const ch of text) {
      v += ch;
      input.value = v;
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: ch, isComposing: true, bubbles: true }));
    }
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
    input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: null, bubbles: true }));
  });
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await expect(box).toHaveValue('−33.5447, 150.4097'); // the box is never rewritten under the finger
});

test('nothing is requested, logged, stored or opened for a long link in the web build', async ({ page, context }) => {
  const requests: string[] = [];
  const logs: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => logs.push(m.text()));
  await watchPopups(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = ((u?: string | URL) => (w.__opened.push(String(u)), null)) as typeof window.open;
  });
  await open(page);
  await armPopupWatch(page);
  const SECRET = 'SECRETPLACEID0x6b1292f3c1e5d9e1';
  const link = `https://www.google.com/maps/place/Mount+Tomah+Botanic+Garden/@-33.5400,150.4000,15z/data=!3m1!4b1!4m6!3m5!1s${SECRET}!8m2!3d-33.5447!4d150.4097?entry=ttu&g_ep=UNIQUEEPTOKEN`;
  await pasteInto(page, `Mount Tomah Botanic Garden\n${link}`);
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await page.getByTestId('manual-clear').click();
  await pasteInto(page, link);
  await page.waitForTimeout(500);
  expect(requests.filter((u) => /google|goo\.gl|UNIQUEEPTOKEN|SECRETPLACEID/i.test(u))).toEqual([]);
  expect(logs.filter((l) => /google|goo\.gl|UNIQUEEPTOKEN|SECRETPLACEID|-33\.5447/i.test(l))).toEqual([]);
  const stores = await page.evaluate(async () => {
    const out: string[] = [];
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i)}=${s.getItem(s.key(i)!)}`);
    const dbs = (await indexedDB.databases?.()) ?? [];
    out.push(...dbs.map((d) => `idb:${d.name}`));
    return out.join('\n');
  });
  expect(stores).not.toMatch(/google|goo\.gl|UNIQUEEPTOKEN|SECRETPLACEID|Botanic/i);
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([]);
  expect(await popups(page)).toEqual([]);
  expect(context.pages()).toHaveLength(1);
});

test('the live region: one update for a pasted place, none for unrelated taps; typing a pair announces the place, not each key', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as { __mut: number };
    w.__mut = 0;
    new MutationObserver((l) => (w.__mut += l.length)).observe(document.querySelector('[data-testid=manual-result]')!, { childList: true, subtree: true, characterData: true });
  });
  const mut = (): Promise<number> => page.evaluate(() => (window as unknown as { __mut: number }).__mut);
  await pasteInto(page, GARDEN);
  await expect(page.getByTestId('manual-fix')).toBeVisible();
  const afterPaste = await mut();
  expect(afterPaste).toBeGreaterThan(0);
  expect(afterPaste).toBeLessThan(12);
  // unrelated changes (area, detail, weather) must not rebuild the result row
  await page.getByTestId('extent').getByRole('radio', { name: '3 km' }).check({ force: true });
  await page.waitForTimeout(500);
  expect(await mut()).toBe(afterPaste);
});

test('typing a pair key by key: the result row is rebuilt at most once per valid pair, and never shows a message half-way', async ({ page }) => {
  await open(page);
  const box = page.getByTestId('manual-coords');
  await box.focus();
  await page.evaluate(() => {
    const w = window as unknown as { __mut: number; __msgs: string[] };
    w.__mut = 0;
    w.__msgs = [];
    new MutationObserver((l) => {
      w.__mut += l.length;
      const m = document.querySelector('[data-testid=manual-message]');
      if (m) w.__msgs.push(m.textContent ?? '');
    }).observe(document.querySelector('[data-testid=manual-result]')!, { childList: true, subtree: true });
  });
  await page.keyboard.type('-33.7, 150.3', { delay: 60 });
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.7000° S, 150.3000° E');
  const r = await page.evaluate(() => ({ mut: (window as unknown as { __mut: number }).__mut, msgs: (window as unknown as { __msgs: string[] }).__msgs }));
  expect(r.msgs).toEqual([]);
  // "-33.7, 1" "…15" "…150" "…150." "…150.3" are each a valid pair: they are a handful of updates, not dozens
  expect(r.mut).toBeLessThan(60);
});

test('a pasted place is built: its name is the scenario name in the run, and nothing stored holds the link', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, 'mock=1&debug=1&theme=light');
  await page.getByTestId('extent').getByRole('radio', { name: '3 km' }).check({ force: true });
  const link = `${GARDEN}?entry=ttu&g_ep=UNIQUEEPTOKEN`;
  await pasteInto(page, `حديقة تومة\n${link}`);
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await page.getByTestId('build').click();
  await expect(page.getByTestId('sim')).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('menu').click();
  await expect(page.locator('.drawer-sub')).toHaveText('حديقة تومة');
  await expect(page.locator('.drawer-sub')).toHaveAttribute('dir', 'auto');
  await page.screenshot({ path: `${SHOTS}/sim-menu-name.png`, scale: 'css' });
  await page.getByTestId('menu-datasets').click();
  await expect(page.getByTestId('datasets-screen')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/datasets-for-pasted.png`, scale: 'css' });
  const dump = await page.evaluate(async () => {
    const out: string[] = [];
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i)}=${s.getItem(s.key(i)!)}`);
    const dbs = (await indexedDB.databases?.()) ?? [];
    for (const d of dbs) {
      await new Promise<void>((resolve) => {
        const rq = indexedDB.open(d.name!);
        rq.onerror = () => resolve();
        rq.onsuccess = () => {
          const db = rq.result;
          const names = [...db.objectStoreNames];
          if (!names.length) return resolve();
          const tx = db.transaction(names, 'readonly');
          let left = names.length;
          for (const n of names) {
            const all = tx.objectStore(n).getAll();
            all.onsuccess = () => {
              try {
                out.push(`idb:${d.name}/${n}=${JSON.stringify(all.result, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? '[bytes]' : v)).slice(0, 20000)}`);
              } catch {
                /* skip */
              }
              if (--left === 0) resolve();
            };
            all.onerror = () => --left === 0 && resolve();
          }
        };
      });
    }
    return out.join('\n');
  });
  expect(dump).not.toMatch(/google\.com|goo\.gl|UNIQUEEPTOKEN|0x6b1292f3c1e5d9e1/i);
});

test('a real keyboard paste (Ctrl+V) of Google share text, over what was there: the name is the first line', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const text = `Mount Tomah Botanic Garden\nBells Line of Road, Mount Tomah NSW 2758\n${GARDEN}`;
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  const box = page.getByTestId('manual-coords');
  await box.focus();
  await page.keyboard.press('Control+V');
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  // paste again over the old text (select all first): the same
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  // paste after a leftover character (no select-all): the place must still be found, and the name must not swallow the address
  await box.fill('');
  await box.focus();
  await page.keyboard.type('x ');
  await page.keyboard.press('Control+V');
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON);
  await expect(page.getByTestId('manual-name')).toHaveText('Mount Tomah Botanic Garden');
  await expect(box).toHaveValue(text.replace(/\n/g, ' ')); // the pasted place replaced the leftover
  // a second link pasted at the end of the first is the one that counts (the old link must not win just because it is first)
  await page.evaluate((t) => navigator.clipboard.writeText(t), PLACE(-33.2, 150.2, 'Second'));
  await box.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+V');
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.2000° S, 150.2000° E');
  await expect(page.getByTestId('manual-name')).toHaveText('Second');
  // text that is not a place is still pasted as usual, in the middle of what is there
  await page.evaluate(() => navigator.clipboard.writeText('-33.7'));
  await box.fill('');
  await page.evaluate(() => navigator.clipboard.writeText('-33.7, 150'));
  await box.focus();
  await page.keyboard.press('Control+V');
  await expect(box).toHaveValue('-33.7, 150');
  await page.keyboard.type('.3');
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.7000° S, 150.3000° E');
});

test('Android: Back on Setup while a short link is looked up leaves nothing open; no pop-up, no new page', async ({ page, context }) => {
  const SHORT = 'https://maps.app.goo.gl/Back123';
  await emulateCapacitorAndroid(page, { httpRoutes: [{ match: SHORT, location: GARDEN, delayMs: 600 }] });
  await watchPopups(page);
  await open(page);
  await armPopupWatch(page);
  await pasteInto(page, SHORT);
  await expect(page.getByTestId('manual-looking')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('manual-latlon')).toHaveText(GARDEN_LATLON, { timeout: 8000 });
  expect(await popups(page)).toEqual([]);
  expect(context.pages()).toHaveLength(1);
});

test('a huge paste (1 MB of text, and a 1 MB link) leaves the screen responsive', async ({ page }) => {
  await open(page);
  const box = page.getByTestId('manual-coords');
  const t0 = Date.now();
  await box.fill('a'.repeat(1_000_000));
  await box.fill(`https://www.google.com/maps/@-33.5,150.4,15z${'/x'.repeat(500_000)}`);
  await expect(page.getByTestId('manual-latlon')).toHaveText('33.5000° S, 150.4000° E');
  await box.fill('');
  expect(Date.now() - t0).toBeLessThan(8000);
  await expect(page.getByTestId('site-katoomba')).toBeVisible();
});

test('the live region of the result is in the accessibility tree before anything is announced into it', async ({ page }) => {
  await open(page);
  const region = page.getByTestId('manual-result');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  expect(await region.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
});
