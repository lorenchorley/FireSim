# D-CONTRACT-060-wind: Wind direction (0.6.0 item 4), lanes W-core and W-ui

Base: C0 `540472b` plus C1 (section 3). Paths under `/home/user/FireSim`, line numbers at head `489542c`. MEASURED = I ran it; open points are in section 8.
Scratch (not repo code): `scratchpad/lane-scout-wind/` has `proto2.ts` (a working reference of `applyWindDirection`), `lag.out`, `lag2.out`, `head.test.ts`.

## 1. The earlier design: verified, corrected, added

Verified
- The atmosphere reads the series only as stamp pairs (`simulation.ts:1161-1166` -> `atm.setAmbient` `base.ts:275`; `buildAtmosphere` 1036-1039) plus static fields (`profile.ts:81-86`, `base.ts:191,231,551,584`): a wind-only series transform needs nothing in `atmosphere/`, `fire/`, `embers/`, `render/`. `WindEdit` / `atm.setWindEdits` (`base.ts:240`) are a separate input and stay.
- No edit is persisted (grep `src`, `e2e`: only `Session.state.edits`, sim records, `mockSim.edits`; `scenario.edits` is Setup's belt kit): no schema.
- Whole-minute times are right: steps end on every 60 s mark and display-step mark (1237).
- No protocol change: `edit` / `removeEdit` carry a generic `ScenarioEdit` / id (`host.ts:140-147`); the in-thread fallback (`client.ts:248-258`) runs the same `Simulation`. At C0 the engine and mock ignore a `windDirection` edit harmlessly (`applyRecord` 912; `mockSim.windEdits()` filters `'wind'`).

Corrected or missing
1. **On the 3-D tiers the fire's wind IS the resolved 3-D air** (`atmosphere.ts:984-1012`: `U_fire = bg + (resolved - bg) * f`, `f = 1` away from the fire), so 3-D lag reaches the fire. The earlier "lowest layer within a minute, layers above 45 min" is not what I measured (7.4): the air settles 5 to 10 min after the turn ends, with a 10 to 20 degree overshoot near the ground in a 9 km test.
2. **Stamp indices shift.** `stampIdx` indexes `series.hours`; inserted stamps move it. Apply, remove and restore must rebuild `wx` and re-bind the pair; and `stepOnce` captures `series = this.scenario.weather` at 1152, BEFORE `applyDueRecords` (1156): read `wx` after the records.
3. **Remove needs an engine branch.** `Simulation.removeEdit` (615-617) records "from now on", so a pending or past change would stay active. "As if never added" copies `removeIgnition` (625-655), chosen by the record's kind; protocol unchanged.
4. Line 430 records every non-`wind` scenario edit at time 0: a `windDirection` in `scenario.edits` (tests, harness) must keep its own time.
5. **Light imports.** `session.ts` is in the entry chunk (`index-*.js`, budget 195 kB gzip, 174.8 in a default build here); `scenario/weather.ts` and `openMeteo.ts` are separate lazy chunks today (MEASURED from the sourcemaps of a scratch `vite build`). So `windDirection.ts` imports only `core/types`, `core/units`, `atmosphere/weatherInterp` (`interpolateHour` makes the inserted stamps), NOT `scenario/weather`. Inserted stamps then carry no precipitation or radiation means: fine, the sim reads those from the forecast only (section 4).
6. Speed: stamps are linear in u/v, so speed dips up to 0.85 % between 15 degree stamps (MEASURED). `env.weather` and `stats.weather` keep the forecast speed exactly (overlay, section 4); only the atmosphere's pair and `windWeather()` carry the dip.
7. Stamp spacing: smoothstep has slope 1.5, so `m = ceil(1.5 * arc / 15) = ceil(arc / 10)` segments keep every pair within 15 degrees after easing (90 degrees = 10 new stamps; each costs one more background solve when crossed, 7.4).
8. Accepted: Setup's belt-kit `WindEdit`s (listed and removable in the old panel) can no longer be removed in a run; forecast cards, the Danger gate, timeline marks and the Weather callout still describe the forecast.

## 2. Data model and pure module `src/scenario/windDirection.ts`

`WindDirectionEdit` (C0, `types.ts:615`) is the data: `{ kind, id, dir /* FROM, [0,360) */, time /* s from start, whole minute */ }`.

```ts
WIND_TURN_S = 900; WIND_TURN_STEP_DEG = 15                                  // C0
windDirectionTime(seconds, durationS): number     // C0 real: ceil to a minute, cap at the last whole minute <= D-60
turnFraction(elapsedS): number; turnDirection(from, to, f): number          // C0 real (shortest arc, half turn clockwise)
type WindChangePhase = 'scheduled' | 'turning' | 'done'                     // C1 real
windChangePhase(edit: Pick<WindDirectionEdit,'time'>, nowS): WindChangePhase // nowS<time scheduled; <time+900 turning; else done
windDirectionEdits(list: readonly { edit: ScenarioEdit }[]): WindDirectionEdit[] // C1 real: the windDirection ones in (time, index) order
windDirectionAt(series, startMs, edits, tMs): number | null                 // W-core
applyWindDirection(series, startMs, edits): WeatherSeries                   // W-core (also export planSwings for the mock and tests)
```

`applyWindDirection` (reference `proto2.ts`, 60 lines):
- No edits: return `series` itself (every existing hash stays bitwise). Pure: input untouched; stamps before the first change are the SAME objects.
- Sort by (`time`, array index). Swing i: `t0 = startMs + time*1000`; `to = wrapDeg(dir)`; `from = D(t0)` from earlier swings, else the forecast 10 m direction at `t0`. `D(t)` = value of the LAST swing with `t0 <= t`: `turnDirection(from, to, turnFraction((t - t0)/1000))`, `null` before the first. A later change cuts an earlier swing and starts from the value reached; equal times: later index wins.
- Stamps: all original ones, plus per swing `t0 + round(k * 900000 / m)`, k = 0..m, `m = max(1, ceil(1.5 * |angleDiff(to, from)| / 15))`, each from the ORIGINAL bracketing pair via `interpolateHour(a, b, f)` with `time` set exactly (nearest stamp copied outside the span); skip times that are already stamps.
- Rotation: each stamp with `time >= first t0` and `D(time) !== null`: `windDir10 = D(time)`; `R = angleDiff(D, its own windDir10)` added (wrapped) to every `windProfile[].dir` and `pressureLevels[].windDir`. Speeds, gusts, all else untouched. After the last swing every later stamp has `windDir10 = to` (the forecast's later swings are replaced; the forecast's own veer with height is kept). Deterministic.
- `windDirectionAt` is `D(t)` from the same plan.

## 3. Session API and C1 (the commit both lanes branch from)

C1 = two files, real but trivial, changing no existing result (type-checked: this exact code in a scratch copy of `src`, `tsc --noEmit` exit 0): (1) `windDirection.ts`: add `WindChangePhase`, `windChangePhase`, `windDirectionEdits`. (2) `session.ts`: imports `wrapDeg` (`../core/units`), `applyWindDirection, windDirectionEdits, windDirectionTime` (`../scenario/windDirection`), type `WindDirectionEdit`; replace the C0 `windWeather()` stub and add two methods after `removeEdit`:

```ts
  private wwKey = '';
  private ww: WeatherSeries | null = null;
  windWeather(): WeatherSeries {
    const list = windDirectionEdits(this.state.get().edits);
    const key = list.map((e) => `${e.id}|${e.dir}|${e.time}`).join(';');
    if (this.ww === null || key !== this.wwKey) {
      this.wwKey = key;
      this.ww = list.length ? applyWindDirection(this.scenario.weather, this.scenario.startTime, list) : this.scenario.weather;
    }
    return this.ww;
  }

  /** From `at` (s, default the view time; raised to a whole minute at or after the view time) the whole wind turns to come from `dir`.
   *  Returns the edit, or null (nothing sent) when the scenario ends within a minute. `id` from the caller (`uniqueId('winddir')`). */
  setWindDirection(id: string, dir: number, at?: number): WindDirectionEdit | null {
    const s = this.state.get();
    const time = windDirectionTime(Math.max(s.viewTime, at ?? s.viewTime), this.duration);
    if (time < s.viewTime - 1e-6) return null;
    this.prepareEditAt();
    const edit: WindDirectionEdit = { kind: 'windDirection', id, dir: wrapDeg(Math.round(dir)), time };
    this.controller.edit(edit, time);
    this.state.set((st) => ({ edits: [...st.edits.filter((x) => x.edit.id !== id), { edit, time }] }));
    this.afterEdit();
    return edit;
  }

  /** Undo a change as if never made (rewind to its time, re-run without it), like removeIgnition. */
  removeWindDirection(id: string): void {
    this.cancelSeek();
    const s = this.state.get();
    const found = s.edits.find((x) => x.edit.kind === 'windDirection' && x.edit.id === id);
    if (!found) return;
    const t = found.time;
    this.controller.removeEdit(id);
    this.rewindFloor = t;
    if (t < s.headTime) {
      this.cutHistory(t);
      this.requestedUntil = Math.min(this.requestedUntil, t);
    }
    this.state.set((st) => ({
      edits: st.edits.filter((x) => x.edit.id !== id),
      insights: st.insights.filter((i) => i.time <= t),
      headTime: t < st.headTime ? (this.snapshots.headTime() ?? t) : st.headTime,
      reviewing: false,
    }));
    this.afterEdit();
    if (!this.state.get().playing && this.state.get().viewTime > this.state.get().headTime) this.controller.run(this.state.get().viewTime);
  }
```

How the UI learns: `session.state.subscribe(render, ['edits'])`; `windDirectionEdits(state.edits)` lists the changes (each `state.edits` entry has `time === edit.time`); scheduled / turning / done is derived: `windChangePhase(edit, state.viewTime)` (so scrubbing back shows "scheduled" again). The Session never announces: panel words come from `windPanelModel.ts` (5.2) using the returned edit. `Session.edit()` is not used for this kind. After C1, `session.ts` is W-core's (line 183: `time: edit.kind === 'windDirection' ? edit.time : 0`, fixes, tests); W-ui never edits it.

## 4. Engine (W-core): `simulation.ts`, `mockSim.ts`

Fields `wx: WeatherSeries` (init `scenario.weather`), `wxKey = ''`.
- `refreshWx(): boolean`: `list = activeEdits(records, applied).windDirection`; key `JSON.stringify(list.map(e => [e.id, e.dir, e.time]))` (`''` if none); unchanged -> false; else `wx = list.length ? applyWindDirection(scenario.weather, startMs, list) : scenario.weather` (same list, same object).
- `weatherNow(tMs)`: `w = weatherAt(scenario.weather, tMs)`; if `wx !== scenario.weather` overlay `windDir10`, `windProfile`, `pressureLevels` from `weatherAt(wx, tMs)`; speed and all other fields stay the forecast's, bitwise. Used at init `w0` (467), `stepOnce` (1169), `makeStats` (1603), `restore` (1970).
- `rebindWind(tMs)`, when an edit or removal record applies in a run and `refreshWx()` returned true: `stampIdx = clamp(stampIndex(wx.hours, tMs), 0, len-2); atm.setAmbient(hs[stampIdx], hs[stampIdx+1]); windDirty = true`.
- Sites: line 430 `e.kind === 'fuel' ? 0 : Math.max(0, e.time)`; `refreshWx()` after the init loop (432-436) and before 467; `applyRecord` 904-922: the `windDirection` kind (and a generic removal of one) calls `refreshWx` + `rebindWind` instead of `setWindEdits`; `buildAtmosphere` 1031-1039: `createAtmosphere` keeps `s.weather`, `hs = this.wx.hours`; `stepOnce`: take `hs` from `this.wx.hours` AFTER `applyDueRecords`, `w = weatherNow(tMs)`; `stableNightInputAt`, `rainBefore`, `solarAt`, moisture and heating keep reading `scenario.weather` (a separate local, not the old `series`); `restore` 1910-1977: `refreshWx()` right after `applied` is reset (1917), before `buildAtmosphere` / `setWindEdits`, so `stampIdx = cp.stampIdx` (1936) is valid in the checkpoint's own `wx`. Checkpoints store nothing new.
- Unchanged on purpose: `view().series`, `forecastInsights`, `engineInfo` stamp seconds, explain (forecast cards stay forecast).
- `edit(edit, time)`: for `windDirection` the record time is `windDirectionTime(edit.time, duration)` and the stored edit has that time. `removeEdit(id)`: if a `windDirection` record has that id, call a private `undoRecords(predicate)` (the body of `removeIgnition` 625-655 extracted, behaviour-preserving; `removeIgnition` calls it too): delete the record, restore the checkpoint at or before its time if it was applied and replay, else drop checkpoints after it; `notifyRewound(t)`. Otherwise the existing path.
- Mock engine: memoised `wx` from the active `windDirection` edits used by `solveInput().weather` (295), `buildSnapshot` (373), `explainNow` (799), `placeSpots` (346); forecast kept for `windChanges` (107) and `engineInfo`. `edit()`: rewind to `edit.time` when `< this.time`. `removeEdit()` of a `windDirection` edit: `rewindTo(edit.time)` when `edit.time < this.time` (emits `rewound`), like `removeIgnition` (155-161).

## 5. UI (W-ui)

### 5.1 Where
New `src/ui/screens/sim/windPanel.ts` (`createWindPanel(ctx, onClose)`, name and test ids kept) and pure `windPanelModel.ts` (+ test). `editPanels.ts`: delete the old section (301-387) and its now-unused imports; `export` `panelShell` (24). `simScreen.ts`: import from `./windPanel`; `TOOLS` (91) `label: 'Wind direction'` (icon `wind`); remove map placement for this tool: `s.tool === 'wind'` in `wantsCrosshair` (614), `case 'wind'` in `onTap` (727-729), the wind mark in `drawAnnotations` (843; also the unused `'wind'` mark kind and `windScreenRotation` import; keep the tested helper), header comment (9). `context.ts`: `UiState.wind` becomes `{ dir: number }` (56) and `DEFAULT_UI.wind = { dir: 225 }` (112): the dial's value only (keeps `content.test.ts:649` and the `'wind'` subscribe key valid); the panel sets it to the current direction rounded to 5 degrees when it opens. `topBar.ts:220`: `weatherAt(ctx.session.windWeather(), abs)` and add `'edits'` to the subscribe keys (a removal must update a paused chip). `sheet.ts` 327, 352, 358: `session.windWeather()`; add `'edits'` to the keys at 558. Unchanged: `scrubber.ts`, `sheet.ts:320` callout, `simScreen.ts:184` (forecast; see 8).

### 5.2 Strings (plain words, sentence case, no em dashes). `compassName` "SW"; `formatDirFrom` "SW (225°)"; clock `formatClock(ctx.absTime(t), ctx.tz)` (`formatDayClock` when the scenario is over 20 h)
- Menu label, FAB, panel title, list, announcements: **Wind direction**.
- Hint: "Choose where the wind comes from. It turns over 15 minutes and then holds that direction, so the forecast's later wind changes no longer apply. Wind speed stays as forecast." (15 = `WIND_TURN_S / 60`)
- Dial aria-label: "Wind comes from. Drag the arrow, or use the arrow keys." (the widget adds "From SW · 225°" and `aria-valuetext`.)
- Legend "When"; options "Now", "In 10 min", "In 30 min", "In 1 h", "At a time".
- "At a time" shows label "Local time" (sr-only "Time the wind starts to turn") and `<input type="time" step="60">` prefilled with the clock of (Now change time + 10 min). Errors (`p.field-error[role=status]`, as `timePopover.ts:52`): "Enter a time such as 14:35." / "That time is not in this scenario (14:00 to 18:00)." / "That time has passed. Choose a time after 14:41." Presets past the end: "The scenario ends before that time."
- Status, two lines (`wind-status`): "Before the change: from NW (315°)." / "Starts turning at 14:41 and reaches SW (225°) by 14:56."
- Primary button `apply-wind`, `btn-lg`, icon `check`: "Turn wind to SW". Disabled for an invalid time, or when the scenario ends within a minute (status line: "There is no time left in this scenario for a wind change.").
- Viewing the past (`state.reviewing`): "You are viewing 14:10. Applying re-runs the simulation from then."
- List (`wind-list`, `h3.sub-title` "Your wind changes"): "Wind from SW · starts 14:40 (in 10 min)" / "Wind from SW · turning, done by 14:55" / "Wind from SW · done at 14:55". Remove: icon-only trash button, aria-label "Remove the wind change to SW at 14:40", test id `remove-wind-direction`.
- Announce, apply: "Wind direction change set. The wind turns to come from SW, starting at 14:40 and done by 14:55." Remove: "Wind change removed." plus " The simulation re-runs from 14:40 without it." only when `headTime` is after the change. No toast, no `role=alert`, nothing pops up.

### 5.3 Time control (pure, `windPanelModel.ts`)
- State `{ choice: 'now'|'10'|'30'|'60'|'at', clock }`; `resolveWhen(state, viewTime, {startMs, tz, durationS})` -> `{ok, time}` or `{ok:false, reason: 'late'|'outside'|'badClock'|'notInScenario'|'past'}`.
- Presets: `windDirectionTime(viewTime + offsetS, D)`; `late` if that is `< viewTime`; `outside` if `viewTime + offsetS > D - 60`.
- At a time: `parseTimeOfDay` (`timelineModel.ts:225`), then new `nextClockTime(sod, startMs, tz, D, fromS)`: first time at or after `fromS` (the Now change time) whose wall clock in `tz` is `sod`, scanning days with `zonedDate`/`zonedTime` (`format.ts`) as `clockToSimTime` (239) does; reason `past` if it exists only earlier. The zone is the scenario's `ctx.tz`, never the device's.
- The change time is a whole simulation minute: "Now" starts up to 59 s after the view time and the status shows that clock minute.
- "Before the change" = `weatherAt(session.windWeather(), ctx.absTime(time)).windDir10` (an earlier pending change counts).
- Status recomputes on `['edits','viewTime','reviewing']` and touches the DOM only when its text changes. The dial never follows the clock after the panel opens. After Apply the panel stays open with its choices.

### 5.4 Layout and accessibility
- Panel frame as the others (`panelShell`): body scrolls (`touch-action: pan-y`), Apply is the fixed foot. Order: hint, dial row (`.wind-controls`, dial `touch-action: none`), "When" (`segmented`, `columns: 3`), time field, status, reviewing hint, list. No crosshair, no map placement.
- `dialSize(innerHeight)`: 184 at 800 and above, 148 from 560, else 120. Estimates from CSS tokens, NOT measured in a browser: panel max-height at 360x640 is `min(52vh, 640-88-64-160) = 328 px` (body about 190 px: dial and read-out fit, "When" by scrolling); 412x915 about 330 px body; 844x390 side panel 388 px wide, body about 110 px. Success criteria (these decide, not the estimates): at 360x640, 412x915 and 844x390 Apply is fully visible without scrolling, the dial is fully visible on open, the time field is reachable by scrolling the body alone, no horizontal scroll, every control at least 44 x 44 px.
- Checks, in one command under the lock with a dev server started and killed inside it: `scripts/layout-budget.mjs` (collapsed layout, stays green at its five sizes) and `scripts/audit-tap-targets.mjs "http://localhost:<port>/?mock=1" --click accept-notice,site-katoomba,build,tools-menu,tool-wind --wait wind-panel --width 360 --height 640` (also 412x915, 844x390; `click` waits for the build).
- A11y: panel `section` labelled "Wind direction", "Close tool" kept; dial `role=slider` (arrows 5 degrees, Page keys 45); "When" a radio fieldset; time input has `<label for>`, `aria-invalid`, `aria-describedby` its message; a disabled Apply has its reason in the visible status; focus not moved on open or after Apply; compass letters scale with the dial (report their size if under 11 px; the read-out line is the text to read).
- Test ids: kept `wind-panel`, `apply-wind`, `wind-dial`; new `wind-when`, `wind-time`, `wind-time-msg`, `wind-status`, `wind-list`, `remove-wind-direction`.

## 6. Lane split and ownership
- **W-core**: `src/scenario/windDirection.ts` (stubs -> real, `planSwings`; comment of `WIND_TURN_STEP_DEG` says "after easing"), `src/sim/simulation.ts`, `src/sim/records.ts` (only if needed), `src/ui/mockSim.ts`, `src/ui/session.ts` (after C1). New tests: `src/scenario/windDirection.test.ts`, `src/sim/windDirection.sim.test.ts`, `src/ui/session.windDirection.test.ts`, `src/ui/mockSim.windDirection.test.ts`.
- **W-ui**: new `windPanel.ts`, `windPanelModel.ts`, `windPanelModel.test.ts`, `e2e/wind-direction.spec.ts` (self-contained, reads `__firesim.session.state`; no edit to `e2e/helpers.ts`); edits to `editPanels.ts`, `simScreen.ts`, `context.ts`, `topBar.ts`, `sheet.ts`, `src/styles/sim.css` (`.wind-controls`, 1518-1535).
- Shared with other 0.6.0 lanes (small local edits): `simScreen.ts`, `topBar.ts`, `sheet.ts`, `session.ts`. Untouched: `scrubber.ts`, `app.ts`, `check-bundle.mjs`, docs, `content.ts`. `e2e/ui.spec.ts:115-116` stays valid.

## 7. Test plan

### 7.1 Pure (`windDirection.test.ts`): flat 270 degrees, 10 m/s, hourly, `{dir:180, time:600}` (numbers MEASURED with `proto2.ts`)
- Helpers: `windDirectionTime(0.1,3600)=60`, `(60,3600)=60`, `(3599,3600)=3540`, `(NaN,..)=0`, `(-5,..)=0`, `(100,30)=0`; `turnFraction(-1)=0`, `(450)=0.5`, `(900)=1`; `turnDirection(270,180,.5)=225`, `(350,10,.5)=0`, `(0,180,.5)=90`, `(180,0,.5)=270`.
- `windDirectionAt`: null at T-60; 270 at T; 263.33 at T+150; 246.67 at +300; 225 at +450; 203.33 at +600; 186.67 at +750; 180 at +900 and after.
- Series: `[]` returns the same object; input frozen and unchanged; two calls identical JSON; stamps before T are `===`; hours 97 -> 107 (90 degrees), +2 (0), +4 (30), +19 (180). Read with `weatherAt`: 270.00, 270.00, 262.78, 246.67, 225.00, 203.33, 187.22, 180.00, 180.00 at T-60, T, +150, +300, +450, +600, +750, +900, +3600; within 1 degree of `windDirectionAt` at 5 s steps (max 0.74); speed within 1 % of 10 (min 9.915) and exactly 10 at stamps; every consecutive pair turns at most 15 degrees + 1e-6 for arcs 5 to 180.
- Column: `windProfile` 80 m dir 280 and 850 hPa level `windDir` 300 become 190 and 210 after the turn (R = -90), speeds unchanged; at T+400 `windDir10` 232.47, profile 242.47.
- Two changes (-> 180 at 600, -> 90 at 900): 270.00, 262.78, 246.67, 234.78 (ideal 235.06), 130.62, 90.00 at 600, 750, 900, 1050, 1500, 1800; hours 97 -> 123. Also equal times, a wrap (350 -> 10), a series with one stamp.

### 7.2 Engine (`windDirection.sim.test.ts`): `syntheticScenario({ windFromDeg: 270, windKmh: 36, slopeDeg: 0, extent: 3000, duration: 3600, ignitions: [pointIgnition('a', -600, 0, 0, 60)], options: { snapshotInterval: 60 } })`, change `{dir 180, time 600}`
1. Head follows (fast tier; MEASURED with the swapped series): `stats.headDir` 107 / 107 / 106 at t=300 / 540 / 600 (same as without), 59 at 900, 28 at 1200, 0 at 1500 and 1800 (without: 104 to 106); `stats.weather.windDir10` 270 / 247 / 203 / 180 at 600 / 900 / 1200 / 1500; burnt at 1800 73.7 vs 53.6 ha. Assert: equal to the no-change run up to T, `|angleDiff(headDir, 0)| < 20` at 1800, area differs by over 20 %.
2. Bitwise before T: every snapshot hash at `time <= 600` equals the run without the change, and differs at 660. Needs the series swapped at application (a swap from the start differs by one ulp: MEASURED).
3. Determinism: two fresh runs equal; display step 60 vs 300 equal at common times; `perfStats:false` and the wild clock of `simulation.test.ts:336-342` equal.
4. Replay: run to 2400, then `sim.edit(e, 600)` equals a fresh run that had it from the start (from T on); a change at 1800 (checkpoint boundary); at time 0 and at 600 via `scenario.edits`.
5. Removal: `sim.removeEdit(id)` after T equals a run that never had it (pattern `simulation.test.ts:149`); a pending one just drops, no rewind; `rewound` as `removeIgnition` gives.
6. Overlay: against the no-change run `stats.weather.windSpeed10`, `temperature`, `relativeHumidity` are equal at every time.
7. Tier: `setQuality('standard')` after T keeps the new wind; one standard determinism run (1500 m, 600 s, change at 300).
8. In-thread `LocalSimController` `edit` + `removeEdit` equals the bare `Simulation`; mock engine: `stats.weather.windDir10` follows after T, removal restores and emits `rewound`.

### 7.3 Session (`session.windDirection.test.ts`, scripted controller as `session.pace.test.ts`)
`time % 60 === 0` and `>= viewTime`; `at` before the view is raised; near the end `null`, nothing sent; a past view sends `rewind(view)` first and cuts history; `windWeather()` is one object until the list changes; `removeWindDirection` cuts at the EDIT's time, sets the floor, runs on when paused beyond the head (copy `session.recorder.test.ts:285-345`).

### 7.4 Standard-tier lag and cost, MEASURED (prototype series swapped at construction; `syntheticScenario`, change 270 -> 180 at T = 1200 s; direction at the centre, degrees; Node here)
- 3 km, 10 m/s (`lag.out`), fire wind at T+300 / +600 / +900 / +1200: 254 / 215 / 191 / 182 (ambient 247 / 203 / 180 / 180); settles 181.
- 9 km, 5 m/s (`lag2.out`), at T+300 / +600 / +900 / +1200 / +1500 / +1800: fire wind 242 / 197 / 170 / 159 / 180 / 178; 10 m air 227 / 190 / 170 / 161 / 182; 1146 m 261 / 230 / 198 / 181 at the first four. Near-ground air runs ahead, overshoots by up to about 20 degrees for about 10 min after the turn ends, and is within about 6 degrees at T+1500; higher layers do not lag it.
- Fast tier: 10 m wind 239 / 197 / 180 at T+300 / +600 / +900, never over 8 degrees from the ambient.
- Cost: 3 km standard, 45 to 55 ms per simulated minute, 78 to 131 ms in minutes that cross a stamp (about +40 to +80 ms each), +0.5 s over 3000 s. 9 km: median 146 ms, worst 332 ms per minute. Phone not measured.
- W-core repeats the standard-tier run on the real code (9 km, 5 m/s): fire wind within 25 degrees of the ambient 30 min after T; report the table.

### 7.5 E2E (`wind-direction.spec.ts`, mock engine, once at the end with `lane-e2e.sh`)
1. `pickTool('wind')`: title "Wind direction", no crosshair. `wind-dial` focus + `PageUp` moves `aria-valuenow` by 45 mod 360. "In 10 min": `wind-status` matches "Starts turning at hh:mm and reaches ... by hh:mm." Apply: `wind-list` has one item "starts ... (in 10 min)"; `state.edits` has one `windDirection`, `time % 60 === 0`; announcement "Wind direction change set".
2. Seek past T + 15 min (`setSpeed(Infinity)`): top bar `.wx-dir` shows the new compass name, the item says "done at"; Remove empties the list and the chip returns to the forecast direction.
3. "At a time": empty -> "Enter a time such as 14:35."; a time before now -> "That time has passed..."; a valid time applies and the list shows its clock.
4. Viewing the past: the reviewing hint shows; Apply cuts `headTime` to about the view time.
5. At 360x640 and 844x390: `apply-wind` inside the viewport and at least 44 px high; `scrollWidth <= innerWidth`; time field reachable; each button, radio label and input at least 44 px each way; popup watcher silent.
Then `tsc`, by-path vitest, the two scripts (5.4), `npm run build:cap` + `check:bundle` once (cheap entry check: `vite build --outDir <scratch>`, read `sources` of `index-*.js.map`: no `scenario/weather.ts` or `openMeteo.ts`).

## 8. Risks and what I could not determine
- 3-D overshoot and lag (7.4): on the standard and high tiers the fire head can wobble for about 10 min after a 90 degree turn. Measured on synthetic terrain only (not Katoomba); the high tier not measured. Say so in the Help text.
- Forecast-based things disagree after a change that replaces a forecast swing: forecast "wind change" cards, the Danger gate pause, timeline marks (`scrubber.ts:249`), the Weather callout (`sheet.ts:320`). Settled as not built; follow-ups for the owner: suppress them after a user change, or derive them from `windWeather()`.
- Stamp cost on a phone is unmeasured; if it stalls raise `WIND_TURN_STEP_DEG` to 20 (m = ceil(1.5 arc / 20), speed dip 1.5 %).
- The `stampIdx` / `setAmbient` re-bind is the likely bug source (rewind, restore across a tier switch, removal, restore to an earlier checkpoint): 7.2 (2, 4, 5, 7) guard it. The in-thread engine is the same `Simulation` (7.2 (8)); the demo engine is a separate whole-horizon re-implementation whose `removeEdit` / `rewound` must match `removeIgnition`.
- "Now" starts up to 59 s later; belt-kit wind observations are no longer removable in a run (tell the owner).
- Layout numbers in 5.4 come from CSS tokens, not a browser. Not examined: explain's live rules beyond reading them (only `rules/weather.ts:690`, `context.ts:222` read the live direction), the Android WebView, TalkBack, the final bundle size (C1 adds small runtime imports to the entry chunk).

## 9. Docs notes
User words: pick a direction and when (now, in 10 or 30 minutes, in 1 hour, or a clock time); the whole wind turns over 15 minutes and holds; speed unchanged; the forecast's later changes no longer apply; limits as in 8. Facts: `wx` is derived from applied edits, whole-minute times, stamp spacing, the 3-D lag table, removal "as if never added", `WindEdit` kept for belt-kit readings.
