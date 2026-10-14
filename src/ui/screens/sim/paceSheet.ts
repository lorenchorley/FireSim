/**
 * The slow-run sheet (plan §6.5): what you asked for, what the phone is doing, that the result is not affected, where the
 * time goes, the likely reasons, what you can do, and a way in to all the numbers. It opens only when the timeline's speed
 * button is tapped (a bottom sheet of the top bar's popover group: Escape, an outside tap and Back close it) and it is loaded
 * on the first tap, so the entry bundle does not carry it. Every sentence comes from paceSheetModel.ts; this file only lays
 * them out and keeps them current once a second, in place (a tap on a button is never lost to a redraw).
 */
import { h, text } from '../../dom';
import { FAST_ANNOUNCEMENT, paceSheet, speedWord } from '../../paceSheetModel';
import { list, listRow, pct } from '../../primitives';
import { speedToStored } from '../../settings';
import type { SimContext } from './context';

export interface PaceSheet {
  /** Bring the sheet up to date with the session (it does nothing while the sheet is closed). */
  refresh(): void;
  destroy(): void;
}

/** A labelled gauge row (the shape of primitives.meter), patched in place. */
function meterRow(testId: string): { el: HTMLElement; set(label: string, valueText: string, fraction: number): void } {
  const name = h('span');
  const value = h('span', { class: 'meter-value' });
  const el = h('div', { class: 'meter', dataset: { testid: testId }, attrs: { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 } }, [
    h('div', { class: 'meter-head' }, [name, value]),
    h('div', { class: 'meter-track' }, h('div', { class: 'meter-fill' })),
  ]);
  return {
    el,
    set(label, valueText, fraction) {
      text(name, label);
      text(value, valueText);
      el.style.setProperty('--v', pct(fraction));
      el.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      el.setAttribute('aria-valuetext', valueText);
      el.setAttribute('aria-label', label);
    },
  };
}

/** Fill the shell that the top bar made with `transportSheet()` (title, grab handle and Close are already there). */
export function mountPaceSheet(ctx: SimContext, panel: HTMLElement, opts: { close(): void }): PaceSheet {
  const { session } = ctx;
  const title = panel.querySelector('.bottom-sheet-title') as HTMLElement;
  const body = panel.querySelector('.tb-sheet-body') as HTMLElement;

  // ── column 1: what is happening ──
  const lead = h('p', { class: 'tp-pace-lead', dataset: { testid: 'pace-lead' } });
  const question = h('h3', { class: 'tp-pace-h' });
  const answer = h('p', { class: 'tp-pace-p' });
  const result = h('section', { class: 'tp-pace-sec', dataset: { testid: 'pace-result' } }, [question, answer]);
  const timeTitle = h('h3', { class: 'tp-pace-h' });
  const rows = (['air', 'fire', 'embers', 'other'] as const).map((id) => ({ id, row: meterRow(`pace-time-${id}`) }));
  const time = h('section', { class: 'tp-pace-sec', hidden: true, dataset: { testid: 'pace-time' } }, [timeTitle, h('div', { class: 'tp-pace-meters' }, rows.map((r) => r.row.el))]);

  // ── column 2: why, and what to do ──
  const reasonsList = h('ul', { class: 'tp-pace-list' });
  const reasons = h('section', { class: 'tp-pace-sec', hidden: true, dataset: { testid: 'pace-reasons' } }, [h('h3', { class: 'tp-pace-h' }, 'Likely reasons'), reasonsList]);
  let playSpeed: number | null = null;
  const playBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-tonal',
      hidden: true,
      dataset: { testid: 'pace-play-at' },
      on: {
        click: () => {
          if (playSpeed === null) return;
          // The same two steps as choosing the speed in its own sheet: the clock follows now, and a new run starts at it.
          session.setSpeed(playSpeed);
          ctx.settings.set({ defaultSpeed: speedToStored(playSpeed) });
          ctx.announce(`Playback speed set to ${speedWord(playSpeed)}.`);
          opts.close();
        },
      },
    },
    '',
  );
  const fastBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary',
      hidden: true,
      dataset: { testid: 'pace-fast' },
      on: {
        click: () => {
          // The existing path: the engine restores its latest checkpoint and goes on with the fast model from there.
          session.controller.setQuality('fast');
          ctx.announce(FAST_ANNOUNCEMENT);
          opts.close();
        },
      },
    },
    '',
  );
  const fastNote = h('p', { class: 'tp-note', hidden: true, dataset: { testid: 'pace-fast-note' } });
  const pausing = h('p', { class: 'tp-note' });
  const actions = h('section', { class: 'tp-pace-sec', hidden: true, dataset: { testid: 'pace-actions' } }, [h('h3', { class: 'tp-pace-h' }, 'What you can do'), h('div', { class: 'tp-pace-btns' }, [playBtn, fastBtn]), fastNote, pausing]);
  const end = h('p', { class: 'tp-pace-p', hidden: true, dataset: { testid: 'pace-end' } });
  // Focus goes back to the timeline's button first (close), so the screen this opens returns focus there when it closes.
  const openNumbers = (): void => {
    opts.close();
    ctx.openDebugStats?.();
  };
  const numbers = ctx.openDebugStats ? list([listRow({ title: 'All the numbers', icon: 'speed', chevron: true, onClick: openNumbers, testId: 'pace-numbers' })]) : null;
  const footnote = h('p', { class: 'tp-note' });

  body.replaceChildren(h('div', { class: 'tp-col' }, [lead, result, time]), h('div', { class: 'tp-col' }, [reasons, actions, end, numbers, footnote]));

  let reasonsKey = '';
  function refresh(): void {
    if (panel.hidden) return;
    const s = session.state.get();
    const e = session.engineInfo();
    const view = paceSheet({
      pace: s.pace,
      engine: e ? { tier: e.tier, ...(e.mock ? { mock: true } : {}), perf: e.perf } : null,
      remainingS: Math.max(0, ctx.scenario.duration - s.viewTime),
    });
    text(title, view.title);
    text(lead, view.lead);
    text(question, view.result.question);
    text(answer, view.result.answer);
    time.hidden = !view.time;
    if (view.time) {
      text(timeTitle, view.time.title);
      view.time.rows.forEach((r, i) => rows[i]!.row.set(r.label, r.text, r.percent / 100));
    }
    const key = view.reasons.join('\n');
    if (key !== reasonsKey) {
      reasonsKey = key;
      reasonsList.replaceChildren(...view.reasons.map((r) => h('li', null, r)));
    }
    reasons.hidden = view.reasons.length === 0;
    const a = view.actions;
    actions.hidden = !a;
    playSpeed = a?.playAt?.speed ?? null;
    playBtn.hidden = !a?.playAt;
    if (a?.playAt) text(playBtn, a.playAt.label);
    fastBtn.hidden = !a?.fast;
    fastNote.hidden = !a?.fast;
    if (a?.fast) {
      text(fastBtn, a.fast.label);
      text(fastNote, a.fast.note);
    }
    if (a) text(pausing, a.pausing);
    end.hidden = !view.end;
    if (view.end) text(end, view.end);
    text(footnote, view.footnote);
  }

  const unsub = session.state.subscribe(refresh, ['pace']);
  return {
    refresh,
    destroy: unsub,
  };
}
