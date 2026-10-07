/**
 * Top bar, Google-Maps style: a floating rounded pill over the map [menu] [clock + elapsed + state] [play / pause]
 * [speed chip], and under it a compact row of read-out chips (temperature, humidity, wind, fire-danger rating; they are
 * not buttons). Everything else is collapsed until asked for: the main menu (a side sheet with Data sets, How this
 * simulation works, Help, Safety notice, Settings, New scenario), the time sheet (tap the clock) and the speed sheet.
 * Nothing in here pops up by itself and nothing stops the simulation.
 */
import { msToKmh } from '../../../core/units';
import { h, setChildren, text } from '../../dom';
import { icon, type IconName } from '../../icons';
import { compassName, formatClock, formatElapsedShort, formatRH, formatTemp, formatWind } from '../../format';
import { bindStepSettings } from '../../settings';
import { ffdi, ratingFromIndex, ratingStyle } from '../../weatherCalc';
import { weatherAt } from '../../weatherSeries';
import { windArrow } from '../../widgets';
import type { SimContext } from './context';
import { createSpeedControl } from './speedControl';
import { clockShowsSeconds } from './timelineModel';
import { createTimePopover } from './timePopover';
import { createPopoverGroup, type PopoverGroup } from './transportKit';

/** The clock waits for the engine this long before "Computing" is shown, so it does not flicker at the head. */
const WAIT_BEFORE_BUSY_MS = 800;

export interface TopBar {
  el: HTMLElement;
  /** The popover group (main menu, time and speed sheets): Back and Escape close the open one first. */
  popovers: PopoverGroup;
  destroy(): void;
}

export interface TopBarOptions {
  /** Open the Help tab of the bottom sheet (the glossary). */
  openHelp(): void;
}

export function createTopBar(ctx: SimContext, opts: TopBarOptions): TopBar {
  const { session } = ctx;

  // ── main menu (a Maps-style side sheet with list rows) ──
  const menuBtn = h(
    'button',
    { type: 'button', class: 'icon-btn tb-menu', dataset: { testid: 'menu' }, aria: { label: 'Menu', haspopup: 'menu', expanded: false } },
    icon('menu'),
  );
  const row = (ic: IconName, title: string, sub: string | null, testid: string, act: () => void): HTMLElement =>
    h('li', { attrs: { role: 'none' } }, [
      h(
        'button',
        {
          type: 'button',
          class: ['list-row', 'drawer-row', sub && 'two-line'],
          attrs: { role: 'menuitem' },
          dataset: { testid },
          on: {
            click: () => {
              // Focus goes back to the menu button first, so a screen this row opens returns focus there when it closes.
              popovers.closeAll();
              act();
            },
          },
        },
        [h('span', { class: 'list-lead' }, icon(ic)), h('span', { class: 'list-body' }, [h('span', { class: 'list-title' }, title), sub ? h('span', { class: 'list-sub' }, sub) : null])],
      ),
    ]);
  const learn = [
    ctx.openDatasets ? row('database', 'Data sets', 'Size, source and date of every data set used', 'menu-datasets', () => ctx.openDatasets?.()) : null,
    ctx.openModelCard ? row('cube', 'How this simulation works', 'What is 2-D, what is 3-D, and how fine the grids are', 'menu-model', () => ctx.openModelCard?.()) : null,
    row('help', 'Help and glossary', 'How to use the screen, and the words firefighters use', 'menu-help', () => opts.openHelp()),
    row('warning', 'Safety notice', null, 'menu-notice', () => ctx.showNotice()),
  ];
  const app = [row('settings', 'Settings', null, 'menu-settings', () => ctx.openSettings()), row('plus', 'New scenario', 'Leave this simulation and set up another', 'menu-new', () => ctx.exit())];
  const menuPanel = h('div', { class: 'sim-drawer', attrs: { role: 'dialog', tabindex: '-1' }, aria: { label: 'Menu' }, hidden: true }, [
    h('div', { class: 'drawer-head' }, [
      h('span', { class: 'drawer-mark', aria: { hidden: true } }, icon('flame')),
      h('div', { class: 'drawer-heading' }, [h('h2', { class: 'drawer-title' }, 'FireSim'), h('p', { class: 'drawer-sub', attrs: { dir: 'auto' } }, ctx.scenario.name)]),
      h('button', { type: 'button', class: 'icon-btn', aria: { label: 'Close menu' }, on: { click: () => popovers.closeAll() } }, icon('close')),
    ]),
    h('ul', { class: 'list drawer-list', attrs: { role: 'menu' }, aria: { label: 'Learn' } }, learn),
    h('hr', { class: 'divider' }),
    h('ul', { class: 'list drawer-list', attrs: { role: 'menu' }, aria: { label: 'App' } }, app),
  ]);

  // ── clock (opens the time sheet) ──
  const clock = h('span', { class: 'clock-time', dataset: { testid: 'clock' } }, '--:--');
  const elapsed = h('span', { class: 'clock-elapsed' });
  const state = h('span', { class: 'tb-state', attrs: { 'aria-live': 'polite' } });
  const clockBtn = h(
    'button',
    { type: 'button', class: 'tb-clock', dataset: { testid: 'time-btn' }, aria: { haspopup: 'dialog', expanded: false, label: 'Simulation time' } },
    [clock, h('span', { class: 'tb-sub' }, [elapsed, state])],
  );
  const timePop = createTimePopover(ctx, { close: () => popovers.closeAll() });

  // ── play / pause: the one blue control of the bar ──
  const playBtn = h(
    'button',
    { type: 'button', class: 'icon-btn icon-btn-filled tb-play', dataset: { testid: 'play' }, aria: { label: 'Play' }, on: { click: () => onPlay() } },
    icon('play'),
  );
  function onPlay(): void {
    const s = session.state.get();
    // At the end of the scenario Play starts it again from the beginning.
    if (!s.playing && s.seekTarget === null && s.viewTime >= ctx.scenario.duration - 1) session.seek(0, { resume: true });
    else session.toggle();
  }

  // ── speed ──
  const speed = createSpeedControl(ctx, { close: () => popovers.closeAll() });

  // ── weather read-out chips ──
  // Read-outs, not buttons: a slip from the pill must not open anything over the map. The Weather tab is the one way in
  // to the weather timeline.
  const wTemp = h('span', { class: 'chip chip-float wx-chip' });
  const wRh = h('span', { class: 'chip chip-float wx-chip' });
  const wWind = h('span', { class: 'chip chip-float wx-chip wx-wind' });
  const wRating = h('span', { class: 'rating-pill wx-rating' });
  const chips = h('div', { class: 'tb-wx', dataset: { testid: 'weather-chip' }, attrs: { role: 'img' } }, [wTemp, wRh, wWind, wRating]);
  let wxLabel = '';
  let ratingLabel = '';
  const setChipLabel = (): void => chips.setAttribute('aria-label', `${wxLabel}. ${ratingLabel}`);

  const pill = h('div', { class: 'search-bar tb-pill' }, [menuBtn, clockBtn, playBtn, speed.button]);
  const el = h('header', { class: 'sim-topbar' }, [pill, chips, menuPanel, timePop.panel, speed.panel]);

  const popovers = createPopoverGroup(el, [
    { id: 'menu', button: menuBtn, panel: menuPanel, dim: true },
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
          ? h('span', { class: 'badge badge-info tb-chip-past' }, [icon('history'), 'Replay'])
          : sk === 'busy'
            ? h('span', { class: 'badge tb-chip-busy' }, [h('span', { class: 'spinner spinner-sm', aria: { hidden: true } }), 'Computing'])
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
      setChildren(playBtn, icon(pk === 'pause' ? 'pause' : pk === 'again' ? 'replay' : 'play'));
    }
    // Weather: interpolated from the scenario series at the view time; rating from the snapshot when available.
    const w = weatherAt(ctx.scenario.weather, abs);
    const unit = ctx.settings.get().units;
    const temp = formatTemp(w.temperature);
    const rh = formatRH(w.relativeHumidity);
    const dirName = compassName(w.windDir10);
    const windTxt = formatWind(w.windSpeed10, unit);
    const arrowDeg = Math.round(w.windDir10 / 5) * 5;
    const wk = `${temp}|${rh}|${dirName}|${windTxt}|${arrowDeg}`;
    if (wk !== wxKey) {
      wxKey = wk;
      setChildren(wTemp, h('span', null, temp));
      setChildren(wRh, [icon('droplet', { class: 'wx-icon' }), h('span', null, rh)]);
      setChildren(wWind, [windArrow(arrowDeg, 18), h('span', { class: 'wx-dir' }, dirName), h('span', { class: 'wx-speed' }, windTxt)]);
      wxLabel = `Weather now: ${temp}, humidity ${rh}, wind from ${dirName} at ${windTxt}`;
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
      wRating.className = `rating-pill wx-rating rating-${r.key}`;
      // FFDI = the Forest Fire Danger Index; the rating word is the plain-English version of it.
      text(wRating, r.key === 'none' ? `FFDI ${Math.round(fi)}` : r.label);
      ratingLabel = `Fire danger ${r.label}, Forest Fire Danger Index about ${Math.round(fi)}`;
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
    popovers,
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
