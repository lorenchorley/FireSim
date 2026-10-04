/**
 * The Playwright `test` every spec uses: the stock one plus a console guard. Any `console.error`, `console.warn` or uncaught
 * page error in a test fails it (a run that is clean on the screen must also be clean in the console), except the few
 * messages listed in IGNORED. `FIRESIM_CONSOLE=report` prints them instead of failing (to see what a run says).
 */
import { expect, test as base } from '@playwright/test';

export { expect };

/** Messages that are not the app's and cannot be fixed here (each with the reason). */
const IGNORED: RegExp[] = [
  // Chromium's software GL (SwiftShader) in the headless test browser says so when WebGL starts; real phones do not.
  /GPU stall due to ReadPixels|Automatic fallback to software WebGL|GL Driver Message|WebGL.*(swiftshader|software)/i,
  // Playwright's headless browser has no favicon or manifest requests answered for the 404 probes of some pages.
  /Failed to load resource: the server responded with a status of 404.*favicon/i,
];

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const seen: string[] = [];
      // A test that breaks the network on purpose (annotation 'network-failures') gets the browser's own report of the failed
      // requests ("Failed to load resource: net::ERR_..." / "... status of 500"); the app's own messages are still guarded.
      const networkFailures = (): boolean => testInfo.annotations.some((a) => a.type === 'network-failures');
      page.on('console', (m) => {
        const type = m.type();
        if (type !== 'error' && type !== 'warning') return;
        const text = m.text();
        if (networkFailures() && /^Failed to load resource: (net::ERR_|the server responded with a status of [45]\d\d)/.test(text)) return;
        if (!IGNORED.some((re) => re.test(text))) seen.push(`console.${type}: ${text.slice(0, 400)}`);
      });
      page.on('pageerror', (e) => seen.push(`pageerror: ${e.message.slice(0, 400)}`));
      await use();
      if (!seen.length) return;
      if (process.env.FIRESIM_CONSOLE === 'report') {
        for (const s of seen) console.log(`[console] ${testInfo.title.slice(0, 60)} :: ${s}`);
        return;
      }
      expect(seen, 'the browser console must stay empty (console.error / console.warn / page errors)').toEqual([]);
    },
    { auto: true },
  ],
});
