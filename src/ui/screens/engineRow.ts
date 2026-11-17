/**
 * The "Engine" row of Setup (0.8.0, workstream J), drawn only when the page was served by a desktop host: This device / Desktop
 * (NAME, N cores), and, when Desktop is chosen without a code, a box for the code the desktop shows. A refused code and an
 * unreachable desktop are said in words under the box, in the callout Setup uses for its other notes: nothing pops up and
 * nothing is announced as an alert. The choice and the code are kept by the page's desktop object for this page load only
 * (src/ui/desktopHost.ts); this file only draws them. Added to the Run card by Setup when a host is found (desktopSlot.ts), so a
 * page without a host has exactly the Setup it always had.
 *
 * 0.9.0: the chip says "Desktop" until the desktop has welcomed the page and then "Desktop (NAME, N cores)", because the host says no more
 * before its code. In the Android app (and, for tests, with `?desktopaddr=1`) no host serves the page, so the row is drawn there too, with
 * an address box above the code box: the person types where the desktop is (src/ui/desktopAddress.ts), and the chip says "Desktop (another computer)".
 */
import type { DesktopHost, DesktopView, EngineChoice } from '../desktopHost';
import { ADDRESS_LABEL, ADDRESS_PLACEHOLDER, CODE_LABEL, CODE_PLACEHOLDER, CONTINUE_HERE, desktopChoiceLabel, ENGINE_HINT, ENGINE_LABEL, ENGINE_PROBLEM, ENGINE_THIS_DEVICE } from '../desktopWords';
import { h, setChildren, show, uniqueId } from '../dom';
import { icon } from '../icons';
import { button, chipChoice } from '../widgets';
import { mountDetailRow } from './desktopDetailRow';

const PROBLEM_WORDS = {
  'needs-code': ENGINE_PROBLEM.needsCode,
  refused: ENGINE_PROBLEM.refused,
  'rate-limited': ENGINE_PROBLEM.rateLimited,
  unreachable: ENGINE_PROBLEM.unreachable,
  'needs-address': ENGINE_PROBLEM.needsAddress,
  'no-answer': ENGINE_PROBLEM.noAnswer,
  'not-allowed': ENGINE_PROBLEM.notAllowed,
  'no-session': ENGINE_PROBLEM.noSession,
} as const;

/**
 * Adds the row to `card` and keeps it in step with `host`. `build` presses Setup's Build button; `siteOf` is the bundled demo site Setup would
 * build now (null: none), told to the page so it can keep the site's files while Desktop is chosen. Returns the function that takes it out again.
 * When the desktop cannot be reached the note offers "Continue on this device": a tap chooses This device and presses Build (the model is
 * built, and the run starts on this device from its start); nothing of it is automatic.
 */
export function mountEngineRow(host: DesktopHost, card: HTMLElement, build: () => void, siteOf: () => string | null = () => null): () => void {
  // A Setup shown again forgets the run that ended (and closes a link nobody used).
  host.release();
  host.site(siteOf());
  const hintId = uniqueId('engine-hint');
  const codeId = uniqueId('engine-code');
  const addressId = uniqueId('engine-address');
  const optionsOf = (s: Readonly<DesktopView>): { value: EngineChoice; label: string }[] => [
    { value: 'device', label: ENGINE_THIS_DEVICE },
    { value: 'desktop', label: desktopChoiceLabel(s.host, s.typed) },
  ];
  const choice = chipChoice<EngineChoice>({
    label: ENGINE_LABEL,
    options: optionsOf(host.state.get()),
    value: host.state.get().engine,
    testId: 'engine',
    onChange: (v) => {
      host.choose(v);
      host.site(siteOf());
    },
  });
  const addressInput = h('input', {
    type: 'text',
    id: addressId,
    inputMode: 'url',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: false,
    maxLength: 120,
    placeholder: ADDRESS_PLACEHOLDER,
    value: host.state.get().address,
    dataset: { testid: 'engine-address' },
    aria: { describedby: hintId },
    on: { input: () => host.typeAddress(addressInput.value) },
  });
  const addressField = h('div', { class: 'field engine-address', dataset: { testid: 'engine-address-field' } }, [
    h('label', { class: 'field-label', htmlFor: addressId }, ADDRESS_LABEL),
    h('div', { class: 'input-wrap' }, addressInput),
  ]);
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
  const row = h('div', { class: 'engine-row', dataset: { testid: 'engine-row' } }, [choice.el, addressField, field, note]);
  card.append(row);
  const unmountDetail = mountDetailRow(host, card); // the Desktop detail (0.9.0), under this row while the desktop is chosen

  let shown = '';
  let shownOptions = '';
  const draw = (s: Readonly<DesktopView>): void => {
    // The chip names the desktop once it has said who it is (the options are replaced only when their words change).
    const options = optionsOf(s);
    const optionsKey = JSON.stringify(options);
    if (optionsKey !== shownOptions) {
      shownOptions = optionsKey;
      choice.setOptions(options);
    }
    choice.set(s.engine);
    if (!s.hasCode && input.value) input.value = ''; // a refused code is forgotten, in the box too
    const wantsAddress = s.typed && s.engine === 'desktop';
    const wantsCode = s.engine === 'desktop' && (s.typed || !(s.hasCode && s.fromLink));
    show(addressField, wantsAddress);
    show(field, wantsCode);
    addressInput.disabled = s.busy;
    input.disabled = s.busy;
    // The note is rebuilt only when what it says changes (a live region must not be rewritten with the same words).
    const says = `${s.engine}|${wantsAddress}|${wantsCode}|${s.hasCode}|${s.busy ? 'busy' : `${s.problem}|${s.note}`}`;
    if (says === shown) return;
    shown = says;
    if (!s.busy && s.problem) {
      // A desktop that cannot be reached, or that will not let this page in, is not a lost run: this device can build and run the same model.
      const act =
        s.problem === 'unreachable' || s.problem === 'no-answer' || s.problem === 'not-allowed' || s.problem === 'no-session' || s.problem === 'version'
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
      const words = s.problem === 'bad-address' || s.problem === 'version' ? (s.note ?? ENGINE_PROBLEM.needsAddress) : PROBLEM_WORDS[s.problem];
      setChildren(note, h('div', { class: 'callout callout-warn', dataset: { testid: 'engine-problem' } }, [icon('warning'), h('div', null, [words, act && h('div', { class: 'engine-act' }, act)])]));
      // Build is pressed at the bottom of the screen: the words must not be left out of sight above it.
      row.scrollIntoView({ block: 'center' });
      if (wantsAddress && (s.problem === 'needs-address' || s.problem === 'bad-address' || s.problem === 'no-answer' || s.problem === 'not-allowed')) addressInput.focus({ preventScroll: true });
      else if ((s.problem === 'needs-code' || s.problem === 'refused') && wantsCode) input.focus({ preventScroll: true });
      return;
    }
    const hint = s.busy ? ENGINE_HINT.connecting : s.engine === 'device' ? ENGINE_HINT.device : s.typed ? ENGINE_HINT.desktopAddress : s.hasCode && s.fromLink ? ENGINE_HINT.desktopLink : ENGINE_HINT.desktopCode;
    setChildren(note, h('p', { class: 'hint', dataset: { testid: 'engine-hint' } }, hint));
  };
  draw(host.state.get());
  const unsub = host.state.subscribe(draw);
  return () => {
    unsub();
    unmountDetail();
    row.remove();
  };
}
