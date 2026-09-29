/**
 * Top bar: ONE row [menu] [clock + elapsed + state] [play / pause] [speed], and under it a slim one-line weather strip.
 * Everything else is collapsed until asked for: the menu (new scenario, settings, safety notice), the time popover (tap
 * the clock) and the speed popover. Nothing in here pops up by itself and nothing stops the simulation.
 */
import { msToKmh } from '../../../core/units';
import { h, setChildren, text } from '../../dom';
import { icon } from '../../icons';
import { compassName, formatClock, formatElapsedShort, formatRH, formatTemp, formatWind } from '../../format';
import { bindStepSettings } from '../../settings';
import { ffdi, ratingFromIndex, ratingStyle } from '../../weatherCalc';
import { weatherAt } from '../../weatherSeries';
import { windArrow } from '../../widgets';
import type { SimContext } from './context';
import { createSpeedControl } from './speedControl';
import { clockShowsSeconds } from './timelineModel';
import { createTimePopover } from './timePopover';
import { createPopoverGroup, glyph, GLYPHS } from './transportKit';

/** The clock waits for the engine this long before "Computing" is shown, so it does not flicker at the head. */
const WAIT_BEFORE_BUSY_MS = 800;

export function createTopBar(ctx: SimContext): { el: HTMLElement; destroy(): void } {
  const { session } = ctx;

  // ── menu ──
  const menuBtn = h(
    'button',
    { type: 'button', class: 'tb-btn tb-menu', dataset: { testid: 'menu' }, aria: { label: 'Menu', haspopup: 'menu', expanded: false } },
    glyph(GLYPHS.menu, 26),
  );
  const menuItem = (ic: Parameters<typeof icon>[0], label: string, testid: string, act: () => void): HTMLButtonElement =>
    h('button', { type: 'button', class: 'tb-menu-item', attrs: { role: 'menuitem' }, dataset: { testid }, on: { click: () => (popovers.closeAll(), act()) } }, [
      icon(ic),
      h('span', null, label),
    ]);
  const menuPanel = h('div', { class: 'tb-pop tb-pop-left tb-menu-pop', attrs: { role: 'menu' }, aria: { label: 'Menu' }, hidden: true }, [
    menuItem('back', 'New scenario', 'menu-new', () => ctx.exit()),
    menuItem('settings', 'Settings & about', 'menu-settings', () => ctx.openSettings()),
    menuItem('warning', 'Safety notice', 'menu-notice', () => ctx.showNotice()),
  ]);

  // ── clock (opens the time popover) ──
  const clock = h('span', { class: 'clock-time', dataset: { testid: 'clock' } }, '--:--');
  const elapsed = h('span', { class: 'clock-elapsed' });
  const state = h('span', { class: 'tb-state', attrs: { 'aria-live': 'polite' } });
  const clockBtn = h(
    'button',
    { type: 'button', class: 'tb-clock', dataset: { testid: 'time-btn' }, aria: { haspopup: 'dialog', expanded: false, label: 'Simulation time' } },
    [clock, h('span', { class: 'tb-sub' }, [elapsed, state])],
  );
  const timePop = createTimePopover(ctx, { close: () => popovers.closeAll() });

  // ── play / pause ──
  const playBtn = h(
    'button',
    { type: 'button', class: 'tb-btn tb-play', dataset: { testid: 'play' }, aria: { label: 'Play' }, on: { click: () => onPlay() } },
    icon('play', { size: 30 }),
  );
  function onPlay(): void {
    const s = session.state.get();
    // At the end of the scenario Play starts it again from the beginning.
    if (!s.playing && s.seekTarget === null && s.viewTime >= ctx.scenario.duration - 1) session.seek(0, { resume: true });
    else session.toggle();
  }

  // ── speed ──
  const speed = createSpeedControl(ctx);

  // ── weather strip ──
  // A read-out, not a button: at 28 px tall it was a target too small for a wet, gloved thumb, and a slip from the play row
  // opened the dock over the map. The Weather tab in the dock is the one way in to the weather timeline.
  const wTemp = h('span', { class: 'wx-item' });
  const wRh = h('span', { class: 'wx-item' });
  const wWind = h('span', { class: 'wx-item wx-wind' });
  const wRating = h('span', { class: 'rating-pill' });
  const chip = h('div', { class: 'tb-wx', dataset: { testid: 'weather-chip' }, attrs: { role: 'img' } }, [wTemp, wRh, wWind, wRating]);
  let wxLabel = '';
  let ratingLabel = '';
  const setChipLabel = (): void => chip.setAttribute('aria-label', `${wxLabel}. ${ratingLabel}`);

  const el = h('header', { class: 'sim-topbar' }, [
    h('div', { class: 'tb-row' }, [menuBtn, clockBtn, playBtn, speed.button]),
    chip,
    menuPanel,
    timePop.panel,
    speed.panel,
  ]);

  const popovers = createPopoverGroup(el, [
    { id: 'menu', button: menuBtn, panel: menuPanel },
    { id: 'time', button: clockBtn, panel: timePop.panel, onOpen: () => timePop.refresh() },
    { id: 'speed', button: speed.button, panel: speed.panel },
  ]);
  menuBtn.addEventListener('click', () => popovers.toggle('menu'));
  clockBtn.addEventListener('click', () => popovers.toggle('time'));
  speed.button.addEventListener('click', () => popovers.toggle('speed'));

  // The settings screen changes the picture interval and the solver step: pass them on to the running session.
  const offSteps = bindStepSettings(session, ctx.settings);

  // render() runs on every view-clock change (every animation frame while playing), so each part is only rebuilt when
  // what it shows changes: no per-frame DOM churn, and the aria-live state line is not re-announced.
  let stateKey = '';
  let playKey = '';
  let wxKey = '';
  let ratingKey = '';
  let waitingSince = 0;
  let waitTimer = 0;
  const render = (): void => {
    const s = session.state.get();
    const abs = ctx.absTime(s.viewTime);
    const secs = clockShowsSeconds(s.timeStep, s.speed);
    const clockText = formatClock(abs, ctx.tz, secs);
    const elapsedText = formatElapsedShort(s.viewTime);
    if (clockText !== clock.textContent || elapsedText !== elapsed.textContent) {
      text(clock, clockText);
      text(elapsed, elapsedText);
      clockBtn.setAttribute('aria-label', `Simulation time ${clockText}, ${elapsedText} after the start. Jump to another time.`);
    }
    const seeking = s.seekTarget !== null;
    // "Computing" only after the clock has waited for the worker for a moment, so it does not flicker (and is not
    // re-announced) each time the view briefly catches up with the newest snapshot; a jump ahead shows it at once.
    const waiting = s.playing && s.viewTime >= s.headTime - 1 && s.computing;
    const now = performance.now();
    if (!waiting) waitingSince = 0;
    else if (!waitingSince) {
      waitingSince = now;
      clearTimeout(waitTimer);
      waitTimer = window.setTimeout(render, WAIT_BEFORE_BUSY_MS + 20);
    }
    const busy = seeking || (waiting && now - waitingSince >= WAIT_BEFORE_BUSY_MS);
    const sk = busy ? 'busy' : !session.isLive(s) ? 'past' : '';
    if (sk !== stateKey) {
      stateKey = sk;
      clockBtn.classList.toggle('is-busy', sk === 'busy'); // "Computing" takes the elapsed time's place
      setChildren(
        state,
        sk === 'past'
          ? h('span', { class: 'tb-chip tb-chip-past' }, 'Replay')
          : sk === 'busy'
            ? h('span', { class: 'tb-chip tb-chip-busy' }, [h('span', { class: 'spinner spinner-sm', aria: { hidden: true } }), 'Computing'])
            : null,
      );
    }
    const shownPlaying = s.playing || seeking;
    const atEnd = !shownPlaying && s.viewTime >= ctx.scenario.duration - 1;
    const pk = shownPlaying ? 'pause' : atEnd ? 'again' : 'play';
    if (pk !== playKey) {
      playKey = pk;
      // The name changes with the action ("Play" / "Pause"), so the button is not also a pressed/unpressed toggle (a screen
      // reader would say "Pause, pressed"): the state is only exposed to the stylesheet.
      playBtn.setAttribute('aria-label', pk === 'pause' ? 'Pause' : pk === 'again' ? 'Play again from the start' : 'Play');
      playBtn.dataset.state = pk;
      setChildren(playBtn, icon(pk === 'pause' ? 'pause' : pk === 'again' ? 'replay' : 'play', { size: 30 }));
    }
    // Weather: interpolated from the scenario series at the view time; rating from the snapshot when available.
    const w = weatherAt(ctx.scenario.weather, abs);
    const unit = ctx.settings.get().units;
    const t = Math.round(w.temperature);
    const rh = formatRH(w.relativeHumidity);
    const dirName = compassName(w.windDir10);
    const windTxt = formatWind(w.windSpeed10, unit);
    const arrowDeg = Math.round(w.windDir10 / 5) * 5;
    const wk = `${t}|${rh}|${dirName}|${windTxt}|${arrowDeg}`;
    if (wk !== wxKey) {
      wxKey = wk;
      setChildren(wTemp, h('span', null, `${t}°`));
      setChildren(wRh, [icon('droplet', { size: 16, class: 'wx-icon' }), h('span', null, rh)]);
      setChildren(wWind, [windArrow(arrowDeg, 18), h('span', { class: 'wx-dir' }, dirName), h('span', { class: 'wx-speed' }, windTxt)]);
      wxLabel = `Weather now: ${formatTemp(w.temperature)}, humidity ${rh}, wind from ${dirName} at ${windTxt}`;
      setChipLabel();
    }
    const st = s.snapshot?.stats;
    const df = ctx.scenario.weather.droughtFactor ?? 8;
    const fi = st && Math.abs(st.time - s.viewTime) < 900 ? st.ffdi : ffdi(w.temperature, w.relativeHumidity, msToKmh(w.windSpeed10), df);
    const style = st?.fireDangerRating ? ratingStyle(st.fireDangerRating) : ratingFromIndex(fi);
    const r = style.key === 'none' ? ratingFromIndex(fi) : style;
    const rk = `${r.key}|${r.label}|${Math.round(fi)}`;
    if (rk !== ratingKey) {
      ratingKey = rk;
      wRating.className = `rating-pill rating-${r.key}`;
      text(wRating, r.key === 'none' ? `FFDI ${Math.round(fi)}` : r.label);
      ratingLabel = `Fire danger ${r.label}, FFDI about ${Math.round(fi)}`;
      setChipLabel();
    }
  };
  const unsub = session.state.subscribe(render, ['viewTime', 'playing', 'speed', 'computing', 'headTime', 'snapshot', 'reviewing', 'seekTarget', 'timeStep']);
  const unsub2 = ctx.settings.subscribe(() => {
    wxKey = '';
    render();
  }, ['units']);
  render();

  return {
    el,
    destroy() {
      unsub();
      unsub2();
      offSteps();
      clearTimeout(waitTimer);
      popovers.destroy();
      timePop.destroy();
      speed.destroy();
    },
  };
}
