# FireSim design language

A flat, Google-Maps-for-Android-flavoured look (Material 3 leaning, no Google assets, fonts or logos) that is a little
denser than stock Android, plus an accessibility variant for reading in bright sun. This file is the contract for everyone
who builds a screen: **use the primitives below, do not invent one-off styles.**

* Tokens: `src/styles/tokens.css` (colour, type, space, shape, elevation, size, motion; light, dark, high contrast)
* Base and controls: `src/styles/base.css`, `components.css`
* Floating and navigation pieces: `src/styles/overlays.css`
* Data-sheet pieces: `src/styles/data.css`
* Screens (they only compose the primitives and tokens; no colour or size of their own): `screens.css` (Setup, Building, Settings, Notice),
  `sim.css` + `transport.css` (the simulation chrome), `layers.css` (Layers panel), `datasets.css` (Data sets), `modelcard.css` (How this
  simulation works), `debugstats.css` (Simulation debug statistics, which reuses the model card's cards and groups), `slice.css` (the Air
  slices side view and the tool's controls, at most 4 KB; imported by the lazy side-view chunk and not by `main.css`)
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
tokens -> base -> components -> overlays -> data -> screens -> sim -> transport -> layers -> datasets -> modelcard -> debugstats
/* slice.css is not in this list: slicePanel.ts imports it, so it loads with the Air slices side view the first time the tool opens */
```

* Appearance is set on `<html>`: `data-theme="light|dark"` and `data-contrast="high"` (only when on).
  `src/ui/settings.ts` applies both (`applyAppearance`, `startThemeSync`); `index.html` applies them before first paint.
  For a session only: `?theme=dark` and `?contrast=high` on the URL (not saved).
* Never hard-code a colour, size or shadow in a screen's CSS; read a token. If a token is missing, add it to
  `tokens.css` for all three modes and to `docs/DESIGN.md`.
* Use the type classes (`.t-title`, `.t-body`, `.t-secondary`, `.t-caption`, `.t-num` ...) instead of setting a font size.
* Layout helpers: `.stack` (vertical, gap `--gap`), `.cluster` (wrapping row), `.grow`, `.spacer`.
* `src/ui/styles.rules.test.ts`, `src/ui/tokens.contrast.test.ts`, `scripts/check-contrast.mjs` and `scripts/audit-tap-targets.mjs` guard the rules below (no gradients outside the slider
  track, no uppercase or weights above 500 outside the sanctioned places, no literal font size under 14 px, hit areas, contrast of every text pair in the four modes,
  no hard-coded colour in any stylesheet).

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
State layers: `--state-hover` / `--state-press` (veils over rows and buttons); disabled buttons: `--disabled-bg` (12 % of the text
colour) and `--disabled-fg` (38 %; 55-60 % in high contrast). Disabled pairs are exempt from WCAG and `check:contrast` reports them as info.

### Status and fire

Each family has `--x` (fill or big icon), `--on-x` (text on the fill), `--x-bg` (tint) and `--x-ink` (text or icon on the tint or on a surface).

| Family | `--x` | `--x-bg` | `--x-ink` | Meaning |
| --- | --- | --- | --- | --- |
| danger | `#d93025` / `#f28b82` | `#fce8e6` / `#42302f` | `#c5221f` / `#f28b82` | errors, destructive actions, danger cards |
| watch | `#f9ab00` / `#fdd663` | `#fef7e0` / `#3d3520` | `#a05a00` / `#fdd663` | caution (amber). Never use the fill as text or as a thin icon on white (2:1); the timeline's speed signal draws its ring and run in `--watch-ink` |
| ok | `#188038` / `#81c995` | `#e6f4ea` / `#263a2c` | `#137333` / `#81c995` | loaded, saved, live, fine |
| info | `#1967d2` / `#8ab4f8` | `#e8f0fe` / `#2f3b52` | `#174ea6` / `#aecbfa` | neutral information (same blue family as the accent, so use it for chrome only) |
| fire | `#e8710a` / `#ff9a5c` | `#fef0e0` / `#40291a` | `#b3400b` / `#ffb27f` | fire markers and fire semantics; no text sits on the fill |

Fire-danger ratings (same in both themes, they are data): `--rating-none #e8eaed`, `-moderate #62b346`, `-high #ffd23f`,
`-extreme #f47b20`, `-catastrophic #9e1b1b`; text `--rating-ink #202124` (`#000` in HC) or `--rating-ink-catastrophic #fff`.

Data colours: `--chart-wind`, `--chart-temp`, `--chart-rh`, `--chart-moist` (wind is purple now, so no chart uses the accent
blue), categorical `--series-1..5` (teal, purple, brown, slate, magenta), `--violet-bg/-ink` (user-entered data),
`--grid`, `--band-dry`.

Safety strip: `--badge-bg` `#fbbc04` / `#e0a100`, `--badge-ink` `#3c2e00` / `#241a00` (7.8:1 and 7.6:1). It reads "Training aid · not for operational use"
wherever that fits on one line (360 px phones and wider at normal text size, 412 px and wider in high contrast, whose bold caps are wider) and
"Training aid only" otherwise (narrower screens, large text); the choice is a container query on the strip itself (`base.css`), and
`e2e/ui.spec.ts` checks it at the phone sizes, in both contrasts and at 200 % text.

Map marks (the same in every theme: they are drawn over the aerial photo and the 3-D terrain, which do not follow the theme): `--map-halo`
`#fff` (strokes and glyphs on the map), `--map-halo-veil` (white 20 %), `--map-shade` `#000` (the dark halo), `--map-pin` `#202124`, and the
fire marks' data colours `--mark-observed` `#e02424`, `--mark-spot` `#ff8c1a`, `--mark-backburn` `#7b3fe4`.

The look of the 3-D ground is the renderer's, not a design token: it does not follow the theme, and the rock walls of the cliff drawing
(0.3.0, display only) are sandstone in linear light inside the terrain shader (the palette's `ROCK` `#a4927a` and `ROCK_DARK` `#6d5f50`),
trimmed by Picture quality. See `docs/ARCHITECTURE.md`, *The cliff drawing*.

### Air slice colours (data ramps of the renderer, not tokens)

The six chips of an Air slice colour it with ramps from `src/render/palette.ts` (`sliceFieldScale(field)`). The side-view panel's raster, the
3-D curtain and the legends all read that one function, so what is drawn always matches its legend. Like every data ramp they are the
same in every look. None uses the interactive blue as its meaning, and no chip's ramp is mistaken for another's: along and across are
purple and green, which are neither the blue and red of temperature nor the blue and orange of up and down.

| Chip | Ramp | Range (legend) | Neutral | Notes |
| --- | --- | --- | --- | --- |
| Speed | `WIND_RAMP` | 0 to 25 m/s (0 to 90 km/h) | none: 0 is calm grey-blue | the cool ramp the wind particles and arrows already use (grey-blue, white, cyan, blue, violet; it goes through white, so it is not luminance-ordered and the colour-vision tests below do not cover it) |
| Along | `ALONG_RAMP` | -25 to +25 m/s (-90 to +90 km/h) | pale at 0 | purple towards A, green towards B |
| Across | `ALONG_RAMP` | the same | pale at 0 | purple towards the left, green towards the right of someone walking from A to B |
| Up/down | `UPDRAFT_RAMP` | -4 to +8 m/s | pale at 0 | sinking (blue) to rising (orange to red); the range is not symmetric |
| Temp | `THETA_RAMP` | -10 to +20 K | pale at 0 | warmer or cooler than the rest of the slice's air at the same height |
| Smoke | `SMOKE_RAMP` | 0.0001 to 1, **a log scale** | none: below the first stop is the palest | pale warm grey to dark brown-grey; every step along the bar is ten times more smoke |

`ALONG_RAMP` is new in 0.4.0: a diverging ramp whose stops are mirror images with the same luminance (relative luminance 0.06 at both ends
and 0.93 at zero), so it reads in grey and the two sides differ by hue alone. `SMOKE_RAMP` is a **log ramp** (`makeRamp(stops, { log: true })`,
sampled with `sampleRamp`, never as a linear table): the model's smoke concentration of a young plume is about a thousandth of that of a
big fire (measured: 0.0005 to 0.001 after 5 to 15 minutes of a small fire), and a linear scale would show nothing for it. Its legend labels the
two ends "faint" and "thick" and the map's legend card says so in words: "Each step along the bar is ten times more smoke, in the model's own
units, not a measured amount." The map's legend card (`sliceLegend(field, kind)`, `mapLegend.ts`) also carries two end words for each chip
("calm" to "storm force", "blowing towards A" to "blowing towards B", "blowing to the left" to "blowing to the right", "sinking" to "rising",
"cooler" to "warmer", "a trace of smoke" to "dense smoke") and a teaching sentence; the side-view panel's own compact legend keeps the
title with its units and the numbers under the bar, so in the panel a value is read from the numbers and the probe's words, never from colour
alone.

**Colour-vision numbers** (`palette.test.ts`; CIE76 ΔE in CIELAB after the Machado, Oliveira and Fernandes (2009) simulation at full severity,
`colourVision.ts`; about 2.3 is a just-noticeable difference and above 10 is easy). Two measures: "a fifth apart" is the smallest ΔE between
any two values that are a fifth of the ramp's range (of its log range for smoke) apart or more, and "two sides" is the smallest ΔE between a
value on the negative side and one on the positive side, each at least a quarter of the way out. Measured when this was written:

| Ramp | Normal | Protan | Deutan | Tritan | Floor the test holds |
| --- | --- | --- | --- | --- | --- |
| Along and across, a fifth apart | 26.2 | 26.1 | 25.2 | 24.9 | above 20 |
| Along and across, the two sides | 56.3 | 42.1 | 32.8 | 30.0 | above 20 |
| Smoke, a fifth apart | 12.0 | 12.2 | 11.9 | 11.8 | above 9 |
| Temperature, a fifth apart | 12.8 | 8.9 | 11.5 | 13.4 | above 8 |
| Temperature, the two sides | 71.9 | 50.1 | 56.9 | 82.9 | above 20 |
| Up and down, a fifth apart | 7.6 | 7.9 | 6.4 | 11.4 | above 6 |
| Up and down, the two sides | 73.6 | 54.5 | 64.4 | 75.1 | above 20 |

Temperature and up/down are the older ramps, covered by these tests for the first time in 0.4.0. Their floors are the measured ones, below
the 9 that the heat-map ramps keep: the closest pair is the two darkest shades of one hue at the strong end (8.9 for temperature under
protan vision, 6.4 for up/down under deutan), well above a just-noticeable difference, and the strength is also carried by the luminance
order and by the legend's numbers.

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
| Tokens for every colour | A hex value in any stylesheet (`npm run check:contrast` lists them) |

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
| Top bar | 84 px | 48 px pill + a 28 px row of read-out chips (`--bar-h`) |
| Bottom navigation | dock 46 px | 56 px (`--nav-h`) |
| Timeline strip | 84 px | 64 px (`--timeline-h`) |
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

### Forced colours and reduced motion

`@media (forced-colors: active)` (Windows high contrast and some accessibility browsers) repaints every background with `Canvas`.
The state that lives only in a fill is redrawn with system colours: switch track and thumb (`Highlight` / `HighlightText` when on),
checked checkbox and radio, slider track and thumb, the selected bottom-nav pill. Floating surfaces (search bar, FAB, sheet, dialog,
popover, snackbar) get a 1 px `CanvasText` edge because their shadows are dropped. Data fills (bars, meters, sparkbars, progress,
legend swatches, fire-danger rating pills) and the TRAINING strip keep their own colours (`forced-color-adjust: none`). Selected chips and
segments need nothing: they carry a check. `prefers-reduced-motion` stops animations and transitions (base.css); the indeterminate
progress bar and the skeleton become static.

## 7. Icons

`icon(name, { size = 24, filled, class, strokeWidth = 2 })` returns an `<svg>` (`iconMarkup()` returns a string). 24 px grid,
2 px round strokes, `currentColor`, `aria-hidden` (put a label on the control, not the icon). Buttons, chips and badges size their
icons to 18 px in CSS; list leads and bars use 24. Gallery: the style guide. Names are kebab-case; older camelCase names and a few
synonyms are aliases (`ICON_ALIASES`):

* fire and tools: `flame ember leaf brush wind whatif why help-circle help crosshair target line point person undo replay cube top eye eye-off compass gps locate my-location pin play pause speed gauge`
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
<button class="btn btn-tonal">Tonal</button>
<button class="btn btn-secondary">Outlined</button> <!-- the default variant -->
<button class="btn btn-ghost">Text</button>         <!-- also .btn-text -->
<button class="btn btn-danger">Delete</button>
<button class="btn btn-primary btn-lg btn-block">[icon]Build 3D model</button>   <!-- .btn-sm (32) / default (40) / .btn-lg (48) -->
```

Icon-only: `.icon-btn` (40 px round, 24 px icon; `.is-selected` blue; `.icon-btn-tonal`, `.icon-btn-filled`), TS `iconButton()`.
`button({ iconOnly: true })` gives `.btn.btn-icon`. FABs: `.fab` (48 px white round, `--elev-2`, `.fab-sm` 40, `.is-active` blue icon,
`.fab-primary` blue), extended pill `.fab.fab-ext.fab-primary` (Play / Directions), `.fab-stack` (column, 8 px gaps), TS `fab()`.
States: hover (pointer devices only) and pressed use a `currentColor` veil, focus is the global 2 px ring. A disabled `.btn` (any
variant) is a neutral grey pill, `--disabled-bg` fill with `--disabled-fg` label (Material 3; outlined and text buttons keep a clear
fill), never a faded blue that reads as a tonal button in the sun. Other disabled controls (icon buttons, FABs, chips, tiles) are 38 %
opacity. The variant rule is `.btn.btn-text`, not `.btn-text`, because `button()` puts its label in `<span class="btn-text">`.

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
    <span class="list-body"><span class="list-title">Terrain</span><span class="list-sub">NSW 5 m elevation model</span></span>
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

## 11. The screens and where their rules live (final state)

All screens are on the tokens and primitives above; there is no bridge or legacy stylesheet. A screen's CSS only composes primitives
(layout, grids, the few pieces nothing else needs) and never sets a colour, a font size under 14 px or a hard-coded size that a token covers.
Anything a screen needed that the design system did not have was added to the right primitives file in a block headed
`/* === additions from the screens phase === */` (components.css `.chip-choice`; `widgets.ts` `chipChoice`, `appBar`, `confirmDialog`,
`copyText`).

| Screen | Builder | CSS | What it is made of |
| --- | --- | --- | --- |
| Safety notice | `screens/notice.ts` | `overlays.css` (`.modal.notice`) | the dialog; shown first, and again from Settings or the main menu |
| Setup | `screens/setup.ts` | `screens.css` | flat cards; `listRow` for "Use my location"; a box for a pasted Google Maps link or coordinates with a Paste `iconButton` and a result row in the style of the GPS fix (`.fix`: pin, numbers, name, chips, Selected, Clear); photo cards for the demo sites; `chipChoice` rows (area, detail, weather source, duration), then two `listRow`s under "Area and detail" (How this simulation works, Simulation debug statistics, so a phone can be checked before anything is built); "Data for this run" (a row per planned data set with an `originChip` and a size; estimates are marked "≈"); a bottom bar with the summary and the blue Build button |
| Building | `screens/building.ts` | `screens.css` | `.progress`, a row per data set as it arrives |
| Settings | `screens/settings.ts` | `screens.css` | `appBar`, `.list` rows with trailing values, `segmented` (Simulation: Performance, then **Picture quality** Auto / Low / Medium / High with its hint and, only when it applies, one plain paragraph that High may run slowly on a phone the guess calls Low: a heads-up, never an alert or a dialog), `toggle` (including High contrast), links to Data sets, How this simulation works and Simulation debug statistics |
| Simulation | `screens/sim/*` | `sim.css`, `transport.css` | below |
| Layers panel | `screens/sim/layersPanel.ts` | `layers.css` | `tileGrid` (map type and map details), **Night lighting** (a `segmented` Realistic / Brighter / Daylight with a hint, directly under the map-type tiles; test id `night-look`; left out where the view has no night), heat-map rows with a colour-ramp swatch, `chip`s, `segmented`, `toggle`, `slider`; one panel built from the layer catalog |
| Data sets | `screens/datasets.ts` | `datasets.css` | `appBar`, `stat` / `statRow`, `stackedBar`, `bar`, `sparkbar`, `kv`, `originChip`, `listRow`, `chipChoice` (filters), a heat-map preview canvas, `confirmDialog` before any deletion |
| How this simulation works | `screens/modelCard.ts` | `modelcard.css` | `appBar`, collapsible groups, `kv`, `badge` (evidence), `callout`, the glossary; its *Speed and memory right now* section is four live `kv` rows and a tonal button that opens Simulation debug statistics |
| Simulation debug statistics | `screens/debugStats.ts` | `debugstats.css` (and `modelcard.css`) | `appBar` with a Back arrow and a Copy `iconButton`; one `card` with the one-line summary, a state word (Live, Paused, Finished, No run yet, Demo engine: a word, never colour alone), a labelled Copy `button` and its hint; then 18 collapsed groups (the model card's collapsible `card`s, each with its own one-line summary, `kv-stack` rows, a tiny bar chart, `.ds-chart`, in `--series-1` for the speed history); a selectable `textarea` (`.ds-box`) appears only when the phone refuses the clipboard |
| Air slices tool | `screens/sim/sliceTool.ts` | `slice.css` (block 2) | a bottom tool panel (`.tool-panel.slice-tool`) with the `line` icon in its title ("Air slice", and "Side view" beside it in `.t-secondary`) and Close; the controls are `.row-actions` of `.btn`s: *Set start (A)*, *Set end (B)*, *Swap*, *Presets* (with a chevron and `aria-expanded`), then, while placing, a primary large *Place A here* and *Cancel*; the four presets are a two-column grid of `.btn`s, a disabled one with its reason under it as a `.hint`; one quiet `.hint` note line. Nothing pops up |
| Air slice side view | `screens/sim/slicePanel.ts` | `slice.css` (block 1) | one Canvas 2-D picture; a row of six filter `chip`s (`chips-scroll`), the reasons for any off chip (`.hint`s) and a tonal `button` *Use the 3-D atmosphere*; a legend (a gradient bar and its end words, or class swatches); the tool's controls; a `toggle` *Show model cells* with its description; the terrain `.hint`; the footer `.hint` |

**Full-screen screens** (Settings, Data sets, How this simulation works, Simulation debug statistics) open as overlays over the stage (`app.ts`): an `appBar` with a back
arrow, cards of rows on the grey background, the TRAINING strip above all of it. The stage behind is `inert`, Back / Escape step back one
level (a data set's page returns to the list), and focus returns to the control that opened the screen. They never pause or change the run.

**The simulation chrome**, from top to bottom: the floating pill (`.top-bar` / `.search-bar` look: main menu, clock with its elapsed line, the
blue round Play button, the speed chip) with a row of 28 px read-out chips under it (temperature, humidity, wind, fire-danger rating: information,
not buttons); the main menu is a left side sheet of `.list-row`s with inset dividers (its last group is Settings, Simulation debug statistics and New scenario); a column of round white `.fab`s on the handed side (Layers, View,
Compass); the extended "Tools" `.fab-ext` in the bottom corner with a labelled speed dial of mini-FABs; the map legend card and the attribution
line at the bottom of the visible map; `.bottom-nav` (Insights with a `.nav-badge`, Weather, Stats, Help) above the timeline strip; a rounded
`.bottom-sheet` with a grab handle that a tab opens at peek / half / full. One menu is open at a time; a pick, an outside tap, Escape and Back close it.
Left-hand mode mirrors everything. Heights: `--bar-h` 48, read-out row 28, `--nav-h` 56, `--timeline-h` 64.
Two rules keep controls reachable on short screens: while the View card is open the round-button column rises above the Tools button (`.map-fabs.view-open`),
and on a short landscape screen at a large text size (200 % on 844 x 390) the read-out chips go away while a tool panel is open
(`.chips-away`, set by `layoutInsets` in `simScreen.ts` only when the chips sit on their own row and the panel body has less than 64 px left), so
the panel's header and its Add / Clear bar stay on screen. Both are covered by `e2e/ui.spec.ts`.

**The speed signal** (`scrubber.ts`, `paceSheet.ts`, `transport.css`). While the simulation cannot keep up with the playback speed,
and only then, a 44 x 44 px round button (`.icon-btn.tl-pace`, the `gauge` icon at 20 px, test id `pace-btn`) takes the strip's fourth
grid column, the one Cancel uses while a jump computes, and is hidden while a jump computes. The strip stays `--timeline-h` (64 px) high;
the track is 44 px narrower while the button shows. It is a state, and never colour alone: *behind* (an
early warning) is the glyph in `--text` inside a 1 px `--outline` ring; *waiting* is the glyph and a 3 px ring in `--watch-ink`, plus a
44 x 3 px run under the rail (`.tl-pace-run`) that ends at the thumb, because the stretch between the thumb and the newest result has no
length while playback waits, so a line there would not show. The ring and the run use `--watch-ink` and not `--watch`: the amber fill
is only 1.9:1 against the strip in the two light looks (the colour table above says never to use it as text or a thin line on white).
High contrast: a 2 px outline and a 4 px ring. Forced colours: `ButtonText` borders (1 px, 3 px) and a `Highlight` run. There is no
transition, so reduced motion has nothing to switch off. The accessible name is "Simulation is running slower than your playback speed.
Show details." (the button has `aria-haspopup="dialog"` and `aria-expanded`), and a separate visually hidden `<span role="status"
aria-live="polite">` says it once when playback starts to wait and at most every 2 minutes; it is never `role=alert`, never a toast or a
scrim. The old "Computing" badge is not shown while the signal is. A tap opens
the sheet *Running slower than playback* (`transportSheet()` in the top bar's popover group: dialog role, grab handle, Close; an outside
tap, Escape and Back close it and focus returns to the button; two columns on a short landscape screen): a lead sentence (what you asked
for and what the phone is computing), *Does it change the result? No ...*, `meter` rows for where the time goes (3-D air, fire spread,
embers, everything else; the *Fire spread* row includes the coupling), the likely reasons (a list, only those the numbers support), the
buttons *Play at N x* and *Use the fast model from here* (with its note: "The fire is computed again from the last checkpoint, up to half
an hour of fire ago, and comes out a little different"), the sentence "Pausing stops the simulation too. Playing slower is what lets it
keep up.", an *All the numbers* `listRow` that opens Simulation debug statistics, and a footnote ("Measured on
this phone, over the last 10 seconds"). "Play at N x" also becomes the default speed, as choosing it in the speed sheet does.

**The Why here? icon row** (`whyPanel.ts`, `markerWords.ts`, `.why-marker` in `sim.css`). When the Why here? tool is tapped on an
icon, the panel starts with a row on `--surface-2` with `--r-md` corners: the icon (32 px; the map's own picture cut from its atlas,
or for a home the UI house icon in the home marker's colour; decorative, `aria-hidden`, so the words carry the meaning), its name in
`--fs-md` medium weight ("Spot fire", "Ignition point", "Danger: Uphill run", "You are here", "Home"), one muted `--fs-sm` detail line
(for example "Started by an ember at 15:17 (+1:12), 450 m ahead of the front") and, when icons are stacked, "+2 more icons here, zoom in
to tell them apart". It comes first in every state of the panel (loading, error, explanation); a tap on the ground has no such row,
which is how the panel says "I took the ground, not an icon". It is part of the panel, not a popup, toast or alert.

**The Air slices tool and its side view** (`sliceTool.ts`, `slicePanel.ts`, `slice.css`; the tool is the seventh entry of the Tools dial, label
"Air slices", icon `line`). It is a tool panel like the others, in `.panel-host`, and nothing in it opens or speaks by itself: no toast,
no dialog, no `role=alert`; a line that cannot be made is one quiet `.hint` under the buttons, in words ("Make the line longer than 300 m").

*Placing.* *Set start (A)* and *Set end (B)* are secondary `.btn`s; the one to do next is tonal. Choosing one shows the app's crosshair and swaps
the row for a primary large *Place A here* (it takes focus) and *Cancel*; the note says "Move the map until the cross is over the start (A)" and
the map still slides under one finger. A tap on the map sets a dashed mark and *Place A here* then keeps that point: the two-step confirm the Wind
tool already uses for gloves and wet screens. After a placement focus moves to the next button; Back and Escape drop a placement first and close
the tool next, and focus goes back to the Tools button. *Presets* folds out a two-column grid of four `.btn`s (the live one is tonal and
`aria-pressed`); a preset that cannot be used is disabled and says why under itself. Every button is a 44 px target (a 40 px `.btn` with its
expander).

*On the map* (inline SVG in `.annotations`, drawn only while the tool is open and only re-projected per frame then): A and B are 15 px discs with
a white letter (a dashed ring with a dark letter while the point is only tapped and not yet placed), the line is a 4 px stroke with a dark halo,
and the probe's pin is a white disc with a ring and a dot. They share one literal teal, `#00796b`, set inline in `sliceTool.ts` (`SLICE_INK`),
like the other map marks' inline styles. **It is not a token** and `check:contrast` does not see it (it reads stylesheets): a token for it,
and a contrast check against the aerial photo, are not done.

*The picture.* A `<canvas class="slice-canvas">` `clamp(180px, 27vh, 230px)` high, `--r-sm` corners, `touch-action: none` (a drag moves the probe,
not the panel), `role="img"` with a text alternative ("Side view of the air along a 6 km line from A to B, coloured by wind speed. The arrow keys
move a probe that reads the air at a point; Escape clears it.") and `tabindex="0"` with the 2 px `--focus` ring. Everything on it is read from the
tokens through `getComputedStyle` (`--text`, `--muted`, `--grid`, `--surface`, `--outline`, `--surface-3`, `--chart-moist`, `--font`, `--fs-xs`), so the
look, high contrast and the text size apply; the axis labels and the scale tag are the caption size (12 px, as the weather chart's), and
everything that is real text (chips, readout, legend, footer) is DOM text at 14 px or more. Streaks and arrows are drawn in `--text` over a
`--surface` halo so they read on every ramp; the probe cross is `--text` over a `--surface` halo. The ground is `--surface-3` with a tint, with the
model's own ground as a dashed `--text` line. The picture is drawn at the device pixel ratio up to 3. Under reduced motion there are no
streaks and no fade: still arrows, and nothing on the picture moves.

*Chips, reasons, legend.* Six `chip`s (`aria-pressed`) in a group labelled "Colour the slice by"; in 358 px they share the row, so they have 6 px of side
padding (and the row scrolls if it is ever too narrow). A chip the air cannot give is `aria-disabled` at 38 % opacity (not `disabled`, so it still takes
focus and a screen reader reads its reason through `aria-describedby`), and its reason is written under the row word for word as the scene
wrote it, with a tonal *Use the 3-D atmosphere* button where switching helps. The legend under it is the legend's title with its units, then a
12 px gradient bar with a 1 px `--divider` border and up to five numbers under it (or 12 px class swatches with their words).

*Probe.* A tap or a drag on the picture (pointer capture; a finger lifted off the glass or a mouse passing over does not move it), or the
arrow keys when it has focus (a lattice step; a quarter of the axis with Shift), and Escape clears it. The words appear in a `.slice-readout`
(`--surface-2`, `--r-md`, 14 px) under the picture, with a 44 px *Clear the probe* icon button; a screen reader hears a reading after a key
move (after a pause of 0.4 s, so a held key does not queue), not after every drag.

*Footer.* A `.hint` that is `position: sticky` at the bottom of the panel's body with a 1 px `--divider` above it, so it is always in view:
"3-D time-stepped air · model grid 133 m · air from 11:25", or "Diagnosed wind: terrain effects only · model grid 133 m · air from 11:25", with
"(4 min before the time shown)" added past 90 seconds. In short landscape (844 x 390: `orientation: landscape` and `max-height: 540px`) the picture
is pinned at the top of the panel at 96 px, the chips and the controls scroll beneath it, and the footer is one line that keeps the kind, the grid
and the age and hides their explanations (`.slice-more`); the readout loses its top margin so the clear button fits.

*Words, as the rules of this document and `src/ui/content.ts` ask.* Plain words and sentence case; no em dash; "about" for a number ("Wind
about 32 km/h"); a wind is named by where it comes **from** with the hyphenated eight-point word ("north-west"), never "towards" in words; the
along and across parts say which way the air goes in the picture ("towards A", "towards B", "to the right", "to the left"); vertical motion in
metres per second whichever speed unit is chosen; heights are "above sea level" on the axis and "above ground" in the sentence (against the 10 m
ground); K is a difference, so "3 K warmer" and never a temperature; "diagnosed wind" and "terrain effects only" wherever the air is the fast
model's; a disabled thing always says why, in a sentence, near it. The probe sentence and the legend's title still say "than the area" for the
temperature, where the number is against the slice's own air at that height (the legend's teaching sentence says it exactly): a wording the
lanes left, to be made exact.

**Never**: a pop-up, a toast or a dialog because of something the simulation did. New insight cards only raise the badge on the Insights tab. Dialogs
open from a tap (`confirmDialog` for deletions, the safety notice, "Leave this simulation?").

**Audits** (all in `scripts/`): `check-contrast.mjs` (`npm run check:contrast`, every stylesheet, four looks), `audit-tap-targets.mjs`,
`audit-contrast-dom.mjs` (measures the rendered page), `layout-budget.mjs` (the share of the screen that is free map at 412x915, 390x844, 360x740,
360x640 and 844x390). The e2e specs check the 200 % font scale, high contrast and the Back order (`e2e/integration.spec.ts`).

**Other**

* `src/render/legendGallery.ts` and `src/render/dev.html` are dev pages with their own CSS; they do not use the app's stylesheets.
* Android native theme (status/navigation bar colours, splash): the table in section 9.
