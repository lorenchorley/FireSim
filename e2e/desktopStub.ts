/**
 * Stands in for the desktop host in the e2e specs (0.8.0, workstream J): the test seam `window.__firesimRemote = { detectHost,
 * connectRemote }`, which the page honours only with `?debug=1`. The stub itself is the plain script e2e/desktop-stub.init.js (the
 * audit scripts use the same file); this puts its options in the page first. `detectHost` answers with a host of the given name,
 * or with no host; `connectRemote` accepts one code and hands back a controller that is a small fake. The real host and its wire
 * are exercised by the integration pass. Everything the page asked is on `window.__remote.calls`.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

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
