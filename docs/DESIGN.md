# FireSim design language

A flat, Google-Maps-for-Android-flavoured look (Material 3 leaning, no Google assets, fonts or logos) that is a little
denser than stock Android, plus an accessibility variant for reading in bright sun. This file is the contract for everyone
who builds a screen: **use the primitives below, do not invent one-off styles.**

* Tokens: `src/styles/tokens.css` (colour, type, space, shape, elevation, size, motion; light, dark, high contrast)
* Base and controls: `src/styles/base.css`, `components.css`
* Floating and navigation pieces: `src/styles/overlays.css`
* Data-sheet pieces: `src/styles/data.css`
* Not yet migrated screens: `screens.css`, `sim.css`, `transport.css`, plus the temporary bridge `legacy.css`
* Icons: `src/ui/icons.ts` (`icon()`), typed builders: `src/ui/widgets.ts` and `src/ui/primitives.ts`
* Live gallery of every primitive in every state (dev server only):
  `/src/ui/styleguide.html?theme=light|dark&contrast=high`
* Screenshots of the gallery and of the app on the new tokens: `docs/screenshots/design/` (taken with Liberation Sans standing in for
  Roboto, which is not installed on the machine that took them; it has no 500 weight, so medium text looks regular there but is medium on a phone)

## 1. Principles

1. **Flat.** White cards on a very light grey app background, separated by a background step and 1 px hairlines.
   No gradients, no gloss, no heavy outlines. Only things that float over the map or over content (top bar pill, FABs,
   floating chips, bottom sheets, popovers, dialogs, snackbars) carry a soft shadow.
2. **One interactive colour.** Blue (`--primary`) means "you can tap this / this is selected". Orange, red and amber are
   reserved for fire, danger and the fire-danger ratings; green means OK. **Never use the interactive blue for data**
   (charts, map layers, legends, bars). Data uses neutral greys, status colours or the `--series-*` colours.
3. **Quiet chrome, loud safety.** The chrome is neutral grey. The only saturated thing that is always on screen is the
   amber TRAINING strip, which is mandatory on every screen.
4. **Field use.** Gloves, shaky hands, sunlight: every control has a hit area of at least 44 x 44 px, selection is never
   shown by colour alone (a check, a thicker frame or a weight change comes with it), and there is a high-contrast variant.
5. **Slightly denser than stock.** Paddings and margins are about 25-35 % smaller than the old design (section 7).
6. **Nothing pops up on its own.** Dialogs, sheets, popovers and snackbars open from a tap. The simulation never toasts.

## 2. Using it

```css
/* main.css already imports, in this order */
tokens -> base -> components -> overlays -> data -> screens -> sim -> transport -> legacy
```

* Appearance is set on `<html>`: `data-theme="light|dark"` and `data-contrast="high"` (only when on).
  `src/ui/settings.ts` applies both (`applyAppearance`, `startThemeSync`); `index.html` applies them before first paint.
  For a session only: `?theme=dark` and `?contrast=high` on the URL (not saved).
* Never hard-code a colour, size or shadow in a screen's CSS; read a token. If a token is missing, add it to
  `tokens.css` for all three modes and to `docs/DESIGN.md`.
* Use the type classes (`.t-title`, `.t-body`, `.t-secondary`, `.t-caption`, `.t-num` ...) instead of setting a font size.
* Layout helpers: `.stack` (vertical, gap `--gap`), `.cluster` (wrapping row), `.grow`, `.spacer`.
* `src/ui/styles.rules.test.ts`, `src/ui/tokens.contrast.test.ts` and `scripts/audit-tap-targets.mjs` guard the rules below (no gradients outside the slider
  track, no uppercase or weights above 500 outside the sanctioned places, hit areas, contrast of every text pair in the four modes).

## 3. Tokens

Values are for light / dark. "HC" = high contrast (either theme). All names are CSS custom properties.

### Surfaces, text, lines

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f1f3f4` | `#202124` | app background behind cards |
| `--surface` | `#ffffff` | `#303134` | cards, sheets, bars, dialogs, popovers |
| `--surface-2` | `#f1f3f4` | `#3c4043` | subtle step: disabled fields, tonal areas, raised |
| `--surface-3` | `#e8eaed` | `#4a4d51` | tracks, skeletons, neutral badge fill. **No muted text on it** (3.9:1 in dark) |
| `--surface-glass` | white 96 % | `#303134` 96 % | floating map overlays (no blur) |
| `--surface-inverse` / `--on-surface-inverse` | `#323232` / white | same | snackbar |
| `--scrim` | `rgba(32,33,36,.5)` | `rgba(0,0,0,.6)` | behind dialogs and sheets |
| `--text` | `#202124` | `#e8eaed` | body text |
| `--muted` (= `--icon`) | `#5f6368` | `#aab0b6` | secondary text, captions, inactive icons. Dark is brighter than the Maps grey `#9aa0a6`, which is only 3.96:1 on `--surface-2` |
| `--divider` | `#dadce0` | `#3c4043` | 1 px hairlines between rows and cards (decorative) |
| `--outline` | `#80868b` | `#969ba1` | boundary of text fields, checkboxes, switches, segmented buttons (>= 3:1) |
| `--outline-variant` | `#dadce0` | `#5f6368` | boundary of buttons and chips that carry a text label |

### Interactive blue

`--primary` (fills, icons, borders, switch track, slider) `#1a73e8` / `#8ab4f8`; `--on-primary` `#fff` / `#202124`;
`--primary-ink` (**text** on white or grey: links, text buttons, selected labels) `#1967d2` / `#8ab4f8`;
`--primary-container` (selected chip, tonal button, nav pill, selected tile tint) `#e8f0fe` / `#2f3b52`;
`--on-primary-container` `#174ea6` / `#d2e3fc`; `--focus` = `--primary`.
`#1a73e8` itself is only 4.5:1 on white, so text on grey uses `--primary-ink`, and text on the tint uses `--on-primary-container`.

### Status and fire

Each family has `--x` (fill or big icon), `--on-x` (text on the fill), `--x-bg` (tint) and `--x-ink` (text or icon on the tint or on a surface).

| Family | `--x` | `--x-bg` | `--x-ink` | Meaning |
| --- | --- | --- | --- | --- |
| danger | `#d93025` / `#f28b82` | `#fce8e6` / `#42302f` | `#c5221f` / `#f28b82` | errors, destructive actions, danger cards |
| watch | `#f9ab00` / `#fdd663` | `#fef7e0` / `#3d3520` | `#a05a00` / `#fdd663` | caution (amber). Never use the fill as text or as a thin icon on white (2:1) |
| ok | `#188038` / `#81c995` | `#e6f4ea` / `#263a2c` | `#137333` / `#81c995` | loaded, saved, live, fine |
| info | `#1967d2` / `#8ab4f8` | `#e8f0fe` / `#2f3b52` | `#174ea6` / `#aecbfa` | neutral information (same blue family as the accent, so use it for chrome only) |
| fire | `#e8710a` / `#ff9a5c` | `#fef0e0` / `#40291a` | `#b3400b` / `#ffb27f` | fire markers and fire semantics; no text sits on the fill |

Fire-danger ratings (same in both themes, they are data): `--rating-none #e8eaed`, `-moderate #62b346`, `-high #ffd23f`,
`-extreme #f47b20`, `-catastrophic #9e1b1b`; text `--rating-ink #202124` (`#000` in HC) or `--rating-ink-catastrophic #fff`.

Data colours: `--chart-wind`, `--chart-temp`, `--chart-rh`, `--chart-moist` (wind is purple now, so no chart uses the accent
blue), categorical `--series-1..5` (teal, purple, brown, slate, magenta), `--violet-bg/-ink` (user-entered data),
`--grid`, `--band-dry`.

Safety strip: `--badge-bg` `#fbbc04` / `#e0a100`, `--badge-ink` `#3c2e00` / `#241a00` (7.8:1 and 7.6:1).

### Elevation

| Token | Use | Light value |
| --- | --- | --- |
| `--elev-1` | floating chips, small controls | `0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15)` |
| `--elev-2` | search pill, FABs (the standard) | `0 1px 2px rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15)` |
| `--elev-3` | bottom sheets, popovers, snackbars | `0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15)` |
| `--elev-4` | dialogs | `0 2px 3px rgba(60,64,67,.3), 0 6px 10px 4px rgba(60,64,67,.15)` |

Dark uses black shadows plus a 1 px 8 % ring so a floating control keeps its edge over dark imagery. HC has small shadows and
adds a 2 px outline to floating surfaces.

### Type

Font `--font` (system UI; Roboto on Android). Sizes `--fs-xs 12`, `--fs-sm 14`, `--fs-md 16`, `--fs-lg 20`, `--fs-xl 24`,
`--fs-2xl 32`; line heights `--lh-xs..--lh-xl` 16 / 20 / 24 / 28 / 32; weights `--fw-regular 400`, `--fw-medium 500`,
`--fw-bold 700` (bold only for the clock digits, big stat numbers and ratings). Sentence case everywhere; uppercase only on the
TRAINING strip and `.badge-caps`. Numbers and times use `font-variant-numeric: tabular-nums` (`.t-num`, `output`, `time`, `.kv-val`).

| Role | Class | Size / weight |
| --- | --- | --- |
| display number | `.t-display` | 32 / 700 |
| screen title | `.t-headline` (`h1`) | 24 / 500 |
| section / dialog title | `.t-title` (`h2`) | 20 / 500 |
| sub-heading, card title | `.t-subtitle` (`h3`) | 16 / 500 |
| list title, input text | `.t-list` | 16 / 400 |
| body, buttons, chips | `.t-body` | 14 / 400 (buttons 500) |
| secondary | `.t-secondary`, `.hint` | 14 / 400 muted |
| caption, status line | `.t-caption` | 12 / 400 muted |

### Space, shape, size, motion, layers

* Space `--sp-1..6` = 4 / 8 / 12 / 16 / 24 / 32 px.
* Radii `--r-xs 4`, `--r-sm 8`, `--r-md 12` (cards), `--r-lg 16`, `--r-xl 20` (sheet top), `--r-bar 28` (top bar), `--r-pill`.
* Lines `--bw` (1 px, 2 px in HC), `--card-bw` (0, 2 px in HC).
* Sizes: `--tap 44` (minimum hit area), `--tap-lg 52`, `--ctl-h 40` (buttons), `--ctl-h-sm 32` (chips, small buttons),
  `--ctl-h-lg 48`, `--field-h 44`, `--row-h 48 / 52 / 72` (1 / 2 / 3 lines), `--fab 48`, `--fab-sm 40`, `--bar-h 48` (top bar),
  `--weather-h 20` (weather line), `--nav-h 56`, `--timeline-h 64`, `--strip-h 24` (TRAINING strip), `--icon-size 24 / 18`.
* Motion: `--dur-1 150ms`, `--dur-2 200ms`, `--ease cubic-bezier(.2,0,0,1)`. `prefers-reduced-motion` switches animations and transitions off (base.css).
* Layers: `--z-float 20`, `--z-sheet 30`, `--z-scrim 80`, `--z-dialog 90`, `--z-toast 95`, `--z-strip 100`.
* Safe areas: `--safe-top/bottom/left/right`.

### Old -> new token map

The old names are all still defined (the not-yet-migrated screen CSS keeps rendering); their meaning shifted as below.
Prefer the new names in new code.

| Old name | Old (light) | Now | Note |
| --- | --- | --- | --- |
| `--bg` | `#fff` | `#f1f3f4` | app background is light grey; cards are white |
| `--surface` | `#fff` | `#fff` | |
| `--surface-2` / `-3` | `#f1f3f5` / `#e3e7eb` | `#f1f3f4` / `#e8eaed` | |
| `--surface-glass` | white 96 % | same | |
| `--text` | `#0b0d10` | `#202124` | |
| `--muted` | `#3a414b` | `#5f6368` | |
| `--border` | `#1d232b` (dark 2 px outline) | `= --outline` `#80868b` | outlines are 1 px and mid grey; old 2 px rules now draw 2 px grey lines |
| `--border-soft` | `#bfc6ce` | `= --divider` `#dadce0` | |
| `--control-border` | `2px solid var(--border)` | `var(--bw) solid var(--outline)` (1 px) | |
| `--primary` | `#111418` (black) | `#1a73e8` (blue) | "selected" fills are blue now |
| `--on-primary` | `#fff` | `#fff` | |
| `--accent` | `#ff6a13` (orange) | `= --primary` (blue) | the orange accent is now `--fire`; old `--accent` uses were selected/active states |
| `--on-accent` / `--accent-soft` | `#111` / `#fff1e6` | `= --on-primary` / `= --primary-container` | |
| `--danger` / `-bg` / `--on-danger` | `#c92a2a` / `#fff0f0` / `#fff` | `#d93025` / `#fce8e6` / `#fff` | text uses `--danger-ink` |
| `--watch` / `-bg` / `-ink` / `--on-watch` | `#f2a900` / `#fff7e0` / `#7a4d00` / `#1a1400` | `#f9ab00` / `#fef7e0` / `#a05a00` / `#202124` | |
| `--info` / `-bg` / `--on-info` | `#1c5fd0` / `#edf3ff` / `#fff` | `#1967d2` / `#e8f0fe` / `#fff` | |
| `--ok` / `-bg` | `#237a36` / `#eaf7ed` | `#188038` / `#e6f4ea` | |
| `--focus` | `#1c5fd0` | `#1a73e8` | 2 px ring, 2 px offset |
| `--grid`, `--band-dry` | | retuned | |
| `--chart-wind` | `#1c5fd0` (blue) | `#7b1fa2` (purple) | data never uses the interactive blue |
| `--shadow` / `--shadow-strong` | `0 2px 12px` / `0 6px 28px` | `= --elev-2` / `= --elev-4` | |
| `--badge-bg` / `--badge-ink` | `#ffd400` striped / `#111` | `#fbbc04` flat / `#3c2e00` | |
| `--radius` / `--radius-sm` | 14 / 10 px | 12 / 8 px | |
| `--tap` / `--tap-lg` | 48 / 60 px | 44 / 52 px | |
| `--fab` | 56 px | 48 px | the sim menus shrink with it |
| `--badge-h` | 20 px | 24 px | `= --strip-h` |
| `--ease` | `cubic-bezier(.2,.7,.2,1)` | `cubic-bezier(.2,0,0,1)` | |
| `--topbar-h`, `--scrub-h`, `--dock-h` | 84 px, 84 px + inset, 46 px | **unchanged** | the sim CSS still draws rows of exactly these sizes; the target values are `--bar-h + --weather-h` (68), `--timeline-h` (64) and `--nav-h` (56). The screen builders switch them when they restyle the chrome |
| `--font` | system stack | same | |

Dark ("Maps night"): `--bg #202124`, `--surface #303134`, `--surface-2 #3c4043`, `--surface-3 #4a4d51`, text `#e8eaed`,
muted `#aab0b6`, primary `#8ab4f8`, danger `#f28b82`, watch `#fdd663`, ok `#81c995`.

## 4. Colour semantics: do and don't

| Do | Don't |
| --- | --- |
| Blue for the selected chip, tab, tile, switch, slider, primary button, links | Blue for a wind line, a heat map, a legend swatch, a size bar |
| `--x-ink` for text on a tint or a surface | `--watch` amber as text or a 2 px icon on white |
| Orange/red for fire, danger and fire-danger only | Orange as a decorative brand accent in chrome |
| A check, a thicker frame or a word next to every colour state | Selection or status by colour alone |
| `--text` on `--surface-3` | `--muted` on `--surface-3` |
| Tokens for every colour | A hex value in screen CSS (legacy files still have a few, see the checklist) |

## 5. Density and the tap rule

| Element | Before | Now |
| --- | --- | --- |
| Buttons | 48-60 px, 2 px black outline | 40 px pill (32 small, 48 large), 1 px outline or filled |
| Chips | 32 px, 2 px outline | 32 px pill, 1 px `--outline-variant` |
| Text field | 54 px, 2 px outline, 19 px bold | 44 px, 1 px outline, 16 px regular |
| List row | 60 px toggles | 48 px (1 line), 52 (2), 72 (3) |
| Card | 16 px padding, 2 px border, 18 px radius, 16 px gap | 12 px padding, no border, 12 px radius, 8 px gap |
| Switch | 60 x 36 | 48 x 28 |
| Slider | 48 px area, 10 px track, 34 px thumb | 44 px area, 4 px track, 20 px thumb |
| Segmented | 52 px, 2 px outline | 44 px, 1 px outline |
| Body text | 17 px, weight 700-900 | 14 px, weight 400-500 |
| Top bar | 84 px | target 48 + 20 px weather line (screen builders) |
| Bottom navigation | dock 46 px | target 56 px |
| Timeline strip | 84 px | target 64 px |
| TRAINING strip | 20 px striped, 14 px caps | 24 px flat amber, 12 px caps |

**Tap rule (hard):** every interactive control has a hit area of at least 44 x 44 px even when its visual size is 32-40 px.
`.btn`, `.icon-btn`, `.fab`, `button.chip` and `.tap` carry an invisible `::after` (`width/height: max(100%, var(--tap))`);
segments, list rows, switch rows, checkbox rows, tiles, stepper buttons, nav items and snackbar actions are tap-sized by their own
`min-height`/`width`. A 32 px control needs 12 px to the next control above or below it so the two 44 px hit areas do not overlap
(that is why `.chips` rows are 12 px apart; buttons are 40 px + 8 px = 48 px apart). Gotchas: a parent with `overflow: hidden|auto` clips the
invisible expander (`.chips-scroll` carries 6 px of padding for that reason; `.bottom-sheet` is deliberately not `overflow: hidden`), and a
neighbouring element painted later steals taps in the overlap. To make your own control tap-safe, add `class="tap"` (it becomes
`position: relative` with the expander) or copy the `::after` rule.

**Audit it:** `node scripts/audit-tap-targets.mjs "<url>" [--click testid,testid] [--wait testid]` probes 8 points around the centre of
every visible interactive element with `elementFromPoint` (the invisible expanders count) and exits 1 if any control has less than a
44 x 44 px hit area. It reports 0 problems on the style guide (light, dark, high contrast) and on Setup, Settings and the Sim screen
(with its round menu open) of the app.

## 6. High contrast ("bright sun")

`<html data-contrast="high">` on top of either theme: near-black on white (or white on black), 2 px outlines (`--bw`,
`--card-bw`), weights 500 / 700, type +1 px (`--fs-*`), stronger dividers, solid fills for selected chips, segments and nav items,
outlined floating surfaces, text pairs >= 7:1 and boundaries >= 4.5:1 (checked in `tokens.contrast.test.ts`).
Primary becomes `#0842a0` (white) or `#aecbfa` (black). It is the boolean setting `highContrast` (default off). The settings screen
builder adds the switch "High contrast (bright sun)" bound to `settingsStore.set({ highContrast })`; nothing else is needed.
The default flat look meets WCAG AA in both themes: text >= 4.5:1, boundaries, icons and graphics >= 3:1, safety strip >= 7:1.

## 7. Icons

`icon(name, { size = 24, filled, class, strokeWidth = 2 })` returns an `<svg>` (`iconMarkup()` returns a string). 24 px grid,
2 px round strokes, `currentColor`, `aria-hidden` (put a label on the control, not the icon). Buttons, chips and badges size their
icons to 18 px in CSS; list leads and bars use 24. Gallery: the style guide. Names are kebab-case; older camelCase names and a few
synonyms are aliases (`ICON_ALIASES`):

* fire and tools: `flame ember leaf brush wind whatif why help-circle help crosshair target line point person undo replay cube top eye eye-off compass gps locate my-location pin play pause speed`
* navigation and actions: `menu close back arrow-back arrow-forward arrow-up arrow-down chevron-up chevron-down chevron-left chevron-right plus minus check check-circle search more-vert more-horiz open-in-new copy edit share filter tune sync history download upload trash settings contrast lock`
* status: `warning danger info online offline`
* data and layers: `database storage road route home tree terrain satellite cloud cloud-off droplet thermometer ruler clock calendar sun moon map globe grid image polygon text file link smartphone bar-chart table chart stats list book`
* aliases: `chevronUp chevronDown chevronRight` -> `chevron-*`; `water-drop` -> `droplet`; `delete` -> `trash`; `external-link` -> `open-in-new`; `mountain` -> `terrain`; `add`/`remove` -> `plus`/`minus`; `public` -> `globe`.

`help` (Help tab) is the book with a question mark; `help-circle` (and `why`) is the question mark in a circle.
A subpath that starts with `*` in the icon data is a small solid shape (a dot).

## 8. Primitives

Each block below has a comment header in the CSS. Class names are stable. "TS" names the builder in `widgets.ts` / `primitives.ts`.

### Buttons (`components.css`; TS `button()`)

```html
<button class="btn btn-primary">Filled</button>     <!-- one per screen area -->
<button class="btn btn-tonal">Tonal</button>        <!-- also .btn-accent -->
<button class="btn">Outlined</button>               <!-- default, also .btn-secondary / .btn-outlined -->
<button class="btn btn-ghost">Text</button>         <!-- also .btn-text -->
<button class="btn btn-danger">Delete</button>
<button class="btn btn-primary btn-lg btn-block">[icon]Build 3D model</button>   <!-- .btn-sm (32) / default (40) / .btn-lg (48) -->
```

Icon-only: `.icon-btn` (40 px round, 24 px icon; `.is-selected` blue; `.icon-btn-tonal`, `.icon-btn-filled`), TS `iconButton()`.
`button({ iconOnly: true })` gives `.btn.btn-icon`. FABs: `.fab` (48 px white round, `--elev-2`, `.fab-sm` 40, `.is-active` blue icon,
`.fab-primary` blue), extended pill `.fab.fab-ext.fab-primary` (Play / Directions), `.fab-stack` (column, 8 px gaps), TS `fab()`.
States: hover (pointer devices only) and pressed use a `currentColor` veil, disabled is 38 % opacity, focus is the global 2 px ring.

### Chips, badges, provenance (`components.css`, `data.css`; TS `chip()`, `badge()`, `originChip()`)

```html
<button class="chip" aria-pressed="false">Roads</button>                 <!-- filter chip -->
<button class="chip is-selected" aria-pressed="true">[check icon .chip-check]Homes</button>   <!-- blue tint + check -->
<button class="chip chip-float">Places</button>                          <!-- floating over the map (elevation) -->
<span class="chip chip-ok">Loaded</span>                                 <!-- static; -ok -warn -danger -info -neutral -->
<div class="chips">...</div>   <div class="chips chips-scroll">...</div>  <!-- wrapping / one scrolling row -->
<span class="badge badge-watch badge-dot">Watch</span>                    <!-- 20 px; -ok -watch -danger -info -fire; .badge-caps -->
<span class="rating-pill rating-extreme">Extreme</span>                  <!-- rating-none/-moderate/-high/-extreme/-catastrophic -->
<span class="origin-chip origin-live">[cloud icon]Live</span>            <!-- -live -saved -bundled -synthetic -user -->
<span class="legend-chip"><span class="swatch" style="background:#62b346"></span>Moderate</span>
```

Origin meanings: **live** fetched just now (green), **saved** on this device from an earlier download (grey), **bundled** shipped
in the app (outlined), **synthetic** generated or estimated, not measured (amber, dashed), **user** entered or drawn by the user
(violet). Always with the word. `ORIGIN_INFO` gives the default wording, icon and sentence.

### Fields (`components.css`; TS `numberField()`, `stepper()`)

```html
<div class="field"><label class="field-label" for="x">Wind speed</label>
  <div class="input-wrap"><input id="x" type="number"><span class="input-unit">km/h</span></div></div>
<div class="input-wrap has-error">...</div><p class="field-error">[warning icon]Message</p>
<div class="input-wrap"><select>...</select></div>        <!-- chevron drawn by the CSS -->
<div class="stepper"><button class="stepper-btn" aria-label="Less">[minus]</button><input class="stepper-input" type="number"><button class="stepper-btn" aria-label="More">[plus]</button></div>
```

Fields are 44 px, 8 px radius, `--outline` border, 16 px text, blue 2 px on focus, disabled = grey fill.

### Selection controls (`components.css`; TS `segmented()`, `toggle()`, `slider()`)

* Segmented: `fieldset.segmented > .segmented-options > label.segmented-option > input[type=radio] + .segmented-face`. Joined outlined
  pills, 44 px; the selected segment is tinted and shows a check that replaces its icon. With `columns` (`.segmented-grid`) the options
  become separate tiles with a 2 px blue frame when selected. In HC the selected segment is solid.
* Switch (M3): `label.toggle > .toggle-text + input[role=switch] + .toggle-track > .toggle-thumb`; the whole 48 px row is the target.
  Group them in `.toggle-list` (hairlines between) or inside a `.list`.
* Checkbox and radio: `label.check > input[type=checkbox]` / `label.radio > input[type=radio]`, 44 px rows.
* Slider: `input[type=range]` (4 px track, blue active part, 20 px thumb). The active part comes from `--pct`; call
  `rangeFill(input)` (primitives.ts) after changing `input.value` by code and on `input`. `widgets.slider()` does it for you.

### Cards, lists (`components.css`; TS `listRow()`, `list()`, `sectionHeader()`, `section()`)

```html
<section class="card"><h2 class="card-title">[icon]Title</h2>...</section>   <!-- .card-flush .card-outlined .card-elevated .card-tap -->
<h3 class="section-header">Data sets</h3>
<ul class="list">                                                              <!-- .no-lead when no row has a leading icon -->
  <li><button class="list-row two-line">                                   <!-- .two-line 52 px / .three-line 72 px / default 48 px -->
    <span class="list-lead">[24 px icon]</span>
    <span class="list-body"><span class="list-title">Terrain</span><span class="list-sub">1 m LiDAR</span></span>
    <span class="list-trail">12 MB [chevron-right]</span></button></li>
</ul>
<hr class="divider"> <hr class="divider divider-inset">
```

Rows that do something are `<button>` or `<a>`; plain rows are `<div>`. Dividers are 1 px and inset to the text. `.toggle` rows fit inside a `.list`.

### Callouts, banners, progress, skeleton (`components.css`)

```html
<div class="callout callout-warn" role="note">[icon]<div>Text</div></div>            <!-- -info -warn -danger -ok; tinted, borderless -->
<div class="banner banner-warn" role="status">[icon]<span class="banner-text">You are offline</span><button class="btn btn-text btn-sm">Retry</button></div>
<div class="progress" role="progressbar" aria-valuenow="40"><div class="progress-fill" style="width:40%"></div></div>
<div class="progress progress-indeterminate"><div class="progress-fill"></div></div>
<span class="skeleton skeleton-line" style="width:60%"></span>   <span class="spinner"></span>
```

### Bars and navigation (`overlays.css`; TS `topBar()`, `bottomNav()`, `bottomSheet()`, `showSnackbar()`)

```html
<header class="app-bar">[icon-btn back]<h1 class="app-bar-title">Data sets</h1>[icon-btn]</header>           <!-- 48 px, hairline under -->
<div class="top-bar"><div class="search-bar">[icon-btn menu]<div class="search-bar-text">Katoomba 14:29</div>[icon-btn]</div>
  <div class="top-bar-sub">35 deg  13 %  NW 38 km/h</div></div>                                              <!-- floating pill 48 px + 20 px line -->
<nav class="bottom-nav"><button class="nav-item" aria-current="page"><span class="nav-icon">[icon]</span><span class="nav-label">Map</span></button>...</nav>
<div class="bottom-sheet" role="dialog"><button class="bottom-sheet-grab" aria-label="Resize"></button>
  <div class="bottom-sheet-head"><h2 class="bottom-sheet-title">Layers</h2>[icon-btn close]</div><div class="bottom-sheet-body">...</div></div>
<div class="modal-scrim"><div class="modal" role="dialog" aria-modal="true"><h2 class="dialog-title">..</h2><div class="dialog-body">..</div><div class="dialog-actions">[btn][btn]</div></div></div>
<div class="popover" role="menu"><ul class="list">...</ul></div>        <!-- position it where it is used -->
<div class="snackbar" role="status"><span class="snackbar-text">Saved</span><button class="snackbar-action">Undo</button></div>
<div class="scrim"></div>
```

The sheet and popover are shells: position them (`absolute`/`fixed`, `bottom: 0`) where used. Bottom nav: icon over label, selected =
blue icon and label with a pale-blue pill (`aria-current="page"`), `.nav-badge` for a count. Dialogs are centred with 28 px radius; the
first-run safety notice uses `.modal.notice`. Snackbars are for feedback to something the user just did (`showSnackbar(host, text)`); lift one above
a bottom bar with `--snackbar-bottom` on the host.

### Tile grid: the layer picker (`overlays.css`; TS `tile()`, `tileGrid()`)

```html
<div class="tile-grid" style="--cols:4" role="group" aria-label="Map details">
  <button class="tile" aria-pressed="true">
    <span class="tile-thumb">[28 px icon or <img>]</span><span class="tile-label">Roads</span><span class="tile-cap">Saved on device</span>
  </button>
  <button class="tile" disabled>...</button>
</div>
```

3 or 4 columns. Selected (`aria-pressed`, `aria-checked` or `.is-selected`): 2 px blue frame, check on the thumb, blue label. Disabled
(`disabled`, `aria-disabled="true"`, `.is-disabled`): faded. `.tile-cap` is the small status line ("Loaded", "Not downloaded", "Needs a run").
For a single choice (map type) use `role="radio"` tiles in a `radiogroup` (`tileGrid({ radio: true })`).

### Data-sheet pieces (`data.css`; TS `kv()`, `stat()`, `statRow()`, `bar()`, `stackedBar()`, `meter()`, `sparkbar()`)

```html
<dl class="kv"><div class="kv-row"><dt class="kv-key">Resolution</dt><dd class="kv-val">1 m</dd></div>...</dl>   <!-- .kv-left .kv-stack .kv-dense -->
<div class="stat"><span class="stat-num">46.5<span class="stat-unit">MB</span></span><span class="stat-cap">On this device</span></div>
<div class="stat-row" style="--cols:3">...</div>                                                              <!-- .stat-lg for 32 px numbers -->
<span class="bar bar-s1" style="--v:42%" role="img" aria-label="42 % of the total"><span class="bar-fill"></span></span>
<span class="bar bar-stack"><span class="bar-seg bar-s1" style="--v:12"></span><span class="bar-seg bar-s2" style="--v:9"></span></span>
<div class="meter meter-ok" role="meter" style="--v:62%">...</div>
<span class="sparkbar" role="img" aria-label="Sizes"><i style="--h:40%"></i><i style="--h:100%"></i></span>
<div class="table-wrap"><table class="data-table"><thead>..</thead><tbody>..</tbody></table></div>                  <!-- td.num right-aligned -->
<code class="code">tile_-33.7_150.3.png</code>   <pre class="code-block">...</pre>
```

Bars, meters and sparkbars are data: default grey, colour by `.bar-ok/-watch/-danger/-fire` or `.bar-s1..s5`; never blue.

## 9. Settings, system bars, theme colour

`Settings.highContrast: boolean` (default `false`, persisted with the other settings, sanitised: anything but a boolean is dropped;
no `SETTINGS_VERSION` bump needed). `applyAppearance(resolveAppearance(settings, systemDark), { root, meta })` writes `data-theme`,
`data-contrast` (only when on), `color-scheme` and `<meta name="theme-color">`; `startThemeSync()` calls it and follows OS changes.

System bar colours (`THEME_CHROME` in `settings.ts`, for the native Android theme, which is handled separately):

| | Light | Dark |
| --- | --- | --- |
| status bar (also `theme-color` meta): the amber strip runs under it | `#fbbc04`, dark icons | `#e0a100`, dark icons |
| navigation bar: the bottom edge is the surface | `#ffffff`, dark icons | `#303134`, light icons |
| window background / splash | `#f1f3f4` | `#202124` |

## 10. Adding a theme or changing a token

1. Add a block `:root[data-theme='name']` to `tokens.css` that redefines **every** colour token of the dark block (a test fails if a
   light colour would leak). Keep `color-scheme` in it.
2. Give `ThemeSetting` / `resolveTheme` / `THEME_CHROME` in `settings.ts` the new value.
3. Add the theme's modes to `MODES` in `tokens.contrast.test.ts`; every pair must pass.
4. Add a link for it in the style guide header.
5. Never add a colour to a screen's CSS; if a screen needs a colour that has no token, add the token to all modes.

## 11. Migration checklist (what the screen builders still have to do)

The app boots and every screen is usable on the new tokens (see `docs/screenshots/design/app-*.png`), but `screens.css`, `sim.css` and
`transport.css` were written for the old look and were **not** restyled. What they still do:

**All legacy files**

* About 75 declarations with `font-weight: 600-900` (chrome, cards, insight cards, weather, stats, timeline, popovers). Use 400 / 500;
  700 only for the clock digits (`.clock-time`), stat numbers and ratings.
* About 30 `2px solid var(--border | --border-soft)` outlines and `inset 0 0 0 2px` selected frames: replace by the flat card (no border),
  hairline (`--divider`) or the selected pattern (`aria-pressed` tint + check / 2 px `--primary` frame).
* Hard-coded colours: `.brand-mark` (`#111418` / `#ff7a1a`), the step icons in `screens.css` (`#fff`, `#0e1116` on `--ok`; use
  `--on-ok`), the `.dot-*` and `.ann-*` marker colours and the map background `#20251f` in `sim.css`. Map annotation colours are data
  (fine); chrome colours should be tokens.
* Text under 16 px is fine now (14 body, 12 caption); the old 16-19 px sizes make the legacy screens look large.
* Bare `<strong>`, `<b>` are 500 now. `text-transform: uppercase` remains on `.sev-badge` (a real badge, OK) and the tracking on
  the rating pill in the top bar (`.tb-wx .rating-pill`).

**Sim chrome (`transport.css`, top of `sim.css`)**

* Top bar (`.sim-topbar`, `.tb-*`): replace by `.top-bar` + `.search-bar` (48 px pill) + `.top-bar-sub` weather line (20 px), then set
  `--topbar-h` to the new total (68 px, no bottom border) and delete the 84 px rows. `.tb-play` becomes a `.fab-ext.fab-primary` or a round
  `.fab.fab-primary` (it currently has a `0 2px 0` hard shadow); `.tb-chip`, `.tb-speed`, `.tb-wx` become chips / `.top-bar-sub` content.
* Speed popover (`.tb-pop`, `.tp-*`): `.popover`, `.chip`/segmented presets, `slider()`, `stepper()`; the raw range in `speedControl.ts`
  already calls `rangeFill()`, keep that when restyling.
* Timeline (`.scrubber`, `.tl-*`): target `--timeline-h` 64 px (currently `--scrub-h` 84 px + inset); the seek stripes
  (`.tl-seek-todo`) use a gradient: replace by a flat two-tone bar; step buttons `.tl-step` are 44 px with a 2 px border.
* Round menus (`.menu-fab`, `.menu-item`, `.menu-row`, `.fab-caret`): now 48 px because `--fab` shrank; make them `.fab` + `.popover`
  rows (or a column of `.chip-float`s) and drop the 2 px borders.
* Dock (`.sheet`, `.sheet-tab`, `.sheet-head`, `.dock`): map to `.bottom-sheet` (grab handle, 20 px top radius) + `.bottom-nav`
  (Insights, Weather, Stats, Help; `--dock-h` 46 -> `--nav-h` 56 and update `DOCK_H` in `layoutModel.ts` and its test). `.tab-badge` -> `.nav-badge`.

**Sim panels (`sim.css`)**

* Insights (`.insight*`, `.sev-badge`, `.conf-badge`, `.factor-*`, `.driver-chip`): cards + badges + kv rows; group titles
  (`.group-title`) are grey `.section-header`s (the bridge only lowercases them now).
* Weather (`.wx-*`, `.weather-*`) and stats (`.stat-tile`, `.stat-grid`, `.stat-value`): `.stat` / `.stat-row`, `.kv`; charts use
  `--chart-*` (wind is purple now).
* Fire, fuel, wind, what-if panels (`.tool-panel`, `.panel-*`, `.preset*`, `.tp-*`): segmented, chips, sliders, `.list`; `.preset.selected`
  is bridged to a blue frame.
* Layers and legends (`.map-legend`, `.ml-*`, `.legend*`, `.overlay-group*`): the tile grid (`.tile-grid`) is the new layer picker;
  legends become `.legend-chip`s and `.kv`. `.legend-ramp` keeps its data gradient (a colour ramp is data).
* Why panel, help (`.why-*`, `.facts`, `.howto`), errors (`.error-chip`): callouts and banners.

**Setup, building, settings (`screens.css`)**

* Header (`.app-header`, `.brand*`, `.header-*`): `.app-bar`; the brand mark keeps its flame on a dark tile.
* Setup (`.setup-*`, `.site-card`, `.choice-card`, `.fix`, `.manual-box`, `.step*`): cards and `.list` rows with 24 px leads; the footer
  (`.setup-footer`, `.build-actions`) keeps one `.btn-primary.btn-lg.btn-block`; `.site-card.selected` is bridged to the blue frame.
* Building (`.building-*`, `.progress-row`): uses the `.progress` primitive now (8 px in `legacy.css`).
* Settings (`.settings-*`, `toggle-list`): theme options are still named "Sunlight" / "Night" (rename to "Light" / "Night"), add the
  switch **High contrast (bright sun)** bound to `highContrast`, use `.list` rows with trailing values; the data sets section is a new
  screen built from `kv`, `stat`, `bar`, `origin-chip`.
* Notice (`notice.ts`): already a `.modal` dialog on the new tokens; add nothing.

**Bridge (`legacy.css`)** currently holds: blue selected frames (`.site-card`, `.choice-card`, `.fix`, `.manual-box`, `.preset`), sentence
case for `.site-region`, `.overlay-group-title`, `.group-title`, and the 8 px building progress bar. Delete each block when its screen is migrated.

**Other**

* `src/render/legendGallery.ts` (render dev page) uses `.chip` as a static box; it is unaffected but should switch to `.legend-chip`.
* Android native theme (status/navigation bar colours, splash): apply the table in section 9.
* The mock/dev pages (`src/render/dev.html`) have their own CSS and were not touched.
