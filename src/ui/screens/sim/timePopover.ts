/**
 * The time popover (opened by tapping the clock): jump to a typed local time, step by fixed amounts, go to the previous /
 * next card, choose the picture interval, and see how far the model has computed. Collapsed until asked for.
 */
import { h, text } from '../../dom';
import { formatClock, formatStepLabel } from '../../format';
import { TIME_STEPS } from '../../settings';
import type { SimContext } from './context';
import { clockToSimTime, nearestCardTime, parseTimeOfDay } from './timelineModel';
import { glyph, GLYPHS } from './transportKit';

export interface TimePopover {
  panel: HTMLElement;
  /** Fill the fields from the session (called when the popover opens). */
  refresh(): void;
  destroy(): void;
}

/** [test id, label, spoken label, change (s)]. */
const RELATIVE: readonly (readonly [string, string, string, number])[] = [
  ['m3600', '−1 h', 'Back one hour', -3600],
  ['m600', '−10 min', 'Back ten minutes', -600],
  ['m60', '−1 min', 'Back one minute', -60],
  ['p60', '+1 min', 'Forward one minute', 60],
  ['p600', '+10 min', 'Forward ten minutes', 600],
  ['p3600', '+1 h', 'Forward one hour', 3600],
];

export function createTimePopover(ctx: SimContext, opts: { close(): void }): TimePopover {
  const { session, scenario } = ctx;
  const D = scenario.duration;
  const abs = ctx.absTime;
  const fmtClock = (t: number, secs = false): string => formatClock(abs(t), ctx.tz, secs);

  /** Where a relative jump starts: the target of a fast-forward under way, else the view time. */
  const base = (): number => {
    const s = session.state.get();
    return s.seekTarget ?? s.viewTime;
  };
  const jump = (t: number): void => session.seek(t);

  // ── typed time ──
  const inputId = `tp-time-${Math.random().toString(36).slice(2, 7)}`;
  const timeInput = h('input', {
    type: 'time',
    id: inputId,
    class: 'tp-input tp-time',
    step: '1',
    dataset: { testid: 'time-input' },
    on: {
      keydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          go();
        }
      },
    },
  });
  const msg = h('p', { class: 'tp-msg', hidden: true, attrs: { role: 'status' }, dataset: { testid: 'time-msg' } });
  const say = (m: string): void => {
    msg.hidden = m === '';
    text(msg, m);
  };
  function go(): void {
    const sod = parseTimeOfDay(timeInput.value);
    if (sod === null) return say('Enter a time such as 14:35.');
    const t = clockToSimTime(sod, scenario.startTime, ctx.tz, D, session.state.get().viewTime);
    if (t === null) return say(`That time is not in this scenario (${fmtClock(0)} to ${fmtClock(D)}).`);
    say('');
    jump(t);
    opts.close();
  }

  // ── steps ──
  const chip = (id: string, label: string, spoken: string, onClick: () => void): HTMLButtonElement =>
    h('button', { type: 'button', class: 'tp-chip tp-chip-flat', dataset: { testid: `time-${id}` }, aria: { label: spoken }, on: { click: onClick } }, label);
  const startChip = chip('start', 'Start', 'Go to the start', () => jump(0));
  const endChip = chip('end', 'End', 'Go to the end of the scenario', () => jump(D));
  const relChips = RELATIVE.map(([id, label, spoken, dt]) => chip(id, label, spoken, () => jump(base() + dt)));

  // ── previous / next card ──
  const cardBtn = (dir: -1 | 1): HTMLButtonElement =>
    h(
      'button',
      {
        type: 'button',
        class: 'tp-chip tp-card',
        dataset: { testid: dir < 0 ? 'time-prev-card' : 'time-next-card' },
        on: {
          click: () => {
            const t = nearestCardTime(session.state.get().insights, session.state.get().viewTime, dir);
            if (t !== null) jump(t);
          },
        },
      },
      dir < 0
        ? [glyph(GLYPHS.chevronLeft, 20), h('span', null, 'Previous card')]
        : [h('span', null, 'Next card'), glyph(GLYPHS.chevronRight, 20)],
    );
  const prevCard = cardBtn(-1);
  const nextCard = cardBtn(1);

  // ── picture interval ──
  const stepBtns = TIME_STEPS.map((sec) =>
    h(
      'button',
      {
        type: 'button',
        class: 'tp-chip tp-chip-flat',
        dataset: { testid: `step-${sec}`, step: String(sec) },
        aria: { pressed: false },
        on: {
          click: () => {
            ctx.settings.set({ timeStep: sec });
            if (session.state.get().timeStep !== sec) session.setTimeStep(sec);
          },
        },
      },
      formatStepLabel(sec),
    ),
  );
  const readout = h('p', { class: 'tp-readout', dataset: { testid: 'computed-readout' } });

  const panel = h(
    'div',
    {
      class: 'tb-pop tb-pop-left tp tp-2col',
      dataset: { testid: 'time-popover' },
      attrs: { role: 'dialog', tabindex: '-1' },
      aria: { label: 'Jump to a time' },
      hidden: true,
    },
    [
      h('div', { class: 'tp-col' }, [
        h('h2', { class: 'tp-title' }, 'Jump to'),
        h('div', { class: 'tp-jump' }, [
          h('label', { class: 'sr-only', htmlFor: inputId }, 'Local time (hours, minutes, seconds)'),
          timeInput,
          h('button', { type: 'button', class: 'tp-go', dataset: { testid: 'time-go' }, on: { click: go } }, 'Go'),
        ]),
        msg,
        h('div', { class: 'tp-grid tp-rel' }, [startChip, ...relChips, endChip]),
      ]),
      h('div', { class: 'tp-col' }, [
        h('div', { class: 'tp-cards' }, [prevCard, nextCard]),
        h('fieldset', { class: 'tp-fieldset' }, [
          h('legend', { class: 'tp-label' }, 'Picture interval'),
          h('div', { class: 'tp-grid tp-steps' }, stepBtns),
          h('p', { class: 'tp-note' }, 'How much fire time each new picture covers. Shorter shows more detail.'),
        ]),
        readout,
      ]),
    ],
  );

  let key = '';
  function update(): void {
    if (panel.hidden) return;
    const s = session.state.get();
    const k = `${Math.round(s.viewTime)}|${Math.round(s.headTime)}|${s.timeStep}|${s.insights.length}`;
    if (k === key) return;
    key = k;
    const secs = s.timeStep < 60;
    text(readout, `Computed to ${fmtClock(s.headTime, secs)} of ${fmtClock(D, secs)}`);
    const b = s.seekTarget ?? s.viewTime;
    startChip.disabled = b <= 0;
    endChip.disabled = b >= D;
    RELATIVE.forEach(([, , , dt], i) => (relChips[i]!.disabled = dt < 0 ? b <= 0 : b >= D));
    const prev = nearestCardTime(s.insights, s.viewTime, -1);
    const next = nearestCardTime(s.insights, s.viewTime, 1);
    prevCard.disabled = prev === null;
    nextCard.disabled = next === null;
    prevCard.title = prev === null ? 'No earlier card' : `Go to ${fmtClock(prev)}`;
    nextCard.title = next === null ? 'No later card has been computed yet' : `Go to ${fmtClock(next)}`;
    for (const sb of stepBtns) sb.setAttribute('aria-pressed', String(Number(sb.dataset.step) === s.timeStep));
  }
  const unsub = session.state.subscribe(update, ['viewTime', 'headTime', 'timeStep', 'insights', 'seekTarget']);

  return {
    panel,
    refresh() {
      key = '';
      const s = session.state.get();
      const secs = s.timeStep < 60;
      timeInput.value = fmtClock(s.viewTime, secs); // "hh:mm" or "hh:mm:ss": what a time input holds
      timeInput.step = secs ? '1' : '60';
      say('');
      update();
    },
    destroy: unsub,
  };
}
