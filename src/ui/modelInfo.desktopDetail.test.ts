/**
 * "How sure are we?" for a run made with a finer Desktop detail (0.9.0, D35): the owner's words come first in that section, in the warning
 * style, with what the run used and the one scenario that shows the grids disagree; the text export carries them; the planned fire cell is the
 * level's; and a card for the standard detail has none of it (it is the card 0.8.0 made).
 */
import { describe, expect, it } from 'vitest';
import { syntheticScenario } from '../sim/testing/scenarios';
import { applyDetail } from './desktopDetailChoice';
import { DETAIL_LABEL } from './desktopDetail';
import { cardToText, describeModel, type ModelCard } from './modelInfo';
import { DEFAULT_SETTINGS } from './settings';
import { buildRequest, defaultSetup } from './setupModel';

const settings = { ...DEFAULT_SETTINGS };
const sure = (c: ModelCard) => c.sections.find((s) => s.id === 'sure')!;
const warns = (c: ModelCard): string[] => sure(c).blocks.flatMap((b) => (b.type === 'text' && b.tone === 'warn' ? [b.text] : []));
const row = (c: ModelCard, id: string) => c.sections.find((s) => s.id === 'glance')!.blocks.flatMap((b) => (b.type === 'rows' ? b.rows : [])).find((r) => r.id === id)!;

describe('the model card of a run with a finer level', () => {
  it('a Setup preview with the level: the first warning of "How sure are we?" is the label and what the run uses, the slope warning stays after it', () => {
    const req = applyDetail(buildRequest({ ...defaultSetup(), where: 'demo', demoSiteId: 'katoomba' }, settings), 'finest');
    const card = describeModel({ scenario: null, request: req, settings });
    const w = warns(card);
    expect(w).toHaveLength(2);
    expect(w[0]!.startsWith(DETAIL_LABEL)).toBe(true);
    expect(w[0]).toMatch(/finest detail: fire cells of 10.m instead of 30.m and up to 8,000 embers/);
    expect(w[0]).toMatch(/2,483 ha at 30.m and 2,738 ha at 10.m.*1,002 and 1,520 ha with embers off/);
    expect(w[0]).toMatch(/Compare runs made with the same detail\.$/);
    expect(w[1]).toMatch(/On slopes steeper than about/);
    // The planned grid is the level's, not 30 m.
    expect(row(card, 'fire').resolution).toMatch(/10.m/);
  });

  it('a run: the grid and the embers are the scenario\'s own, and the label is in the text export', () => {
    const sc = syntheticScenario({ extent: 3000, options: { desktopDetail: 'finer', maxEmbers: 8000, fireCellSize: 20 } });
    const card = describeModel({ scenario: sc, settings });
    expect(warns(card)[0]).toMatch(new RegExp(`^${DETAIL_LABEL}\\. This run uses the desktop's finer detail: fire cells of ${sc.terrain.grid.cellSize}.m`));
    expect(cardToText(card)).toContain(DETAIL_LABEL);
  });

  it('the standard detail has no such warning and no mention anywhere in the card', () => {
    const card = describeModel({ scenario: null, request: buildRequest({ ...defaultSetup(), where: 'demo', demoSiteId: 'katoomba' }, settings), settings });
    expect(warns(card)).toHaveLength(1);
    expect(JSON.stringify(card)).not.toMatch(/Finer grid/);
    const run = describeModel({ scenario: syntheticScenario({ extent: 3000 }), settings });
    expect(JSON.stringify(run)).not.toMatch(/Finer grid/);
  });
});
