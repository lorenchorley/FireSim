/**
 * Timeline: a custom pointer slider over the WHOLE scenario, so any time is one tap away. Tap anywhere on the track to
 * jump there, drag to scrub (move the finger up for fine control), hold ‹ › to step by the display step, or use the
 * keyboard. The computed range is shaded; a time beyond it becomes a fast-forward whose progress is shown in the track,
 * with a Cancel button. There is no "Live" button: Play does that.
 */
import { h, setChildren, text } from '../../dom';
import { formatClock, formatElapsedShort, formatStepLabel, tzOffsetHours } from '../../format';
import { detectWindChanges } from '../../weatherCalc';
import type { SimContext } from './context';
import {
  type DragState,
  dragMove,
  dragStart,
  edgeLabels,
  keyboardTarget,
  offsetSeconds,
  repeatStepS,
  seekPercent,
  snapFor,
  cardMarks,
  timeTicks,
  timeToFraction,
} from './timelineModel';
import { frameThrottle, glyph, GLYPHS } from './transportKit';

/** Least distance (px) between two clock labels. */
const MIN_LABEL_PX = 62;

const pct = (frac: number): string => `${(frac * 100).toFixed(3)}%`;

export function createScrubber(ctx: SimContext): { el: HTMLElement; destroy(): void } {
  const { session, scenario } = ctx;
  const D = scenario.duration;
  const startMs = scenario.startTime;
  const clock = (t: number, secs = false): string => formatClock(ctx.absTime(t), ctx.tz, secs);
  const utcOffsetS = offsetSeconds(tzOffsetHours(startMs, ctx.tz));

  // ── the slider ──
  const head = h('div', { class: 'tl-head' });
  const played = h('div', { class: 'tl-played' });
  const seekDone = h('div', { class: 'tl-seek-done' });
  const seekTodo = h('div', { class: 'tl-seek-todo' });
  const rail = h('div', { class: 'tl-rail' }, [head, played, seekDone, seekTodo]);
  const hourTicks = h('div', { class: 'tl-hours', aria: { hidden: true } });
  const labels = h('div', { class: 'tl-labels', aria: { hidden: true } });
  const marks = h('div', { class: 'tl-marks', aria: { hidden: true } });
  const target = h('div', { class: 'tl-target', hidden: true, aria: { hidden: true } });
  const thumb = h('div', { class: 'tl-thumb', aria: { hidden: true } });
  const bubbleMain = h('span', { class: 'tl-bubble-main' });
  const bubbleSub = h('span', { class: 'tl-bubble-sub' });
  const bubble = h('div', { class: 'tl-bubble', hidden: true, aria: { hidden: true } }, [bubbleMain, bubbleSub]);
  const area = h('div', { class: 'tl-area' }, [rail, hourTicks, labels, marks, target, thumb, bubble]);
  const slider = h('div', {
    class: 'tl-slider',
    dataset: { testid: 'scrubber' },
    attrs: { role: 'slider', tabindex: '0' },
    aria: { label: 'Simulation time', valuemin: 0, valuemax: Math.round(D), valuenow: 0 },
  });
  slider.append(area);

  // ── fast-forward status ──
  const statusText = h('span', { class: 'tl-status-text' });
  const statusPct = h('span', { class: 'tl-status-pct', aria: { hidden: true } });
  const cancelBtn = h(
    'button',
    { type: 'button', class: 'tl-cancel', dataset: { testid: 'seek-cancel' }, aria: { label: 'Cancel the fast-forward' }, on: { click: () => session.cancelSeek() } },
    'Cancel',
  );
  const status = h('div', { class: 'tl-status', hidden: true, dataset: { testid: 'seek-status' }, attrs: { role: 'status' } }, [
    h('span', { class: 'spinner spinner-sm', aria: { hidden: true } }),
    statusText,
    statusPct,
    cancelBtn,
  ]);

  // ── ‹ › ──
  const offs: (() => void)[] = [];
  const stepButton = (dir: -1 | 1): HTMLButtonElement => {
    const btn = h(
      'button',
      { type: 'button', class: `tl-step tl-step-${dir < 0 ? 'prev' : 'next'}`, dataset: { testid: dir < 0 ? 'scrub-prev' : 'scrub-next' } },
      glyph(dir < 0 ? GLYPHS.chevronLeft : GLYPHS.chevronRight, 28),
    );
    let timer = 0;
    let held = false;
    let repeat = 0;
    let fromPointer = false;
    const stepOnce = (): void => {
      const s = session.state.get();
      session.seek((s.seekTarget ?? s.viewTime) + dir * repeatStepS(s.timeStep, repeat));
      repeat++;
    };
    const stop = (): void => {
      held = false;
      clearTimeout(timer);
      // The click that follows a pointer release has been (or will be) ignored; a later key press must not be.
      window.setTimeout(() => (fromPointer = false), 60);
    };
    const tick = (): void => {
      if (!held || btn.disabled) return stop();
      stepOnce();
      timer = window.setTimeout(tick, 110);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable: the release is still seen on the button */
      }
      fromPointer = true;
      held = true;
      repeat = 0;
      stepOnce();
      timer = window.setTimeout(tick, 420);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) btn.addEventListener(ev, stop);
    // A key press (Enter / Space) arrives as a click without a pointer; a pointer's click was handled on pointerdown.
    btn.addEventListener('click', () => {
      if (fromPointer) {
        fromPointer = false;
        return;
      }
      repeat = 0;
      stepOnce();
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    offs.push(stop);
    return btn;
  };
  const prevBtn = stepButton(-1);
  const nextBtn = stepButton(1);

  const mid = h('div', { class: 'tl-mid' }, [slider]);
  const el = h('div', { class: 'scrubber', dataset: { testid: 'timeline' } }, [prevBtn, mid, nextBtn, status]);

  // ── pointer: tap = jump, drag = scrub ──
  let areaLeft = 0;
  let areaW = 1;
  const measure = (): void => {
    const r = area.getBoundingClientRect();
    areaLeft = r.left;
    areaW = Math.max(1, r.width);
  };
  let drag: DragState | null = null;
  let pointerId = -1;
  let downY = 0;
  const scrub = frameThrottle<number>((t) => session.scrub(t));

  const showBubble = (): void => {
    if (!drag) return;
    const s = session.state.get();
    const secs = s.timeStep < 60;
    text(bubbleMain, `${clock(drag.t, secs)} · ${formatElapsedShort(drag.t)}`);
    const notes: string[] = [];
    if (drag.t > s.headTime + 1) notes.push('will compute');
    if (drag.factor < 1) notes.push(`fine ×${drag.factor}`);
    text(bubbleSub, notes.join(' · '));
    bubbleSub.hidden = notes.length === 0;
    bubble.hidden = false;
    // Keep the bubble on the screen near the ends.
    const bw = bubble.offsetWidth;
    const cx = areaLeft + timeToFraction(drag.t, D) * areaW;
    const room = document.documentElement.clientWidth;
    let dx = 0;
    if (cx - bw / 2 < 6) dx = 6 - (cx - bw / 2);
    else if (cx + bw / 2 > room - 6) dx = room - 6 - (cx + bw / 2);
    bubble.style.setProperty('--bubble-dx', `${Math.round(dx)}px`);
  };

  slider.addEventListener('pointerdown', (e) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    measure();
    pointerId = e.pointerId;
    downY = e.clientY;
    try {
      slider.setPointerCapture(e.pointerId);
    } catch {
      /* fine: move / up still arrive while the pointer stays over the slider */
    }
    e.preventDefault();
    slider.focus({ preventScroll: true });
    session.beginScrub();
    drag = dragStart(e.clientX, areaLeft, areaW, D, snapFor(session.state.get().timeStep));
    el.classList.add('is-scrubbing');
    scrub.push(drag.t);
    render();
    showBubble();
  });
  slider.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== pointerId) return;
    drag = dragMove(drag, e.clientX, e.clientY - downY, areaW, D, session.state.get().timeStep);
    scrub.push(drag.t);
    render();
    showBubble();
  });
  const finish = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== pointerId) return;
    if (e.type === 'pointerup') drag = dragMove(drag, e.clientX, e.clientY - downY, areaW, D, session.state.get().timeStep);
    const t = drag.t;
    drag = null;
    scrub.cancel();
    bubble.hidden = true;
    el.classList.remove('is-scrubbing');
    session.endScrub(t);
    render();
  };
  slider.addEventListener('pointerup', finish);
  slider.addEventListener('pointercancel', finish);
  slider.addEventListener('lostpointercapture', finish);
  slider.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── keyboard ──
  slider.addEventListener('keydown', (e) => {
    const s = session.state.get();
    const t = keyboardTarget(e.key, e.shiftKey, s.seekTarget ?? s.viewTime, s.timeStep, D);
    if (t === null) return;
    e.preventDefault();
    session.seek(t);
  });

  // ── ticks (rebuilt when the track width, the step or the revealed cards change) ──
  const changes = detectWindChanges(scenario.weather.hours).filter((c) => c.time > startMs && c.time < startMs + D * 1000);
  let hoursKey = '';
  const buildHours = (): void => {
    const w = Math.round(areaW);
    if (w <= 1) return;
    const key = String(w);
    if (key === hoursKey) return;
    hoursKey = key;
    const { ticks } = timeTicks({ startMs, durationS: D, utcOffsetS, widthPx: w, minLabelPx: MIN_LABEL_PX });
    const xs = ticks.filter((t) => t.major).map((t) => timeToFraction(t.t, D) * w);
    const edges = edgeLabels(xs, w, MIN_LABEL_PX);
    setChildren(
      hourTicks,
      ticks.map((t) => h('span', { class: t.major ? 'tl-hour tl-hour-major' : 'tl-hour', style: { left: pct(timeToFraction(t.t, D)) } })),
    );
    setChildren(labels, [
      edges.start ? h('span', { class: 'tl-label tl-label-start', style: { left: '0%' } }, clock(0)) : null,
      ...ticks.filter((t) => t.major).map((t) => h('span', { class: 'tl-label', style: { left: pct(timeToFraction(t.t, D)) } }, clock(t.t))),
      edges.end ? h('span', { class: 'tl-label tl-label-end', style: { left: '100%' } }, clock(D)) : null,
    ]);
  };
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      measure();
      buildHours();
      render();
    });
    ro.observe(area);
  }

  // ── render ──
  let lastInsights: unknown = null;
  let insightGen = 0;
  let marksKey = '';
  let textKey = '';
  let stepKey = -1;
  let seekFrom = 0;
  let wasSeeking = false;
  const vars = new Map<string, string>();
  const setVar = (name: string, value: string): void => {
    if (vars.get(name) === value) return;
    vars.set(name, value);
    el.style.setProperty(name, value);
  };

  function render(): void {
    const s = session.state.get();
    const shown = drag ? drag.t : s.viewTime;
    setVar('--view', pct(timeToFraction(shown, D)));
    setVar('--head', pct(timeToFraction(s.headTime, D)));

    // Fast-forward: the reached part and the part still to compute up to the target.
    const seeking = s.seekTarget !== null;
    if (seeking && !wasSeeking) seekFrom = s.viewTime;
    wasSeeking = seeking;
    el.classList.toggle('is-seeking', seeking);
    status.hidden = !seeking;
    target.hidden = !seeking;
    if (seeking) {
      const tgt = s.seekTarget!;
      const from = Math.min(seekFrom, tgt);
      const reached = Math.min(Math.max(s.viewTime, from), tgt);
      setVar('--seek-from', pct(timeToFraction(from, D)));
      setVar('--seek-reached', pct(timeToFraction(reached, D)));
      setVar('--seek-target', pct(timeToFraction(tgt, D)));
      text(statusText, `Computing to ${clock(tgt, s.timeStep < 60)}…`);
      text(statusPct, `${seekPercent(s.seekProgress)} %`);
    }

    // Text and ARIA change at most every few seconds of simulated time.
    const tk = `${Math.floor(shown / 10)}|${Math.floor(s.headTime / 10)}|${s.timeStep}`;
    if (tk !== textKey) {
      textKey = tk;
      const secs = s.timeStep < 60;
      slider.setAttribute('aria-valuenow', String(Math.round(shown)));
      slider.setAttribute('aria-valuetext', `${clock(shown, secs)}, ${formatElapsedShort(shown)} since the start; computed to ${clock(s.headTime, secs)}`);
    }
    if (s.timeStep !== stepKey) {
      stepKey = s.timeStep;
      const label = formatStepLabel(s.timeStep);
      prevBtn.setAttribute('aria-label', `Back ${label}`);
      nextBtn.setAttribute('aria-label', `Forward ${label}`);
      prevBtn.title = `Back ${label} (hold to repeat)`;
      nextBtn.title = `Forward ${label} (hold to repeat)`;
    }
    const at = s.seekTarget ?? shown;
    prevBtn.disabled = at <= 0;
    nextBtn.disabled = at >= D;

    // Only cards already revealed get a tick: the timeline must not give away what the fire will do next (predict
    // first, then observe). The forecast wind change is known in advance, so it is always shown.
    let nShown = 0;
    for (const i of s.insights) if (i.severity !== 'info' && i.time <= s.viewTime + 1) nShown++;
    if (s.insights !== lastInsights) {
      lastInsights = s.insights;
      insightGen++;
    }
    const mk = `${insightGen}|${nShown}|${Math.round(areaW)}`;
    if (mk !== marksKey) {
      marksKey = mk;
      const revealed = s.insights.filter((i) => i.severity !== 'info' && i.time <= s.viewTime + 1);
      setChildren(marks, [
        ...changes.map((c) => h('span', { class: 'tl-mark tl-mark-change', style: { left: pct((c.time - startMs) / 1000 / D) } })),
        ...cardMarks(revealed, D, areaW).map((m) => h('span', { class: `tl-mark tl-mark-${m.severity}`, style: { left: pct(m.frac) } })),
      ]);
    }
  }

  const unsub = session.state.subscribe(render, ['viewTime', 'headTime', 'playing', 'insights', 'forecastInsights', 'reviewing', 'seekTarget', 'seekProgress', 'timeStep']);
  measure();
  render();
  // The width is known once the strip is in the page; the observer builds the ticks then (and on every resize).
  queueMicrotask(() => {
    measure();
    buildHours();
  });

  return {
    el,
    destroy() {
      unsub();
      scrub.cancel();
      ro?.disconnect();
      for (const o of offs) o();
    },
  };
}
