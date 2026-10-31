/**
 * The Wind direction tool's panel: where the wind comes from (a dial), when the turn starts (now, in 10 or 30 minutes, in
 * an hour, or at a clock time), what that will do, and the list of the changes made so far (each can be removed). The
 * change is for the whole scenario, so there is no crosshair and nothing to place on the map. Its words and maths are in
 * windPanelModel.ts; the change itself is made and undone by the session (`setWindDirection`, `removeWindDirection`).
 */
import { windDirectionEdits, windRerunFrom } from '../../../scenario/windDirection';
import { h, listen, setChildren, text, uniqueId } from '../../dom';
import { weatherAt } from '../../weatherSeries';
import { button, compassRose, segmented } from '../../widgets';
import type { SimContext } from './context';
import { panelShell } from './editPanels';
import {
  BACK_TO_FORECAST_HINT,
  BACK_TO_FORECAST_LABEL,
  DIAL_LABEL,
  LIST_TITLE,
  READINGS_NOTE,
  READINGS_TITLE,
  TIME_FIELD_LABEL,
  TIME_FIELD_SPOKEN,
  WHEN_LABEL,
  WHEN_OPTIONS,
  WIND_HINT,
  applyAnnouncement,
  applyLabel,
  backToForecastAnnouncement,
  defaultClock,
  dialSize,
  dialStart,
  holdsDirection,
  problemText,
  removeAnnouncement,
  removeReadingAnnouncement,
  resolveWhen,
  reviewingText,
  windList,
  windReadingEdits,
  windReadings,
  windView,
  type WhenChoice,
  type WhenState,
  type WindEnv,
  type WindListItem,
} from './windPanelModel';

/** Show or hide with the `hidden` attribute, touching the DOM only when it changes (the panel is brought up to date on every tick of the clock). */
const setShown = (el: HTMLElement, shown: boolean): void => {
  if (el.hidden === shown) el.hidden = !shown;
};

export function createWindPanel(ctx: SimContext, onClose: () => void): { el: HTMLElement; destroy(): void } {
  const { ui, session } = ctx;
  const g = ctx.scenario.terrain.grid;
  const env: WindEnv = { startMs: ctx.scenario.startTime, tz: ctx.tz, durationS: ctx.scenario.duration, centre: { x: g.x0 + ((g.nx - 1) * g.cellSize) / 2, y: g.y0 + ((g.ny - 1) * g.cellSize) / 2 } };
  /** The wind direction (from) at a simulation time, with the changes made so far counted. */
  const directionAt = (t: number): number => weatherAt(session.windWeather(), ctx.absTime(t)).windDir10;
  const viewNow = session.state.get().viewTime;

  // The dial opens at the direction the wind has now, so it is never a turn away from what is there until the person drags it.
  ui.set({ wind: { dir: dialStart(directionAt(viewNow)) } });
  const when: WhenState = { choice: 'now', clock: defaultClock(viewNow, env) };
  /** Whether the person has typed in the time field (until then it follows the clock when "At a time" is chosen). */
  let clockEdited = false;

  // ── the dial and the hint beside it ──
  const dial = compassRose({ label: DIAL_LABEL, value: ui.get().wind.dir, size: dialSize(window.innerHeight), testId: 'wind-dial', onChange: (d) => ui.set({ wind: { dir: d } }) });
  const dialSvg = dial.el.querySelector('.rose-svg');
  const fitDial = (): void => {
    const size = String(dialSize(window.innerHeight));
    dialSvg?.setAttribute('width', size);
    dialSvg?.setAttribute('height', size);
  };

  // ── when ──
  const whenSeg = segmented<WhenChoice>({
    label: WHEN_LABEL,
    options: WHEN_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    value: when.choice,
    columns: 3,
    testId: 'wind-when',
    onChange: (v) => {
      when.choice = v;
      if (v === 'at' && !clockEdited) {
        when.clock = defaultClock(session.state.get().viewTime, env);
        timeInput.value = when.clock;
      }
      render();
      if (v === 'at') timeField.scrollIntoView({ block: 'nearest' }); // the panel is short on a small phone: the field may be under the fold
    },
  });
  const timeId = uniqueId('wind-time');
  const msgId = uniqueId('wind-time-msg');
  const timeInput = h('input', {
    type: 'time',
    id: timeId,
    class: 'input wind-time',
    step: '60',
    value: when.clock,
    attrs: { 'aria-describedby': msgId },
    dataset: { testid: 'wind-time' },
    on: {
      input: () => {
        clockEdited = true;
        when.clock = timeInput.value;
        render();
      },
      keydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        }
      },
    },
  });
  const timeField = h('div', { class: 'wind-time-field', hidden: true }, [
    h('label', { class: 'field-label', htmlFor: timeId }, [TIME_FIELD_LABEL, h('span', { class: 'sr-only' }, `. ${TIME_FIELD_SPOKEN}`)]),
    timeInput,
  ]);
  const msg = h('p', { class: 'field-error wind-time-msg', id: msgId, hidden: true, attrs: { role: 'status' }, dataset: { testid: 'wind-time-msg' } });

  // ── what it will do ──
  const line1 = h('p', { class: 'wind-status-line' });
  const line2 = h('p', { class: 'wind-status-line' });
  const status = h('div', { class: 'wind-status', dataset: { testid: 'wind-status' } }, [line1, line2]);
  const reviewing = h('p', { class: 'hint wind-reviewing', hidden: true, dataset: { testid: 'wind-reviewing' } });

  // ── the changes made ──
  const list = h('div', { class: 'edit-list', dataset: { testid: 'wind-list' } });
  const rows = new Map<string, HTMLElement>();
  let listIds = '';

  // ── apply ──
  const applyBtn = button({ label: applyLabel(ui.get().wind.dir), icon: 'check', variant: 'primary', size: 'lg', testId: 'apply-wind', onClick: () => apply() });
  const applyText = applyBtn.querySelector('.btn-text') as HTMLElement;
  // The short plan over the button: on a small portrait phone the status under "When" is below the fold, this line is not (sim.css shows one or the other).
  const plan = h('p', { class: 'wind-plan', hidden: true, dataset: { testid: 'wind-plan' } });

  function apply(): void {
    const w = resolveWhen(when, session.state.get().viewTime, env);
    if (!w.ok) return;
    const holds = holdsDirection(ui.get().wind.dir, directionAt(w.time)); // before the change is made: after it the wind there is the new one
    const edit = session.setWindDirection(uniqueId('winddir'), ui.get().wind.dir, w.time);
    ctx.announce(edit ? applyAnnouncement(edit, env, holds) : problemText('late', when.choice, session.state.get().viewTime, env));
  }

  /** The button that had focus is gone after a removal: keep the keyboard in the panel (the next Remove, or the dial). */
  const keepFocus = (hadFocus: boolean): void => {
    if (hadFocus) (list.querySelector<HTMLElement>('button') ?? dial.el.querySelector<HTMLElement>('.rose'))?.focus();
  };

  function remove(id: string, trigger: HTMLElement): void {
    const s = session.state.get();
    const edit = windDirectionEdits(s.edits).find((e) => e.id === id);
    if (!edit) return;
    const hadFocus = document.activeElement === trigger;
    session.removeWindDirection(id);
    ctx.announce(removeAnnouncement(edit, s.headTime, env));
    keepFocus(hadFocus);
  }

  /** Every change comes away at once; the button is gone after it, so the keyboard goes to the dial (not to a reading's Remove). */
  function backToForecast(trigger: HTMLElement): void {
    const s = session.state.get();
    const list = windDirectionEdits(s.edits);
    if (list.length === 0) return;
    const from = Math.min(...list.map(windRerunFrom)); // where the run starts again: the earliest made or start, as the session cuts
    const hadFocus = document.activeElement === trigger;
    const removed = session.backToForecast();
    if (removed > 0) ctx.announce(backToForecastAnnouncement(removed, from, s.headTime, env));
    if (hadFocus) dial.el.querySelector<HTMLElement>('.rose')?.focus();
  }

  /** The secondary button under the changes (it is shown while there is one) and the sentence that says what it does. */
  const backBlock = (): HTMLElement[] => {
    const back = button({ label: BACK_TO_FORECAST_LABEL, icon: 'undo', variant: 'secondary', class: 'wind-back', testId: 'wind-back-to-forecast', onClick: () => backToForecast(back) });
    return [back, h('p', { class: 'hint wind-back-note' }, BACK_TO_FORECAST_HINT)];
  };

  /** A local wind reading (Setup's belt kit): the session's ordinary edit removal. */
  function removeReading(id: string, trigger: HTMLElement): void {
    if (!windReadingEdits(session.state.get().edits).some((e) => e.id === id)) return;
    const hadFocus = document.activeElement === trigger;
    session.removeEdit(id);
    ctx.announce(removeReadingAnnouncement);
    keepFocus(hadFocus);
  }

  /** One section of the list: a title and a row per item, each with its Remove (bin) button. */
  const section = (title: string, items: readonly WindListItem[], removeId: string, onRemove: (id: string, trigger: HTMLElement) => void, testId?: string): HTMLElement[] => [
    h('h3', { class: 'sub-title' }, title),
    h(
      'ul',
      { class: 'plain-list', dataset: { testid: testId } },
      items.map((i) => {
        const span = h('span');
        const btn = button({ label: i.removeLabel, icon: 'trash', variant: 'ghost', iconOnly: true, testId: removeId, onClick: () => onRemove(i.id, btn) });
        rows.set(i.id, span);
        return h('li', { class: 'edit-item', dataset: { testid: testId && `${testId}-row` } }, [span, btn]);
      }),
    ),
  ];

  const renderList = (): void => {
    const s = session.state.get();
    const changes = windList(windDirectionEdits(s.edits), s.viewTime, env);
    const readings = windReadings(windReadingEdits(s.edits), s.viewTime, env);
    const ids = `${changes.map((i) => i.id).join('|')}#${readings.map((i) => i.id).join('|')}`;
    if (ids !== listIds) {
      listIds = ids;
      rows.clear();
      setChildren(list, [
        changes.length ? [...section(LIST_TITLE, changes, 'remove-wind-direction', remove), ...backBlock()] : null,
        readings.length ? [...section(READINGS_TITLE, readings, 'remove-wind-reading', removeReading, 'wind-readings'), h('p', { class: 'hint wind-readings-note' }, READINGS_NOTE)] : null,
      ]);
    }
    // The words follow the clock (not started, turning, done) without rebuilding the buttons, so a tap is never lost to a redraw.
    for (const i of [...changes, ...readings]) {
      const span = rows.get(i.id);
      if (span) text(span, i.text);
    }
  };

  const render = (): void => {
    const s = session.state.get();
    const dir = ui.get().wind.dir;
    const v = windView({ when, viewTime: s.viewTime, env, dir, directionAt });
    setShown(timeField, when.choice === 'at');
    const newMessage = v.message !== '' && msg.textContent !== v.message;
    text(msg, v.message);
    setShown(msg, v.message !== '');
    if (newMessage) msg.scrollIntoView({ block: 'nearest' }); // the reason Apply is off: not to be left under the fold
    const invalid = String(when.choice === 'at' && !v.when.ok && v.message !== '');
    if (timeInput.getAttribute('aria-invalid') !== invalid) timeInput.setAttribute('aria-invalid', invalid);
    text(line1, v.lines[0] ?? '');
    text(line2, v.lines[1] ?? '');
    setShown(line2, !!v.lines[1]);
    text(reviewing, s.reviewing ? reviewingText(s.viewTime, env) : '');
    setShown(reviewing, s.reviewing);
    text(plan, v.plan);
    setShown(plan, v.plan !== '');
    text(applyText, v.label);
    applyBtn.disabled = !v.canApply;
    renderList();
  };

  const body = h('div', { class: 'panel-body' }, [h('div', { class: 'wind-controls' }, [h('p', { class: 'hint wind-hint' }, WIND_HINT), dial.el]), whenSeg.el, timeField, msg, status, reviewing, list]);
  const foot = h('div', null, [plan, applyBtn]);
  const el = panelShell('Wind direction', 'wind', 'wind-panel', onClose, body, foot);
  el.classList.add('wind-panel');
  // The foot is a live region in the other panels (their Add / Apply bar comes and goes); here the button stays, and its words follow the dial.
  foot.removeAttribute('aria-live');
  const unsubs = [session.state.subscribe(render, ['edits', 'viewTime', 'reviewing']), ui.subscribe(render, ['wind']), listen(window, 'resize', fitDial)];
  render();
  return {
    el,
    destroy() {
      for (const u of unsubs) u();
    },
  };
}
