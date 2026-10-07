/**
 * Setup screen (B), flat Maps style: a stack of cards and list rows with chips for the options.
 *   Where: "Use my location", a pasted Google Maps link or typed coordinates, or a demo site (horizontally scrolling place cards with
 *     lazily decoded photos)
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
import type { LatLon } from '../../core/geo';
import { describeFix, describePlace, getLocation, LocationError, readClipboardText } from '../location';
import { formatCoordinateText, parseLocationText, rememberableText, type LocationNeedsNetwork, type LocationSource } from '../mapsLink';
import { resolveMapsShortLink } from '../mapsShortLink';
import { demoImageryUrl } from '../imagery';
import { datasetIcon } from '../labels';
import type { Services } from '../modules';
import { getPref, PREF_KEYS, setPref } from '../prefs';
import { chip, iconButton, listRow, showSnackbar } from '../primitives';
import { performanceProfile, settingsStore } from '../settings';
import {
  approxElevation,
  beltRh,
  buildRequest,
  detailCell,
  detailChoices,
  windHint,
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
  // The place of a pasted Google Maps link or of typed coordinates. The box shows what the person typed or pasted; the form keeps only
  // what it means (state.manualText: coordinates, state.manualName: the place name), and `manualView` is what the result row shows.
  type ManualView =
    | { kind: 'empty' }
    | { kind: 'typing' }
    | { kind: 'looking' }
    | { kind: 'ok'; position: LatLon; name?: string; label: string; note?: string }
    | { kind: 'error'; message: string };
  let manualView: ManualView = { kind: 'empty' };
  let lookupCtrl: AbortController | null = null;
  let lookupSeq = 0;
  let lookupTimer: ReturnType<typeof setTimeout> | undefined;
  let lookupRun: (() => void) | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let errorRun: (() => void) | null = null;
  /** Text as it was copied, with its line breaks (the box is one line, so it shows them as spaces): the name of a Google share is its first line. */
  let copied: { text: string; squashed: string } | null = null;
  let pastedText: string | null = null;
  const squash = (t: string): string => t.replace(/\s+/g, '');
  const SOURCE_LABEL: Record<LocationSource, string> = {
    coordinates: 'Coordinates',
    'google-maps-link': 'Google Maps link',
    'geo-link': 'Map link (geo:)',
    'openstreetmap-link': 'OpenStreetMap link',
  };

  const manualHint = h('p', { class: 'hint', id: 'manual-hint', dataset: { testid: 'manual-hint' } }, 'Share a place from Google Maps and paste it here — a link, or lat, lon');
  const manualResult = h('div', { class: 'manual-result', attrs: { 'aria-live': 'polite' }, dataset: { testid: 'manual-result' } });
  const manualInput = h('input', {
    type: 'text',
    id: 'manual-coords',
    inputMode: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    placeholder: 'Google Maps link, or -33.715, 150.285',
    dataset: { testid: 'manual-coords' },
    aria: { describedby: 'manual-hint' },
    on: {
      paste: (e) => {
        const t = e.clipboardData?.getData('text/plain') ?? '';
        // A pasted place or link REPLACES what the box held, like the Paste button: pasted after leftover text it would otherwise join
        // it ("<old link> <new link>": the old one is read first; "x <name> <address> <link>": the address ends up in the name).
        const whole = t.trim() ? parseLocationText(t) : null;
        if (whole && (whole.ok || whole.reason === 'short-link-needs-network' || /https?:\/\/|geo:/i.test(t))) {
          e.preventDefault();
          manualInput.value = t.replace(/[\r\n]+/g, ' ');
          copied = /[\r\n]/.test(t) ? { text: t, squashed: squash(t) } : null;
          pastedText = null;
          applyManualText(t, { now: true });
          return;
        }
        // Anything else is pasted as usual. Remember its line breaks: a one-line box shows them as spaces, and "Name / address / link" needs them.
        pastedText = t && /[\r\n]/.test(t) ? t : null;
      },
      input: (e) => {
        const pasted = (e as InputEvent).inputType === 'insertFromPaste' || (e as InputEvent).inputType === 'insertFromDrop';
        const shown = manualInput.value;
        if (pastedText && squash(pastedText) === squash(shown)) copied = { text: pastedText, squashed: squash(pastedText) };
        else if (!copied || copied.squashed !== squash(shown)) copied = null;
        pastedText = null;
        applyManualText(copied ? copied.text : shown, { now: pasted });
      },
      change: () => flushManual(),
      keydown: (e) => {
        if (e.key !== 'Enter' || e.isComposing) return; // Enter that confirms an IME word is not "done"
        e.preventDefault();
        applyManualText(copied && copied.squashed === squash(manualInput.value) ? copied.text : manualInput.value, { now: true });
        flushManual();
        manualInput.blur();
      },
    },
  });
  const pasteBtn = iconButton({ icon: 'link', label: 'Paste a Google Maps link from the clipboard', testId: 'manual-paste', variant: 'tonal', onClick: () => void pasteFromClipboard() });
  const manualBox = h('div', { class: 'manual-box' }, [
    h('div', { class: 'manual-row' }, [h('div', { class: 'field' }, [h('label', { class: 'field-label', htmlFor: 'manual-coords' }, 'Or paste a Google Maps link or coordinates'), h('div', { class: 'input-wrap' }, manualInput)]), pasteBtn]),
    manualHint,
    manualResult,
  ]);

  function cancelLookup(): void {
    lookupSeq++;
    lookupCtrl?.abort();
    lookupCtrl = null;
    clearTimeout(lookupTimer);
    lookupRun = null;
  }
  function cancelError(): void {
    clearTimeout(errorTimer);
    errorRun = null;
  }
  /** Run what was waiting for a pause in the typing: the short-link lookup, the "not recognised" message. */
  function flushManual(): void {
    if (lookupRun) {
      clearTimeout(lookupTimer);
      const run = lookupRun;
      lookupRun = null;
      run();
    }
    if (errorRun) {
      clearTimeout(errorTimer);
      const run = errorRun;
      errorRun = null;
      run();
    }
  }

  /** Read what is in the box (a link, share text or coordinates) and make it the place; a short link is looked up. */
  function applyManualText(raw: string, o: { now?: boolean } = {}): void {
    cancelLookup();
    cancelError();
    const whereBefore = store.get().where;
    const r = parseLocationText(raw);
    if (r.ok) {
      manualView = { kind: 'ok', position: r.position, ...(r.name ? { name: r.name } : {}), label: SOURCE_LABEL[r.source], ...(r.note ? { note: r.note } : {}) };
      update({ manualText: rememberableText(raw), manualName: r.name ?? '', where: 'manual' });
    } else if (r.reason === 'short-link-needs-network') {
      manualView = { kind: 'looking' };
      update({ manualText: '', manualName: '', where: 'manual' });
      lookupRun = () => void lookUp(r);
      lookupTimer = setTimeout(flushManual, o.now ? 0 : 450);
    } else if (r.reason === 'empty') {
      manualView = { kind: 'empty' };
      update({ manualText: '', manualName: '', where: 'manual' });
    } else {
      // Not a place (yet): say why once the typing pauses, so the message does not flash up on every key.
      manualView = { kind: 'typing' };
      update({ manualText: '', manualName: '', where: 'manual' });
      errorRun = () => {
        manualView = { kind: 'error', message: r.message };
        renderWhere();
      };
      errorTimer = setTimeout(flushManual, o.now ? 0 : 700);
    }
    renderWhere();
    if (store.get().where !== whereBefore) renderWeatherPanel(); // the historic-fire list follows the site only while a demo site is chosen
    schedulePlan(); // the data a run needs depends on the place: the plan must follow the pasted or typed place
  }

  /** Ask Google where a short link leads (on the phone). Editing the text cancels it. */
  async function lookUp(link: LocationNeedsNetwork): Promise<void> {
    const ctrl = new AbortController();
    lookupCtrl = ctrl;
    const seq = ++lookupSeq;
    const res = await resolveMapsShortLink(link.url, { signal: ctrl.signal, ...(link.name ? { nameHint: link.name } : {}) });
    if (destroyed || ctrl.signal.aborted || seq !== lookupSeq) return;
    lookupCtrl = null;
    if (res.ok) {
      manualView = { kind: 'ok', position: res.position, ...(res.name ? { name: res.name } : {}), label: 'Google Maps short link', ...(res.note ? { note: res.note } : {}) };
      // `where` stays as it is: the person may have picked a demo site or the GPS while Google was asked, and a late answer must not take
      // the choice back (the row then offers "Use this place").
      update({ manualText: formatCoordinateText(res.position), manualName: res.name ?? '' });
    } else {
      manualView = { kind: 'error', message: res.message };
      update({ manualText: '', manualName: '' });
    }
    renderWhere();
    renderWeatherPanel();
    schedulePlan();
  }

  async function pasteFromClipboard(): Promise<void> {
    pasteBtn.disabled = true;
    const clip = await readClipboardText();
    pasteBtn.disabled = false;
    if (destroyed) return;
    if (!clip.ok) {
      cancelError();
      manualView = { kind: 'error', message: clip.message };
      renderManual();
      manualInput.focus();
      return;
    }
    manualInput.value = clip.text;
    copied = { text: clip.text, squashed: squash(clip.text) };
    if (squash(manualInput.value) !== copied.squashed) copied = null;
    applyManualText(clip.text, { now: true });
  }

  function clearManual(): void {
    cancelLookup();
    cancelError();
    copied = null;
    manualInput.value = '';
    manualView = { kind: 'empty' };
    const s = store.get();
    update({ manualText: '', manualName: '', ...(s.where === 'manual' ? { where: 'demo' as const } : {}) });
    renderWhere();
    renderWeatherPanel();
    schedulePlan();
    manualInput.focus();
  }

  /** The result row under the box, in the style of the GPS fix: pin, numbers, name, chips, notes, Selected and Clear. */
  function renderManual(): void {
    const s = store.get();
    const v = manualView;
    manualBox.classList.toggle('selected', s.where === 'manual' && v.kind === 'ok');
    show(manualHint, v.kind === 'empty' || v.kind === 'typing');
    const clearBtn = (): HTMLElement => button({ label: 'Clear', icon: 'close', variant: 'text', size: 'sm', testId: 'manual-clear', onClick: clearManual });
    if (v.kind === 'empty' || v.kind === 'typing') return setChildren(manualResult, null);
    if (v.kind === 'looking') {
      return setChildren(manualResult, [h('p', { class: 'status-line', dataset: { testid: 'manual-looking' } }, [h('span', { class: 'spinner', aria: { hidden: true } }), 'Looking up the place with Google Maps…']), h('div', { class: 'fix-actions' }, clearBtn())]);
    }
    if (v.kind === 'error') {
      return setChildren(manualResult, [h('p', { class: 'callout callout-warn', dataset: { testid: 'manual-message' } }, [icon('warning'), h('span', null, v.message)]), h('div', { class: 'fix-actions' }, clearBtn())]);
    }
    const d = describePlace(v.position);
    const selected = s.where === 'manual';
    const site = d.nearDemo ? (d.nearDemo.name.split('–')[0]?.trim() ?? d.nearDemo.region) : '';
    setChildren(manualResult, [
      h('div', { class: ['fix', 'manual-fix', selected && 'selected'], dataset: { testid: 'manual-fix' } }, [
        h('div', { class: 'fix-main' }, [
          icon('pin'),
          h('span', { class: 't-num', dataset: { testid: 'manual-latlon' } }, formatLatLon(v.position.lat, v.position.lon)),
          v.name ? h('span', { class: 'fix-name', attrs: { dir: 'auto' }, dataset: { testid: 'manual-name' } }, v.name) : null,
          selected ? h('span', { class: 'fix-selected' }, [icon('check'), 'Selected']) : null,
        ]),
        h('div', { class: 'chips' }, [chip({ label: v.label, tone: 'neutral' }), chip({ label: d.inNsw ? 'In NSW' : 'Outside NSW', tone: d.inNsw ? 'ok' : 'watch' }), d.nearDemo ? chip({ label: `Bundled data: ${site}`, tone: 'info' }) : null]),
        v.note ? h('p', { class: 'hint' }, v.note) : null,
        d.southHint ? h('p', { class: 'hint' }, 'South of the equator the latitude is negative. Did you mean the same place with a minus sign, or S after the number?') : null,
        !d.inNsw ? h('p', { class: 'hint' }, 'Fuel, fire-history and vegetation data are NSW-only; results elsewhere use estimates.') : null,
        h('div', { class: 'fix-actions' }, [!selected ? button({ label: 'Use this place', variant: 'tonal', size: 'sm', testId: 'manual-use', onClick: () => (update({ where: 'manual' }), renderWhere(), renderWeatherPanel(), schedulePlan()) }) : null, clearBtn()]),
      ]),
    ]);
  }

  /** After the saved setup comes back: show the remembered coordinates as a result row (nothing is changed or looked up). */
  function restoreManualView(): void {
    const t = store.get().manualText;
    const r = t.trim() ? parseLocationText(t) : null;
    manualView = r && r.ok ? { kind: 'ok', position: r.position, label: SOURCE_LABEL[r.source] } : { kind: 'empty' };
  }

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
    renderManual();
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
    const wind = windHint(c);
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
      replay: 'The weather of a real fire day, as a weather model reconstructed it.',
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
    // Say what happened: a delete the device refused must not be reported as done.
    let done: boolean | null;
    try {
      done = await storage.deleteAreaPack(id);
    } catch {
      done = null;
    }
    showSnackbar(el, done === null ? `Could not delete “${name}”: the phone refused to remove it` : done ? `Deleted “${name}”` : `“${name}” was already gone`);
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
    let failed = 0;
    for (const g of groups) {
      try {
        freed += (await storage.clearCache(g.kind)).bytes;
      } catch {
        failed++;
      }
    }
    showSnackbar(el, failed ? `Cleared ${formatBytes(freed)}; could not clear ${failed === 1 ? 'one kind of stored copy' : `${failed} kinds of stored copies`}` : `Cleared ${formatBytes(freed)}`);
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
    const where = s.where === 'demo' ? (site?.name.split('–')[0]?.trim() ?? 'Demo site') : s.where === 'gps' ? 'My location' : (s.manualName.trim() ? `\u2068${s.manualName.trim()}\u2069` : 'Coordinates'); // the name is isolated: a right-to-left name must not reorder the "6 km · 6 h" after it
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
    restoreManualView();
    renderManual();
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
      cancelLookup();
      cancelError();
      packAbort?.abort();
      thumbs.destroy();
      unsubPerf();
      el.remove();
    },
  };
}
