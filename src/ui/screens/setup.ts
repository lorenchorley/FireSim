/**
 * Setup screen (B): where (GPS / coordinates / bundled demo site), area and detail, weather source (now, past,
 * forecast, presets, historic replay, belt weather kit, manual with an optional wind change), duration,
 * online/offline, then "Build 3D model".
 */
import { DEMO_SITES } from '../../data/demoSites';
import { h, setChildren, show, text } from '../dom';
import { icon } from '../icons';
import { REPLAYS, WEATHER_PRESETS } from '../content';
import { DEFAULT_TZ, formatLatLon, formatDateTime, fromZonedInput, toZonedInput, tzOffsetHours, zonedDate, zonedTime } from '../format';
import { describeFix, getLocation, LocationError } from '../location';
import { demoImageryUrl } from '../imagery';
import { parseLatLon } from '../nsw';
import { getPref, PREF_KEYS, setPref } from '../prefs';
import { approxElevation, beltRh, detailHint, persistable, restoreSetup, validateSetup, type SetupState, type WeatherChoice } from '../setupModel';
import { Store } from '../store';
import { BEAUFORT, beaufortFromKmh, beaufortRepresentativeKmh, dewPoint, ffdi, ratingFromIndex } from '../weatherCalc';
import { button, compassRose, numberField, section, segmented, slider, toggle } from '../widgets';

export interface SetupScreen {
  el: HTMLElement;
  destroy(): void;
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

export function createSetupScreen(opts: { onBuild: (s: SetupState) => void; onSettings: () => void }): SetupScreen {
  const store = new Store<SetupState>(restoreSetup(null));
  void getPref<Partial<SetupState> | null>(PREF_KEYS.setup, null).then((saved) => {
    if (saved) {
      store.set(restoreSetup(saved));
      renderAll();
    }
  });
  const save = (): void => void setPref(PREF_KEYS.setup, persistable(store.get()));
  const update = (p: Partial<SetupState>): void => {
    store.set(p);
    save();
  };

  // ───────────── Where ─────────────
  const gpsResult = h('div', { class: 'gps-result', attrs: { 'aria-live': 'polite' } });
  const gpsBtn = button({
    label: 'Use my location',
    icon: 'locate',
    variant: 'primary',
    size: 'lg',
    testId: 'use-location',
    onClick: () => void locate(),
  });
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
    gpsBtn.disabled = true;
    setChildren(gpsResult, h('p', { class: 'status-line' }, [h('span', { class: 'spinner', aria: { hidden: true } }), 'Getting a GPS fix… (up to 30 s in steep country)']));
    try {
      const fix = await getLocation();
      update({ gps: { position: fix.position, accuracy: fix.accuracy }, where: 'gps' });
    } catch (e) {
      const msg = e instanceof LocationError ? e.message : 'Location unavailable. Pick a demo site or enter coordinates.';
      setChildren(gpsResult, h('p', { class: 'callout callout-warn' }, [icon('warning'), h('span', null, msg)]));
      manualInput.focus();
    } finally {
      gpsBtn.disabled = false;
      renderWhere();
    }
  }

  const siteCards = h(
    'div',
    { class: 'site-list', attrs: { role: 'radiogroup', 'aria-label': 'Demo sites' } },
    DEMO_SITES.map((site) =>
      h(
        'button',
        {
          type: 'button',
          class: 'site-card',
          dataset: { site: site.id, testid: `site-${site.id}` },
          attrs: { role: 'radio' },
          on: {
            click: () => {
              update({ where: 'demo', demoSiteId: site.id });
              renderWhere();
              renderWeatherPanel();
            },
          },
        },
        [
          h('img', { class: 'site-thumb', src: demoImageryUrl(site.id), alt: '', loading: 'lazy', decoding: 'async' }),
          h('span', { class: 'site-body' }, [
            h('span', { class: 'site-region' }, site.region),
            h('span', { class: 'site-name' }, site.name),
            h('span', { class: 'site-teach' }, site.teaching),
          ]),
          h('span', { class: 'site-check', aria: { hidden: true } }, icon('check')),
        ],
      ),
    ),
  );

  function renderWhere(): void {
    const s = store.get();
    for (const c of siteCards.querySelectorAll<HTMLButtonElement>('.site-card')) {
      const on = s.where === 'demo' && c.dataset.site === s.demoSiteId;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-checked', String(on));
    }
    if (s.gps) {
      const d = describeFix(s.gps.position, s.gps.accuracy);
      setChildren(gpsResult, [
        h('div', { class: ['fix', s.where === 'gps' && 'selected'] }, [
          h('div', { class: 'fix-main' }, [icon('pin'), h('strong', null, formatLatLon(s.gps.position.lat, s.gps.position.lon))]),
          h('div', { class: 'chips' }, [
            h('span', { class: ['chip', d.poor ? 'chip-warn' : 'chip-ok'] }, `±${Math.round(s.gps.accuracy)} m`),
            h('span', { class: ['chip', d.inNsw ? 'chip-ok' : 'chip-warn'] }, d.inNsw ? 'In NSW' : 'Outside NSW'),
            d.nearDemo ? h('span', { class: 'chip chip-info' }, `Bundled data: ${d.nearDemo.region}`) : null,
          ]),
          d.poor ? h('p', { class: 'hint' }, 'GPS is uncertain here. Check your position on the map before marking a fire.') : null,
          !d.inNsw ? h('p', { class: 'hint' }, 'Fuel, fire-history and vegetation data are NSW-only; results elsewhere use estimates.') : null,
          s.where !== 'gps' ? button({ label: 'Use this location', variant: 'secondary', onClick: () => (update({ where: 'gps' }), renderWhere()) }) : null,
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
      h('div', { class: 'row-actions' }, [gpsBtn]),
      gpsResult,
      manualBox,
      h('h3', { class: 'sub-title' }, [icon('map'), 'Or pick a demo site — works offline']),
      siteCards,
    ],
    { icon: 'pin', id: 'where' },
  );

  // ───────────── Area & detail ─────────────
  const detailHintEl = h('p', { class: 'hint' });
  const extentSeg = segmented({
    label: 'Area size',
    options: [
      { value: '3', label: '3 km' },
      { value: '6', label: '6 km' },
      { value: '9', label: '9 km' },
    ],
    value: String(store.get().extentKm) as '3' | '6' | '9',
    testId: 'extent',
    onChange: (v) => {
      update({ extentKm: Number(v) as 3 | 6 | 9 });
      renderArea();
    },
  });
  const detailSeg = segmented({
    label: 'Detail',
    options: [
      { value: 'fast', label: 'Fast', sub: '40 m' },
      { value: 'normal', label: 'Normal', sub: '30 m' },
      { value: 'detailed', label: 'Detailed', sub: '20 m' },
    ],
    value: store.get().detail,
    testId: 'detail',
    onChange: (v) => {
      update({ detail: v });
      renderArea();
    },
  });
  function renderArea(): void {
    const s = store.get();
    extentSeg.set(String(s.extentKm) as '3' | '6' | '9');
    detailSeg.set(s.detail);
    text(detailHintEl, `${s.extentKm} km square (6 km suits most fires; 9 km takes in a whole valley). ${detailHint(s.extentKm, s.detail)}: finer detail shows gullies and cliffs better but runs slower.`);
  }
  const areaCard = section('Area and detail', [extentSeg.el, detailSeg.el, detailHintEl], { icon: 'target', id: 'area' });

  // ───────────── Weather ─────────────
  const weatherSeg = segmented<WeatherChoice>({
    label: 'Weather source',
    hideLabel: true,
    columns: 2,
    testId: 'weather-source',
    options: [
      { value: 'now', label: 'Now', icon: 'online' },
      { value: 'forecast', label: 'Forecast', icon: 'clock' },
      { value: 'past', label: 'Past day', icon: 'replay' },
      { value: 'preset', label: 'Preset', icon: 'book' },
      { value: 'replay', label: 'Historic fire', icon: 'flame' },
      { value: 'belt', label: 'Belt kit', icon: 'thermometer' },
      { value: 'manual', label: 'Manual', icon: 'settings' },
    ],
    value: store.get().weather,
    onChange: (v) => {
      update({ weather: v });
      renderWeatherPanel();
    },
  });
  const weatherPanel = h('div', { class: 'weather-panel' });

  function radioCards<T extends { id: string }>(items: T[], selected: string, render: (it: T) => HTMLElement[], onPick: (id: string) => void, label: string, testPrefix: string): HTMLElement {
    return h(
      'div',
      { class: 'choice-list', attrs: { role: 'radiogroup', 'aria-label': label } },
      items.map((it) =>
        h(
          'button',
          {
            type: 'button',
            class: ['choice-card', it.id === selected && 'selected'],
            attrs: { role: 'radio', 'aria-checked': String(it.id === selected) },
            dataset: { testid: `${testPrefix}-${it.id}` },
            on: { click: () => onPick(it.id) },
          },
          [h('span', { class: 'choice-body' }, render(it)), h('span', { class: 'site-check', aria: { hidden: true } }, icon('check'))],
        ),
      ),
    );
  }

  function renderWeatherPanel(): void {
    const s = store.get();
    weatherSeg.set(s.weather);
    const now = Date.now();
    let content: (HTMLElement | null)[] = [];
    switch (s.weather) {
      case 'now':
        content = [
          h('p', { class: 'hint' }, 'Hourly data for the site from Open-Meteo (Bureau of Meteorology ACCESS-G, ECMWF).'),
          !s.online ? h('p', { class: 'callout callout-warn' }, [icon('offline'), h('span', null, 'Offline: the last downloaded forecast will be used if there is one. Belt weather kit readings are more reliable without signal.')]) : null,
        ];
        break;
      case 'forecast':
        content = [
          dateTimeField('Start at', s.forecastTime, (ms) => update({ forecastTime: ms }), { min: now, max: now + 16 * 24 * 3600_000, testId: 'forecast-time' }),
          h(
            'div',
            { class: 'chips chips-actions' },
            [
              ['+1 h', now + 3600_000],
              ['+3 h', now + 3 * 3600_000],
              ['Tomorrow 14:00', zonedTime(zonedDate(now + 24 * 3600_000), 14)],
            ].map(([l, t]) =>
              button({
                label: String(l),
                variant: 'ghost',
                onClick: () => {
                  update({ forecastTime: Math.ceil(Number(t) / 600_000) * 600_000 });
                  renderWeatherPanel();
                },
              }),
            ),
          ),
          h('p', { class: 'hint' }, 'Forecasts are hourly for up to about 16 days; skill drops after 3–4 days.'),
        ];
        break;
      case 'past':
        content = [
          dateTimeField('Start at', s.pastTime, (ms) => update({ pastTime: ms }), { max: now, testId: 'past-time' }),
          h('p', { class: 'hint' }, 'Uses archived forecasts and reanalysis for that day (needs the network).'),
        ];
        break;
      case 'preset':
        content = [
          radioCards(
            WEATHER_PRESETS,
            s.presetId,
            (p) => [h('span', { class: 'choice-head' }, [h('span', { class: 'choice-name' }, p.name), ratingChip(p.rating)]), h('span', { class: 'choice-desc' }, p.description)],
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
          radioCards(
            list,
            s.replayId,
            (r) => [
              h('span', { class: 'choice-head' }, [h('span', { class: 'choice-name' }, r.name), r.siteId === siteId ? h('span', { class: 'chip chip-info' }, 'This site') : null]),
              h('span', { class: 'choice-desc' }, r.description),
            ],
            (id) => {
              const r = REPLAYS.find((x) => x.id === id)!;
              update({ replayId: id, ...(s.where === 'demo' ? { demoSiteId: r.siteId } : {}) });
              renderWhere();
              renderWeatherPanel();
            },
            'Historic fire days',
            'replay',
          ),
          h('p', { class: 'hint' }, 'Picking a historic day also selects its demo site. Weather is the recorded hourly data for that day.'),
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
      preset: 'Teaching scenarios with typical mountain fire weather.',
      replay: 'Replay the recorded weather of a real fire day.',
      belt: 'Your belt weather kit readings (dry/wet bulb, wind).',
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
    const bfOut = h('p', { class: 'beaufort-readout', attrs: { 'aria-live': 'polite' } });
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

  const weatherCard = section('Weather', [weatherSeg.el, weatherPanel], { icon: 'wind', id: 'weather' });

  // ───────────── Run ─────────────
  const durSlider = slider({
    label: 'Simulate for',
    min: 1,
    max: 12,
    step: 1,
    value: store.get().durationH,
    format: (v) => `${v} h`,
    testId: 'duration',
    onInput: (v) => update({ durationH: v }),
  });
  const onlineToggle = toggle({
    label: 'Use the network',
    description: 'Live weather and remote data. Off = bundled data, downloaded area packs and cache only.',
    checked: store.get().online,
    icon: 'online',
    testId: 'online',
    onChange: (v) => {
      update({ online: v });
      renderWeatherPanel();
    },
  });
  const runCard = section('Run', [durSlider.el, onlineToggle.el], { icon: 'clock', id: 'run' });

  // ───────────── Footer ─────────────
  const errorsEl = h('div', { class: 'footer-errors', attrs: { 'aria-live': 'polite' } });
  const summaryEl = h('p', { class: 'footer-summary' });
  const buildBtn = button({
    label: 'Build 3D model',
    icon: 'cube',
    variant: 'primary',
    size: 'lg',
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
    setChildren(errorsEl, showErrors || s.where !== 'demo' ? errs.map((e) => h('p', { class: 'error-line' }, [icon('warning', { size: 18 }), e])) : null);
    const site = DEMO_SITES.find((x) => x.id === s.demoSiteId);
    const where = s.where === 'demo' ? (site?.name.split('–')[0]?.trim() ?? 'Demo site') : s.where === 'gps' ? 'My location' : 'Coordinates';
    const wLabel: Record<WeatherChoice, string> = { now: 'live weather', forecast: `forecast ${s.forecastTime ? formatDateTime(s.forecastTime) : ''}`, past: 'past weather', preset: 'preset weather', replay: 'historic day', belt: 'belt kit readings', manual: 'manual weather' };
    text(summaryEl, `${where} · ${s.extentKm} km · ${s.durationH} h · ${wLabel[s.weather]}`);
  }
  const footer = h('div', { class: 'setup-footer' }, [errorsEl, summaryEl, buildBtn]);

  const header = h('header', { class: 'app-header' }, [
    h('div', { class: 'brand' }, [
      h('span', { class: 'brand-mark', aria: { hidden: true } }, icon('flame', { size: 28 })),
      h('span', { class: 'brand-text' }, [h('span', { class: 'brand-name' }, 'FireSim'), h('span', { class: 'brand-sub' }, 'Mountain bushfire trainer')]),
    ]),
    button({ label: 'Settings and about', icon: 'settings', variant: 'ghost', iconOnly: true, testId: 'open-settings', onClick: opts.onSettings }),
  ]);

  const el = h('div', { class: 'screen setup-screen', dataset: { testid: 'setup' } }, [
    header,
    h('main', { class: 'setup-main' }, [
      h('p', { class: 'setup-intro' }, 'Build a 3-D model of the country around you, choose the weather, mark where the fire is, and see why it behaves the way it does.'),
      whereCard,
      areaCard,
      weatherCard,
      runCard,
    ]),
    footer,
  ]);

  function renderAll(): void {
    renderWhere();
    renderArea();
    renderWeatherPanel();
    durSlider.set(store.get().durationH);
    onlineToggle.set(store.get().online);
    manualInput.value = store.get().manualText;
  }
  renderAll();

  return { el, destroy: () => el.remove() };
}
