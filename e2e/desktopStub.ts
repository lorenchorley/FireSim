/**
 * Stands in for the desktop host in the e2e specs (0.8.0, workstream J; protocol 2 since 0.9.0): the test seam `window.__firesimRemote = { detectHost,
 * connectRemote, reach }`, which the page honours only with `?debug=1`. The stub itself is the plain script e2e/desktop-stub.init.js (the
 * audit scripts use the same file); this puts its options in the page first. `detectHost` answers with the protocol 2 probe (the host's
 * name comes only with the welcome, in the link's `info`), or with no host; `connectRemote` accepts one code and hands back a controller that
 * is a small fake. The real host and its wire are exercised by the real-host specs (desktop-real, desktop-cross-origin). Everything the page asked
 * is on `window.__remote.calls`.
 */
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

export interface DesktopStubOptions {
  name?: string;
  cores?: number;
  node?: string;
  /** The code the stub accepts (default ABCD2345). */
  code?: string;
  /** No host answers (the page is not served by a desktop host). */
  noHost?: boolean;
  /** `connectRemote` fails for another reason than the code (the desktop went away). */
  unreachable?: boolean;
  /** Hold the answer of `connectRemote` back (ms), to see the "Connecting" state. */
  delayMs?: number;
  /** The link ends by itself this long (ms) after the engine was initialised (`?stubfail=N` in the address does the same). */
  failAfterMs?: number;
  /** The desktop refuses the code as it does after several wrong ones (`reason: 'rate-limited'`). */
  rateLimited?: boolean;
  /** The link has no `onClosed` (an older module): the page then takes an `error` event of the controller for the end of the link. */
  noOnClosed?: boolean;
  /** Typed address: where the stub's desktop is (`http://192.168.1.20:4300`). The probe and the link answer only there; anywhere else is a desktop that is not there. */
  base?: string;
  /** Typed address: a desktop that is there but does not list this page (the probe is refused as a browser's CORS check would; something is listening). */
  notAllowed?: boolean;
  /** The connection fails with a `RemoteVersionError` that carries the two protocol numbers. */
  versionMismatch?: { page: number; host: number };
  /** The desktop has no free session. */
  noSession?: boolean;
}

export type RemoteCall = [string, ...unknown[]];

const STUB = readFileSync(new URL('./desktop-stub.init.js', import.meta.url), 'utf8');

export async function installDesktopStub(page: Page, options: DesktopStubOptions = {}): Promise<void> {
  await page.addInitScript({ content: `window.__desktopStubOptions = ${JSON.stringify(options)};\n${STUB}` });
}

/** What the page asked of the stub so far. */
export const remoteCalls = (page: Page): Promise<RemoteCall[]> => page.evaluate(() => (window as unknown as { __remote: { calls: RemoteCall[] } }).__remote.calls.map((c) => [...c] as RemoteCall));

/** The link ends (the controller says so with an `error` event and `onClosed` is called once; `quiet`: `onClosed` only). */
export const failLink = (page: Page, reason = 'The desktop connection closed.', quiet = false): Promise<void> =>
  page.evaluate(([m, q]) => (window as unknown as { __remote: { close(m: string, how: { quiet: boolean }): void } }).__remote.close(m as string, { quiet: q as boolean }), [reason, quiet]);

/** An engine's error message while the link is still open (not the end of the link). */
export const engineError = (page: Page, message = 'The engine had a problem.'): Promise<void> => page.evaluate((m) => (window as unknown as { __remote: { fail(m: string): void } }).__remote.fail(m), message);

// ───────────── helpers the desktop specs share ─────────────

/** `true` when two addresses have the same origin. */
export const sameOrigin = (url: string, origin: string): boolean => new URL(url).origin === origin;

/** Every place the page may have put the code: storage, the address, the history entry, a cookie, the names of IndexedDB databases. */
export async function whereIsTheCode(page: Page, code: string): Promise<string[]> {
  return page.evaluate(async (c) => {
    const found: string[] = [];
    for (const [name, s] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const) for (let i = 0; i < s.length; i++) if (`${s.key(i)}=${s.getItem(s.key(i)!)}`.includes(c)) found.push(name);
    if (location.href.includes(c)) found.push('address');
    if (JSON.stringify(history.state ?? null).includes(c)) found.push('history state');
    if (document.cookie.includes(c)) found.push('cookie');
    for (const d of (await indexedDB.databases?.()) ?? []) if ((d.name ?? '').includes(c)) found.push('indexedDB name');
    return found;
  }, code);
}

/** The eight probes of the repo's tap audit: a point around the centre that lands on something else is a hit area under 44 x 44 px. */
export async function missedProbes(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const label = el.closest('label');
    return [[-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, 15], [-15, 15], [15, -15]].filter(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx!, cy + dy!);
      return !(hit && (el === hit || el.contains(hit) || (label && label.contains(hit))));
    }).length;
  });
}

/** The Setup form for the real builder: the Katoomba demo, preset weather, offline (the build then takes seconds). */
export async function chooseKatoombaOffline(page: Page): Promise<void> {
  await page.getByTestId('site-katoomba').click();
  await page.getByTestId('weather-source').getByRole('radio', { name: 'Preset' }).check();
  await page.getByTestId('preset-hot-nw-sw-change').click();
  const online = page.getByTestId('online').getByRole('switch');
  if (await online.isChecked()) await page.getByTestId('online').click();
}

/** Resolves when `count()` has not grown for `quietPolls` polls (one a second): the page has finished asking for files. */
export async function untilQuiet(count: () => number, quietPolls = 5, timeout = 90_000): Promise<void> {
  let quiet = 0;
  let last = -1;
  await expect
    .poll(
      async () => {
        quiet = count() === last ? quiet + 1 : 0;
        last = count();
        return quiet;
      },
      { message: 'the page has finished asking for files', timeout, intervals: [1000] },
    )
    .toBeGreaterThanOrEqual(quietPolls);
}
