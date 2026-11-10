/**
 * The Desktop detail choice and where it reaches the Setup model (0.9.0, D35): a finer level applies only while the desktop is the engine chosen,
 * the request carries the level and its cell and embers, Setup's chips and hint say the cell the build will make, and a level this page cannot keep the
 * pictures of is refused by Setup's validation, before anything is built. With no level everything is what 0.8.0 made.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRequest } from '../scenario/build';
import { applyDetail, chosenDetail, chosenDetailRefusal, detailChoice, detailGate, levelOf } from './desktopDetailChoice';
import type { DesktopApi } from './desktopSlot';
import { desktopSlot } from './desktopSlot';
import { buildRequest, defaultSetup, detailCell, detailChoices, validateSetup } from './setupModel';
import { Store } from './store';

const NOW = Date.UTC(2026, 10, 8, 3, 0);

/** A host as far as the choice reads it: the engine chosen. */
function host(engine: 'device' | 'desktop'): { api: DesktopApi; state: Store<{ engine: 'device' | 'desktop' }> } {
  const state = new Store<{ engine: 'device' | 'desktop' }>({ engine });
  return { api: { state } as unknown as DesktopApi, state };
}

const setup = (over: Partial<ReturnType<typeof defaultSetup>> = {}) => ({ ...defaultSetup(NOW), where: 'demo' as const, demoSiteId: 'katoomba', ...over });

beforeEach(() => {
  detailChoice.set({ level: 'standard' });
  detailGate.refusal = null;
  desktopSlot.set({ host: null, run: null });
});
afterEach(() => {
  detailChoice.set({ level: 'standard' });
  detailGate.refusal = null;
  desktopSlot.set({ host: null, run: null });
});

describe('what a run built now would have', () => {
  it('is the standard detail on a page with no desktop host, whatever was chosen', () => {
    detailChoice.set({ level: 'finest' });
    expect(chosenDetail()).toBeNull();
  });

  it('is the level chosen only while the engine chosen is the desktop (This device builds a standard run)', () => {
    const h = host('device');
    desktopSlot.set({ host: h.api });
    detailChoice.set({ level: 'finest' });
    expect(chosenDetail()).toBeNull();
    h.state.set({ engine: 'desktop' });
    expect(chosenDetail()).toBe('finest');
    detailChoice.set({ level: 'finer' });
    expect(chosenDetail()).toBe('finer');
    detailChoice.set({ level: 'standard' });
    expect(chosenDetail()).toBeNull();
    // The link ended and the engine choice went back to This device: no level is left behind for the next build.
    detailChoice.set({ level: 'finest' });
    h.state.set({ engine: 'device' });
    expect(chosenDetail()).toBeNull();
  });
});

describe('buildRequest', () => {
  it('with no level the request is exactly what 0.8.0 made: no desktopDetail key, 30 m, the performance profile\'s embers and tier', () => {
    const req = buildRequest(setup(), 'auto', NOW);
    expect(req.options).toEqual({ fireCellSize: 30, maxEmbers: 3000, tier: 'auto' });
    expect('desktopDetail' in (req.options ?? {})).toBe(false);
    const quality = buildRequest(setup({ detail: 'detailed' }), 'quality', NOW);
    expect(quality.options).toEqual({ fireCellSize: 20, maxEmbers: 4000, tier: 'high' });
  });

  it('with the desktop and a level it carries the level, its cell and its embers, and keeps the person\'s tier and steps', () => {
    const h = host('desktop');
    desktopSlot.set({ host: h.api });
    detailChoice.set({ level: 'finest' });
    const req = buildRequest(setup(), { performance: 'quality', timeStep: 30, solverStep: 5 }, NOW);
    expect(req.options).toEqual({ fireCellSize: 10, maxEmbers: 8000, tier: 'high', snapshotInterval: 30, maxStepS: 5, desktopDetail: 'finest' });
    // The Fast option of Setup is the fast tier at the level's cell (what 15e measured).
    expect(buildRequest(setup({ detail: 'fast' }), 'auto', NOW).options).toMatchObject({ fireCellSize: 10, tier: 'fast', desktopDetail: 'finest' });
    detailChoice.set({ level: 'finer' });
    expect(buildRequest(setup(), 'auto', NOW).options).toMatchObject({ fireCellSize: 20, maxEmbers: 8000, tier: 'auto', desktopDetail: 'finer' });
  });

  it('the builder makes the level\'s cell at every area Setup offers, never the phone\'s 30 m or its 6 km rule for 20 m', () => {
    const h = host('desktop');
    desktopSlot.set({ host: h.api });
    for (const level of ['finer', 'finest'] as const) {
      detailChoice.set({ level });
      for (const extentKm of [3, 6, 9] as const)
        for (const detail of ['fast', 'normal', 'detailed'] as const) {
          const req = buildRequest(setup({ extentKm, detail }), 'auto', NOW);
          const rr = resolveRequest(req);
          expect(rr.fireCellSize, `${level} ${extentKm} km ${detail}`).toBe(level === 'finer' ? 20 : 10);
          expect(rr.extent).toBe(extentKm * 1000);
          expect(rr.warnings).toEqual([]);
        }
    }
  });

  it('a level changes nothing in a request that was already made', () => {
    const h = host('desktop');
    desktopSlot.set({ host: h.api });
    const standard = buildRequest(setup(), 'auto', NOW);
    detailChoice.set({ level: 'finest' });
    expect(standard.options?.desktopDetail).toBeUndefined();
    expect(applyDetail(standard, 'finest')).not.toBe(standard);
    expect(standard.options?.fireCellSize).toBe(30);
    expect(levelOf(buildRequest(setup(), 'auto', NOW).options)).toBe('finest');
  });
});

describe('Setup\'s chips and hint say what the build will make', () => {
  it('the cell of every Detail chip follows the level, and is 0.8.0\'s with none', () => {
    expect(detailChoices(6, 'auto').map((c) => c.label)).toEqual(['Fast · 30 m 2-D', 'Normal · 30 m', 'Detailed · 20 m']);
    expect(detailChoices(6, 'auto', null).map((c) => c.label)).toEqual(['Fast · 30 m 2-D', 'Normal · 30 m', 'Detailed · 20 m']);
    expect(detailChoices(9, 'auto', 'finest').map((c) => c.label)).toEqual(['Fast · 10 m 2-D', 'Normal · 10 m', 'Detailed · 10 m']);
    expect(detailChoices(9, 'auto', 'finer').map((c) => c.label)).toEqual(['Fast · 20 m 2-D', 'Normal · 20 m', 'Detailed · 20 m']);
    const c = detailCell(6, 'normal', 'auto', 'finest');
    expect(c).toMatchObject({ cellM: 10, n: 600, cells: 360000, coarsened: false });
    expect(detailCell(9, 'detailed', 'auto')).toMatchObject({ cellM: 30, coarsened: true });
  });
});

describe('Setup refuses a level this page cannot keep the pictures of', () => {
  it('asks the gate the row set, only for a chosen level, and adds its sentence to the form\'s errors', () => {
    const h = host('desktop');
    desktopSlot.set({ host: h.api });
    detailGate.refusal = (km) => (km === 9 ? 'This device cannot keep the pictures of 10 m cells over 9 km.' : null);
    expect(chosenDetailRefusal(9)).toBeNull(); // no level chosen: nothing to refuse
    expect(validateSetup(setup({ extentKm: 9 }), NOW)).toEqual([]);
    detailChoice.set({ level: 'finest' });
    expect(chosenDetailRefusal(6)).toBeNull();
    expect(chosenDetailRefusal(9)).toMatch(/cannot keep the pictures/);
    expect(validateSetup(setup({ extentKm: 6 }), NOW)).toEqual([]);
    expect(validateSetup(setup({ extentKm: 9 }), NOW)).toEqual(['This device cannot keep the pictures of 10 m cells over 9 km.']);
    // With This device chosen the level does not apply, so nothing is refused.
    h.state.set({ engine: 'device' });
    expect(validateSetup(setup({ extentKm: 9 }), NOW)).toEqual([]);
  });
});
