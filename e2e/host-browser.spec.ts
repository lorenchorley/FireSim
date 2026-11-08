/**
 * The REAL desktop host in a REAL browser (0.9.0 contract 4.2): DNS rebinding (item 5; the 0.8.0 check was made with forged headers) and the one-use
 * link of `--open` (item 4: a redirect with a fragment is followed by the browser as the host means it).
 *
 * DNS rebinding.
 *
 * The attack: a page on the attacker's own name gets that name pointed at the victim's computer (127.0.0.1), so the page is same-origin with
 * the host and its script can read what the host answers; the Origin check alone is no defence, because the page's origin and the request's
 * Host both say the attacker's name. What the browser sends then is `Host: hostile.example:PORT` to the host. Chromium's
 * `--host-resolver-rules` makes that state in one step: `MAP hostile.example 127.0.0.1`. The attacker's document is served by the test
 * (page.route fulfils the one URL, as the attacker's server would), and everything else the page asks of its own origin goes on to the real
 * host over the real network, under the hostile name.
 *
 * Expected: the host answers every request and handshake that names it by the hostile name with 421, before the Origin check and before the code
 * is looked at, with and without --lan, and also when the owner has listed the hostile page's origin with --allow-origin (the Host allowlist
 * stays). The same page under this computer's own name (the control) reads the host's three-field answer and opens the engine link, so the
 * refusals are the host's and not a broken set-up.
 *
 * Needs no build of the app: it builds the host (desktop/build.mjs) into a folder of its own and serves a one-line page.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { buildDesktop } from '../desktop/build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'ABCD2345';
const HOSTILE = 'hostile.example';
/** This computer's own name, one the host allows (the control), and also mapped to loopback for the browser. */
const OWN = hostname().toLowerCase();
const ATTACK_PATH = '/attack.html';
/** The names of two pages of other origins (an app's page and another page), for the listed-origin check. They are served by the test, as the app serves its own. */
const APP_HOST = 'app.example';
const OTHER_APP_HOST = 'other.example';
const APP_PAGE_PORT = 5555;

let work: string;
let built: string;
let runner: string;
let browser: Browser;
const hosts = new Set<ChildProcess>();

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'firesim-rebinding-'));
  mkdirSync(join(work, 'dist'));
  writeFileSync(join(work, 'dist', 'index.html'), '<!doctype html><title>FireSim</title><p>the app</p>');
  built = mkdtempSync(join(ROOT, 'desktop', '.build-test-rebind-'));
  await buildDesktop({ root: ROOT, outDir: built, logLevel: 'silent' });
  runner = join(work, 'run.mjs');
  writeFileSync(
    runner,
    `import { main } from ${JSON.stringify(pathToFileURL(join(built, 'main.mjs')).href)};\nprocess.exit(await main(process.argv.slice(2), { distDir: ${JSON.stringify(join(work, 'dist'))}, workerFile: new URL(${JSON.stringify(pathToFileURL(join(built, 'engineWorker.mjs')).href)}) }));\n`,
  );
  browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: [`--host-resolver-rules=MAP ${HOSTILE} 127.0.0.1, MAP ${OWN} 127.0.0.1, MAP ${APP_HOST} 127.0.0.1, MAP ${OTHER_APP_HOST} 127.0.0.1`],
  });
});

test.afterAll(async () => {
  await browser?.close();
  for (const h of hosts) h.kill('SIGKILL');
  hosts.clear();
  rmSync(work, { recursive: true, force: true });
  rmSync(built, { recursive: true, force: true });
});

interface RunningHost {
  port: number;
  log: () => string;
  stop(): Promise<void>;
}

/** A port that is free now (to name the page's origin before the host that is told about it starts). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** The real host as a child process on a free port (or the `port` given), with `args`; resolves when its banner is complete. */
async function startHost(args: string[], port = 0, env: Record<string, string> = {}): Promise<RunningHost> {
  const child = spawn(process.execPath, [runner, '--port', String(port), '--code', CODE, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  hosts.add(child);
  let text = '';
  child.stdout!.on('data', (d: Buffer) => (text += d));
  child.stderr!.on('data', (d: Buffer) => (text += d));
  const exited = new Promise<void>((r) => child.once('exit', () => r()));
  await expect.poll(() => text.includes('Ctrl+C stops it.') || /could not start|Usage:/.test(text), { timeout: 60_000, message: 'the host banner' }).toBe(true);
  const listening = Number(/:(\d+)\/#code=/.exec(text)?.[1]);
  if (!listening) throw new Error(`The host printed no address:\n${text}`);
  return {
    port: listening,
    log: () => text,
    async stop() {
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      child.kill('SIGKILL');
    },
  };
}

/** What a script of a page does at the host at `target` (`127.0.0.1:PORT`), from its own origin or another: read /__firesim/host, then try the engine link with the code. */
const script = async ({ target, code }: { target: string; code: string }): Promise<Reading> => {
  const reading: Reading = { fetchStatus: 0, fetchBody: '', ws: 'not open', wsCloseCode: null };
  try {
    const r = await fetch(`http://${target}/__firesim/host`, { cache: 'no-store' });
    reading.fetchStatus = r.status;
    reading.fetchBody = await r.text();
  } catch {
    reading.fetchStatus = -1; // the browser did not let the page read the answer (CORS) or there was none
  }
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`ws://${target}/__firesim/engine`);
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, 8000);
    ws.onopen = () => {
      reading.ws = 'open';
      ws.send(JSON.stringify({ type: 'hello', protocol: 2, code }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string' && (JSON.parse(ev.data) as { type: string }).type === 'welcome') reading.ws = 'welcome';
      clearTimeout(timer);
      ws.close();
      resolve();
    };
    ws.onclose = (ev) => {
      reading.wsCloseCode = ev.code;
      clearTimeout(timer);
      resolve();
    };
  });
  return reading;
};

type Reading = {
  fetchStatus: number;
  fetchBody: string;
  ws: 'open' | 'welcome' | 'not open';
  wsCloseCode: number | null;
};

/**
 * Open the attacker's page under `name` (the document is served by the test, everything else goes to the real host) and let its script do what the
 * attacker would: read /__firesim/host from its own origin and try the engine link with the right code (the attacker is assumed to have it: the point is
 * the Host check, which comes first).
 */
async function attack(name: string, port: number): Promise<Reading> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const origin = `http://${name}:${port}`;
    await page.route(`${origin}/**`, (route) => (new URL(route.request().url()).pathname === ATTACK_PATH ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>attacker</title>' }) : route.continue()));
    await page.goto(`${origin}${ATTACK_PATH}`);
    return await page.evaluate(script, { target: `${name}:${port}`, code: CODE });
  } finally {
    await context.close();
  }
}

/** A page of another origin (served by the test, as an app serves its own) that does the same at the host on `hostPort` of this computer. */
async function fromOtherOrigin(pageHost: string, hostPort: number, code = CODE): Promise<Reading> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const origin = `http://${pageHost}:${APP_PAGE_PORT}`;
    await page.route(`${origin}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>the app</title>' }));
    await page.goto(`${origin}/index.html`);
    return await page.evaluate(script, { target: `127.0.0.1:${hostPort}`, code });
  } finally {
    await context.close();
  }
}

const REFUSED: Reading = { fetchStatus: 421, fetchBody: '', ws: 'not open', wsCloseCode: 1006 };

test.describe('a page on the attacker\'s name, pointed at this computer', () => {
  test('the control: the same page under this computer\'s own name reads the host\'s three fields and opens the engine link', async () => {
    const host = await startHost([]);
    try {
      const r = await attack(OWN, host.port);
      expect(r.fetchStatus).toBe(200);
      expect(JSON.parse(r.fetchBody)).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
      expect(r.ws).toBe('welcome');
    } finally {
      await host.stop();
    }
  });

  test('on the hostile name the host answers 421 to the page and refuses its engine link, and no session was made', async () => {
    const host = await startHost([]);
    try {
      expect(await attack(HOSTILE, host.port)).toMatchObject(REFUSED);
      // the host said why, once, in its log, and it is still serving its own name, with no session of the attacker's
      expect(host.log()).toContain(`the Host header "${HOSTILE}:${host.port}" is not a name of this computer (--allow-host NAME adds one)`);
      const own = await attack(OWN, host.port);
      expect(own.ws).toBe('welcome');
      expect(host.log()).not.toContain('wrong code'); // the attacker's tries never reached the code
    } finally {
      await host.stop();
    }
  });

  test('the same with --lan (the host listens on every interface)', async () => {
    const host = await startHost(['--lan']);
    try {
      expect(await attack(HOSTILE, host.port)).toMatchObject(REFUSED);
      expect((await attack(OWN, host.port)).ws).toBe('welcome');
    } finally {
      await host.stop();
    }
  });

  test('also when the owner has listed the hostile page\'s origin (--allow-origin): the Host allowlist is checked first and stays', async () => {
    const port = await freePort();
    const host = await startHost(['--lan', '--allow-origin', `http://${HOSTILE}:${port}`], port);
    try {
      expect(host.log()).toContain(`Apps may connect from: http://${HOSTILE}:${port}`); // the origin IS listed
      expect(await attack(HOSTILE, host.port)).toMatchObject(REFUSED);
    } finally {
      await host.stop();
    }
  });

  test('an allowed name still works when it is given with --allow-host: the hostile name is let in only by the owner', async () => {
    const host = await startHost(['--allow-host', HOSTILE]);
    try {
      const r = await attack(HOSTILE, host.port);
      expect(r.fetchStatus).toBe(200);
      expect(r.ws).toBe('welcome');
    } finally {
      await host.stop();
    }
  });
});

test.describe('a page of another origin (an app\'s), with --allow-origin', () => {
  test('a listed origin reads the three fields of /__firesim/host across origins and opens the engine link with the code; another origin does neither', async () => {
    const host = await startHost(['--allow-origin', `http://${APP_HOST}:${APP_PAGE_PORT}`]);
    try {
      const listed = await fromOtherOrigin(APP_HOST, host.port);
      expect(listed.fetchStatus).toBe(200); // the browser let the page read it: Access-Control-Allow-Origin names this origin
      expect(JSON.parse(listed.fetchBody)).toEqual({ app: 'firesim-desktop-host', protocol: 2, requiresCode: true });
      expect(listed.ws).toBe('welcome');
      const other = await fromOtherOrigin(OTHER_APP_HOST, host.port);
      expect(other.fetchStatus).toBe(-1); // no Access-Control-Allow-Origin for it: the browser keeps the answer from the page
      expect(other.ws).toBe('not open'); // refused at the handshake (403)
      expect(host.log()).toContain(`Apps may connect from: http://${APP_HOST}:${APP_PAGE_PORT}`);
    } finally {
      await host.stop();
    }
  });

  test('without the flag no other origin gets either', async () => {
    const host = await startHost([]);
    try {
      const r = await fromOtherOrigin(APP_HOST, host.port);
      expect(r.fetchStatus).toBe(-1);
      expect(r.ws).toBe('not open');
    } finally {
      await host.stop();
    }
  });

  test('a listed origin is still held to the code: a wrong one is refused with 4401 in the same browser', async () => {
    const host = await startHost(['--allow-origin', `http://${APP_HOST}:${APP_PAGE_PORT}`]);
    try {
      const r = await fromOtherOrigin(APP_HOST, host.port, 'WRONG234');
      expect(r.ws).toBe('open'); // the handshake is taken (the origin is listed) ...
      expect(r.wsCloseCode).toBe(4401); // ... and the hello is not
    } finally {
      await host.stop();
    }
  });
});

test.describe('the one-use link of --open', () => {
  test('a browser follows it to the page with the code in its address once, and the second use is refused with a sentence', async () => {
    // A program named xdg-open at the front of the PATH takes the place of the browser launcher and keeps the link it was started with.
    const bin = join(work, 'fake-bin');
    mkdirSync(bin, { recursive: true });
    const record = join(work, 'link.txt');
    writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\nprintf '%s' "$1" > ${record}\n`, { mode: 0o755 });
    const host = await startHost(['--open'], 0, { PATH: `${bin}:${process.env.PATH ?? ''}` });
    try {
      await expect.poll(() => existsSync(record) && readFileSync(record, 'utf8') !== '', { timeout: 10_000, message: 'the launcher to be started' }).toBe(true);
      const link = readFileSync(record, 'utf8');
      expect(link).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${host.port}/__firesim/open\\?t=[0-9a-f]{64}$`));
      expect(link).not.toContain(CODE);
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const first = await page.goto(link);
        expect(first?.status()).toBe(200); // the page the redirect led to
        expect(page.url()).toBe(`http://127.0.0.1:${host.port}/#code=${CODE}`);
        expect(await page.title()).toBe('FireSim');
        const second = await page.goto(link);
        expect(second?.status()).toBe(410);
        expect(await page.locator('body').innerText()).toContain('This link was used already or has run out.');
        expect(page.url()).not.toContain(CODE);
      } finally {
        await context.close();
      }
    } finally {
      await host.stop();
    }
  });
});
