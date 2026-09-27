/**
 * Top bar: menu, local simulation clock (+ elapsed, "viewing past" / "computing" states), play/pause, playback
 * speed, and the current-weather chip (temperature, RH, wind arrow + speed, fire danger rating).
 */
import { msToKmh } from '../../../core/units';
import { h, listen, setChildren, text } from '../../dom';
import { icon } from '../../icons';
import { formatClock, formatElapsedShort, formatPlaybackSpeed, formatRH, formatTemp, formatWind, compassName } from '../../format';
import { SPEEDS } from '../../session';
import { ffdi, ratingFromIndex, ratingStyle } from '../../weatherCalc';
import { weatherAt } from '../../weatherSeries';
import { button, windArrow } from '../../widgets';
import type { SimContext } from './context';

export function createTopBar(ctx: SimContext): { el: HTMLElement; destroy(): void } {
  const { session } = ctx;
  const clock = h('span', { class: 'clock-time', dataset: { testid: 'clock' } }, '--:--');
  const elapsed = h('span', { class: 'clock-elapsed' });
  const state = h('span', { class: 'clock-state', attrs: { 'aria-live': 'polite' } });
  const playBtn = h(
    'button',
    { type: 'button', class: 'btn btn-accent btn-round play-btn', dataset: { testid: 'play' }, aria: { label: 'Play' }, on: { click: () => session.toggle() } },
    icon('play', { size: 30 }),
  );
  const speedLabel = h('span', { class: 'speed-label' }, '60×');
  const speedBtn = h(
    'button',
    { type: 'button', class: 'btn btn-secondary speed-btn', dataset: { testid: 'speed' }, aria: { haspopup: 'listbox', expanded: false, label: 'Playback speed' }, on: { click: () => toggleMenu() } },
    [icon('speed', { size: 20 }), speedLabel],
  );
  const menu = h(
    'div',
    { class: 'popover speed-menu', attrs: { role: 'listbox', 'aria-label': 'Playback speed' }, hidden: true },
    SPEEDS.map((sp) =>
      h(
        'button',
        {
          type: 'button',
          class: 'popover-item',
          attrs: { role: 'option' },
          dataset: { speed: String(sp) },
          on: {
            click: () => {
              session.setSpeed(sp);
              toggleMenu(false);
            },
          },
        },
        [h('span', { class: 'popover-main' }, Number.isFinite(sp) ? `${sp}×` : 'As fast as possible'), h('span', { class: 'popover-sub' }, speedHint(sp))],
      ),
    ),
  );
  function toggleMenu(open = menu.hidden): void {
    menu.hidden = !open;
    speedBtn.setAttribute('aria-expanded', String(open));
    if (open) (menu.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus();
  }
  const offs: (() => void)[] = [];
  offs.push(
    listen(document, 'pointerdown', (e) => {
      if (!menu.hidden && !menu.contains(e.target as Node) && !speedBtn.contains(e.target as Node)) toggleMenu(false);
    }),
  );

  const menuBtn = button({ label: 'Menu', icon: 'list', variant: 'ghost', iconOnly: true, testId: 'menu', onClick: () => toggleMain() });
  const mainMenu = h('div', { class: 'popover main-menu', hidden: true, attrs: { role: 'menu' } }, [
    h('button', { type: 'button', class: 'popover-item', attrs: { role: 'menuitem' }, on: { click: () => (toggleMain(false), ctx.exit()) } }, [icon('back'), h('span', { class: 'popover-main' }, 'New scenario')]),
    h('button', { type: 'button', class: 'popover-item', attrs: { role: 'menuitem' }, on: { click: () => (toggleMain(false), ctx.openSettings()) } }, [icon('settings'), h('span', { class: 'popover-main' }, 'Settings & about')]),
    h('button', { type: 'button', class: 'popover-item', attrs: { role: 'menuitem' }, on: { click: () => (toggleMain(false), ctx.showNotice()) } }, [icon('warning'), h('span', { class: 'popover-main' }, 'Safety notice')]),
  ]);
  function toggleMain(open = mainMenu.hidden): void {
    mainMenu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  offs.push(
    listen(document, 'pointerdown', (e) => {
      if (!mainMenu.hidden && !mainMenu.contains(e.target as Node) && !menuBtn.contains(e.target as Node)) toggleMain(false);
    }),
  );

  // Weather chip.
  const wTemp = h('span', { class: 'wx-item' });
  const wRh = h('span', { class: 'wx-item' });
  const wWind = h('span', { class: 'wx-item wx-wind' });
  const wRating = h('span', { class: 'rating-pill' });
  const chip = h(
    'button',
    {
      type: 'button',
      class: 'weather-chip',
      dataset: { testid: 'weather-chip' },
      aria: { label: 'Current weather — open the weather timeline' },
      on: { click: () => ctx.ui.set({ tab: 'weather', sheet: 'half', panelOpen: false }) },
    },
    [wTemp, wRh, wWind, wRating],
  );

  const el = h('header', { class: 'sim-topbar' }, [
    h('div', { class: 'topbar-row' }, [
      menuBtn,
      h('div', { class: 'clock' }, [clock, h('span', { class: 'clock-sub' }, [elapsed, state])]),
      playBtn,
      speedBtn,
    ]),
    chip,
    menu,
    mainMenu,
  ]);

  // render() runs on every view-clock change (every animation frame while playing), so each part is only rebuilt
  // when what it shows changes: no per-frame DOM churn, and the aria-live state line is not re-announced.
  let stateKey = '';
  let playKey = '';
  let speedKey = -1;
  let wxKey = '';
  let ratingKey = '';
  let waitingSince = 0;
  let waitTimer = 0;
  const render = (): void => {
    const s = session.state.get();
    const abs = ctx.absTime(s.viewTime);
    text(clock, formatClock(abs, ctx.tz));
    text(elapsed, formatElapsedShort(s.viewTime));
    const live = session.isLive(s);
    // "Computing" only after the clock has waited for the worker for a moment, so it does not flicker (and is not
    // re-announced) each time the view briefly catches up with the newest snapshot.
    const waiting = s.playing && s.viewTime >= s.headTime - 1 && s.computing;
    const now = performance.now();
    if (!waiting) waitingSince = 0;
    else if (!waitingSince) {
      waitingSince = now;
      clearTimeout(waitTimer);
      waitTimer = window.setTimeout(render, WAIT_BEFORE_BUSY_MS + 20);
    }
    const busy = waiting && now - waitingSince >= WAIT_BEFORE_BUSY_MS;
    const sk = !live ? 'past' : busy ? 'busy' : '';
    if (sk !== stateKey) {
      stateKey = sk;
      setChildren(
        state,
        sk === 'past'
          ? h('span', { class: 'state-chip state-past' }, 'Replay')
          : sk === 'busy'
            ? h('span', { class: 'state-chip state-busy' }, [h('span', { class: 'spinner spinner-sm', aria: { hidden: true } }), 'Computing'])
            : null,
      );
    }
    const pk = s.playing ? 'pause' : 'play';
    if (pk !== playKey) {
      playKey = pk;
      playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      playBtn.setAttribute('aria-pressed', String(s.playing));
      setChildren(playBtn, icon(s.playing ? 'pause' : 'play', { size: 30 }));
    }
    if (s.speed !== speedKey) {
      speedKey = s.speed;
      text(speedLabel, formatPlaybackSpeed(s.speed));
      for (const b of menu.querySelectorAll<HTMLElement>('[data-speed]')) b.setAttribute('aria-selected', String(Number(b.dataset.speed) === s.speed));
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
      setChildren(wRh, [icon('droplet', { size: 18, class: 'wx-icon' }), h('span', null, rh)]);
      setChildren(wWind, [windArrow(arrowDeg, 22), h('span', { class: 'wx-dir' }, dirName), h('span', { class: 'wx-speed' }, windTxt)]);
      chip.setAttribute('aria-label', `Weather now: ${formatTemp(w.temperature)}, humidity ${rh}, wind from ${dirName} at ${windTxt}. Open the weather timeline.`);
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
      wRating.setAttribute('aria-label', `Fire danger ${r.label}, FFDI about ${Math.round(fi)}`);
    }
  };
  const unsub = session.state.subscribe(render, ['viewTime', 'playing', 'speed', 'computing', 'headTime', 'snapshot', 'reviewing']);
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
      clearTimeout(waitTimer);
      for (const o of offs) o();
    },
  };
}

const WAIT_BEFORE_BUSY_MS = 800;

function speedHint(sp: number): string {
  if (!Number.isFinite(sp)) return 'Results as soon as they are computed';
  if (sp === 1) return 'Real time';
  const minPerSec = sp / 60;
  return minPerSec >= 1 ? `${minPerSec} min of fire per second` : `${sp} s per second`;
}
