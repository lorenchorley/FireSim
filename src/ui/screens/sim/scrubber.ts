/**
 * Time scrubber: a big range slider over the whole scenario with the computed range shaded, ticks for insights and
 * wind changes, the view time, and a "Live" button that returns to the newest computed time.
 */
import { h, setChildren, text } from '../../dom';
import { icon } from '../../icons';
import { formatClock, formatElapsedShort } from '../../format';
import { detectWindChanges } from '../../weatherCalc';
import type { SimContext } from './context';

export function createScrubber(ctx: SimContext): { el: HTMLElement; destroy(): void } {
  const { session, scenario } = ctx;
  const D = scenario.duration;
  const input = h('input', {
    type: 'range',
    class: 'scrub-input',
    min: '0',
    max: String(D),
    step: '60',
    value: '0',
    dataset: { testid: 'scrubber' },
    aria: { label: 'Simulation time' },
  });
  const ticks = h('div', { class: 'scrub-ticks', aria: { hidden: true } });
  const cur = h('span', { class: 'scrub-cur' });
  const end = h('span', { class: 'scrub-end' }, formatClock(ctx.absTime(D), ctx.tz));
  const liveBtn = h(
    'button',
    { type: 'button', class: 'btn btn-secondary live-btn', dataset: { testid: 'live' }, aria: { label: 'Go to the newest time' }, on: { click: () => session.goLive() } },
    [icon('live', { size: 20 }), h('span', { class: 'btn-text' }, 'Live')],
  );
  let raf = 0;
  let dragging = false;
  input.addEventListener('input', () => {
    dragging = true;
    const v = Number(input.value);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => session.seek(v));
  });
  input.addEventListener('change', () => {
    dragging = false;
    session.seek(Number(input.value));
  });
  const changes = detectWindChanges(scenario.weather.hours).filter((c) => c.time > scenario.startTime && c.time < scenario.startTime + D * 1000);
  const el = h('div', { class: 'scrubber' }, [
    liveBtn,
    h('div', { class: 'scrub-track-wrap' }, [h('div', { class: 'scrub-labels' }, [cur, end]), h('div', { class: 'scrub-rail' }, [ticks, input])]),
  ]);

  let lastTickKey = '';
  let lastInsights: unknown = null;
  let insightGen = 0;
  // Called every animation frame while playing: text and ARIA only change once per displayed minute.
  let labelKey = '';
  let headPct = '';
  const render = (): void => {
    const s = session.state.get();
    if (!dragging) input.value = String(s.viewTime);
    const hp = `${((100 * s.headTime) / D).toFixed(2)}%`;
    if (hp !== headPct) {
      headPct = hp;
      el.style.setProperty('--head', hp);
    }
    el.style.setProperty('--view', `${((100 * s.viewTime) / D).toFixed(2)}%`);
    const lk = `${Math.floor(s.viewTime / 60)}|${Math.floor(s.headTime / 60)}`;
    if (lk !== labelKey) {
      labelKey = lk;
      input.setAttribute('aria-valuetext', `${formatClock(ctx.absTime(s.viewTime), ctx.tz)}, ${formatElapsedShort(s.viewTime)} since start; computed to ${formatClock(ctx.absTime(s.headTime), ctx.tz)}`);
      text(cur, `${formatClock(ctx.absTime(s.viewTime), ctx.tz)} · ${formatElapsedShort(s.viewTime)}`);
    }
    const live = session.isLive(s);
    liveBtn.classList.toggle('is-live', live && s.playing);
    liveBtn.disabled = live && s.playing;
    // Only cards already revealed get a tick: the timeline must not give away what the fire will do next
    // (predict first, then observe). The forecast wind change is known in advance, so it is always shown.
    let nShown = 0;
    for (const i of s.insights) if (i.severity !== 'info' && i.time <= s.viewTime + 1) nShown++;
    if (s.insights !== lastInsights) {
      lastInsights = s.insights;
      insightGen++;
    }
    const key = `${insightGen}|${nShown}`;
    if (key !== lastTickKey) {
      const shown = s.insights.filter((i) => i.severity !== 'info' && i.time <= s.viewTime + 1);
      lastTickKey = key;
      setChildren(ticks, [
        ...changes.map((c) => h('span', { class: 'tick tick-change', style: { left: `${(100 * (c.time - scenario.startTime)) / 1000 / D}%` } })),
        ...shown.map((i) => h('span', { class: `tick tick-${i.severity}`, style: { left: `${(100 * i.time) / D}%` } })),
      ]);
    }
  };
  const unsub = session.state.subscribe(render, ['viewTime', 'headTime', 'playing', 'insights', 'forecastInsights', 'reviewing']);
  render();
  return {
    el,
    destroy() {
      unsub();
      cancelAnimationFrame(raf);
    },
  };
}
