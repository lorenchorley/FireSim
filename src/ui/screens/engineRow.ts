/**
 * The "Engine" row of Setup (0.8.0, workstream J), drawn only when the page was served by a desktop host: This device / Desktop
 * (NAME, N cores), and, when Desktop is chosen without a code, a box for the code the desktop shows. A refused code and an
 * unreachable desktop are said in words under the box, in the callout Setup uses for its other notes: nothing pops up and
 * nothing is announced as an alert. The choice and the code are kept by the page's desktop object for this page load only
 * (src/ui/desktopHost.ts); this file only draws them. Added to the Run card by Setup when a host is found (desktopSlot.ts), so a
 * page without a host has exactly the Setup it always had.
 */
import type { DesktopHost, DesktopView, EngineChoice } from '../desktopHost';
import { CODE_LABEL, CODE_PLACEHOLDER, CONTINUE_HERE, desktopChoiceLabel, ENGINE_HINT, ENGINE_LABEL, ENGINE_PROBLEM, ENGINE_THIS_DEVICE } from '../desktopWords';
import { h, setChildren, show, uniqueId } from '../dom';
import { icon } from '../icons';
import { button, chipChoice } from '../widgets';

const PROBLEM_WORDS = { 'needs-code': ENGINE_PROBLEM.needsCode, refused: ENGINE_PROBLEM.refused, unreachable: ENGINE_PROBLEM.unreachable } as const;

/**
 * Adds the row to `card` and keeps it in step with `host`. `build` presses Setup's Build button. Returns the function that takes it out again.
 * When the desktop cannot be reached the note offers "Continue on this device": a tap chooses This device and presses Build (the model is
 * built, and the run starts on this device from its start); nothing of it is automatic.
 */
export function mountEngineRow(host: DesktopHost, card: HTMLElement, build: () => void): () => void {
  // A Setup shown again forgets the run that ended (and closes a link nobody used).
  host.release();
  const hintId = uniqueId('engine-hint');
  const codeId = uniqueId('engine-code');
  const choice = chipChoice<EngineChoice>({
    label: ENGINE_LABEL,
    options: [
      { value: 'device', label: ENGINE_THIS_DEVICE },
      { value: 'desktop', label: desktopChoiceLabel(host.info) },
    ],
    value: host.state.get().engine,
    testId: 'engine',
    onChange: (v) => host.choose(v),
  });
  const input = h('input', {
    type: 'text',
    id: codeId,
    inputMode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
    maxLength: 32,
    placeholder: CODE_PLACEHOLDER,
    value: host.typedCode(),
    dataset: { testid: 'engine-code' },
    aria: { describedby: hintId },
    on: { input: () => host.typeCode(input.value) },
  });
  const field = h('div', { class: 'field engine-code', dataset: { testid: 'engine-code-field' } }, [
    h('label', { class: 'field-label', htmlFor: codeId }, CODE_LABEL),
    h('div', { class: 'input-wrap' }, input),
  ]);
  // One note that is always there (so a screen reader has the region before the words change): the hint, or what went wrong.
  const note = h('div', { class: 'engine-note', id: hintId, attrs: { 'aria-live': 'polite' }, dataset: { testid: 'engine-note' } });
  const row = h('div', { class: 'engine-row', dataset: { testid: 'engine-row' } }, [choice.el, field, note]);
  card.append(row);

  let shown = '';
  const draw = (s: Readonly<DesktopView>): void => {
    choice.set(s.engine);
    if (!s.hasCode && input.value) input.value = ''; // a refused code is forgotten, in the box too
    const wantsCode = s.engine === 'desktop' && !(s.hasCode && s.fromLink);
    show(field, wantsCode);
    input.disabled = s.busy;
    // The note is rebuilt only when what it says changes (a live region must not be rewritten with the same words).
    const says = `${s.engine}|${wantsCode}|${s.hasCode}|${s.busy ? 'busy' : s.problem}`;
    if (says === shown) return;
    shown = says;
    if (!s.busy && s.problem) {
      const act =
        s.problem === 'unreachable'
          ? button({
              label: CONTINUE_HERE,
              variant: 'secondary',
              testId: 'continue-here-setup',
              onClick: () => {
                host.choose('device');
                build();
              },
            })
          : null;
      setChildren(note, h('div', { class: 'callout callout-warn', dataset: { testid: 'engine-problem' } }, [icon('warning'), h('div', null, [PROBLEM_WORDS[s.problem], act && h('div', { class: 'engine-act' }, act)])]));
      // Build is pressed at the bottom of the screen: the words must not be left out of sight above it.
      row.scrollIntoView({ block: 'center' });
      if (s.problem !== 'unreachable' && wantsCode) input.focus({ preventScroll: true });
      return;
    }
    const hint = s.busy ? ENGINE_HINT.connecting : s.engine === 'device' ? ENGINE_HINT.device : s.hasCode && s.fromLink ? ENGINE_HINT.desktopLink : ENGINE_HINT.desktopCode;
    setChildren(note, h('p', { class: 'hint', dataset: { testid: 'engine-hint' } }, hint));
  };
  draw(host.state.get());
  const unsub = host.state.subscribe(draw);
  return () => {
    unsub();
    row.remove();
  };
}
