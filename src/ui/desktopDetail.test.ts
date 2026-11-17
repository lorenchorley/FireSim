/**
 * The Desktop detail setting (0.9.0, D35): what each level sets, the words, and the page's two memory rules. Pure: no DOM, no engine.
 * The numbers pinned here come from plan 15e "Measured" (a snapshot of 16 MB at 10 m over 6 km and 39 MB over 9 km; 30 m about 2 MB) and from the
 * history budget of `defaultSnapshotBudget` (6 % of the device's memory, 48 to 160 MiB).
 */
import { describe, expect, it } from 'vitest';
import type { ScenarioRequest } from '../scenario/request';
import { SCENARIO_PARAMS } from '../scenario/params';
import { SIM_PARAMS } from '../sim/params';
import {
  ASSUMED_MEMORY_GB,
  DESKTOP_HISTORY_BUDGET,
  DETAIL_CHOICES,
  DETAIL_LABEL,
  PICTURES_KEPT_MIN,
  applyDetail,
  detailChipLabel,
  detailHint,
  deviceRefusal,
  historyBudgetFor,
  isDesktopClass,
  levelCellM,
  levelEmbers,
  levelOf,
  modelCardWords,
  pageClassOf,
  pictureBytes,
  runLabel,
  snapshotRefusal,
  statsWords,
  type PageClass,
} from './desktopDetail';
import { defaultSnapshotBudget } from './session';

const MIB = 1024 * 1024;
const PHONE: PageClass = { mobile: true, memoryGb: 4 };
const DESKTOP: PageClass = { mobile: false, memoryGb: 8 };

const request = (options: ScenarioRequest['options'] = {}): ScenarioRequest => ({
  name: 'Katoomba',
  centre: { lat: -33.7, lon: 150.3 },
  extent: 6000,
  weather: { kind: 'preset', presetId: 'hot-nw-sw-change', start: 0 },
  duration: 3600,
  online: false,
  options,
});

describe('the levels', () => {
  it('Standard changes nothing; Finer is 20 m and Finest 10 m, both whole multiples of the 10 m ground model, with 8,000 embers', () => {
    expect(DETAIL_CHOICES).toEqual(['standard', 'finer', 'finest']);
    expect(levelCellM('standard')).toBeNull();
    expect(levelEmbers('standard')).toBeNull();
    expect(levelCellM('finer')).toBe(20);
    expect(levelCellM('finest')).toBe(10);
    expect(levelEmbers('finer')).toBe(8000);
    expect(levelEmbers('finest')).toBe(8000);
    for (const c of ['finer', 'finest'] as const) expect(SCENARIO_PARAMS.desktopDetailCellM[c] % SCENARIO_PARAMS.hiResCellM).toBe(0);
  });

  it('applyDetail sets the cell, the embers and the record, keeps the air tier and every other setting, and does not touch the request it is given', () => {
    const base = request({ tier: 'high', maxEmbers: 3000, snapshotInterval: 30, maxStepS: 5, fireCellSize: 30 });
    const frozen = JSON.stringify(base);
    const out = applyDetail(base, 'finest');
    expect(out.options).toEqual({ tier: 'high', maxEmbers: 8000, snapshotInterval: 30, maxStepS: 5, fireCellSize: 10, desktopDetail: 'finest' });
    expect(JSON.stringify(base)).toBe(frozen);
    expect(out).not.toBe(base);
    expect(applyDetail(base, 'finer').options).toMatchObject({ fireCellSize: 20, maxEmbers: 8000, desktopDetail: 'finer', tier: 'high' });
    // The Auto tier stays Auto: the engine (the desktop's) decides it by its own timing; the level never picks a tier.
    expect(applyDetail(request({ tier: 'auto' }), 'finer').options?.tier).toBe('auto');
  });

  it('with no level the request is given back as it is (the standard detail adds nothing, not even a key)', () => {
    const base = request({ tier: 'auto', maxEmbers: 3000 });
    expect(applyDetail(base, null)).toBe(base);
    expect('desktopDetail' in (applyDetail(base, null).options ?? {})).toBe(false);
  });

  it('levelOf reads the record of a scenario or a request, and anything that is not a level is the standard detail', () => {
    expect(levelOf({ desktopDetail: 'finer' })).toBe('finer');
    expect(levelOf({ desktopDetail: 'finest' })).toBe('finest');
    expect(levelOf({})).toBeNull();
    expect(levelOf(undefined)).toBeNull();
    expect(levelOf({ desktopDetail: 'standard' as never })).toBeNull();
    expect(levelOf({ desktopDetail: 'coarse' as never })).toBeNull();
  });
});

describe('the words', () => {
  it('the label is the owner\'s words, exactly', () => {
    expect(DETAIL_LABEL).toBe('Finer grid, results differ, not validated');
  });

  it('every place a result is shown says it, with the cell of the run', () => {
    expect(runLabel('finest')).toBe('Finer grid, results differ, not validated · 10\u00a0m cells');
    expect(runLabel('finer')).toBe('Finer grid, results differ, not validated · 20\u00a0m cells');
    expect(statsWords('finest', 10, 8000).value).toBe(DETAIL_LABEL);
    expect(statsWords('finer', 20, 8000).note).toMatch(/20.m.*8,000 embers.*30.m cells/);
    const card = modelCardWords('finest', 10, 8000);
    expect(card.startsWith(DETAIL_LABEL)).toBe(true);
    expect(card).toMatch(/2,483 ha at 30.m and 2,738 ha at 10.m/);
    expect(card).toMatch(/1,002 and 1,520 ha with embers off/);
    expect(card).toMatch(/Nothing says which is closer to a real fire/);
  });

  it('the chips name the cell, the hint says the cost and that the High air stays the person\'s choice, and Standard has no label', () => {
    expect(DETAIL_CHOICES.map(detailChipLabel)).toEqual(['Standard', 'Finer · 20 m', 'Finest · 10 m']);
    expect(detailHint('standard')).not.toMatch(/results differ/);
    expect(detailHint('finer')).toMatch(/20 m.*8,000 embers.*About 2 times the work.*High 3-D air is allowed and stays your choice in Settings/);
    expect(detailHint('finest')).toMatch(/10 m.*About 9 times the work.*16 MB a picture over 6 km/);
  });

  it('is in the voice of the app: no em dashes, no exclamation marks, nothing undefined or NaN', () => {
    const all = [DETAIL_LABEL, runLabel('finer'), runLabel('finest'), ...DETAIL_CHOICES.flatMap((c) => [detailChipLabel(c), detailHint(c)]), modelCardWords('finer', 20, 8000), statsWords('finest', 10, 8000).note];
    for (const t of all) {
      expect(t, t).not.toMatch(/—|!|undefined|NaN|null/);
    }
  });
});

describe('the page class and the history budget (a phone never gets more)', () => {
  it('reads the browser\'s own words: a hint wins, else the user agent, an iPad that asks for the desktop site is a tablet', () => {
    expect(pageClassOf({ userAgentData: { mobile: true }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', deviceMemory: 8 })).toEqual({ mobile: true, memoryGb: 8 });
    expect(pageClassOf({ userAgentData: { mobile: false }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', deviceMemory: 8 })).toEqual({ mobile: false, memoryGb: 8 });
    expect(pageClassOf({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', deviceMemory: 8 }).mobile).toBe(true);
    expect(pageClassOf({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }).mobile).toBe(true);
    expect(pageClassOf({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5 }).mobile).toBe(true);
    expect(pageClassOf({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 0 }).mobile).toBe(false);
    expect(pageClassOf({ userAgentData: { mobile: false }, userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 }).mobile).toBe(true);
    expect(pageClassOf(undefined)).toEqual({ mobile: null, memoryGb: null });
    expect(pageClassOf({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0' })).toEqual({ mobile: false, memoryGb: null });
  });

  it('only a page that says it is not a phone and reports the most memory a browser reports is desktop-class', () => {
    expect(isDesktopClass(DESKTOP)).toBe(true);
    expect(isDesktopClass({ mobile: false, memoryGb: 4 })).toBe(false);
    expect(isDesktopClass({ mobile: false, memoryGb: null })).toBe(false);
    expect(isDesktopClass({ mobile: null, memoryGb: 8 })).toBe(false);
    expect(isDesktopClass({ mobile: true, memoryGb: 8 })).toBe(false);
  });

  it('the standard detail never changes the budget, whatever the page', () => {
    for (const page of [PHONE, DESKTOP, { mobile: null, memoryGb: null }]) for (const base of [48 * MIB, 96 * MIB, 160 * MIB]) expect(historyBudgetFor(null, base, page)).toBe(base);
  });

  it('a phone\'s page keeps exactly defaultSnapshotBudget at every level, for every memory class a browser reports (no growth on a phone)', () => {
    for (const level of ['finer', 'finest'] as const)
      for (const memoryGb of [0.25, 0.5, 1, 2, 3, 4, 8, null])
        for (const mobile of [true, null]) {
          const base = defaultSnapshotBudget(memoryGb ?? undefined);
          expect(historyBudgetFor(level, base, { mobile, memoryGb }), `${level} ${memoryGb} GB mobile=${mobile}`).toBe(base);
        }
    // A desktop browser that reports less than the top class does not grow either.
    for (const memoryGb of [0.5, 1, 2, 4, null]) expect(historyBudgetFor('finest', defaultSnapshotBudget(memoryGb ?? undefined), { mobile: false, memoryGb })).toBe(defaultSnapshotBudget(memoryGb ?? undefined));
  });

  it('a desktop-class page gets 384 MiB at a finer level, which keeps 24 pictures of 16 MB where 160 MiB keeps 10', () => {
    expect(DESKTOP_HISTORY_BUDGET).toBe(384 * MIB);
    expect(historyBudgetFor('finest', defaultSnapshotBudget(8), DESKTOP)).toBe(384 * MIB);
    expect(historyBudgetFor('finer', defaultSnapshotBudget(8), DESKTOP)).toBe(384 * MIB);
    expect(Math.floor((384 * MIB) / 16e6)).toBeGreaterThanOrEqual(24);
    expect(Math.floor((160 * MIB) / 16e6)).toBe(10);
  });
});

describe('the size of a picture (plan 15e: 16 MB at 10 m over 6 km, 39 MB over 9 km, about 2 MB at 30 m)', () => {
  it('agrees with what 15e measured', () => {
    const mb = (extent: number, cell: number): number => pictureBytes(extent, cell) / 1e6;
    expect(mb(6000, 10)).toBeGreaterThan(15);
    expect(mb(6000, 10)).toBeLessThan(18);
    expect(mb(9000, 10)).toBeGreaterThan(35);
    expect(mb(9000, 10)).toBeLessThan(42);
    expect(mb(6000, 30)).toBeGreaterThan(1.5);
    expect(mb(6000, 30)).toBeLessThan(3);
    expect(mb(6000, 20)).toBeGreaterThan(mb(6000, 30));
    expect(mb(6000, 20)).toBeLessThan(mb(6000, 10));
  });
});

describe('the page can refuse a detail whose pictures it cannot keep, with a sentence', () => {
  const refuse = (level: 'finer' | 'finest', extentKm: number, page: PageClass, memoryGb = page.memoryGb ?? undefined): string | null =>
    snapshotRefusal({ level, extentM: extentKm * 1000, page, baseBudget: defaultSnapshotBudget(memoryGb) })?.sentence ?? null;

  it('keeps room for at least three pictures: a phone of 4 GB takes 10 m over 6 km and 9 km, a phone of 1 GB takes 6 km but not 9 km', () => {
    expect(PICTURES_KEPT_MIN).toBe(3);
    expect(refuse('finest', 6, PHONE)).toBeNull();
    expect(refuse('finest', 9, PHONE)).toBeNull();
    expect(refuse('finest', 6, { mobile: true, memoryGb: 1 })).toBeNull();
    const nine = refuse('finest', 9, { mobile: true, memoryGb: 1 });
    expect(nine).toMatch(/^This device cannot keep the pictures of 10.m cells over 9.km: each is about 3\d\.\d.MB and its history has room for about 1 \(6\d\.\d.MB\)\./);
    expect(nine).toMatch(/Choose a smaller area or the Finer level\.$/);
  });

  it('says what to choose instead for each level, and says less than one when not even one fits', () => {
    expect(refuse('finer', 9, { mobile: true, memoryGb: 0.25 })).toBeNull(); // about 9 MB a picture in 48 MiB
    const tiny = snapshotRefusal({ level: 'finest', extentM: 9000, page: PHONE, baseBudget: 20 * MIB })!.sentence;
    expect(tiny).toMatch(/room for less than one/);
    const finer = snapshotRefusal({ level: 'finer', extentM: 9000, page: PHONE, baseBudget: 8 * MIB })!.sentence;
    expect(finer).toMatch(/Choose a smaller area or the standard detail\.$/);
  });

  it('a desktop-class page, with its larger budget, takes what a phone cannot', () => {
    const base = 20 * MIB;
    expect(snapshotRefusal({ level: 'finest', extentM: 9000, page: PHONE, baseBudget: base })).not.toBeNull();
    expect(snapshotRefusal({ level: 'finest', extentM: 9000, page: DESKTOP, baseBudget: base })).toBeNull();
  });
});

describe('"Continue on this device" after a desktop run with a finer level: can this device run that grid by itself?', () => {
  const ask = (level: 'finer' | 'finest', extentM: number, page: PageClass) =>
    deviceRefusal({ level, extentM, durationS: 4 * 3600, tier: 'auto', maxEmbers: 8000, snapshotIntervalS: 60, page, baseBudget: defaultSnapshotBudget(page.memoryGb ?? undefined) });

  it('a phone of 4 GB can run 20 m over 6 km by itself, and cannot run 10 m over 9 km', () => {
    expect(ask('finer', 6000, PHONE)).toBeNull();
    const r = ask('finest', 9000, PHONE)!;
    expect(r).not.toBeNull();
    expect(r.sentence).toMatch(/^This device cannot run the 10.m grid of this run by itself: it needs about \d\.\d.GB of memory, it reports about 4 GB, and about a third of that is what an app can use\./);
    expect(r.sentence).toMatch(/It would not be switched to a coarser grid for you\.$/);
    expect(r.short).toBe('This device cannot run the 10 m grid of this run.');
    expect(r.action).toBe('Set up at the standard detail');
  });

  it('a device that does not say its memory is taken as 3 GB, and says so', () => {
    expect(ASSUMED_MEMORY_GB).toBe(3);
    const r = ask('finest', 9000, { mobile: null, memoryGb: null })!;
    expect(r.sentence).toMatch(/it reports no memory size, so 3 GB is assumed/);
  });

  it('a desktop-class page can run more than a phone', () => {
    const need = (page: PageClass) => ask('finest', 6000, page);
    expect(need({ mobile: true, memoryGb: 2 })).not.toBeNull();
    expect(need(DESKTOP)).toBeNull();
  });

  it('never lowers the grid: it only says no and offers the standard detail', () => {
    const r = ask('finest', 9000, { mobile: true, memoryGb: 2 })!;
    expect(Object.keys(r).sort()).toEqual(['action', 'sentence', 'short']);
  });
});

describe('the cost figures the hint quotes are 15e\'s (one study, one computer)', () => {
  it('11.7 s and 47.0 s an hour against 5.3 s: about 2.2 and 8.9 times', () => {
    expect(Math.round((11.7 / 5.3) * 10) / 10).toBe(2.2);
    expect(Math.round((47.0 / 5.3) * 10) / 10).toBe(8.9);
    expect(SIM_PARAMS.desktopDetailMaxEmbers.finer).toBe(8000);
  });
});
