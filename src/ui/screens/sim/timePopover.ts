/**
 * The time sheet (opened by tapping the clock): jump to a typed local time, step by fixed amounts, go to the previous /
 * next card, choose the picture interval, and see how far the model has computed. A Maps-style bottom sheet, collapsed
 * until asked for.
 */
import { h, text } from '../../dom';
import { icon } from '../../icons';
import { formatClock, formatStepLabel } from '../../format';
import { TIME_STEPS } from '../../settings';
import type { SimContext } from './context';
import { clockToSimTime, nearestCardTime, parseTimeOfDay } from './timelineModel';
import { transportSheet } from './transportKit';

export interface TimePopover {
  panel: HTMLElement;
  /** Fill the fields from the session (called when the popover opens). */
  refresh(): void;
  destroy(): void;
}

/** The relative jumps (s); the test id, the label and the spoken label are made from the amount. */
const RELATIVE: readonly number[] = [-3600, -600, -60, 60, 600, 3600];
const relId = (dt: number): string => `${dt < 0 ? 'm' : 'p'}${Math.abs(dt)}`;
const relLabel = (dt: number): string => `${dt < 0 ? '−' : '+'}${formatStepLabel(Math.abs(dt))}`;
const relSpoken = (dt: number): string => `${dt < 0 ? 'Back' : 'Forward'} ${formatStepLabel(Math.abs(dt))}`;

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
    class: 'input tp-input tp-time',
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
  const msg = h('p', { class: 'field-error tp-msg', hidden: true, attrs: { role: 'status' }, dataset: { testid: 'time-msg' } });
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
    h('button', { type: 'button', class: 'chip tp-step-chip', dataset: { testid: `time-${id}` }, aria: { label: spoken }, on: { click: onClick } }, label);
  const startChip = chip('start', 'Start', 'Go to the start', () => jump(0));
  const endChip = chip('end', 'End', 'Go to the end of the scenario', () => jump(D));
  const relChips = RELATIVE.map((dt) => chip(relId(dt), relLabel(dt), relSpoken(dt), () => jump(base() + dt)));

  // ── previous / next card ──
  const cardBtn = (dir: -1 | 1): HTMLButtonElement =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn tp-card',
        dataset: { testid: dir < 0 ? 'time-prev-card' : 'time-next-card' },
        on: {
          click: () => {
            const t = nearestCardTime(session.state.get().insights, session.state.get().viewTime, dir);
            if (t !== null) jump(t);
          },
        },
      },
      dir < 0 ? [icon('chevron-left'), h('span', null, 'Previous card')] : [h('span', null, 'Next card'), icon('chevron-right')],
    );
  const prevCard = cardBtn(-1);
  const nextCard = cardBtn(1);

  // ── picture interval ──
  const stepBtns = TIME_STEPS.map((sec) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip tp-step-chip',
        dataset: { testid: `step-${sec}`, step: String(sec) },
        aria: { pressed: false },
        on: {
          click: () => {
            ctx.settings.set({ timeStep: sec });
            if (session.state.get().timeStep !== sec) session.setTimeStep(sec);
          },
        },
      },
      [icon('check', { class: 'chip-check' }), formatStepLabel(sec)],
    ),
  );
  const readout = h('p', { class: 'tp-readout', dataset: { testid: 'computed-readout' } });

  const panel = transportSheet({
    title: 'Jump to a time',
    testId: 'time-popover',
    class: 'tp tp-2col',
    onClose: opts.close,
    body: [
      h('div', { class: 'tp-col' }, [
        h('div', { class: 'tp-jump' }, [
          h('label', { class: 'sr-only', htmlFor: inputId }, 'Local time (hours, minutes, seconds)'),
          timeInput,
          h('button', { type: 'button', class: 'btn btn-primary tp-go', dataset: { testid: 'time-go' }, on: { click: go } }, 'Go'),
        ]),
        msg,
        h('div', { class: 'chips tp-rel', attrs: { role: 'group' }, aria: { label: 'Jump by' } }, [startChip, ...relChips, endChip]),
        h('div', { class: 'tp-cards' }, [prevCard, nextCard]),
      ]),
      h('div', { class: 'tp-col' }, [
        h('fieldset', { class: 'tp-fieldset' }, [
          h('legend', { class: 'tp-label' }, 'Picture interval'),
          h('div', { class: 'chips tp-steps' }, stepBtns),
          h('p', { class: 'tp-note' }, 'How much fire time each new picture covers. Shorter shows more detail.'),
        ]),
        readout,
      ]),
    ],
  });

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
    RELATIVE.forEach((dt, i) => (relChips[i]!.disabled = dt < 0 ? b <= 0 : b >= D));
    const prev = nearestCardTime(s.insights, s.viewTime, -1);
    const next = nearestCardTime(s.insights, s.viewTime, 1);
    prevCard.disabled = prev === null;
    nextCard.disabled = next === null;
    prevCard.title = prev === null ? 'No earlier card' : `Go to ${fmtClock(prev)}`;
    nextCard.title = next === null ? 'No later card has been computed yet' : `Go to ${fmtClock(next)}`;
    for (const sb of stepBtns) {
      const on = Number(sb.dataset.step) === s.timeStep;
      sb.setAttribute('aria-pressed', String(on));
      sb.classList.toggle('is-selected', on);
    }
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
