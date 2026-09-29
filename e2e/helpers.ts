/**
 * Shared plumbing of the end-to-end specs: the safety notice, the collapsed menus, the speed popover, the timeline and a
 * "no pop-up ever" watcher. The chrome is collapsed by default, so a tool or a camera mode is always reached through its
 * round menu ("tools-menu" / "view-menu"); these helpers open the menu only when it is closed.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** Session fields the specs read through the `?debug=1` / `?mock=1` handle (window.__firesim). */
export interface SessionView {
  playing: boolean;
  speed: number;
  viewTime: number;
  headTime: number;
  seekTarget: number | null;
  seekProgress: number;
  timeStep: number;
  area: number;
  insights: number;
  ignitions: string[];
  fuelEdits: number;
  error: string | null;
}

export async function session(page: Page): Promise<SessionView> {
  return page.evaluate(() => {
    const fs = (window as unknown as { __firesim: { session: { state: { get(): Record<string, unknown> } } } }).__firesim;
    const s = fs.session.state.get() as {
      playing: boolean;
      speed: number;
      viewTime: number;
      headTime: number;
      seekTarget: number | null;
      seekProgress: number;
      timeStep: number;
      snapshot: { stats: { burntAreaHa: number } } | null;
      insights: unknown[];
      ignitions: { origin: string }[];
      edits: { edit: { kind: string } }[];
      error: string | null;
    };
    return {
      playing: s.playing,
      // JSON-safe: Infinity is sent as -1 and restored below.
      speed: s.speed === Infinity ? -1 : s.speed,
      viewTime: s.viewTime,
      headTime: s.headTime,
      seekTarget: s.seekTarget,
      seekProgress: s.seekProgress,
      timeStep: s.timeStep,
      area: s.snapshot?.stats.burntAreaHa ?? 0,
      insights: s.insights.length,
      ignitions: s.ignitions.map((i) => i.origin),
      fuelEdits: s.edits.filter((e) => e.edit.kind === 'fuel').length,
      error: s.error ?? null,
    };
  }).then((v) => ({ ...v, speed: v.speed === -1 ? Infinity : v.speed }));
}

/** Scenario length (s), from the debug handle. */
export async function scenarioDuration(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __firesim: { scenario: { duration: number } } }).__firesim.scenario.duration);
}

export async function acceptNotice(page: Page): Promise<void> {
  await expect(page.getByTestId('notice')).toBeVisible();
  await page.getByTestId('accept-notice').click();
  await expect(page.getByTestId('notice')).toHaveCount(0);
}

// ───────────── collapsed menus ─────────────

/** Open a round menu ('tools' or 'view') if it is not open already. */
export async function openMenu(page: Page, which: 'tools' | 'view'): Promise<void> {
  const fab = page.getByTestId(`${which}-menu`);
  if ((await fab.getAttribute('aria-expanded')) !== 'true') await fab.click();
  await expect(fab).toHaveAttribute('aria-expanded', 'true');
}

/** Pick a tool from the Tools menu (the menu collapses after a pick). Picking the open tool again closes its panel. */
export async function pickTool(page: Page, id: 'why' | 'fire' | 'fuel' | 'wind' | 'layers' | 'whatif'): Promise<void> {
  await openMenu(page, 'tools');
  await page.getByTestId(`tool-${id}`).click();
  await expect(page.getByTestId('tools-menu')).toHaveAttribute('aria-expanded', 'false');
}

/** Pick a camera mode from the View menu. */
export async function pickViewMode(page: Page, mode: 'orbit' | 'top' | 'ground'): Promise<void> {
  await openMenu(page, 'view');
  await page.locator(`.view-btn[data-mode="${mode}"]`).click();
  await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'false');
}

/** Click an entry of the View menu (fly-fire, compass…); it collapses the menu. */
export async function viewMenuAction(page: Page, testId: 'fly-fire' | 'fly-me' | 'compass'): Promise<void> {
  await openMenu(page, 'view');
  await page.getByTestId(testId).click();
  await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'false');
}

/** Zoom with the View menu's − / + row (which stays open for repeated taps), then collapse the menu. */
export async function zoomView(page: Page, dir: 'in' | 'out', taps = 1): Promise<void> {
  await openMenu(page, 'view');
  for (let i = 0; i < taps; i++) await page.getByTestId(`zoom-${dir}`).click();
  await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'true'); // still open: several taps in a row
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-menu')).toHaveAttribute('aria-expanded', 'false');
}

// ───────────── speed ─────────────

/** Choose a playback speed (x real time, or Infinity = as fast as possible) in the speed popover, then close it. */
export async function setSpeed(page: Page, speed: number): Promise<void> {
  await page.getByTestId('speed').click();
  await expect(page.getByTestId('speed-popover')).toBeVisible();
  await page.locator(`[data-speed="${speed}"]`).click();
  await expect.poll(async () => (await session(page)).speed).toBe(speed);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('speed-popover')).toBeHidden();
}

// ───────────── timeline ─────────────

/** Where (page x, y) the timeline sits for a simulated time t (s): the track runs the whole scenario. */
export async function timelinePoint(page: Page, t: number): Promise<{ x: number; y: number }> {
  const D = await scenarioDuration(page);
  const box = await page.locator('.tl-area').boundingBox();
  if (!box) throw new Error('the timeline is not on screen');
  return { x: box.x + (t / D) * box.width, y: box.y + box.height / 2 };
}

/** Tap the timeline at simulated time t (s): a jump to that time. */
export async function tapTimeline(page: Page, t: number): Promise<void> {
  const p = await timelinePoint(page, t);
  await page.mouse.click(p.x, p.y);
}

/** Jump to a time (s from the start) with the time popover, the way a user types it. Returns when the popover closed. */
export async function jumpWithPopover(page: Page, t: number): Promise<void> {
  const D = await scenarioDuration(page);
  expect(t).toBeLessThanOrEqual(D);
  await page.getByTestId('time-btn').click();
  await expect(page.getByTestId('time-popover')).toBeVisible();
  const start = await page.evaluate(() => (window as unknown as { __firesim: { scenario: { startTime: number; weather: { timezone?: string } } } }).__firesim.scenario);
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: start.weather.timezone || 'Australia/Sydney' }).format(new Date(start.startTime + t * 1000));
  await page.getByTestId('time-input').fill(clock);
  await page.getByTestId('time-go').click();
  await expect(page.getByTestId('time-popover')).toBeHidden();
}

/** Play the seek to its end: wait until the fast-forward has finished. */
export async function waitForSeekEnd(page: Page, timeoutMs = 120_000): Promise<SessionView> {
  await expect.poll(async () => (await session(page)).seekTarget, { timeout: timeoutMs }).toBeNull();
  return session(page);
}

// ───────────── "nothing pops up" watcher ─────────────

/**
 * Selectors of things that would pop up over the map because of a simulation event. The single allowed exception is the
 * failure strip (`.error-chip`, role=alert) and the error text inside the Insights tab (`.sim-error`).
 */
const POPUP_SELECTOR = '.toast, [data-testid=toast], [role=alert], [role=alertdialog], .modal-scrim, dialog[open]';

/**
 * Start recording every pop-up that shows up in the page (call before navigating). Read the result with `popups(page)`.
 * A MutationObserver catches nodes that are added at any time; a fast timer catches ones that become visible.
 */
export async function watchPopups(page: Page): Promise<void> {
  await page.addInitScript((selector) => {
    const found: string[] = [];
    (window as unknown as { __popups: string[]; __watchPopups: boolean }).__popups = found;
    (window as unknown as { __watchPopups: boolean }).__watchPopups = false;
    const allowed = (el: Element): boolean => !!el.closest('.error-chip, .sim-error');
    const visible = (el: Element): boolean => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !(el as HTMLElement).hidden;
    };
    const record = (el: Element, how: string): void => {
      if (allowed(el)) return;
      const tag = `${how}: <${el.tagName.toLowerCase()} class="${(el as HTMLElement).className}" testid="${el.getAttribute('data-testid') ?? ''}"> ${(el.textContent ?? '').trim().slice(0, 60)}`;
      if (!found.includes(tag)) found.push(tag);
    };
    const on = (): boolean => (window as unknown as { __watchPopups: boolean }).__watchPopups;
    const scan = (root: ParentNode, how: string): void => {
      if (root instanceof Element && root.matches(selector)) record(root, how);
      root.querySelectorAll?.(selector).forEach((e) => record(e, how));
    };
    const start = (): void => {
      new MutationObserver((muts) => {
        if (!on()) return;
        for (const m of muts) m.addedNodes.forEach((n) => n instanceof Element && scan(n, 'added'));
      }).observe(document.documentElement, { childList: true, subtree: true });
      setInterval(() => {
        if (!on()) return;
        document.querySelectorAll(selector).forEach((e) => visible(e) && record(e, 'visible'));
      }, 100);
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }, POPUP_SELECTOR);
}

/** Begin (or end) recording. Turn it on once the simulation screen is showing (the safety notice is a modal by design). */
export async function armPopupWatch(page: Page, on = true): Promise<void> {
  await page.evaluate((v) => ((window as unknown as { __watchPopups: boolean }).__watchPopups = v), on);
}

export async function popups(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as unknown as { __popups?: string[] }).__popups ?? [])]);
}

/**
 * Fail if the simulation stopped playing on its own. Call it in a polling loop while a run is in progress: `playing`
 * must stay true until the scenario ends (the only automatic stop besides the app going to the background).
 */
export async function expectStillPlaying(page: Page, duration: number): Promise<SessionView> {
  const s = await session(page);
  if (!s.playing && s.viewTime < duration - 2 && s.seekTarget === null) throw new Error(`playback stopped by itself at ${s.viewTime} s (head ${s.headTime} s)`);
  return s;
}

/** A locator's centre, for gestures. */
export async function centreOf(loc: Locator): Promise<{ x: number; y: number }> {
  const b = await loc.boundingBox();
  if (!b) throw new Error('element is not on screen');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// ───────────── dock ─────────────

export type Detent = 'closed' | 'peek' | 'half' | 'full';
const DETENTS: Detent[] = ['closed', 'peek', 'half', 'full'];

/** Drag the dock's tab row up or down until it rests at the wanted detent (the way a finger resizes it). */
export async function setDock(page: Page, want: Detent): Promise<void> {
  const dock = page.getByTestId('dock');
  for (let i = 0; i < 6; i++) {
    const cur = (await dock.getAttribute('data-detent')) as Detent;
    if (cur === want) return;
    const dir = DETENTS.indexOf(want) > DETENTS.indexOf(cur) ? -1 : 1; // up = a taller panel
    const box = await page.getByTestId('sheet-handle').boundingBox();
    if (!box) throw new Error('the dock is not on screen');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dir * 70, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  }
  await expect(dock).toHaveAttribute('data-detent', want);
}

// ───────────── screenshots ─────────────

/** Wait until every CSS animation / transition on the page has finished (a menu that is still fading in is not a picture). */
export async function animationsDone(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))).then(() => undefined));
  await page.waitForTimeout(250);
}

/**
 * Put two screenshots (PNG buffers) side by side on a plain background and save them as one image: used for the menus,
 * of which only one is open at a time.
 */
export async function composeSideBySide(page: Page, left: Buffer, right: Buffer, path: string, size: { width: number; height: number }): Promise<void> {
  const gap = 24;
  const p = await page.context().newPage();
  try {
    await p.setViewportSize({ width: size.width * 2 + gap * 3, height: size.height + gap * 2 });
    const src = (b: Buffer): string => `data:image/png;base64,${b.toString('base64')}`;
    await p.setContent(
      `<meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;background:#3b4046;display:flex;gap:${gap}px;padding:${gap}px"><img src="${src(left)}" style="width:${size.width}px;height:${size.height}px;border-radius:14px"><img src="${src(right)}" style="width:${size.width}px;height:${size.height}px;border-radius:14px"></body>`,
    );
    await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await p.screenshot({ path });
  } finally {
    await p.close();
  }
}
