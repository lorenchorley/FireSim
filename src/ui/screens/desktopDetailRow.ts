/**
 * The "Desktop detail" row of Setup (0.9.0, D35): Standard, Finer (20 m cells) and Finest (10 m cells), drawn under the Engine row and only while the
 * engine chosen is the desktop (so it is never offered for this device, and a page without a desktop host never has it). What a level sets and what
 * a result with it is are in src/ui/desktopDetail.ts; the choice itself (kept for this page load only, like the Engine choice) is in
 * src/ui/desktopDetailChoice.ts, which Setup reads to draw its own cells and to build the request. This file draws the chips, says in words what the
 * level is ("Finer grid, results differ, not validated" next to the chips, in the callout Setup uses for its other notes) and gives Setup's validation
 * the sentence that refuses a level this page cannot keep the pictures of. Nothing pops up and nothing is announced as an alert.
 */
import type { DesktopHost } from '../desktopHost';
import { DETAIL_CHOICES, DETAIL_LABEL, DETAIL_ROW_LABEL, DETAIL_WHERE, detailChipLabel, detailHint, pageClassOf, snapshotRefusal } from '../desktopDetail';
import { chosenDetail, detailChoice, detailGate, type DetailChoice } from '../desktopDetailChoice';
import { h, setChildren, show, uniqueId } from '../dom';
import { icon } from '../icons';
import { defaultSnapshotBudget } from '../session';
import { chipChoice } from '../widgets';

/** Adds the row to `card` and keeps it in step with the engine choice. Returns the function that takes it out again. */
export function mountDetailRow(host: DesktopHost, card: HTMLElement): () => void {
  const hintId = uniqueId('detail-hint');
  const choice = chipChoice<DetailChoice>({
    label: DETAIL_ROW_LABEL,
    options: DETAIL_CHOICES.map((value) => ({ value, label: detailChipLabel(value) })),
    value: detailChoice.get().level,
    testId: 'desktop-detail',
    onChange: (level) => detailChoice.set({ level }),
  });
  choice.el.setAttribute('aria-describedby', hintId);
  const note = h('div', { class: 'engine-note', id: hintId, dataset: { testid: 'desktop-detail-note' } });
  const row = h('div', { class: 'engine-row detail-row', dataset: { testid: 'desktop-detail-row' } }, [choice.el, note]);
  card.append(row);

  // Build is refused next to the other things that are wrong with the form, with the sentence of the pure model (nothing is built, nothing is lowered).
  const page = pageClassOf(globalThis.navigator);
  detailGate.refusal = (extentKm) => {
    const level = chosenDetail();
    return level ? (snapshotRefusal({ level, extentM: extentKm * 1000, page, baseBudget: defaultSnapshotBudget(page.memoryGb ?? undefined) })?.sentence ?? null) : null;
  };

  let shown = '';
  const draw = (): void => {
    const onDesktop = host.state.get().engine === 'desktop';
    const level = detailChoice.get().level;
    show(row, onDesktop);
    choice.set(level);
    const says = `${onDesktop}|${level}`;
    if (says === shown) return;
    shown = says;
    const children = [h('p', { class: 'hint', dataset: { testid: 'desktop-detail-hint' } }, detailHint(level))];
    if (level !== 'standard') children.push(h('div', { class: 'callout callout-warn', dataset: { testid: 'desktop-detail-label' } }, [icon('warning'), h('div', null, DETAIL_LABEL)]));
    children.push(h('p', { class: 'hint' }, DETAIL_WHERE));
    setChildren(note, children);
  };
  draw();
  // The engine choice changing redraws Setup's own cells too (a level applies only while the desktop is the engine): `touched` tells it.
  const bump = (): void => detailChoice.set((s) => ({ touched: s.touched + 1 }));
  const stops = [
    host.state.subscribe(() => {
      draw();
      bump();
    }, ['engine']),
    detailChoice.subscribe(draw, ['level']),
  ];
  return () => {
    for (const stop of stops) stop();
    detailGate.refusal = null;
    row.remove();
  };
}
