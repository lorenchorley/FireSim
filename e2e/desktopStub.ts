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
}

export type RemoteCall = [string, ...unknown[]];

const STUB = readFileSync(new URL('./desktop-stub.init.js', import.meta.url), 'utf8');

export async function installDesktopStub(page: Page, options: DesktopStubOptions = {}): Promise<void> {
  await page.addInitScript({ content: `window.__desktopStubOptions = ${JSON.stringify(options)};\n${STUB}` });
}

/** What the page asked of the stub so far. */
export const remoteCalls = (page: Page): Promise<RemoteCall[]> => page.evaluate(() => (window as unknown as { __remote: { calls: RemoteCall[] } }).__remote.calls.map((c) => [...c] as RemoteCall));

/** Make the open link fail the way a closed one does (the controller says so with an `error`). */
export const failLink = (page: Page, message = 'The desktop connection closed.'): Promise<void> => page.evaluate((m) => (window as unknown as { __remote: { fail(m: string): void } }).__remote.fail(m), message);
