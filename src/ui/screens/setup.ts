/**
 * Setup screen (B), flat Maps style: a stack of cards and list rows with chips for the options.
 *   Where: "Use my location", coordinates, or a demo site (horizontally scrolling place cards with lazily decoded photos)
 *   Area and detail: area 3 / 6 / 9 km and detail as chips, each naming the cell size the builder really makes
 *   Weather: the source as one row of chips (now, forecast, past, preset, historic fire, belt kit, manual) and its panel
 *   Run: duration chips and "Use the network"
 *   Data for this run: the planned data sets (scenario/estimate.ts) with origin and estimated size; opens the Data sets screen
 *   Offline and storage: save the area, the saved areas with size, date and Delete, the storage on the phone and
 *   "Clear downloaded map cache" (every destructive action asks first and none is automatic)
 * and a bottom bar with the summary and the blue "Build 3D model" button.
 */
import { formatBytes, isoDate, type DatasetRecord } from '../../core/datasets';
import { DEMO_SITES } from '../../data/demoSites';
import type { StorageReport } from '../../data/storage';
import { h, setChildren, show, text } from '../dom';
import { icon } from '../icons';
import { REPLAYS, WEATHER_PRESETS } from '../content';
import { DEFAULT_TZ, formatLatLon, formatDateTime, fromZonedInput, toZonedInput, tzOffsetHours, zonedDate, zonedTime } from '../format';
import { describeFix, getLocation, LocationError } from '../location';
import { demoImageryUrl } from '../imagery';
import { datasetIcon } from '../labels';
import type { Services } from '../modules';
import { parseLatLon } from '../nsw';
import { getPref, PREF_KEYS, setPref } from '../prefs';
import { chip, iconButton, listRow, showSnackbar } from '../primitives';
import { performanceProfile, settingsStore } from '../settings';
import {
  approxElevation,
  beltRh,
  buildRequest,
  detailCell,
  detailChoices,
  durationChoices,
  persistable,
  planRow,
  planSummary,
  presetStart,
  resolveCentre,
  restoreSetup,
  validateSetup,
  type ExtentKm,
  type SetupState,
  type WeatherChoice,
} from '../setupModel';
import { Store } from '../store';
import { BEAUFORT, beaufortFromKmh, beaufortRepresentativeKmh, dewPoint, ffdi, ratingFromIndex } from '../weatherCalc';
import { button, chipChoice, compassRose, confirmDialog, numberField, section, slider, toggle } from '../widgets';
import { badgeElement } from './building';

export interface SetupScreen {
  el: HTMLElement;
  /** The form as it is now (for the model card preview and the planned data sets). */
  state(): SetupState;
  destroy(): void;
}

export interface SetupScreenOptions {
  onBuild: (s: SetupState) => void;
  onSettings: () => void;
  /** Open the Data sets screen (planned, stored and bundled data), optionally at one data set. */
  onOpenDatasets?: (datasetId?: string) => void;
  /** Open "How this simulation works" for the current choice. */
  onOpenModelCard?: (s: SetupState) => void;
  /** To say when the scenario builder is the demo (mock) one. */
  services?: Services;
}

/**
 * Date-and-time field in NSW time (the simulation clock's zone, {@link DEFAULT_TZ}), whatever the device's zone; the
 * label says so when the device is set to a different zone.
 */
function dateTimeField(label: string, value: number, onChange: (ms: number) => void, opts: { min?: number; max?: number; testId?: string } = {}): HTMLElement {
  const id = `dt-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const input = h('input', {
    type: 'datetime-local',
    id,
    value: toZonedInput(value),
    min: opts.min !== undefined ? toZonedInput(opts.min) : '',
    max: opts.max !== undefined ? toZonedInput(opts.max) : '',
    dataset: opts.testId ? { testid: opts.testId } : undefined,
    on: {
      change: () => {
        const ms = fromZonedInput(input.value);
        if (Number.isFinite(ms)) onChange(ms);
      },
    },
  });
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sameZone = tzOffsetHours(value) === -new Date(value).getTimezoneOffset() / 60 || deviceTz === DEFAULT_TZ;
  return h('div', { class: 'field' }, [
    h('label', { class: 'field-label', htmlFor: id }, sameZone ? label : `${label} (NSW time)`),
    h('div', { class: 'input-wrap' }, input),
  ]);
}

/**
 * Site photos: each bundled imagery.jpg is 1125 x 1125 px (~270 kB, 5 MB decoded). A card's photo is fetched only when the
 * card scrolls near the view, decoded straight to the thumbnail's size (createImageBitmap with a centre crop) and drawn
 * on a canvas that already has its final size, so nothing shifts. Without createImageBitmap it falls back to a lazy <img>.
 */
function lazyThumbs(scroller: HTMLElement): { observe(el: HTMLElement, url: string): void; destroy(): void } {
  const pending = new Map<Element, string>();
  const load = (host: HTMLElement, url: string): void => {
    pending.delete(host);
    const w = Math.max(1, host.clientWidth || 160);
    const hgt = Math.max(1, host.clientHeight || 96);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const fallback = (): void => {
      setChildren(host, h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }));
    };
    if (typeof createImageBitmap !== 'function') return fallback();
    void fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(async (blob) => {
        // Decoded straight at about the thumbnail's width (the height follows the photo's aspect ratio), then drawn
        // centre-cropped (cover) onto a canvas of the card's size.
        const bmp = await createImageBitmap(blob, { resizeWidth: Math.round(w * dpr), resizeQuality: 'medium' });
        const cw = Math.round(w * dpr);
        const ch = Math.round(hgt * dpr);
        const scale = Math.max(cw / bmp.width, ch / bmp.height);
        const dw = bmp.width * scale;
        const dh = bmp.height * scale;
        const c = h('canvas', { width: cw, height: ch, aria: { hidden: true } });
        c.getContext('2d')?.drawImage(bmp, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        bmp.close();
        setChildren(host, c);
      })
      .catch(fallback);
  };
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const url = pending.get(e.target);
              if (e.isIntersecting && url) {
                io?.unobserve(e.target);
                load(e.target as HTMLElement, url);
              }
            }
          },
          { root: scroller, rootMargin: '0px 60px' },
        )
      : null;
  return {
    observe(el, url) {
      pending.set(el, url);
      if (io) io.observe(el);
      else load(el, url);
    },
    destroy() {
      io?.disconnect();
      pending.clear();
    },
  };
}

export function createSetupScreen(opts: SetupScreenOptions): SetupScreen {
  const store = new Store<SetupState>(restoreSetup(null));
  let destroyed = false;
  void getPref<Partial<SetupState> | null>(PREF_KEYS.setup, null).then((saved) => {
    if (saved && !destroyed) {
      store.set(restoreSetup(saved));
      renderAll();
    }
  });
  const save = (): void => void setPref(PREF_KEYS.setup, persistable(store.get()));
  const update = (p: Partial<SetupState>): void => {
    store.set(p);
    save();
  };
  const tier = (): string => performanceProfile(settingsStore.get().performance).tier;

  // ───────────── Where ─────────────
  const gpsResult = h('div', { class: 'gps-result', attrs: { 'aria-live': 'polite' } });
  const gpsRow = listRow({ title: 'Use my location', sub: 'GPS fix, up to 30 s in steep country', icon: 'my-location', testId: 'use-location', onClick: () => void locate() }) as HTMLButtonElement;
  const manualInput = h('input', {
    type: 'text',
    id: 'manual-coords',
    inputMode: 'text',
    autocomplete: 'off',
    placeholder: '-33.715, 150.285',
    dataset: { testid: 'manual-coords' },
    on: {
      input: () => {
        update({ manualText: manualInput.value, where: 'manual' });
        renderWhere();
      },
    },
  });
  const manualMsg = h('p', { class: 'hint', attrs: { 'aria-live': 'polite' } });
  const manualBox = h('div', { class: 'manual-box' }, [
    h('div', { class: 'field' }, [h('label', { class: 'field-label', htmlFor: 'manual-coords' }, 'Or enter coordinates (lat, lon)'), h('div', { class: 'input-wrap' }, manualInput)]),
    manualMsg,
  ]);

  async function locate(): Promise<void> {
    gpsRow.disabled = true;
    setChildren(gpsResult, h('p', { class: 'status-line' }, [h('span', { class: 'spinner', aria: { hidden: true } }), 'Getting a GPS fix…']));
    try {
      const fix = await getLocation();
      update({ gps: { position: fix.position, accuracy: fix.accuracy }, where: 'gps' });
    } catch (e) {
      const msg = e instanceof LocationError ? e.message : 'Location unavailable. Pick a demo site or enter coordinates.';
      setChildren(gpsResult, h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, msg)]));
      manualInput.focus();
    } finally {
      gpsRow.disabled = false;
      renderWhere();
      schedulePlan();
    }
  }

  const siteScroller = h('div', { class: 'site-scroll', attrs: { role: 'radiogroup', 'aria-label': 'Demo sites' } });
  const thumbs = lazyThumbs(siteScroller);
  const siteCards = DEMO_SITES.map((site) => {
    const thumb = h('span', { class: 'site-thumb', aria: { hidden: true } }, icon('image'));
    const card = h(
      'button',
      {
        type: 'button',
        class: 'site-card',
        dataset: { site: site.id, testid: `site-${site.id}` },
        attrs: { role: 'radio', 'aria-checked': 'false' },
        on: {
          click: () => {
            update({ where: 'demo', demoSiteId: site.id });
            renderWhere();
            renderWeatherPanel();
            schedulePlan();
          },
        },
      },
      [
        thumb,
        h('span', { class: 'site-check', aria: { hidden: true } }, icon('check')),
        h('span', { class: 'site-body' }, [h('span', { class: 'site-name' }, site.name), h('span', { class: 'site-region' }, site.region), h('span', { class: 'site-teach' }, site.teaching)]),
      ],
    );
    thumbs.observe(thumb, demoImageryUrl(site.id));
    return card;
  });
  setChildren(siteScroller, siteCards);

  function renderWhere(): void {
    const s = store.get();
    for (const c of siteCards) {
      const on = s.where === 'demo' && c.dataset.site === s.demoSiteId;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-checked', String(on));
    }
    if (s.gps) {
      const d = describeFix(s.gps.position, s.gps.accuracy);
      setChildren(gpsResult, [
        h('div', { class: ['fix', s.where === 'gps' && 'selected'] }, [
          h('div', { class: 'fix-main' }, [icon('pin'), h('span', { class: 't-num' }, formatLatLon(s.gps.position.lat, s.gps.position.lon)), s.where === 'gps' ? h('span', { class: 'fix-selected' }, [icon('check'), 'Selected']) : null]),
          h('div', { class: 'chips' }, [
            chip({ label: `±${Math.round(s.gps.accuracy)} m`, tone: d.poor ? 'watch' : 'ok' }),
            chip({ label: d.inNsw ? 'In NSW' : 'Outside NSW', tone: d.inNsw ? 'ok' : 'watch' }),
            d.nearDemo ? chip({ label: `Bundled data: ${d.nearDemo.region}`, tone: 'info' }) : null,
          ]),
          d.poor ? h('p', { class: 'hint' }, 'GPS is uncertain here. Check your position on the map before marking a fire.') : null,
          !d.inNsw ? h('p', { class: 'hint' }, 'Fuel, fire-history and vegetation data are NSW-only; results elsewhere use estimates.') : null,
          s.where !== 'gps' ? button({ label: 'Use this location', variant: 'tonal', size: 'sm', onClick: () => (update({ where: 'gps' }), renderWhere(), schedulePlan()) }) : null,
        ]),
      ]);
    }
    const p = parseLatLon(s.manualText);
    manualBox.classList.toggle('selected', s.where === 'manual');
    text(manualMsg, s.manualText.trim() === '' ? 'Decimal degrees or degrees-minutes, e.g. 33°42.9′S 150°17.1′E.' : p ? `${formatLatLon(p.lat, p.lon)}${s.where === 'manual' ? ' — selected' : ''}` : 'Not recognised yet — try “-33.715, 150.285”.');
    renderFooter();
  }

  const whereCard = section(
    'Where',
    [
      h('ul', { class: 'list card-list' }, h('li', null, gpsRow)),
      gpsResult,
      manualBox,
      h('h3', { class: 'section-header setup-sub' }, [h('span', null, 'Demo sites'), h('span', { class: 'section-note' }, 'Work offline')]),
      siteScroller,
    ],
    { icon: 'pin', id: 'setup-where' },
  );

  // ───────────── Area and detail ─────────────
  const detailHintEl = h('p', { class: 'hint', dataset: { testid: 'detail-hint' } });
  const extentChips = chipChoice<'3' | '6' | '9'>({
    label: 'Area (a square)',
    options: [
      { value: '3', label: '3 km' },
      { value: '6', label: '6 km' },
      { value: '9', label: '9 km' },
    ],
    value: String(store.get().extentKm) as '3' | '6' | '9',
    testId: 'extent',
    onChange: (v) => {
      update({ extentKm: Number(v) as ExtentKm });
      renderArea();
      schedulePlan();
    },
  });
  const detailChips = chipChoice({
    label: 'Detail',
    options: detailChoices(store.get().extentKm, tier()),
    value: store.get().detail,
    testId: 'detail',
    onChange: (v) => {
      update({ detail: v });
      renderArea();
      schedulePlan();
    },
  });
  function renderArea(): void {
    const s = store.get();
    extentChips.set(String(s.extentKm) as '3' | '6' | '9');
    detailChips.setOptions(detailChoices(s.extentKm, tier()));
    detailChips.set(s.detail);
    const c = detailCell(s.extentKm, s.detail, tier());
    const cells = c.cells.toLocaleString('en-AU');
    const why = c.coarsened ? ` 20 m needs an area of 6 km or less.` : '';
    const wind = c.twoD ? 'simple 2-D surface wind' : '3-D wind';
    text(detailHintEl, `${c.cellM} m cells, ${c.n} × ${c.n} = ${cells} cells, ${wind}.${why} Finer cells show gullies and cliffs better but run slower.`);
  }
  const modelRow = opts.onOpenModelCard
    ? listRow({ title: 'How this simulation works', sub: 'What is 2-D and what is 3-D, grids and time steps', icon: 'help-circle', chevron: true, testId: 'setup-model-card', onClick: () => opts.onOpenModelCard?.(store.get()) })
    : null;
  const areaCard = section('Area and detail', [extentChips.el, detailChips.el, detailHintEl, modelRow ? h('ul', { class: 'list card-list' }, h('li', null, modelRow)) : null], { icon: 'target', id: 'setup-area' });

  // ───────────── Weather ─────────────
  const weatherChips = chipChoice<WeatherChoice>({
    label: 'Weather source',
    hideLabel: true,
    scroll: true,
    testId: 'weather-source',
    options: [
      { value: 'now', label: 'Now', icon: 'online' },
      { value: 'forecast', label: 'Forecast', icon: 'clock' },
      { value: 'past', label: 'Past day', icon: 'history' },
      { value: 'preset', label: 'Preset', icon: 'book' },
      { value: 'replay', label: 'Historic fire', icon: 'flame' },
      { value: 'belt', label: 'Belt kit', icon: 'thermometer' },
      { value: 'manual', label: 'Manual', icon: 'edit' },
    ],
    value: store.get().weather,
    onChange: (v) => {
      update({ weather: v });
      renderWeatherPanel();
      schedulePlan();
    },
  });
  const weatherPanel = h('div', { class: 'weather-panel' });

  /** A list of radio rows (presets, historic days): the selected one is tinted and carries a check. */
  function choiceRows<T extends { id: string }>(items: T[], selected: string, render: (it: T) => (HTMLElement | null)[], onPick: (id: string) => void, label: string, testPrefix: string): HTMLElement {
    return h(
      'div',
      { class: 'list choice-list', attrs: { role: 'radiogroup', 'aria-label': label } },
      items.map((it) =>
        h(
          'button',
          {
            type: 'button',
            class: ['list-row', 'choice-row', it.id === selected && 'selected'],
            attrs: { role: 'radio', 'aria-checked': String(it.id === selected) },
            dataset: { testid: `${testPrefix}-${it.id}` },
            on: { click: () => onPick(it.id) },
          },
          [h('span', { class: 'list-lead choice-mark', aria: { hidden: true } }, icon(it.id === selected ? 'check-circle' : 'point')), h('span', { class: 'list-body choice-body' }, render(it))],
        ),
      ),
    );
  }

  function renderWeatherPanel(): void {
    const s = store.get();
    weatherChips.set(s.weather);
    const now = Date.now();
    let content: (HTMLElement | null)[] = [];
    switch (s.weather) {
      case 'now':
        content = [
          h('p', { class: 'hint' }, "Hourly data for the site from Open-Meteo: its automatic 'best match' forecast for the location, with ECMWF as the fallback."),
          !s.online ? h('p', { class: 'callout callout-warn' }, [icon('offline'), h('span', null, 'Offline: the last downloaded forecast is used if there is one. Belt weather kit readings are more reliable without signal.')]) : null,
        ];
        break;
      case 'forecast':
        content = [
          dateTimeField('Start at', s.forecastTime, (ms) => (update({ forecastTime: ms }), renderFooter()), { min: now, max: now + 16 * 24 * 3600_000, testId: 'forecast-time' }),
          h(
            'div',
            { class: 'chips' },
            (
              [
                ['+1 h', now + 3600_000],
                ['+3 h', now + 3 * 3600_000],
                ['Tomorrow 14:00', zonedTime(zonedDate(now + 24 * 3600_000), 14)],
              ] as const
            ).map(([l, t]) =>
              chip({
                label: l,
                kind: 'assist',
                icon: 'clock',
                onClick: () => {
                  update({ forecastTime: Math.ceil(t / 600_000) * 600_000 });
                  renderWeatherPanel();
                },
              }),
            ),
          ),
          h('p', { class: 'hint' }, 'Hourly, up to about 16 days ahead; forecasts lose skill after 3–4 days.'),
        ];
        break;
      case 'past':
        content = [dateTimeField('Start at', s.pastTime, (ms) => (update({ pastTime: ms }), renderFooter()), { max: now, testId: 'past-time' }), h('p', { class: 'hint' }, 'Archived forecasts and reanalysis for that day (needs the network).')];
        break;
      case 'preset':
        content = [
          choiceRows(
            WEATHER_PRESETS,
            s.presetId,
            (p) => {
              const lon = s.where === 'demo' ? (DEMO_SITES.find((x) => x.id === s.demoSiteId)?.centre.lon ?? 150.3) : (s.gps?.position.lon ?? 150.3);
              const start = presetStart(p.id, lon, now);
              return [
                h('span', { class: 'choice-head' }, [h('span', { class: 'list-title' }, p.name), ratingChip(p.rating)]),
                h('span', { class: 'list-sub' }, p.description),
                start !== null ? h('span', { class: 'list-sub choice-when' }, [icon('clock'), h('span', null, `Starts ${formatDateTime(start)}`)]) : null,
              ];
            },
            (id) => {
              update({ presetId: id });
              renderWeatherPanel();
            },
            'Weather presets',
            'preset',
          ),
        ];
        break;
      case 'replay': {
        const siteId = s.where === 'demo' ? s.demoSiteId : null;
        const list = [...REPLAYS].sort((a, b) => Number(b.siteId === siteId) - Number(a.siteId === siteId));
        content = [
          choiceRows(
            list,
            s.replayId,
            (r) => [h('span', { class: 'choice-head' }, [h('span', { class: 'list-title' }, r.name), r.siteId === siteId ? chip({ label: 'This site', tone: 'info' }) : null]), h('span', { class: 'list-sub' }, r.description)],
            (id) => {
              const r = REPLAYS.find((x) => x.id === id)!;
              update({ replayId: id, ...(s.where === 'demo' ? { demoSiteId: r.siteId } : {}) });
              renderWhere();
              renderWeatherPanel();
              schedulePlan();
            },
            'Historic fire days',
            'replay',
          ),
          h('p', { class: 'hint' }, 'A historic day also selects its demo site; the weather is the recorded hourly data of that day.'),
        ];
        break;
      }
      case 'belt':
        content = beltPanel(s);
        break;
      case 'manual':
        content = manualPanel(s);
        break;
    }
    const intro: Record<WeatherChoice, string> = {
      now: 'Live conditions and the forecast from now.',
      forecast: 'A future start time from the forecast.',
      past: 'Weather that happened on a past day.',
      preset: 'Teaching days with typical mountain fire weather.',
      replay: 'The recorded weather of a real fire day.',
      belt: 'Your belt weather kit readings (dry and wet bulb, wind).',
      manual: 'Type the conditions, with an optional wind change.',
    };
    setChildren(weatherPanel, [h('p', { class: 'panel-intro' }, intro[s.weather]), ...content]);
    renderFooter();
  }

  function ratingChip(r: string): HTMLElement {
    const key = r.toLowerCase().replace(/\s+/g, '-');
    return h('span', { class: ['rating-pill', `rating-${key}`] }, r);
  }

  function beltPanel(s: SetupState): HTMLElement[] {
    const rhOut = h('output', { class: 'big-readout', attrs: { 'aria-live': 'polite' }, dataset: { testid: 'belt-rh' } });
    const dangerOut = h('p', { class: 'hint' });
    const bfOut = h('p', { class: 'hint beaufort-readout', attrs: { 'aria-live': 'polite' } });
    const recompute = (): void => {
      const b = store.get().belt;
      const elev = approxElevation(store.get());
      const rh = beltRh(b, elev);
      if (Number.isFinite(rh)) {
        rhOut.textContent = `RH ${Math.round(rh)}%`;
        const fi = ffdi(b.dry, rh, b.windKmh, b.droughtFactor);
        dangerOut.textContent = `Dew point ${dewPoint(b.dry, rh).toFixed(0)} °C · FFDI about ${Math.round(fi)} (${ratingFromIndex(fi).label}) · corrected for about ${elev} m elevation`;
      } else {
        rhOut.textContent = 'RH –';
        dangerOut.textContent = 'The wet bulb cannot read warmer than the dry bulb — re-wet the wick and whirl again.';
      }
      const bf = beaufortFromKmh(b.windKmh);
      bfOut.textContent = `Beaufort ${bf.force} · ${bf.name}: ${bf.cue}`;
      renderFooter();
    };
    const setBelt = (p: Partial<SetupState['belt']>): void => {
      update({ belt: { ...store.get().belt, ...p } });
      recompute();
    };
    const windField = numberField({ label: 'Wind speed', unit: 'km/h', value: s.belt.windKmh, min: 0, max: 150, step: 1, onInput: (v) => setBelt({ windKmh: v }), testId: 'belt-wind' });
    const bfSelect = h(
      'select',
      {
        id: 'beaufort',
        on: {
          change: () => {
            const v = beaufortRepresentativeKmh(Number(bfSelect.value));
            windField.set(v);
            setBelt({ windKmh: v });
          },
        },
      },
      [h('option', { value: '', disabled: true, selected: true }, 'No anemometer? Pick what you see…'), ...BEAUFORT.slice(0, 9).map((b) => h('option', { value: String(b.force) }, `${b.force} ${b.name} — ${b.cue}`))],
    );
    const out = [
      h('div', { class: 'grid-2' }, [
        numberField({ label: 'Dry bulb', unit: '°C', value: s.belt.dry, step: 0.5, onInput: (v) => setBelt({ dry: v }), testId: 'belt-dry' }).el,
        numberField({ label: 'Wet bulb', unit: '°C', value: s.belt.wet, step: 0.5, onInput: (v) => setBelt({ wet: v }), testId: 'belt-wet' }).el,
      ]),
      h('div', { class: 'readout-box' }, [rhOut, dangerOut]),
      windField.el,
      h('div', { class: 'field' }, [h('label', { class: 'field-label', htmlFor: 'beaufort' }, 'Beaufort helper'), h('div', { class: 'input-wrap' }, bfSelect)]),
      bfOut,
      compassRose({ label: 'Wind direction — drag to where the wind comes FROM', value: s.belt.windDir, onChange: (d) => setBelt({ windDir: d }), testId: 'belt-dir' }).el,
      dateTimeField('Reading taken at', s.belt.time || Date.now(), (ms) => setBelt({ time: ms })),
      slider({ label: 'Drought factor', min: 0, max: 10, step: 1, value: s.belt.droughtFactor, format: (v) => `${v} / 10`, onInput: (v) => setBelt({ droughtFactor: v }), hint: 'From the district forecast or the brigade (10 = long drought, all fine fuel available).' }).el,
    ];
    recompute();
    return out;
  }

  function manualPanel(s: SetupState): HTMLElement[] {
    const setM = (p: Partial<SetupState['manual']>): void => {
      update({ manual: { ...store.get().manual, ...p } });
      renderFooter();
    };
    const setC = (p: Partial<SetupState['manual']['change']>): void => setM({ change: { ...store.get().manual.change, ...p } });
    const changeBox = h('div', { class: 'change-box' });
    const renderChange = (): void => {
      const c = store.get().manual.change;
      show(changeBox, c.enabled);
      if (!c.enabled) return;
      setChildren(changeBox, [
        slider({ label: 'Change arrives after', min: 0.5, max: 11, step: 0.5, value: c.afterHours, format: (v) => `${v} h`, onInput: (v) => setC({ afterHours: v }) }).el,
        compassRose({ label: 'New wind comes FROM', value: c.windDir, onChange: (d) => setC({ windDir: d }), size: 190 }).el,
        h('div', { class: 'grid-3' }, [
          numberField({ label: 'Wind', unit: 'km/h', value: c.windKmh, min: 0, onInput: (v) => setC({ windKmh: v }) }).el,
          numberField({ label: 'Temp', unit: '°C', value: c.temperature, onInput: (v) => setC({ temperature: v }) }).el,
          numberField({ label: 'RH', unit: '%', value: c.rh, min: 1, max: 100, onInput: (v) => setC({ rh: v }) }).el,
        ]),
      ]);
    };
    const tg = toggle({ label: 'Wind change', description: 'e.g. a south-westerly change in the afternoon', checked: s.manual.change.enabled, onChange: (v) => (setC({ enabled: v }), renderChange()) });
    const out = [
      h('div', { class: 'grid-3' }, [
        numberField({ label: 'Temp', unit: '°C', value: s.manual.temperature, onInput: (v) => setM({ temperature: v }), testId: 'manual-t' }).el,
        numberField({ label: 'RH', unit: '%', value: s.manual.rh, min: 1, max: 100, onInput: (v) => setM({ rh: v }), testId: 'manual-rh' }).el,
        numberField({ label: 'Wind', unit: 'km/h', value: s.manual.windKmh, min: 0, onInput: (v) => setM({ windKmh: v }), testId: 'manual-wind' }).el,
      ]),
      compassRose({ label: 'Wind comes FROM', value: s.manual.windDir, onChange: (d) => setM({ windDir: d }) }).el,
      dateTimeField('Start at', s.manual.start || Date.now(), (ms) => setM({ start: ms })),
      slider({ label: 'Drought factor', min: 0, max: 10, step: 1, value: s.manual.droughtFactor, format: (v) => `${v} / 10`, onInput: (v) => setM({ droughtFactor: v }) }).el,
      tg.el,
      changeBox,
    ];
    renderChange();
    return out;
  }

  const weatherCard = section('Weather', [weatherChips.el, weatherPanel], { icon: 'wind', id: 'setup-weather' });

  // ───────────── Run ─────────────
  const durationOptions = (cur: number): { value: string; label: string }[] => durationChoices(cur).map((hrs) => ({ value: String(hrs), label: `${hrs} h` }));
  const durChips = chipChoice<string>({
    label: 'Simulate for',
    options: durationOptions(store.get().durationH),
    value: String(store.get().durationH),
    testId: 'duration',
    onChange: (v) => {
      update({ durationH: Number(v) });
      renderFooter();
    },
  });
  const onlineToggle = toggle({
    label: 'Use the network',
    description: 'Live weather and map data. Off: bundled data, saved areas and stored copies only.',
    checked: store.get().online,
    icon: 'online',
    testId: 'online',
    onChange: (v) => {
      update({ online: v });
      renderWeatherPanel();
      schedulePlan();
    },
  });
  const runCard = section('Run', [durChips.el, h('div', { class: 'list card-list' }, onlineToggle.el)], { icon: 'clock', id: 'setup-run' });

  // ───────────── Data for this run (planned, before anything is downloaded) ─────────────
  const planHead = h('p', { class: 'plan-total', attrs: { 'aria-live': 'polite' }, dataset: { testid: 'plan-total' } }, 'Working out the data this run needs…');
  const planWarn = h('div', { class: 'plan-warnings' });
  const planList = h('ul', { class: 'list card-list plan-list', aria: { label: 'Planned data sets' } });
  const planNote = h('p', { class: 'hint plan-note' });
  const allRow = opts.onOpenDatasets ? listRow({ title: 'All data sets and storage', icon: 'database', chevron: true, testId: 'open-datasets', onClick: () => opts.onOpenDatasets?.() }) : null;
  const dataCard = section('Data for this run', [planHead, planWarn, planList, planNote, allRow ? h('ul', { class: 'list card-list' }, h('li', null, allRow)) : null], { icon: 'database', id: 'setup-data', class: 'plan-card' });
  dataCard.dataset.testid = 'data-preview';
  let planSeq = 0;
  let planTimer: ReturnType<typeof setTimeout> | undefined;
  function schedulePlan(): void {
    clearTimeout(planTimer);
    planTimer = setTimeout(() => void renderPlan(), 200);
  }
  async function renderPlan(): Promise<void> {
    const seq = ++planSeq;
    const s = store.get();
    const errs = validateSetup(s);
    if (errs.length && 'error' in resolveCentre(s)) {
      text(planHead, 'Pick a place to see the data this run needs.');
      setChildren(planList, null);
      setChildren(planWarn, null);
      text(planNote, '');
      return;
    }
    let records: DatasetRecord[];
    try {
      const req = buildRequest(s, settingsStore.get());
      const { estimateScenarioData } = await import('../../scenario/estimate');
      records = await estimateScenarioData(req);
    } catch (e) {
      if (seq !== planSeq || destroyed) return;
      console.warn('[FireSim] data plan unavailable', e);
      text(planHead, 'The data plan is not available right now.');
      setChildren(planList, null);
      return;
    }
    if (seq !== planSeq || destroyed) return;
    const sum = planSummary(records, s.online);
    text(planHead, `${sum.download} · ${sum.offline}`);
    setChildren(
      planWarn,
      sum.warnings.map((w) => h('div', { class: 'callout callout-warn' }, [icon(s.online ? 'offline' : 'warning'), h('div', null, w)])),
    );
    const rows = records.filter((r) => r.role !== 'bundle' && r.role !== 'pack').map((r) => planRow(r, s.online));
    setChildren(
      planList,
      rows.map((r) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: ['list-row', 'two-line', 'plan-row'],
              dataset: { testid: `plan-${r.id}` },
              disabled: !opts.onOpenDatasets,
              on: { click: () => opts.onOpenDatasets?.(r.id) },
              attrs: { 'aria-label': `${r.title}, ${r.provider}, ${r.badge.label}${r.size ? `, ${r.size.replace('≈', 'about')}` : ''}` },
            },
            [
              h('span', { class: 'list-lead' }, icon(datasetIcon(r.id, r.role))),
              h('span', { class: 'list-body' }, [h('span', { class: 'list-title' }, r.title), h('span', { class: 'list-sub' }, r.provider)]),
              h('span', { class: 'list-trail plan-trail' }, [badgeElement(r.badge), r.size ? h('span', { class: 'plan-size t-num' }, r.size) : null]),
            ],
          ),
        ),
      ),
    );
    const mock = opts.services?.sources.scenario === 'mock';
    text(
      planNote,
      `≈ sizes are estimates of the uncompressed answers (the services usually send less); bundled sizes are exact.${mock ? ' This build uses the demo builder: the list is what the full builder would read.' : ''}`,
    );
  }

  // ───────────── Offline and storage ─────────────
  const packOut = h('p', { class: 'hint pack-status', attrs: { 'aria-live': 'polite' }, dataset: { testid: 'pack-status' } });
  let packAbort: AbortController | null = null;
  const packRow = listRow({ title: 'Save this area for offline use', sub: 'Terrain, map layers and weather of the chosen square', icon: 'download', testId: 'save-pack', onClick: () => void savePack() }) as HTMLButtonElement;
  async function savePack(): Promise<void> {
    const s = store.get();
    const c = resolveCentre(s);
    if ('error' in c) {
      text(packOut, c.error);
      return;
    }
    if (!s.online) {
      text(packOut, 'Turn on “Use the network” to download an area.');
      return;
    }
    packAbort?.abort();
    const ctrl = new AbortController();
    packAbort = ctrl;
    packRow.disabled = true;
    try {
      const { downloadAreaPack } = await import('../../scenario/areaPack');
      const r = await downloadAreaPack(
        { name: c.name, centre: c.centre, extent: s.extentKm * 1000, ...(c.demoSiteId ? { demoSiteId: c.demoSiteId } : {}) },
        (p) => text(packOut, `${Math.round(p.fraction * 100)} % · ${p.message}`),
        ctrl.signal,
      );
      const size = r.meta.bytes ? ` (${formatBytes(r.meta.bytes)})` : '';
      text(packOut, `Saved “${r.meta.name}”${size} for offline use.${r.warnings.length ? ` ${r.warnings.length} layer(s) could not be downloaded.` : ''}`);
      void renderStorage();
      schedulePlan();
    } catch (e) {
      if (!ctrl.signal.aborted) text(packOut, `Could not save the area: ${(e as Error).message || e}`);
    } finally {
      packRow.disabled = false;
    }
  }
  const packsHead = h('h3', { class: 'section-header setup-sub' }, 'Saved areas');
  const packsList = h('ul', { class: 'list card-list', aria: { label: 'Saved areas' }, dataset: { testid: 'saved-areas' } });
  const storageList = h('ul', { class: 'list card-list', dataset: { testid: 'storage' } });
  async function renderStorage(): Promise<void> {
    let rep: StorageReport;
    try {
      const { storage } = await import('../../data');
      rep = await storage.report();
    } catch (e) {
      console.warn('[FireSim] storage report unavailable', e);
      return;
    }
    if (destroyed) return;
    show(packsHead, rep.packs.length > 0);
    setChildren(
      packsList,
      rep.packs.map((p) =>
        h(
          'li',
          null,
          listRow({
            title: p.name,
            sub: `${formatBytes(p.bytes)} · saved ${isoDate(p.createdAt)} · ${p.extentM / 1000} km square`,
            icon: 'offline',
            trailing: iconButton({ icon: 'trash', label: `Delete the saved area ${p.name}`, testId: `delete-pack-${p.id}`, onClick: () => void deletePack(p.id, p.name, p.bytes) }),
          }),
        ),
      ),
    );
    const bundledText = rep.bundled.available ? ` · ${formatBytes(rep.bundled.totalBytes)} bundled with the app` : '';
    const clearRow = listRow({
      title: 'Clear downloaded map cache',
      sub: rep.cacheBytes > 0 ? `${formatBytes(rep.cacheBytes)} of downloaded copies; saved areas stay` : 'Nothing downloaded yet',
      icon: 'trash',
      testId: 'clear-cache',
      onClick: () => void clearCache(rep),
    }) as HTMLButtonElement;
    clearRow.disabled = rep.cacheBytes <= 0;
    setChildren(storageList, [
      h(
        'li',
        null,
        listRow({
          title: 'Storage on this phone',
          sub: rep.onDeviceBytes > 0 ? `${formatBytes(rep.onDeviceBytes)} added by the app (${formatBytes(rep.cacheBytes)} downloaded copies, ${formatBytes(rep.packBytes)} saved areas)${bundledText}` : `Nothing downloaded or saved yet${bundledText}`,
          icon: 'storage',
        }),
      ),
      h('li', null, clearRow),
      ...rep.warnings.map((w) => h('li', null, h('div', { class: 'callout callout-warn' }, [icon('warning'), h('div', null, w)]))),
    ]);
  }
  async function deletePack(id: string, name: string, bytes: number): Promise<void> {
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      body: `The saved area (${formatBytes(bytes)}) is removed from this phone. Builds here then need a signal again. Downloaded copies and the bundled demo sites stay.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok || destroyed) return;
    const { storage } = await import('../../data');
    await storage.deleteAreaPack(id).catch(() => false);
    showSnackbar(el, `Deleted “${name}”`);
    void renderStorage();
    schedulePlan();
  }
  async function clearCache(rep: StorageReport): Promise<void> {
    const groups = rep.caches.filter((g) => g.bytes > 0);
    const ok = await confirmDialog({
      title: 'Clear downloaded map cache?',
      body: [
        h('p', null, `Removes the stored copies of downloads (${formatBytes(rep.cacheBytes)}). Saved areas and the bundled demo sites stay. Places you built before need a signal again.`),
        h(
          'ul',
          { class: 'dialog-list' },
          groups.map((g) => h('li', null, `${g.title}: ${formatBytes(g.bytes)}`)),
        ),
      ],
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok || destroyed) return;
    const { storage } = await import('../../data');
    let freed = 0;
    for (const g of groups) freed += (await storage.clearCache(g.kind).catch(() => ({ removed: 0, bytes: 0 }))).bytes;
    showSnackbar(el, `Cleared ${formatBytes(freed)}`);
    void renderStorage();
    schedulePlan();
  }
  const offlineCard = section('Offline and storage', [h('ul', { class: 'list card-list' }, h('li', null, packRow)), packOut, packsHead, packsList, storageList], { icon: 'offline', id: 'setup-offline' });

  // ───────────── Bottom bar ─────────────
  const errorsEl = h('div', { class: 'footer-errors', attrs: { 'aria-live': 'polite' } });
  const summaryEl = h('p', { class: 'footer-summary' });
  const buildBtn = button({
    label: 'Build 3D model',
    icon: 'cube',
    variant: 'primary',
    size: 'lg',
    block: true,
    testId: 'build',
    onClick: () => {
      const errs = validateSetup(store.get());
      if (errs.length) {
        renderFooter(true);
        return;
      }
      opts.onBuild(store.get());
    },
  });
  function renderFooter(showErrors = false): void {
    const s = store.get();
    const errs = validateSetup(s);
    buildBtn.setAttribute('aria-disabled', String(errs.length > 0));
    buildBtn.classList.toggle('is-disabled', errs.length > 0);
    setChildren(errorsEl, showErrors || s.where !== 'demo' ? errs.map((e) => h('p', { class: 'error-line' }, [icon('warning'), e])) : null);
    const site = DEMO_SITES.find((x) => x.id === s.demoSiteId);
    const where = s.where === 'demo' ? (site?.name.split('–')[0]?.trim() ?? 'Demo site') : s.where === 'gps' ? 'My location' : 'Coordinates';
    const wLabel: Record<WeatherChoice, string> = { now: 'live weather', forecast: `forecast ${s.forecastTime ? formatDateTime(s.forecastTime) : ''}`, past: 'past weather', preset: 'preset weather', replay: 'historic day', belt: 'belt kit readings', manual: 'manual weather' };
    text(summaryEl, `${where} · ${s.extentKm} km · ${s.durationH} h · ${wLabel[s.weather]}`);
  }
  const footer = h('div', { class: 'bottom-bar setup-footer' }, [errorsEl, summaryEl, buildBtn]);

  const header = h('header', { class: 'app-bar setup-bar' }, [
    h('span', { class: 'brand-mark', aria: { hidden: true } }, icon('flame')),
    h('div', { class: 'app-bar-titles' }, [h('h1', { class: 'app-bar-title', tabIndex: -1 }, 'FireSim'), h('p', { class: 'app-bar-sub' }, 'Mountain bushfire trainer')]),
    iconButton({ icon: 'settings', label: 'Settings and about', testId: 'open-settings', onClick: opts.onSettings }),
  ]);

  const el = h('div', { class: 'screen setup-screen', dataset: { testid: 'setup' } }, [
    header,
    h('main', { class: 'screen-main setup-main' }, [
      h('p', { class: 'setup-intro' }, 'Build a 3-D model of the country, choose the weather, mark the fire and see why it behaves the way it does.'),
      whereCard,
      areaCard,
      weatherCard,
      runCard,
      dataCard,
      offlineCard,
    ]),
    footer,
  ]);

  // The detail chips name the cell size, which depends on the performance mode (Settings).
  const unsubPerf = settingsStore.subscribe(() => {
    renderArea();
    schedulePlan();
  }, ['performance']);

  function renderAll(): void {
    const s = store.get();
    renderWhere();
    renderArea();
    renderWeatherPanel();
    durChips.setOptions(durationOptions(s.durationH));
    durChips.set(String(s.durationH));
    onlineToggle.set(s.online);
    manualInput.value = s.manualText;
    schedulePlan();
  }
  renderAll();
  void renderStorage();

  return {
    el,
    state: () => store.get(),
    destroy: () => {
      destroyed = true;
      clearTimeout(planTimer);
      packAbort?.abort();
      thumbs.destroy();
      unsubPerf();
      el.remove();
    },
  };
}
