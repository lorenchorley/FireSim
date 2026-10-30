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
fire marks' data colours `--mark-observed` `#e02424`, `--mark-spot` `#ff8c1a`, `--mark-backburn` `#7b3fe4`, and the Air slice's `--mark-slice` `#00796b` (its line, its A and B discs and the probe's pin).

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
| Temp | `THETA_RAMP` | -10 to +20 K | pale at 0 | warmer or cooler than the average of the slice at that height (`SLICE_THETA_BASIS`: the legend's title and the chip's name use these words, the probe says "than average") |
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

**The wind arrows and flow lines' colours (0.5.0)** are the Speed chip's ramp, `WIND_RAMP` (the row above: the colours of the Wind streaks near the ground, 0 to 25 m/s, 0 to 90 km/h on the legend card), through a 64-entry speed table made once (`buildSpeedTable`, the colour of a segment is the wind speed at its start). It is **not** the Wind speed map's ramp (`WIND_SPEED_RAMP`, cool to warm, 0 to 60 km/h and over): the 10 m chip shares that map's field and not its colours, which `truthAudit.test.ts` holds. Every stroke is drawn on a near-black navy halo (sRGB `#081024`, 2.5 px of colour on 5 px), because the ramp goes through near white and pale cyan, which would vanish on the aerial photo and on the pale relief. The strokes are drawn in JavaScript and so are outside `npm run check:contrast`: `flowGlyphs.test.ts` holds each of the table's 64 colours to at least 3:1 against the halo ink, and the pictures (37 to 41) judge the rest. The ramp is not luminance-ordered (it is the Speed chip's, and the colour-vision numbers below do not cover it), so the colour is not the only carrier of the wind's strength: a mark's length grows with the wind up to its limit, and the legend card gives the numbers.

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
| Layers panel | `screens/sim/layersPanel.ts` | `layers.css` | `tileGrid` (map type and map details), **Night lighting** (a `segmented` Realistic / Brighter / Daylight with a hint, directly under the map-type tiles; test id `night-look`; left out where the view has no night), heat-map rows with a colour-ramp swatch, `chip`s, `segmented`, `toggle`, `slider`; in Wind and air the **Arrows and flow lines** switch row (0.5.0: a `toggle` with its (i), and once it is on a `chipChoice` "Wind height" of six chips, a caption and a zoom line, `layers.css` `.wg-*`; see *The wind arrows and flow lines*); one panel built from the layer catalog |
| Data sets | `screens/datasets.ts` | `datasets.css` | `appBar`, `stat` / `statRow`, `stackedBar`, `bar`, `sparkbar`, `kv`, `originChip`, `listRow`, `chipChoice` (filters), a heat-map preview canvas, `confirmDialog` before any deletion |
| How this simulation works | `screens/modelCard.ts` | `modelcard.css` | `appBar`, collapsible groups, `kv`, `badge` (evidence), `callout`, the glossary; its *Speed and memory right now* section is four live `kv` rows and a tonal button that opens Simulation debug statistics |
| Simulation debug statistics | `screens/debugStats.ts` | `debugstats.css` (and `modelcard.css`) | `appBar` with a Back arrow and a Copy `iconButton`; one `card` with the one-line summary, a state word (Live, Paused, Finished, No run yet, Demo engine: a word, never colour alone), a labelled Copy `button` and its hint; then 18 collapsed groups (the model card's collapsible `card`s, each with its own one-line summary, `kv-stack` rows, a tiny bar chart, `.ds-chart`, in `--series-1` for the speed history); a selectable `textarea` (`.ds-box`) appears only when the phone refuses the clipboard |
| Air slices tool | `screens/sim/sliceTool.ts` | `slice.css` (block 2) | a bottom tool panel (`.tool-panel.slice-tool`) with the `line` icon in its title ("Air slice"), the **Side view** and **Map view** tablist (0.5.0) and Close in its header; the controls are `.row-actions` of `.btn`s: *Set start (A)*, *Set end (B)*, *Swap*, *Presets* (with a chevron and `aria-expanded`), then, while placing, a primary large *Place A here* and *Cancel*; the four presets are a two-column grid of `.btn`s, a disabled one with its reason under it as a `.hint`; one quiet `.hint` note line; and, from 0.4.1, a row of two `.btn`s under the note, *Keep this line* (only while the line is a live preset) and *Clear recording* (only while something is recorded), and, from 0.5.0, a last row: *Turn off the slice* (only while there is a slice) with the hint "This also clears the recording." while something is recorded. The **Map view** tab (0.5.0) holds the arrows' switch, chips, caption and zoom line and the same last row. Nothing pops up |
| Air slice side view | `screens/sim/slicePanel.ts` | `slice.css` (block 1) | one Canvas 2-D picture; under it the probe's reading (`.slice-readout`, only while there is one); a row of six filter `chip`s (`chips-scroll`; two rows of three under 412 px); the tool's controls; the reasons for any off chip (`.hint`s) with a tonal `button` *Use the 3-D atmosphere* before them; a legend (a gradient bar and its end words, or class swatches: after the controls where no chip is off, after the reasons where one is); a `toggle` *Show model cells* with its description and, on a recorded slice, a `.hint` that the recording keeps no cells; the recording's status line (a `.hint` with `tabindex="-1"`, 0.4.1); the terrain `.hint`; the footer `.hint` |
| Wind direction tool | `screens/sim/windPanel.ts`, `windPanelModel.ts` | `sim.css` (`.wind-*`) | a tool panel (`panelShell`) with no crosshair: the dial (`compassRose`) and its hint, a `segmented` *When* of five, a time field and its reason, two status lines, a note for a past view, the lists *Your wind changes* and *Wind readings* with icon-only Remove buttons, and one primary large *Apply* in the foot ("Turn wind to SW" or "Hold wind from NW"); on a small portrait phone a one-line plan over Apply (0.6.0; *The Wind direction panel*, below) |
| Wind detail chip | `screens/sim/windDetailChip.ts`, `windDetailSheet.ts` | `sim.css` (`.wind-detail`, `.wd-*`) | a 44 px `chip chip-float` above the legend card with four pips, and its sheet in the top bar's popovers (0.6.0; *The Wind detail chip*, below) |

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

*The two tabs (0.5.0).* The header has the title ("Air slice", with the `line` icon; the old subtitle "Side view" is gone, the tab says it), then **Side view** and **Map view**, then Close. The tabs are a tablist, not a radio group: a `div.segmented.slice-tabs` with `role="tablist"` and the name "Air slice view", holding `button.segmented-option.slice-tab` with `role="tab"`, `aria-selected` and `aria-controls` (the tool's body), drawn in the segmented control's look (the chosen tab on `--primary-container` with `--on-primary-container` and a check, on `--primary` and `--on-primary` in high contrast; a pressed one on `--state-press`; a 2 px `--focus` ring inside the tab). Only the chosen tab is in the Tab order (a roving `tabindex`); Left and Right move to the other tab and choose it (they wrap), Home and End go to the ends, and the focus goes with the choice. The body is `role="tabpanel"` and is named by the chosen tab (`aria-labelledby`). A press says once, in the polite live region, "Map view: wind arrows and flow lines." or "Side view." (and, if a placement was under way, "Placing cancelled."); pressing the tab already shown does nothing and says nothing. A tab is a 44 px target; the header is no taller than it was (the tool's header drops its padding, so it is 49 px with its border, held to at most 50 px at 412 x 915, 360 x 640 and 844 x 390 by `e2e/air-tool.spec.ts`, which matters in the short landscape column). The title and the tabs wrap as one group (`.slice-head-main`, `flex-wrap: wrap`), so at a large text size the tabs go under the title and Close stays at the end of the first row; the tab labels and the chips wrap between words and never inside one (`overflow-wrap: normal`, `hyphens: manual`, `min-width: min-content`: the 200 % text check at 412 x 915, 360 x 640 and 844 x 390). Under 400 px wide the title gives up its icon so that "Side view" and "Map view" fit at 360 px. The 2-D map has no tabs: the tool is one line ("The side view needs the 3-D view."). The tab chosen is kept in the tool's state when the tool is closed and opened again (and only for the life of the sim screen).

*The Map view (0.5.0).* The body is the arrows' own controls and nothing of the side view: the switch ("Wind arrows and flow lines", with its one line while off), the Wind height chips, the caption and the zoom line (see *The wind arrows and flow lines*, below), then the *Turn off the slice* row. It is built the first time it is shown and shares one state with the Layers panel (flip the switch in either, open the other: the same). The side view's panel (with its streaks) is taken out of the document and told it is not active while the Map view shows, and is given the scene's slice again on the way back; a tab press drops a placement under way, so no crosshair is left on the map (the controls that place are the side view's). `slice.css` is untouched by all of this (4,066 bytes, under a guard of 4,096 in `styles.rules.test.ts`); the new rules are in `layers.css`, which the entry loads, because the tool's shell is an entry module and `slice.css` belongs to the lazy side-view chunk.

*Placing.* *Set start (A)* and *Set end (B)* are secondary `.btn`s; the one to do next is tonal. Choosing one shows the app's crosshair and swaps
the row for a primary large *Place A here* (it takes focus) and *Cancel*; the note says "Move the map until the cross is over the start (A)" and
the map still slides under one finger. A tap on the map sets a dashed mark and *Place A here* then keeps that point: the two-step confirm the Fire and Fuel
tools use for gloves and wet screens. After a placement focus moves to the next button; Back and Escape drop a placement first and close
the tool next, and focus goes back to the Tools button. *Presets* folds out a two-column grid of four `.btn`s (the live one is tonal and
`aria-pressed`); a preset that cannot be used is disabled and says why under itself. Every button is a 44 px target (a 40 px `.btn` with its
expander).

*Recording (0.4.1).* The time-lapse recorder adds one row of `.row-actions` of two secondary `.btn`s under the note line, and no other control: *Keep this
line*, shown only while the line in force is a live preset (it follows the wind and the fire, so it is not recorded; the button writes the line it is now as A and
B, clears the preset and the probe, and recording starts with the next picture), and *Clear recording*, shown only while the recorder holds a picture (it empties it
and keeps the line). The two are not on screen together, because a preset has no recording; there is no pause button (switch the slice off to stop). The row sits
4 px under the rows above it (`.slice-controls .slice-row`, margin 4 px: at 2 px the 44 px hit areas of *Presets* and the new row fought in the repo's tap
audit, which `e2e/air-slice.spec.ts` now runs on the tool at 412 x 915 and 360 x 640 with *Keep this line* and then *Clear recording* shown). Nothing pops up and
there is no `role=alert` or toast: a press is announced once through the app's polite live region ("Line kept. Recording starts when the simulation next
runs." and "Recording cleared. Recording starts when the simulation next runs.") and, because the pressed button is put away, **focus goes to the recording's
status line** (a `.hint` paragraph with `tabindex="-1"`, so not a stop of the Tab key; `SlicePanelController.focusRecording()`), which scrolls it into view clear of
the pinned footer (`scroll-padding-bottom`) and is read by a screen reader. With no status line to go to (no slice yet) focus falls back to *Set start (A)*.

*Turn off the slice (0.5.0).* A plain secondary large `.btn` (`btn btn-secondary btn-lg`, test id `slice-off`, 48 px tall with a 44 px hit area) in a `div.row-actions.slice-row`, the pattern of the recording's buttons: it is the **last row** of the side view's controls and of the Map view, full width, 4 px under the row above, with no new CSS. One factory builds both buttons for one action, and only the shown tab's is in the document, so the test id is unique. It is **absent** (hidden, as Keep this line and Clear recording are, not disabled: an always-present dead button is noise) when there is nothing to turn off, while a placement is under way, and when only a draft end is set (v-ui: the row made the sheet 72 px taller after "Place A here" and moved the cross, and the button would have been named for something that is not there); it is shown for a live preset, a hand line, the Layers panel's line while its section is on, and a line that Layers switched off but the tool still holds. While the recorder holds a picture a `.hint.slice-note` under the button reads "This also clears the recording." and the button points at it (`aria-describedby`); there is no pop-up, no confirmation and no undo, so the warning is the whole safeguard. A press switches the slice off and clears the stored line, the curtain, the panel's slice, the A and B marks and the probe's pin on the map, and the recording (one write; the chip and the Layers compass setting stay), and the Layers switch then reads Off; the tool **stays open** on the empty placement state. Because the pressed button is put away, **focus goes to *Set start (A)*** on the side view (the panel scrolls back to its picture, whose empty state says what to do next) and to the **arrows switch** on the Map view. The polite announcement is "Slice turned off." or, when the recorder held a picture, "Slice turned off. The recording was cleared." Opening the tool again does not switch the slice back on (the stored line was cleared on purpose), whereas the Layers panel's own switch-off keeps the line, so the tool brings it back; closing the tool (X, Back, Escape) still does not turn the slice off. It is a button of the tool, not a control on the 3-D map beside the line: the marks live in the `aria-hidden` annotation layer, which has no hit targets, and a 44 px target there would fight the one-finger pan and the tap-to-place candidate (the reason plan D6 rejected draggable handles). Pictures 40 (the Map view, with the button and its hint) and 41 (the side view scrolled to it) are `docs/screenshots/40-air-slice-map-view.png` and `41-air-slice-turn-off.png`, made by `gallery 0.5.0`, after *Keep this line* and a minute of recording.

*On the map* (inline SVG in `.annotations`, drawn only while the tool is open and only re-projected per frame then): A and B are 15 px discs with
a white letter (a dashed ring with a teal letter while the point is only tapped and not yet placed), the line is a 4 px stroke with a white
8 px halo (`.ann-stroke-casing`), and the probe's pin is a white disc with a ring and a dot. They share one token, `--mark-slice` (`#00796b`),
which `sliceTool.ts` reads as `SLICE_INK = 'var(--mark-slice)'`, so `check:contrast` sees it. Its pairs are the teal against its white halo
`--map-halo` (5.32:1, a UI pair, which `npm run check:contrast` prints) and the white letter on the teal disc, which is the same 5.32:1 and
bold 19 px, so it counts as large text (3:1 is needed, and 4.5:1 in the high-contrast looks; it would not pass the 7:1 of small text there). What is not done is a
check against the aerial photo behind the halo: the halo carries the edge there.

*The picture.* A `<canvas class="slice-canvas">` as tall as its picture needs (`--slice-h`, set by the panel), at most `clamp(180px, 27vh, 230px)`, so a long
line at true scale has no blank band above it (128 px while there is no slice, 84 px in short landscape), `--r-sm` corners, `touch-action: none` (a drag moves the probe,
not the panel), `role="img"` with a text alternative ("Side view of the air along a 6 km line from A to B, coloured by wind speed. The arrow keys
move a probe that reads the air at a point; Escape clears it.") and `tabindex="0"` with the 2 px `--focus` ring. Everything on it is read from the
tokens through `getComputedStyle` (`--text`, `--muted`, `--grid`, `--surface`, `--outline`, `--surface-3`, `--chart-moist`, `--font`, `--fs-xs`), so the
look, high contrast and the text size apply; the axis labels and the scale tag are the caption size (12 px, as the weather chart's), and
everything that is real text (chips, readout, legend, footer) is DOM text at 14 px or more. Streaks and arrows are drawn in `--text` over a
`--surface` halo so they read on every ramp; the probe cross is `--text` over a `--surface` halo. The ground is `--surface-3` with a tint, with the
model's own ground as a dashed `--text` line. The picture is drawn at the device pixel ratio up to 3. Under reduced motion there are no
streaks and no fade: still arrows, and nothing on the picture moves.

*Chips, reasons, legend.* Six `chip`s (`aria-pressed`) in a group labelled "Colour the slice by"; from 412 px wide they share one row, with 6 px of side
padding, and under 412 px they sit in two rows of three (`.slice-chips` becomes a three-column grid). A chip the air cannot give is `aria-disabled` at 38 % opacity (not `disabled`, so it still takes
focus and a screen reader reads its reason through `aria-describedby`), and its reason is written under the row word for word as the scene
wrote it, with a tonal *Use the 3-D atmosphere* button where switching helps; the button comes first, and a tap on a chip that is off scrolls to
the reason and the button. The order on a phone in portrait is the picture, the reading, the chips, the tool's controls, then the reasons and the
button, then the legend, so that *Set start* and *Presets* stay in view at 390 x 844 (the button is a scroll away; at 360 x 640 only the picture and
the chips fit in the window). Where no chip is off (the 3-D air) the legend comes before the controls. The legend is the legend's title with its units,
then a 12 px gradient bar with a 1 px `--divider` border and up to five numbers under it (or 12 px class swatches with their words).

*Probe.* A tap or a drag on the picture (pointer capture; a finger lifted off the glass or a mouse passing over does not move it), or the
arrow keys when it has focus (a lattice step; a quarter of the axis with Shift), and Escape clears it. The words appear in a `.slice-readout`
(`--surface-2`, `--r-md`, 14 px) under the picture, with a 44 px *Clear the probe* icon button; a screen reader hears a reading after a key
move (after a pause of 0.4 s, so a held key does not queue), not after every drag. The reading is not part of the pinned picture: in short
landscape it scrolls with the chips and the controls, so it never covers them.

*The recording's status line (0.4.1).* A `.hint` paragraph (14 px, `data-testid="slice-recording"`) after the *Show model cells* switch and, with the switch on over a
recorded slice, its one-line note ("The recording does not keep the model's own cells, so the smooth picture is shown."), and before the terrain caption and the
footer, so in short landscape it scrolls with the controls and only the footer stays pinned. It says what the recording holds and what that means for the picture
shown, in the words of `src/ui/recordingWords.ts` (the statistics row says the same span): "Recorded from 11:30 to 12:40 (every picture kept)." or "(about every 2
min)."; for a time before the first picture "Recorded from 13:06, as far ahead as the simulation had run. This time is earlier, so it uses the history's saved air,
which can be older."; "Recording starts when the simulation next runs." while nothing is held; after a drop its reason first ("The line changed, so the old recording
was dropped."), and "Recording cleared." only until a picture is held again; for a live preset or the Layers line why it is not recorded, with the way to record it;
"Recording stopped. The slice is not affected." if the recorder failed. It is plain text, not a live region and never a `role=alert`: the spoken answer to a press is the
polite announcement above. Picture 36 (`docs/screenshots/36-air-slice-recorded.png`, made by `gallery 0.4.1`) shows it at 412 px wide, scrolled to *Clear recording*, with
the cells switch, the status line and the footer.

*Footer.* A `.hint` that is `position: sticky` at the bottom of the panel's body with a 1 px `--divider` above it, so it is always in view:
"3-D time-stepped air · model grid 133 m · air from 11:25", or "Diagnosed wind: terrain effects only · model grid 133 m · air from 11:25", with
"(4 min before the time shown)" added past 90 seconds (the age is in minutes, so an old picture on a small phone can say "239 min before the time shown"). Where the slice is read from the time-lapse recording (0.4.1) the third
part says "recorded air from 11:25" and counts the age from that recorded picture ("recorded air from 11:25 (2 min before the time shown)"), for example "3-D time-stepped
air · model grid 133 m · recorded air from 11:25"; the word "recorded" is part of the age run, so the one-line footer of short landscape keeps it.
In short landscape (844 x 390: `orientation: landscape` and `max-height: 540px`) the picture is pinned at the top of the panel at 84 px, as wide as the
panel (the pinned block reaches the panel's edges), the reading, the chips and the controls scroll beneath it
(five lines of reading fit under it at a line height of 1.3), and the footer is one line, pinned at the bottom, that keeps the kind, the grid and
the age and hides their explanations (`.slice-more`); while a reading is shown the footer is hidden and its line goes to the reading, and the
readout loses its top margin so the clear button's hit area does not reach under the picture. The body keeps `scroll-padding` for the pinned picture
above and the footer below, so a control that is scrolled to stops clear of both. **A consequence for the recording (decided, not fixed):** with a probe shown in short
landscape the footer is hidden, so nothing in view says "recorded" or how old the air is while probing; keeping the footer would clip the reading, and a word added to the
reading would lengthen it at 360 x 640, where it already wraps to five lines. At 360 x 640 in portrait the footer stays in view and says it.

*Words, as the rules of this document and `src/ui/content.ts` ask.* Plain words and sentence case; no em dash; "about" for a number ("Wind
about 32 km/h"); a wind is named by where it comes **from** with the hyphenated eight-point word ("north-west"), never "towards" in words; the
along and across parts say which way the air goes in the picture ("towards A", "towards B", "to the right", "to the left"); vertical motion in
metres per second whichever speed unit is chosen; heights are "above sea level" on the axis and "above ground" in the sentence (against the 10 m
ground); K is a difference, so "3 K warmer" and never a temperature; "diagnosed wind" and "terrain effects only" wherever the air is the fast
model's; a disabled thing always says why, in a sentence, near it. The temperature is against the slice's own air, so it is never called
"than the area": the probe says "3 K warmer than average" (or "about average temperature" under half a kelvin), the legend's title says
"Warmer or cooler than the average of the slice at that height" and the chip is named "Air temperature against the average of the slice at
that height" (one constant, `SLICE_THETA_BASIS`), and the legend's sentence and Help say what the average is. **A design point:** because the
average is taken over the line's own air, on a short line through a plume the Temp chip understates the plume (the plume is part of what it is
compared with); a longer line, with more ordinary air in each row, would understate it less. **The recording's words** follow the same rules: a time is
"11:30" on the scenario's clock; the spacing of a thinned recording is "about every 2 min" ("about every 20 s" under 90 s, hours from 90 minutes), "about" because
thinning keeps between one and two of its gaps; "every picture kept" is in brackets after the span so that neither reads as a fragment; "recorded air from" and
"Recording starts when the simulation next runs" say what is recorded and when without promising a time, because the simulation computes ahead of the picture shown and a
line placed while playing is recorded only from where the worker had got to.

**The wind arrows and flow lines** (`windGlyphControls.ts`, `glyphWords.ts`, `layers.css`; the Layers row and the Air slices tool's Map view). One builder serves both places, so they are one state by construction; nothing in it pops up, speaks or moves by itself.

*The switch.* A `toggle` (`.toggle`, test id `layer-windGlyphs`; the label is "Arrows and flow lines" in Layers, where the heading "Wind and air" is above it and the catalog keeps its titles to 24 characters, and "Wind arrows and flow lines" in the Map view, which has no such heading). In Layers it is a switch row (`.lp-switch`, with the (i) button that opens the catalog text), after the Wind streaks control and before Air slice. A switch that cannot be used is `disabled` and a `.hint` (`.wg-reason`, 14 px, the `aria-describedby` of the switch) says why in a sentence: "Needs the 3-D view" on the 2-D map, "Needs the air picture, which the simulation makes once it has started" before the first picture. A switch that is on is always operable, so it can be turned off (a remembered "on" on the 2-D map has no chips and says why). In the Map view, while the switch is off and can be used, one `.hint` (`.wg-intro`) says what it does, "Draws the wind on the map: arrows from far away, flow lines when you zoom in.", and is the switch's description (the tab has no (i) button).

*The chips, the caption and the zoom line.* Built the first time the switch is on (the Layers panel's DOM budget) and hidden, not torn down, when it is off again. A `chipChoice` (test id `wind-height`, a radio group labelled "Wind height") of six chips, **10 m**, 50 m, 100 m, 300 m, 1 km, 2 km, in a grid that fits as many as the text size allows (`repeat(auto-fill, minmax(calc(var(--fs-sm) * 3.2 + 52px), 1fr))`: three to a row at the normal size and in the 412 px column, fewer at a large text size); a chip's label never breaks inside a word (`white-space: nowrap`, `overflow-wrap: normal`; `styles.rules.test.ts` holds it), it moves to the next row instead. Under the chips two `.hint` paragraphs: the caption (`.wg-caption`, `white-space: pre-line`, one line for each sentence) and the zoom line (`.wg-level`). The box is a column with a `--sp-1` gap, and the next row of Layers starts `--sp-3` below the caption. They are plain text, not live regions: nothing is announced for a zoom, a rebuild or a height change (the person pressed the chip). The caption and the line are read from the layer's own statistics twice a second only while the control is on screen and the switch is on, and a text is rewritten only when it changed, so a reader is not interrupted by the poll.

*Words.* As the rules of this document and `src/ui/content.ts` ask: plain words, sentence case, no em dash, "about" for a number; a height is "10 m" (never "Ground", never "What the fire feels", which E2 would earn), "50 m", "1 km"; the first line of the caption ends in a full stop (a screen reader would run it into the next line otherwise), parts joined by " · ": "Wind at 100 m above the ground · model grid 133 m · air from 14:05." and for the 10 m chip "Wind about 10 m above open ground · ..." (and, on the fast tier only, ", as the model fits it to the terrain"); "air from", never "wind from" (it reads as a compass direction), exactly the Air slices footer's phrase, with "(4 min before the time shown)" past 90 seconds and "air time not recorded" when there is none; the fast tier adds "Diagnosed wind: terrain effects only, no plume."; the 10 m chip adds "On a calm night the fire can feel much less wind than this in places, and much more in others."; above 60 px a model cell, "At this zoom the curves are a smooth fit through the model, not new detail." The zoom line says what is drawn and what zooming does ("Zoom in to see the wind arrows.", "Showing straight arrows. Zoom in for more.", "Showing straight arrows, closer together. Zoom in for flow lines.", "Showing curved flow lines.", "Showing long flow lines.") or why nothing is ("Not drawn at eye level. Go back to the map view.", "Waiting for the wind picture.", "Not drawn here: this view already uses all the phone can draw. Zoom out or switch a layer off."). Every sentence is pinned in `glyphWords.test.ts`, and the Help and Glossary entries to them in `content.test.ts`.

*The legend card.* The map legend card (Google-Maps style, collapsible, a tap opens Layers) follows the switch, not the picture: with the arrows on it shows the wind-speed ramp in km/h (a gradient bar from 0 to 90 km/h with its end numbers), titled "Wind near the ground" for the 10 m chip or "Wind at 100 m" and so on. The precedence is a heat map, then colour-coded trees, then an Air slice, then the arrows, then the Wind streaks; at eye level, where nothing of the arrows is drawn, the card gives way to the streaks' or to none; and it is still shown at level 0 (a known limit). The card shows the title and the ramp only; the caption is in the control.

*Colour.* The strokes are drawn in JavaScript, outside `npm run check:contrast`: `WIND_RAMP` (the Wind streaks' and the Air slice's Speed chip's ramp, not the Wind speed map's cool-to-warm one) under a near-black navy halo (sRGB `#081024`, 5 px under a 2.5 px stroke), so that its pale stops (`#f4f9ff`, `#a8ecff`) stay readable on the aerial photo, plain relief and the three night looks; `flowGlyphs.test.ts` holds every one of the 64 colours of the speed table to at least 3:1 against the halo ink, and the pictures judge the rest. Nothing moves, so reduced motion has no branch. Pictures 37 to 39 (`docs/screenshots/`, `gallery 0.5.0`) show the arrows at three zooms and the Layers row.

*Debug statistics.* One row, "Wind glyphs", in the Display group (a `kv` row like its neighbours): the level, the glyphs and segments, the last rebuild and the 95th percentile and maximum of a slice, with the model cell in pixels and the rebuild count as its note; "Off", "On, not drawn at eye level", "On, waiting for the wind picture", "On, not drawn: the view already uses all the triangles a frame may have" (the arrows and flow lines only since 0.6.0), "Level 0, nothing drawn at this zoom", or "Not available (this view draws no wind glyphs)" on the 2-D map. It is in the copy as text.

**The Wind detail chip (0.6.0)** (`windDetailChip.ts`, `windDetailPips.ts`, `windDetailState.ts`, `windDetailWords.ts`, `windDetailSheet.ts`, `.wind-detail` and `.wd-*` in `sim.css`; the owner's request: "an on screen icon indicating the level of detail of the wind currently shown because of the zoom level (or other things it depends on)"). It says how detailed the wind on the map is now and, in its sheet, why it is not more detailed. It never opens, speaks or moves by itself.

*The chip.* A `chip chip-float` button, `min-height: var(--tap)` (44 px), `padding: 0 --sp-3`, `gap: --sp-2`: the `wind` icon (18 px), the label "Wind detail" (a long label in a short chip, never abbreviated) and four **pips**. A pip is a 10 px circle with a 2 px `currentColor` border; a step reached is filled with `currentColor` (`.is-on`) and the rest are rings, so **the shape carries the step and not the colour** (forced colours: the filled pip is `CanvasText`, `forced-color-adjust: none`). The pips are `aria-hidden`: the button's accessible name carries the step ("Wind detail: level 3 of 4. Open the explanation.", or "Wind detail: not drawn yet. Open the explanation." at step 0), with `aria-haspopup="dialog"` and `aria-expanded`. It is a button of the map and not a state of the simulation, so it is a chip (the look of the speed chip and the legend card), not a badge.

*Where.* In the bottom-left stack of the map, **directly above the legend card**: `simScreen.ts` (`layoutInsets`) sets `left = colL + 12` and `bottom` = the legend's top + 8 px (the attribution line's top when the legend is hidden, the base + 12 when both are), with the legend's `max-width`. It never goes into the right-hand column of round buttons: a fourth round button would make that column 184 px high and risk `fabs-crowded` hiding Layers and View at 844 x 390. The scout measured a stand-in chip of 175 x 44 px at 412 x 915, 360 x 640 and 844 x 390: 0 overlaps with the pill, the weather chips, the round buttons, Tools, the legend, the attribution line, the dock and the timeline (the spec checks the real chip against all of them). It steps aside **exactly when the legend does**: an open Layers or other panel, a full sheet and drawing a line hide it (`display: none`), an open menu hides it without moving the stack (`visibility: hidden`), and on a wide or short landscape screen, where a full sheet is a side column, it stays (`.sheet-full .wind-detail:not([hidden])`). It is hidden (the `hidden` attribute) when there is no wind mark to describe: neither the Wind streaks nor the arrows and flow lines are on, the view is the 2-D map, the view is eye level and only the arrows are on, or the layer is still waiting for the air with no streaks on. **It is not shown for the Wind speed map** (a coloured map, not marks).

*The sheet.* A bottom sheet of the top bar's popover group, the pattern of the slow-run sheet (`transportSheet({ title: 'Wind detail', testId: 'wind-detail-sheet', class: 'tp tp-2col tp-wind-detail' })`): dialog role, grab handle, Close; a tap on the chip opens it, and Escape, an outside tap, Close and Back close it (focus returns to the chip; one popover at a time). Its body is the four pips again (12 px) beside a lead line in `--fs-md` ("Level 4 of 4: detailed streaks."), then short paragraphs in `--fs-sm` with a `--sp-2` gap: which wind it is ("Wind about 10 m above open ground." or "Wind at about 100 m above the ground."), what to do next ("Zoom in for more detail." / "This is the most detailed level."), what the picture's numbers are (at level 4, "Direction and speed come from the air model, which works on cells about 133 m wide." and "The small eddies are added for looks, from the shape of the ground. The streaks also move faster than the real wind so that you can see them."; at the lower levels the cell line "The air model works on cells about 133 m wide. Between its points the wind is a smooth fit."), and the limits that apply ("Not drawn here: this view already uses all the phone can draw. Zoom out or switch a layer off." (only the arrows and flow lines can reach this one: the detailed streaks are never trimmed), "The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated.", "Your phone is set to reduce motion, so the streaks stand still."). On a short landscape screen the paragraphs run in two balanced columns under the lead (`column-count: 2`, `break-inside: avoid`). The sheet repaints in place every 250 ms while it is open and only when its words change; if the marks go away under it (a fly-to to eye level, the air gone) it closes itself. No toast, no `role=alert`, no live region: nothing is announced for a zoom. The words follow the rules of this document: "about" for numbers, sentence case, no em dash, a limit is a sentence and not a code, "estimated" and "not simulated" for the fast tier, and the added eddies are called what they are.

**The look of the most detailed level (0.6.0)** (`detailBatch.ts`, `detailStreaks.ts`; the owner's request: "the wind streaks should become much more detailed and believable"). At level 4 the picture is **comet-shaped streaks**: a bright, thick head and a tail that thins to 45 % of the width and fades to nothing, so the direction reads at a glance even in the frozen frame. Each streak is born at a random moment, lives its own time (70 to 130 % of the time a pulse takes to cross it) and starts again after a gap of up to 60 %, so the picture always has some streaks coming and some going. A longer streak is a stronger wind (16 px per m/s, 90 to 220 px). **The streaks are about 32 px apart on average at every zoom**, so the picture neither thickens nor thins as you zoom: more lines are added as you come closer and none is moved or taken away, and a streak keeps its own rhythm while you zoom (the lattice nests, so there is no pop and no fourfold change of density where the zoom crosses an octave; about 460 to 860 lines on a 412 x 915 phone). **The closest zoom always has its picture**: the streaks are the one picture that the drawing budget never trims, even where a dense forest already fills the frame (up to 24,000 triangles more than the limit at the High picture quality). **Colour is the model's speed** and nothing else: the same ramp as the arrows and flow lines (`WIND_RAMP`: pale grey-blue to violet, 0 to 90 km/h on the unchanged legend card) under the same dark navy ring (`HALO_INK`, 0.4 of the width each side at 60 %), so the pale stops read on the aerial photo, plain relief and the night looks; the stroke is 3.2 CSS px at the head (`DETAIL_WIDTH_PX`, a first guess for a phone). **The small eddies**: the streaks bend with three octaves of drifting noise (40, 10 and 2.4 m peak to peak), a finer one fading in only when its amplitude would be about a pixel, so more eddies appear as you zoom in; the bends are stronger in the lee of a ridge and over rough ground (from the 10 m terrain as received), a streak lifts a little over a windward slope and sinks in a lee, and a gust wave of about 120 m brightens and dims it along its length. **All of this beyond direction, speed and colour is added for looks and is not computed by the model, and the interface says so** ("The small eddies are added for looks, from the shape of the ground."): it is the one place where the picture is richer than the data, labelled where a person would look for a reason (the chip's sheet and the Help entry *Detailed streaks*), and it fades with the Wind height (0.38 at 300 m, 0.04 at 1 km) because the ground matters less up there. The streaks show through the tree tops (the depth bias of the arrows, plus a slide of the biased depth that stops at 0.8 of the way to the eye); with reduced motion the picture stands still at a frame where most lines carry a pulse, and nothing animates. There is no new control, no new legend and no new Layers row (the Layers panel's DOM headroom is 9 nodes): both existing switches draw it. Everything in this paragraph is a first guess seen only in software rendering; the width, the amplitude, the density and the speed of the pulses are tuned in `DETAIL_GEOMETRY` and one block of the shader.

**The Wind direction panel (0.6.0)** (`windPanel.ts`, `windPanelModel.ts`, `.wind-*` in `sim.css`; the tool is the fourth entry of the Tools dial, label "Wind direction", icon `wind`, where "Local wind" was). It is a tool panel like the others (`panelShell`: header with the title and Close, a scrolling body, a fixed foot), but **with no crosshair and nothing to place**: it turns the wind of the whole map, so a tap on the map does not belong to it, and the panel needs none of the two-step confirm of the Fire and Fuel tools. In the body, in order:

- *The hint and the dial.* A grid `auto minmax(0, 1fr)`: the dial (`compassRose`, `touch-action: none`, named for a screen reader "Wind comes from. Drag the arrow, or use the arrow keys.") and the hint beside it ("Choose where the wind comes from. It turns over 15 minutes and then holds that direction, so the forecast's later wind changes no longer apply. Wind speed stays as forecast."). The dial opens on the wind as it is now, to the nearest 5 degrees, so it is never a turn away from what is there until the person drags it, and it never follows the clock afterwards. Its size follows the window's height (`dialSize`: 184 px from 800 px high, 148 from 700, 140 from 560, else 120), because the panel is short on a small phone.
- *When.* A `segmented` of five options in three columns (Now, In 10 min, In 30 min, In 1 h, At a time). "At a time" shows a "Local time" field (`<input type="time" step="60">`, `max-width: 180px`, prefilled with the Now start plus 10 minutes, a sr-only suffix "Time the wind starts to turn"); a reason that Apply is off sits under it as a `p.field-error[role=status]` in `--fs-sm` (not the 12 px of a field error elsewhere, because it explains why a button is off) and is scrolled into view when it appears.
- *What it will do.* Two status lines in `--fs-sm`: "Before the change: from NW (315°)." and "Starts turning at 14:41 and reaches SW (225°) by 14:56." (or, when the dial is on the wind, "Holds NW (315°) from 14:41. The forecast's later wind changes no longer apply."). When the person is looking at an earlier time, a `.hint`: "You are viewing 14:10. Applying re-runs the simulation from then." A time is the scenario's clock ("14:41", or "Sat 14:41" in a scenario of more than 20 hours), never the device's.
- *The changes.* "Your wind changes" (`h3.sub-title`, a `plain-list`; a row per change, in time order: "Wind from SW · starts 14:40 (in 10 min)", "· turning, done by 14:55", "· done at 14:55") each with an icon-only `trash` ghost button (accessible name "Remove the wind change to SW at 14:40", a 44 px hit area). The words follow the clock without rebuilding the buttons, so a tap is never lost to a redraw. After a removal the keyboard stays in the list (the next Remove, or the dial).
- *The readings.* If Setup's belt kit put local wind readings in the run, they have their own list under "Wind readings" (a row each: where, "near the middle" or "2.1 km NE of the middle", the direction and the radius, when it starts, "(from the belt kit)", with its own Remove) and one `.hint` under it: "A reading keeps its own direction when you turn the wind." The panel does not change a reading's speed or direction.
- *The foot.* One primary large button with the `check` icon, `apply-wind`, whose words say what it will do: "Turn wind to SW", or **"Hold wind from NW"** when the dial is already within half a step of the wind there. It is disabled, with the reason under the time field or in the status, for a time that cannot be used (the field is empty or not a time, the time is not in the scenario, it has passed, it is after the last whole minute, or the scenario ends within a minute). After Apply the panel stays open with its choices, and the foot is not a live region (the button stays, and its words follow the dial); the announcement ("Wind direction change set. The wind turns to come from SW, starting at 14:40 and done by 14:55.") goes to the polite region. No toast, no dialog, no confirmation (a change is undone by its own Remove).

*The 360 x 640 rule.* On a small portrait phone (under 700 px high: `@media (orientation: portrait) and (max-height: 699px)`) the status under When is below the fold when the panel opens, and the person would press a button without seeing what it does. So **a one-line plan** (`.wind-plan`, "Starts turning at 12:00, done by 12:15." or "Holds NW (315°) from 12:00.") sits in the foot over Apply, always in view, and the longer second status line is hidden (it is the same sentence). The dial gives way (140 px at 640 px high) and the list scrolls. On a short landscape screen (844 x 390: `orientation: landscape` and `max-height: 540px`, about 240 px of panel) the header and the foot give up padding, the dial's read-out goes beside it and the hint under both (`display: contents` on the dial's wrap), so the whole dial is in view on opening and the rest is reached by scrolling. Every control is a 44 px target (`e2e/wind-direction.spec.ts` checks the panel at 360 x 640 and 844 x 390 with a reading and a change listed).

*Words.* "Wind direction" everywhere the person sees it (the Tools dial, the panel title, the list, the announcements); "where the wind comes from" (never "towards"); a direction is the eight-point word with its degrees ("SW (225°)"); "turns", "starts turning", "holds"; the Weather tab says, once, "You changed the wind direction, so the forecast's later wind changes no longer apply." in a `callout-info` and not as a card; "local wind reading" survives only for the belt kit's readings.

**The side view's denser wind marks (0.6.0)** (`slicePanelModel.ts`, `sliceDraw.ts`; the owner's request: the vertical slice's streaks and arrows about twice as dense). The rule, which holds in both modes: **about twice as many marks as 0.5.0, and no mark may overlap its neighbour.** Moving: one streak per about 95 square px of plot (190 in 0.5.0), at most 600 (300) and never fewer than 120, so a smaller plot is not a smear and a tiny one still has some flow. Reduced motion: a lattice of arrows of about 24 x 21 px a cell (34 x 30 in 0.5.0: each side about the square root of two shorter), the whole number of columns and rows nearest to that, the least stretched from that shape, so the short landscape plot gets about twice the arrows and not a lattice of slivers (`arrowGrid`); **the longest arrow is 60 % of the smaller side of its cell**, so two neighbours pointing any way keep 40 % of that side clear between them (about 7 to 13 px on a phone: 0.5.0 drew 10 to 18 px), and an arrow is 55 % of the longest in a calm and all of it from 11.4 m/s (`arrowLength`). The side view's verifier measured on the real app that the streaks are exactly twice as many and the arrows 1.6 to 2.3 times, and that the arrows came out 29 to 42 % shorter: a calm arrow is 7.8 to 8.7 px on a portrait phone and 6.5 to 6.9 px on a landscape one (about 17 device px at a pixel ratio of 2.625). A floor of about 8 px for a calm arrow, against the no-overlap rule, is a follow-up and is not built. The 3-D curtain's wind arrows (21 columns by nine heights) are twice as many too. Streak colour, the halo, the 24 frames a second cap and everything else of the side view are as they were.

**Never**: a pop-up, a toast or a dialog because of something the simulation did. New insight cards only raise the badge on the Insights tab. Dialogs
open from a tap (`confirmDialog` for deletions, the safety notice, "Leave this simulation?").

**Audits** (all in `scripts/`): `check-contrast.mjs` (`npm run check:contrast`, every stylesheet, four looks), `audit-tap-targets.mjs`,
`audit-contrast-dom.mjs` (measures the rendered page), `layout-budget.mjs` (the share of the screen that is free map at 412x915, 390x844, 360x740,
360x640 and 844x390). The e2e specs check the 200 % font scale, high contrast and the Back order (`e2e/integration.spec.ts`).

**Other**

* `src/render/legendGallery.ts` and `src/render/dev.html` are dev pages with their own CSS; they do not use the app's stylesheets.
* Android native theme (status/navigation bar colours, splash): the table in section 9.
