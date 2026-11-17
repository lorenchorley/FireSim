/**
 * What a run made with a finer Desktop detail adds to the simulation screen (0.9.0, D35), as one lazy chunk that only such a run loads (the first
 * screen carries none of it): the history budget it gets, the label on the map, and the one question "Continue on this device" must ask first (can
 * this device run that grid by itself?). The scenario is the record: `scenario.options.desktopDetail`, set when the run was built, so a run restarted on
 * this device after the desktop went away keeps its label, and nothing here reads a speed, a display or a statistic.
 */
import type { ScenarioData } from '../core/types';
import { deviceRefusal, historyBudgetFor, levelOf, pageClassOf, runLabel } from './desktopDetail';
import { defaultSnapshotBudget } from './session';
import { h } from './dom';

/** The session's options for a run: its history budget. `{}` for the standard detail, so the session is exactly the one 0.8.0 made. */
export function sessionOptions(scenario: ScenarioData, nav: Parameters<typeof pageClassOf>[0] = globalThis.navigator): { maxBytes?: number } {
  const level = levelOf(scenario.options);
  if (!level) return {};
  const page = pageClassOf(nav);
  return { maxBytes: historyBudgetFor(level, defaultSnapshotBudget(page.memoryGb ?? undefined), page) };
}

/**
 * The label on the map, after the engine's own (the demo engine's slot, "Running on the desktop"): the owner's words and the cell of the run. It is
 * a note on the screen, never a pop-up. Returns the function that takes it out. Null for the standard detail.
 */
export function mountLabel(root: HTMLElement, scenario: ScenarioData): (() => void) | null {
  const level = levelOf(scenario.options);
  if (!level) return null;
  const el = h('p', { class: 'mock-banner detail-banner', dataset: { testid: 'detail-banner' } }, runLabel(level));
  root.append(el);
  return () => el.remove();
}

/**
 * Whether this device can take the run over by itself when the desktop is gone. Null for the standard detail and for a grid this device can hold
 * (the restart then goes ahead and the run keeps its label); else the sentence and the one thing offered: set up again at the standard detail.
 */
export function continueRefusal(scenario: ScenarioData, nav: Parameters<typeof pageClassOf>[0] = globalThis.navigator): ReturnType<typeof deviceRefusal> {
  const level = levelOf(scenario.options);
  if (!level) return null;
  const page = pageClassOf(nav);
  return deviceRefusal({
    level,
    extentM: scenario.extent,
    durationS: scenario.duration,
    tier: scenario.options.tier ?? 'auto',
    maxEmbers: scenario.options.maxEmbers ?? 4000,
    snapshotIntervalS: scenario.options.snapshotInterval,
    page,
    baseBudget: defaultSnapshotBudget(page.memoryGb ?? undefined),
  });
}
