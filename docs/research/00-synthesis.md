# 00 — FireSim model specification (synthesis of research docs 01–10, 08b)

**Status:** normative (revision 2, after the physics and implementability reviews). This is the single source of
truth for the simulation, fuel, moisture, atmosphere, ember, explanation, scenario and orchestration code. If this
document disagrees with a research document (01–10) or with `docs/ARCHITECTURE.md`, **this document wins**. The
research documents keep their value as the evidence base: every number here cites the section it came from, so an
implementer can check the reasoning.

**Readers:** the implementation agents for `fuel/`, `fuel/moisture` + drought, `fire/models`, `fire/spread`,
`atmosphere/`, `embers/`, `explain/`, `scenario/` and `sim/`. Each module section (§4–§12) is self-contained. It gives
equations with units, coefficients, clamps, algorithms, TypeScript signatures, test vectors and what the module must
not do. §1 records every place where the sources disagreed and which variant was chosen, and why. §2 lists every
change to the shared contracts; **the sim agent lands §2 in `src/core/` first**, and every other agent codes against
it. §14 collects the test vectors, §15 the validation scenarios and §16 the open issues.

> FireSim is a **training aid, not an operational prediction tool.** Every user-visible number is labelled
> "model estimate". Every insight card ends with doctrine, never with the model: *"Education only. LACES first.
> Follow your Crew Leader and NSW RFS procedures."*

---

## 0. Conventions

### 0.1 Evidence tags

| Tag | Meaning | Implementation rule |
|---|---|---|
| **[V]** | Verified in a research doc against a primary source, official document or code that cites the equation (docs say "verified", [S], [S-doc], [S-code], [V]) | Hard-code, and unit-test against the given vector |
| **[K]** | Standard literature value not re-verified this session | Hard-code with a `// [K] verify: <source>` comment |
| **[D]** | Derived (arithmetic or physics shown) | Hard-code |
| **[H]** | FireSim heuristic or design choice | Put it in the module's `*_PARAMS` constant object (tunable, documented), never inline |
| **UNVERIFIED** | A research doc tried and failed to confirm it | Same as [H], plus list it in §16; UI must label outputs that depend on it "uncertain" |

### 0.2 Units, coordinates, grids and time

- **Internal units are SI** (m, s, m/s, °C, %, kW/m, kW/m², t/ha for fuel loads) as in `src/core/units.ts`.
  Australian empirical models are coded in their **published units** (km/h, m/h, cm) *inside* `fire/models` and
  converted once at the function boundary: `U10_kmh = 3.6·windSpeed10`, `H_ns_cm = 100·nearSurfaceHeight`,
  `ros_ms = ros_mh/3600`.
- **Grids** are `GridSpec` (row-major, `k = j·nx + i`, i east, j north, j = 0 the **southern** row). The bundled
  demo rasters are stored with row 0 = **north**; flip on load.
- **Grid identity (normative).** `ScenarioData.terrain` and `ScenarioData.fuel` are on the **fire grid**
  (`fireCellSize`, 20 or 30 m) and `fuel.grid === terrain.grid` (the worker asserts it). The moisture model, fire
  spread, ember emission/landing, `TerrainFeatures` and explain all index cells with the same `k`. The 10 m DEM
  travels separately as `ScenarioData.terrainHiRes` (render and atmosphere block-averaging only). The atmosphere has
  its own coarser grid (§8.1).
- **Directions**: compass azimuth, degrees clockwise from north. Wind direction = direction **from**; spread,
  flow and upslope directions = direction **towards**. `windToUV`, `uvToWind`, `angleDiffDeg` in `core/units.ts`
  are normative. `wind_to = wrapDeg(windDir + 180)`.
- **Aspect** (`Terrain.aspectDeg`) = the downhill direction the slope faces; **upslope azimuth** = aspect + 180
  (`upslopeAzimuth()` in `terrain/`). **Aspect is NaN on flat cells** (slope < `FLAT_SLOPE_DEG`). Every formula that
  uses aspect must say what it does with NaN; the defaults are: aspect-dependent weights = their neutral value
  (0.5 in the §5.9 FA blend), `lee = 0` (§7.9), "southern half" tests false (§4.3), upslope-dependent vectors 0.
- **Directional slope** along azimuth ψ: `θ_d(ψ) = atan(∇z·û(ψ))` (`directionalSlopeDeg()`), positive uphill.
- **Time**: all state times are unix ms (UTC) or seconds from scenario start (`t`). Every *physics clock rule*
  (fuel-moisture period, "afternoon", 13:00–17:00 windows) uses **local mean solar time**
  `LMST = UTC + lon/15 h` (≈ AEST + 1 min at 150.3° E). Displayed times use the civil zone
  (`Australia/Sydney`, DST-aware). Doc 04 §3.2 could not verify whether the AFDRS period hours are standard or
  daylight time; solar time is the physically meaningful choice [H].
- **Local calendar dates** (NPWS dates, daily weather, fire seasons): `localDate(ms)` = the UTC calendar date of
  `ms + 12 h`. This maps both conventions found in the NPWS data (00:00Z = that date; 13:00Z/14:00Z = local
  midnight of the next date) to the intended date. `season(t) = localYear − (localMonth < 7 ? 1 : 0)`.
- **Seasons**: "Oct–Mar" means local months 10, 11, 12, 1, 2, 3.
- Angles are degrees at APIs and radians inside kernels.

### 0.3 Shared helper functions (`src/core/physics.ts`, new; owner: fuel/moisture agent, all may import)

```ts
export const G = 9.81, CP = 1005, RD = 287.0, KAPPA_VK = 0.4, SIGMA_SB = 5.67e-8, LV = 2.5e6, RCP = 0.2857;
export const HEAT_YIELD_KJ_PER_KG = 18600;               // AFDRS default heat yield [V doc 03 §3.1]
export const RHO_REF = 1.1;                              // kg/m³, reference density of ember v_t0 (§9)
export const esat = (tC: number) => 6.112 * Math.exp(17.67 * tC / (tC + 243.5));   // hPa, Bolton 1980 [V doc 02]
export const rhFromTd = (tC: number, tdC: number) => clamp(100 * esat(tdC) / esat(tC), 0, 100);
export function dewPointC(tC: number, rh: number): number { // exact inverse of esat
  const g = Math.log(clamp(rh, 0.1, 100) / 100 * esat(tC) / 6.112); return 243.5 * g / (17.67 - g); }
export const pressureIsa = (zM: number) => 1013.25 * (1 - 2.25577e-5 * zM) ** 5.25588;   // hPa [K doc 04]
export const exner = (pHpa: number) => (pHpa / 1000) ** RCP;                               // Π
export const theta = (tC: number, pHpa: number) => (tC + 273.15) / exner(pHpa);             // K
export const airDensity = (tC: number, pHpa: number) => (pHpa * 100) / (RD * (tC + 273.15)); // kg/m³
export const logistic = (g: number) => 1 / (1 + Math.exp(-g));
export const vpdKpa = (tC: number, rh: number) => Math.max(0, esat(tC) * (1 - rh / 100)) / 10;
export const lmstHour = (ms: number, lonDeg: number) => (((ms / 3.6e6 + lonDeg / 15) % 24) + 24) % 24;
export function localDate(ms: number): string;           // §0.2 (UTC date of ms + 12 h), 'yyyy-mm-dd'
export function stableNight(s: StableNightState, inp: StableNightInput, dtS: number): void;  // §5.2a
```
`clamp`, `smoothstep(e0, e1, x)` (cubic Hermite, `t²(3 − 2t)`, t clamped) and `lerp` come from `core/units.ts`.
One saturation formula (Bolton) is used app-wide, as doc 08 E9 demands ("pick one set"). The UI's
`weatherCalc.ts` already uses it.

### 0.4 Priorities

**P0** = required for the first integrated build; **P1** = required for release; **P2** = optional, behind a flag
defaulting to off. Each algorithm below carries its priority.

---

## 1. Decision register: contradictions resolved

| # | Topic | Sources disagree | **Chosen** | Why |
|---|---|---|---|---|
| D1 | Level-set time step and viscosity | ARCHITECTURE "Δt_f ≤ 0.5·Δx/ROS_max"; doc 03 §4.3, doc 09 §4.4 the same; WRF two-sided viscosity | **Corrected bound** `Δt_f = 0.9/max_band[R((‖n_x‖+2ν)/Δx + (‖n_y‖+2ν)/Δy)]` (‖·‖ = absolute value), **ν = 0.2 applied to concave parts only** (`ν·R·Δx·min(0, ∇²φ)`) | Doc 07 §3.4: the advective-only bound is unstable with viscosity, and grows-only turns the instability into the whole map burning. Review measurement: the two-sided term slows an LB 3.84 head to 0.854 of its speed at Δx 30 m (0.959 one-sided) and shrinks circles; merge cusps (concave) keep their damping. The bound is unchanged (conservative) |
| D2 | Upslope factor | `e^(0.069θ)` (Noble), `e^(0.0687θ)` (FBI-TG eq 3.5), `2^(θ/10)` (Mk2 eq 13) | **`SF = 2^(θ/10)`** for θ > 0 | All within 2 % up to 30° (doc 03 §0.1 item 11); 2^(θ/10) is the Mk2 form and teaches "doubles every 10°" |
| D3 | Downslope factor | symmetric `e^(−0.069θ)` (Mk5 code, doc 10 draft) | **Kataburn** `SF(−θ) = s/(2s−1)`, `s = 2^(θ/10)` (≥ 0.5), also as an upper bound on any head with θ_e < 0 (§7.3) | Verified FBI-TG eq 3.6 / PyroXL; symmetric form under-predicts backing 2.3× at −20° (doc 01 §1). Without the bound the additive hybrid gives an opposed-wind downslope head only 5 % below flat |
| D4 | Steep slope handling | doc 03 §3.14: clamp SF at 20° and hand over; doc 01 §4.2: evaluate uncapped, hard cap SF ≤ 16 (40°), plus eruptive amplifier | **Doc 01**: SF uncapped to 40° (cap 16), `validated=false` beyond +20°/−30°, the §7.6 attachment amplifier, and **R_H ≤ 15 km/h in vesta2/pine after all multipliers** (grass and heath exempt) | Evidence says all models *under*-predict above 20° (doc 01 §2.2); a clamp would under-predict further. Doc 01 §4.3 states the 15 km/h forest cap on R, not only on the amplified part |
| D5 | Forest ROS model | Vesta 2012 (AFDRS at launch), Vesta Mk2, McArthur Mk5 | **Vesta Mk2 primary**; Vesta 2012 and Mk5 available as comparison models | Mk2 is the current model and exposes phases (the "why" engine) (doc 03 §1) |
| D6 | Mk2 FL input | "FL_s" | **FL = surface + near-surface load** (availability NOT applied to the load — see D8) | PyroPy_2 docstring (doc 05 §3.4 "definition trap"); UNVERIFIED |
| D7 | Mk2 phase mixing | coded form (weights sum > 1) vs normalised | **Coded form** default; `mixing:'normalised'` switch | Parity with NSW RFS tools (doc 03 §3.5) |
| D8 | Dry-forest fuel availability | AFDRS 2022 linear `0.1·DF` vs Mk2 logistic | **Mk2 logistic** `FA = 1.008/(1+104.9·e^(−0.9306·DF))` inside the Mk2 path; `0.1·DF` only in the Vesta 2012 / AFDRS-parity path | Each model with its own availability (doc 04 §3.2 correction 1). FA multiplies the *moisture effect* (FME = φ_M·FA), not the loads, in Mk2 |
| D9 | Wet-forest availability constant | −0.175 (Vesta2.bas) vs −0.0175 | **−0.0175**; `FA_wet = logistic_Mk2(C1(KBDI,WRF)·DF)` | −0.175 makes availability fall with drought (doc 03 §3.5, doc 05 §3.4). No extra `min(…,0.1·DF)` in the Mk2 path |
| D10 | Topography in wet-forest availability | C1 has no slope term (C2 = TODO everywhere) | **TPI/aspect blend** (§5.9); the ridge WRF reduction is **not** applied to the wetForest family | AFDRS-RP §10.1 under-prediction on ridges (doc 03 §2.4, §3.14) [H]; applying both would count the ridge effect twice (lower WRF raises C1). Do *not* invent a C2 (doc 05 §2.8) |
| D11 | P3 gate | `R2 < 0.3` km/h (PyroXL, ineffective) vs `R2 < 300 m/h` | **300 m/h** | Docstring intent; PyroPy2 (doc 03 §3.5) |
| D12 | Heath model | FBI-TG v1.0 Anderson + damping vs 2024 refit | **2024 refit default**, v1.0 selectable; show the spread | PyroXL change log 2024-02-15: refit is operational (doc 03 §3.8) |
| D13 | Eaten-out grass < 5 km/h | FBI-TG `0.054+0.209U` (discontinuous) vs Spark `0.027+0.1045U` | **Spark continuous** | Avoids a ×2 jump as wind drops through 5 km/h (doc 03 §3.7) |
| D14 | FBI tables | FBI-TG v1.0 vs PyroXL 2024 (grass 100/3000, heath ROS-based) | **FBI-TG v1.0** default; PyroXL tables as data variant | Published document (doc 03 §3.11) |
| D15 | FHS from fuel age | `fl_to_fhs(load)` vs LUT FHS maxima on the Olson curve | **LUT maxima × Olson** (§4.5), per class (§4.2); `fl_to_fhs` only for user-entered loads | PyroXL change log 2024-10-11; near-surface FHS differs ×2.9 (doc 05 §3.3) |
| D16 | Olson residual `c` | NSW LUT column `c` meaning unknown | **Ignore `c`** (X(0) = 0 after a full-reset fire); prescribed burns use the residual form with patchiness | Operational PyroXL `fuel_amount` has no residual (doc 05 §2.2) |
| D17 | Dead fuel moisture model | doc 03: Vesta per cell with period chosen per cell from insolation; doc 04: physical EMC + time lag calibrated to Vesta | **Vesta-anchored anomaly model** (§5.3): AFDRS base equation per fuel family with a *domain-level* period, plus a per-cell physical anomaly `E_phys(cell) − E_phys(family reference)`, plus time lag, rain and dew memory | Keeps AFDRS parity on flat ground, makes aspect/shade/canopy effects physical, and avoids double counting aspect through both the period and the anomaly |
| D18 | Drought factor | Noble 1980 vs Griffiths 1999 + Finkele limit | **Griffiths + Finkele x_lim** (BoM operational); Noble kept for comparison | Doc 04 §3.9 |
| D19 | KBDI cold days and spin-up | xclim (ET < 0 allowed) vs NCAR (dK = 0 if Tmax < 10 °C) | **dK = 0 if Tmax < 10 °C; ET ≥ 0; always two passes over the 365-day history** | Doc 04 §3.9 [H]; one pass from K = 0 under-reads dry sites by up to 4.6 mm (gospers) |
| D20 | Fire shape with slope | doc 01: invert the wind function for an effective wind; rev. 1: ellipse × `SF(θ_n)/SF(θ_e)` | **LB from the wind component along the head axis; the normal speed is a convex offset ellipse built from three speeds** R_H (head), R_B (back), R_F (flank), each with its own directional slope (§7.4) | A level set propagates the Wulff shape of its speed function: the rev. 1 multiplier was non-convex and cut the head extent to 0.96/0.76/0.55 of R_H at 20/30/40° calm and 0.51 at LB 2.55 on 20° (review, measured). The support function of an ellipse is convex, so R_H, R_B, R_F are reproduced exactly |
| D21 | LB and Mk2 low-wind jumps | grass 1 → 2.32 at 5 km/h; forest 1 → 1.195 at 5 km/h; Mk2 R1 ×2–3.5 at u = 2 km/h | **Ramps** `1 + (f(U) − 1)·clamp((U−2)/3, 0, 1)` for grass and forest LB; Mk2 R1 slope term × `clamp(u − 2, 0, 1)` | Smooth animation and CFL (doc 03 §3.10) [H]; verified vectors unaffected |
| D22 | VLS trigger | doc 01 logistic score (θ 20°, Δ 40°, U 25 km/h, I > 4000 kW/m) vs doc 02 smoothstep score | **Doc 02 score** with the wind edges **smoothstep(3.5, 6.5 m/s) on U_ridge (D42)**; activation by the upwind intensity (§7.9) | Doc 02's own note wanted 0.5 at 5 m/s; `smoothstep(4,7,5) = 0.26`, `smoothstep(3.5,6.5,5) = 0.5`. Lee-slope cells back against the eddy (I ≈ 200 kW/m), so the intensity test must look at the fire arriving over the crest |
| D23 | VLS lateral rate | doc 01: 3–10 × flank ROS; doc 02: 0.4–5 km/h, mean ≈ 2 km/h, 10–15 min pulses | **Doc 02 absolute rates**, pulse amplitude 0.8 | Matches observed 1.9 km/h mean (Airport Fire, doc 02 §2.6); amplitude 0.8 spans 0.4–5 km/h |
| D24 | Lee-separation slope | 18° (doc 01), 20° (doc 02), 15–20° (doc 06) | **smoothstep(15°, 25°)**, 0.5 at 20° | Midpoint of the verified "≈ 20°" (Wood 1995 via Sharples 2012) |
| D25 | Lee-eddy reversed wind | 0.2–0.4 (01), 0.2–0.5 (02), 0.3 (06) | **0.3 × U_ridge, upslope** | Common value |
| D26 | Thermal-belt band | ±50 m (01), 50–100 m (02), ±100 m (07) | **\|hav − h_inv\| ≤ 75 m** (height above the valley floor vs the inversion top) | Midpoint [H] |
| D27 | Heat release | WRF `(1−bmst)` on wet mass | **Q = χ_c·H·dw_dry/dt**, χ_c = 0.85, H = 18.6 MJ/kg, no `(1−bmst)`; χ_c also applies to Briggs, PFT and the ember plume flux | Australian loads are oven-dry (doc 07 §5.1) |
| D28 | Intensity fuel | doc 03 §4.1 phase mapping vs PyroXL flame-height gating | **PyroXL gating** (elevated added when FH > 1 m, 0.5·canopy when FH > 0.66·H_o,eff; surface capped at 10 t/ha; all × FA) | Verified code (doc 05 §2.1); bark excluded from intensity, used for embers |
| D29 | Spotting distance fit | non-monotonic below ~1000 m/h | **Monotone envelope** (§6.10) | Doc 06 §3.6 [A] |
| D30 | Atmosphere wind for ROS | model 10 m wind inside canopy; rev. 1 open log law from z_ref | **`U10_fire = ‖U(z_ref)‖·κ(z_ref)`, κ(z) = ‖u_prof(10 m)‖/‖u_prof(z)‖** from the grid-point background profile (§8.8) | Rev. 1 inflated flat-ground wind by 8–15 % at the median and 27–47 % at P90 (stable nights) against the forecast (fixture profiles U80/U10 1.50–1.59, ERA5 U100/U10 1.72), which also broke AFDRS parity. κ reproduces the forecast U10 exactly on flat ground |
| D31 | Double counting of fire wind; the coupling slider | — | `U_fire = U_bg + (U_dyn − U_bg)·[(1 − m_f) + c_f·m_f]`, `m_f` > 0 for any fire (§8.8); **c_f = 0 = one-way coupling** (no fire heat to the atmosphere, U_fire = U_dyn) | Fire-influence mask keeps thermal (diurnal) flows independent of the slider (doc 07 §4.2 refined) [H]; rev. 1's 50 MW gate made the slider inert for small fires |
| D32 | Pyrogenic potential | on/off unclear | **Off when the 3-D atmosphere runs; on in the fast tier with c_p = c_f**, head-opposing component removed | Doc 07 §4.2; the empirical head ROS already contains the near-field indraft (review) |
| D33 | Card thresholds that overlap (S02 vs doc 01 card 3, etc.) | 24°/100 m vs 22°/60 m | One registry (§10.2); attachment uses the §7.6 logistic centred at 22°, card fires at A ≥ 0.5 | Doc 10 §11 item 16 asked for harmonisation |
| D34 | Weather model choice | ARCHITECTURE lists BOM ACCESS-G; model id `ncep_gfs_global` (doc 08) vs `gfs_seamless` (doc 08b) | **Never depend on ACCESS-G** (all-null live, doc 08b §5). Surface: Open-Meteo `best_match` (verified complete) then `ecmwf_ifs`; profile fallback `ecmwf_ifs025`, then **`gfs_seamless`** (the id doc 08b sent live); past: `historical-forecast` `ecmwf_ifs`, ERA5 archive before 2016 [H] | Doc 08b is authoritative over 08 |
| D35 | SVTM layer ids | doc 08: 0 = labels, 3 = formation | **REST layer 3 = the only vector layer** (PCT polygons with `vegClass`, `vegForm`) | Doc 08b §4 (live) |
| D36 | RFS feed CORS | doc 08 "no CORS" | **ACAO: \*** (live) — fetch directly, keep native fallback | Doc 08b §8 |
| D37 | Physics clock | clock hours (PyroXL) vs solar | **Local mean solar time** (§0.2) | [H] |
| D38 | Psychrometer | UI: A = 6.62e−4; doc 04: A = 6.53e−4(1+9.44e−4 T_w), Magnus + f(p) | **A = 6.53e−4·(1 + 9.44e−4·T_w) K⁻¹ with Bolton e_s and station pressure** | Verified KNMI form (doc 04 §3.10); difference < 0.5 RH points |
| D39 | Belt-kit wind height | — | 2 m reading → 10 m open: ×1.25 open, ×1.67 woodland, ×2.4 forest | FBI-TG Table 3.4 10:8 / 10:6 / 10:4.2 (doc 03 §2.2) [V] |
| D40 | Missing fire record | "long unburnt" (08), steady state (05), 25 yr (AFDRS) | Steady state (t = ∞), `timeSinceFire = NaN`, flagged | Same result as 25 yr for litter; honest in the UI |
| D41 | Which model feeds the displayed FBI / rating | Mk2 (spread model) vs AFDRS operational | **AFDRS-parity path**: Vesta 2012 (FA = 0.1·DF) for forest, CSIRO grass, heath 2024, pine, with AFDRS moisture (M_A) and flat ground; the spread itself uses Mk2 | The FBI is an AFDRS product; Mk2 phase 3 rates a 36 °C/12 %/40 km/h day FBI 114 where AFDRS-parity gives 75 (Extreme), matching the preset chip |
| D42 | Ridge wind U_ridge and lee separation | "profile speed at z_crest + 50 m" (AGL at the crest or ASL on the grid-point profile?); separation edge 3–5 m/s vs doc 02 "> 20–25 km/h", doc 01 15 km/h | **U_ridge(k) ≡ ‖U_bg10‖ at the crest cell of crest(k)** (10 m open-equivalent background wind, no fire); domain value = median over ridge cells; **s_sep wind edge smoothstep(4.2, 6.9 m/s)** (0.5 at 20 km/h) | The literature thresholds are 10 m values; the ASL reading was ≈ 385 m AGL at Katoomba and made every lee slope "windy" |
| D43 | Air-temperature lapse rate | 6.5 K/km (doc 04 §4.2) vs 9.8 K/km in the daytime mixed layer (doc 02 §4.3) | **Γ = 6.5 + 3.3·smoothstep(5°, 15°, h_sun)·smoothstep(0.75·relief, 1.25·relief, BLH) K/km** (BLH ?? 1500 m by day) | Dry-adiabatic mixing by day when the mixed layer spans the relief; 1.5 K difference across Katoomba's 450 m |
| D44 | Mk2 no-wind rate | §6.2 "R0 = R1 at U = 0" vs §7.3 "kernel ROS at U = 0" | **R0 ≡ 30·FME m/h** (R1 at u ≤ 2); the flat head `R_w = max(kernel, R0)` | The coded mixing at U = 0 with heavy litter gives P2 ≈ 0.5–0.9 and R2(0) = 0, so the kernel returns 2.7–10 m/h, and w⃗ = (R_w − R0)û would point upwind in calm cells |
| D45 | "Why" factor decomposition | fuel = base/base_generic (always 1 for Mk2, whose R(U = 0) does not depend on load) | **Generic-fuel reference** (§6.12): wind and fuel factors evaluated at the cell's wind | Makes the Fuel driver and the recent-burn explanation work for forest |
| D46 | Preset reference elevation | undefined; physics review: sea level; implementability review: domain median | **`sourceElevation` = domain median elevation**; preset upper air forced non-superadiabatic (§11.3) | The preset's stated temperature is what a user at the site sees and the chip FBI is evaluated there; the column fix removes the superadiabatic layer that caused NaN stability and wrong C-Haines |
| D47 | Forest moisture period 1 window | 12 ≤ LMST < 18 (rev. 1) vs FBI-TG 12:00–17:00 | **12 ≤ LMST < 17** | FBI-TG eq 3.48 (doc 03 §3.2, doc 04 §3.2) |
| D48 | Hourly-mean radiation timing | evaluate at t (rev. 1 §12.2) vs t − 30 min (§11.2) | **Clearness index** `k_t = GHI_hour/GHI_clear(t_mid)` stamped at the hour mid-point, interpolated, `ghi(t) = k_t(t)·GHI_clear(t)` | No half-hour shift of slope contrasts; well-behaved at sunrise/sunset |
| D49 | Night cold pool | on/off template (rev. 1) | **Continuous state Δθ(t)** from `stableNight()` (§5.2a), shared by moisture, atmosphere, fast-tier winds and cards | Rev. 1 jumped 5–6 K at sunrise or at U10 = 4 m/s, had no inversion for morning starts, and used different gates in the cards |
| D50 | Surface heat flux shortwave | Holtslag `990 sin ψ − 30` × cloud (WindNinja) on `direct/1353` | **Q_sw = insolation().total** (slope, cast shadow, sky view, diffuse and cloud already applied) | `direct` is already the attenuated, cloud-adjusted beam: rev. 1 applied attenuation twice (−34 % at 60° sun) and dropped diffuse |
| D51 | Canopy roughness in the atmosphere | WindNinja fixed trees z₀ 1 m, d 12 m, `max(z₁ − d, 2z₀)` | **z₀ = 0.1·H̄, d = 0.67·H̄** from the fuel map canopy height; `z_eff = max(z₁ − d, 10·z₀)`, C_D ≤ 0.030 | Rev. 1 gave C_D = 0.333 (drag time ≈ 15 s) wherever z₁ < 14 m, i.e. over all forest |
| D52 | Ember emission normalisation | per burning cell × Δx_f (rev. 1: scales with flame depth and grid orientation) | **Per unit front length**: each cell emits its share `Δx_f²/R_k` over its flaming time (§9.2) | Emission independent of τ_f, R and front orientation; reference 324 brands km⁻¹ h⁻¹ at 10 MW/m, BH 3 |

---

## 2. Contract changes

**Ownership.** The sim agent lands this section first, in one commit, before the other agents start: additions to
`src/core/types.ts`, the new files `src/core/physics.ts` (§0.3) and `src/core/simTypes.ts` (shared simulation-state
types, re-exported from `types.ts` with `export * from './simTypes'`), and the protocol changes in
`src/sim/protocol.ts`. Additions are **optional fields** unless marked *changed*, so existing code (UI mocks, render)
keeps compiling. Producers named below **must** populate them; consumers fall back to `FUEL_TYPES[type]` defaults when
a fuel field is absent (helper `fuelParamsAt(fuel, k)` in `fuel/`).

### 2.1 `src/core/types.ts`

```ts
// ── Terrain (producer: scenario/, from the 10 m DEM block-averaged to the fire grid) ───────────────────
export interface Terrain { /* …existing… */
  /** 90th-percentile slope (deg) of the 10 m sub-cells inside each cell (captures cliffs the cell slope smooths). */
  slopeP90Deg?: Float32Array;
  /** Fraction (0–1) of 10 m sub-cells steeper than 60° (cliff). */
  cliffFraction?: Float32Array;
}

// ── Weather (producer: scenario/ weather parser, presets, belt kit) ───────────────────────────────────
export interface WeatherHour { /* …existing… */
  directRadiation?: number;   // W/m², horizontal beam, mean of the preceding hour (Open-Meteo direct_radiation)
  diffuseRadiation?: number;  // W/m², horizontal diffuse, mean of the preceding hour
  /** Clearness k_t = GHI_hour / clear-sky GHI at the hour mid-point, stamped at time − 30 min by the parser (§11.2). */
  clearness?: number;
  vpd?: number;               // kPa (vapour_pressure_deficit), cross-check only
}
export interface WeatherSeries { /* …existing… */
  annualRainfall?: number;    // mm, climatological mean used by KBDI (§5.7)
  rainLast20?: number[];      // daily rain (mm), index 19 = yesterday, for the drought factor (§5.8)
  /** Where pressure levels came from: a model, a designed preset air mass, or synthesis (§8.2). Absent = none. */
  upperAirSource?: 'model' | 'preset' | 'synthetic';
  /** Night cold-pool parameters (presets, user edits); default { dThetaMax: 5, hInv: 150 } (§5.2a). */
  nightTemplate?: { dThetaMax: number; hInv: number };
  warnings?: string[];
}

// ── Fuel ───────────────────────────────────────────────────────────────────────────────────────────
export type FuelFamily = 'vesta2' | 'grass' | 'heath' | 'pine' | 'none';
export type MoistureFamily = 'forest' | 'wetForest' | 'heath' | 'grass' | 'pine' | 'none';
export interface LayerParams { load: number /* steady state t/ha */; k: number /* Olson /yr */ }
export type BarkClass = 'none' | 'smooth' | 'stringy' | 'ribbon' | 'mixed';
export type GrassState = 'natural' | 'grazed' | 'eatenOut';
export interface FuelTypeInfo {       // one row of FUEL_TYPES (§4.1); data lives in fuel/catalogue.ts
  id: FuelType; name: string; family: FuelFamily; moistureFamily: MoistureFamily; afdrsType: string;
  surface: LayerParams; nearSurface: LayerParams; elevated: LayerParams; bark: LayerParams; canopy: LayerParams;
  fhsMax: { surface: number; nearSurface: number; elevated: number };  // steady-state hazard scores 0–4
  nearSurfaceHeight: number; elevatedHeight: number;                     // m
  canopyHeight: number; canopyCover: number; lai: number;               // type defaults (also the H_o,eff floor, §4.7)
  wrf: number;               // Vesta sub-canopy wind reduction factor (u = U10/WRF)
  grassWaf?: number;         // grass family: wind adjustment for grass under trees (1 / 0.5 / 0.3)
  grassStateDefault?: GrassState;
  wetSubmodel: boolean; spotting: boolean; barkClass: BarkClass;
  tfi?: { minSfaz: number; minLmz: number; max: number } | 'avoid';
  flameResidence: number;    // τ_f (s): flaming residence for heat release (§7.5)
  receptivity: number;       // ember-landing receptivity R_fuel (§9.5)
  moistureRefCanopy: number; // c_ref of the family reference column (§5.4)
  colour: string;            // legend colour of the fuel overlay
}
export interface FuelClassInfo {      // one row of FUEL_CLASSES (§4.2)
  id: number; name: string; fuelType: FuelType; lut?: number;
  overrides: Partial<Omit<FuelTypeInfo, 'id'>>;          // incl. family / moistureFamily for classes 35, 39, 48
  curingOffset?: number;                                 // percentage points (class 39: −15)
  moistureOffsetIfKbdiBelow?: { pp: number; kbdi: number };  // class 34: +3 pp while KBDI < 100
  grassState?: GrassState;
}
/** Everything the hot loops need for one fire-grid cell, resolved once at init and after edits (fuel/ fuelParamsAt). */
export interface CellFuelParams {
  type: FuelType; fuelClass: number; family: FuelFamily; moistureFamily: MoistureFamily;
  surfaceLoad: number; nearSurfaceLoad: number; elevatedLoad: number; barkLoad: number; canopyLoad: number; // t/ha
  fhsS: number; fhsNs: number; fhsEl: number; barkHazard: number;
  hNs: number; hEl: number;           // m
  hO: number;                          // canopy height used for drag/display (CHM when present), m
  hOEff: number;                       // max(CHM p90, 0.8·type H_o): intensity gating, crown cards, ember launch, z_ref
  cover: number; lai: number; wrf: number;
  grassState: GrassState; grassWaf: number; curing: number;
  underWoodland: boolean; wetSubmodel: boolean; spotting: boolean; barkClass: BarkClass;
  tauF: number; receptivity: number; cRef: number;
  faBlendW: number;                    // §5.9 topographic blend weight w (wetForest cells), else 0
  moistureOffset: number; flags: number; timeSinceFire: number;
}
export interface FuelMap { /* …existing… */          // grid === terrain.grid (fire grid)
  fuelClass?: Uint8Array;      // index into FUEL_CLASSES (§4.2); 0..12 = generic class of FuelType 0..12
  wrf?: Float32Array;          // wind reduction factor (10 m open → sub-canopy), per cell
  canopyLoad?: Float32Array;   // canopy (overstorey) fine fuel load (t/ha)
  canopyHeightEff?: Float32Array; // H_o,eff (m), §4.7
  flags?: Uint16Array;         // FuelFlag bits
  moistureOffset?: Float32Array; // pp added by the moisture model (FuelEdit.moistureDelta, class 34)
  fireCount30?: Uint8Array;    // recorded fires in the last 30 years
  fireCountTfi?: Uint8Array;   // fires closer than the class TFI minimum to the next fire
  breakWidth?: Float32Array;   // m; > 0 on cells holding a sub-cell fire break (FuelFlag.Road), 0 elsewhere
}
export enum FuelFlag {   // plain enum (Vite/esbuild isolatedModules: no const enum)
  WetSubmodel = 1, PostFire = 2, Stringybark = 4, RibbonBark = 8, WetGullyMinority = 16, NoFireRecord = 32,
  UserEdited = 64, InferredVegetation = 128, UnderWoodland = 256, Cliff = 512, Road = 1024, HeavyFuel = 2048,
}
export interface FireHistoryRecord { /* …existing… */
  endTime?: number;          // unix ms (local end date, 12:00 AEST), §4.4
  season?: number;           // decoded first year of the FireYear season, e.g. 196465 → 1964
  name?: string; areaHa?: number;
  datesKnown?: boolean;      // false when StartDate was null (startTime = season mid-point)
  startDate?: string; endDate?: string;   // local calendar dates 'yyyy-mm-dd' (§0.2)
}
export interface VegetationRecord { /* …existing… */
  fuelType?: FuelType;       // *changed*: optional — fuel/ fills it; data/ does not depend on fuel/
  pctId?: number;            // PCTID
  fuelClass?: number;        // FUEL_CLASSES index resolved by fuel/ mapping
}
/** Compact per-cell fire history the worker needs for setType / setTimeSinceFire edits (§4.8). */
export interface FuelHistoryCompact { recStart: Uint32Array /* nCells + 1 */; recIndex: Uint32Array; tb: Float64Array; kind: Uint8Array }

// ── Fire behaviour I/O ─────────────────────────────────────────────────────────────────────────────
export interface FireBehaviourInput { /* …existing… */
  wrf?: number; kbdi?: number; wetForest?: boolean; fuelClass?: number;
  surfaceLoad?: number; nearSurfaceLoad?: number; elevatedLoad?: number; barkLoad?: number; canopyLoad?: number;
  fuelAvailability?: number; // 0–1 override; absent → computed from DF (and KBDI/WRF if wet)
  slopeDeg?: number;         // directional slope (deg, + upslope) along the spread direction; default 0
  grassState?: GrassState;
  underWoodland?: boolean;   // heath under an overstorey (10 m → 2 m wind factor 0.35 instead of 0.667)
  canopyHeightEff?: number;  // H_o,eff for intensity gating (default: type value)
}
export interface FireBehaviourOutput { /* …existing… */
  ros0?: number;             // no-wind, no-slope ROS R0 for this fuel and moisture (m/s), §6.2
  p2?: number; p3?: number;  // Vesta Mk2 phase probabilities
  moistureFactor?: number;   // φ_M
  fuelAvailability?: number; // FA
  fbi?: number; rating?: string;
  validated?: boolean;       // false outside the model's data range (slope, wind, moisture)
}
export interface SpreadFactors { /* …existing… */
  build?: number;            // build-up fraction 0–1 (§7.8); part of `terrain`
  fireWindShare?: number;    // |U_fireInd| / max(|U_fire|, 0.1)
  direction?: number;        // R(ψ)/R_H of the §7.4 ellipse at the arrival normal (1 at the head)
}

// ── Options and scenario ───────────────────────────────────────────────────────────────────────────
export type QualityTier = 'fast' | 'standard' | 'high';
export interface SimOptions { /* …existing… */
  tier?: 'auto' | QualityTier;   // default 'auto' (§12.6)
  atmosDz1?: number;             // first-level thickness Δζ₁ (m); tier default
}
// *changed* defaults = the standard tier: atmosCellSize 200, atmosLevels 20, atmosDz1 30, tier 'auto'
// (the worker overrides atmosCellSize/atmosLevels/atmosDz1/maxEmbers from the tier table of §12.6).
export interface ScenarioData { /* …existing… */
  terrainHiRes?: { grid: GridSpec; elevation: Float32Array };   // 10 m DEM (render, atmosphere block-averaging)
  fuelHistory?: FuelHistoryCompact;       // fire-grid history for edits (§4.8)
  activeFires?: FireHistoryRecord[];      // fires burning at t0 (§4.4), display only
}

// ── Embers, insights, snapshot ─────────────────────────────────────────────────────────────────────
export interface SpotFire { /* …existing… */
  emberClass?: 'flake' | 'ribbon' | 'leaf' | 'twig' | 'heavy';
  maxHeightAGL?: number; flightTime?: number; landingMoisture?: number; pIgnite?: number;
  sourceX?: number; sourceY?: number; leeEddy?: boolean; ridgeDrop?: number;
}
export interface Insight { /* …existing… */
  confidence?: 'physics' | 'rule-of-thumb' | 'model-estimate' | 'sub-grid';
  showLayers?: string[];     // render layer ids for "Show me" (§10.2 mapping table)
  key?: string;              // detector key `kind:tileX:tileY` or `kind:domain`, stable across snapshots
}
export interface SimSnapshot { /* …existing… */
  /** Extra overlay rasters on the fire grid, keyed by OverlayKind ('vls', 'attach', 'trench', 'dmz', 'landing'). */
  layers?: Record<string, Float32Array>;
}
```

### 2.2 `src/core/simTypes.ts` (new; shared by fire/, atmosphere/, embers/, explain/, sim/ — avoids import cycles)

Type-only imports: `TerrainDerived`, `InsolationResult` from `terrain/` (`import type`, no runtime dependency), `Rng`
from `core/rng`, the rest from `core/types`.

```ts
export interface TerrainFeatures {              // producer: fire/terrainFeatures.ts computeTerrainFeatures()
  flowAcc: Float32Array;       // D8 upslope area (m²) after priority-flood depression filling
  drainage: Uint8Array;        // flowAcc ≥ 5 ha
  trench: Float32Array;        // §7.6 trench score T (0–1)
  gullyAxis: Float32Array;     // up-gully azimuth (deg) on drainage cells and their side walls, NaN elsewhere
  gullyBase: Int32Array;       // per trench cell: index of the lowest cell of its connected T ≥ 0.3 segment, −1 elsewhere
  saddle: Uint8Array;          // Landform.Saddle, or hxx·hyy − hxy² < 0 and slope ≤ 10° and relPos ≥ 0.6 [H]
  ridge: Uint8Array;           // Landform ∈ {Ridge, Peak, Spur} or relPos ≥ 0.9
  cliff: Uint8Array;           // Landform.Cliff, cliffFraction ≥ 0.3 or slopeP90 ≥ 60°
  narrowValley: Uint8Array;    // valley-floor width ≤ 200 m with both walls ≥ 15° within 300 m (S43)
  slope30: Float32Array;       // slope (deg) of the DEM averaged to 30 m (VLS calibration scale)
  valleyDrop: Float32Array;    // m: z_k − z at the end of the D8 steepest-descent path (anabatic Δz, §8.6)
  crestRise: Float32Array;     // m: rise to the local crest along the steepest-ascent path (katabatic Δz, §8.6)
  crestDist: Float32Array;     // m: along-path distance from that crest (katabatic L)
  crest(k: number, windFromDeg: number): { d: number; zCrest: number; relief: number; kCrest: number } | null; // §7.9
}
export interface StableNightInput { time: number /* unix ms */; sunElevation: number; hoursSinceSunrise: number; u10: number /* grid-point m/s */;
  cloudPct: number; rain24: number; breakEta?: number | null /* s, from the 3-D heat deficit */; }
export interface StableNightState { dTheta: number; dThetaAtSunrise: number; tSunrise: number | null; dThetaMax: number; hInv: number;
  gate: number /* 0–1 */; tBreak: number | null /* unix ms */; sn: number /* clamp(dTheta/3 K, 0, 1) */; }
export interface MoistureContext { time: number; lmstHour: number; month: number; sunElevation: number;
  cloudFrac: number; u10: Float32Array /* |U_bg10|, open-equivalent, fire grid */; airT?: Float32Array /* °C at z+2 m,
  from atmosphere when spun up */; burnt: Uint8Array; kbdi: number; df: number; night: StableNightState; }
export interface FireWindContext { sep: Float32Array /* s_sep, fire grid */; frontDist: Float32Array /* m */;
  firePowerW: number; plumeTopAGL: number; slopeFlowOn: boolean; time: number; }
export interface AtmosDiagnostics { spunUp: boolean; synthetic: boolean; upperAirSource: 'model'|'preset'|'synthetic'|'none';
  inversion: { present: boolean; dTheta: number; topASL: number; mixedLayerTopAGL: number; breakEta: number | null };
  cHaines: number | null; pft: number | null; frH: number; nSquared: number;
  plumeTopASL: number; plumeLclASL: number; firePowerMW: number; maxUpdraft: number;
  uRidgeMedian: number; fireInfluence: Float32Array /* m_f, fire grid */; heatFlux: Float32Array /* Q_h W/m², fire grid */;
  slopeFlow: Float32Array /* S_top m/s, fire grid */; kappa: number /* κ(z_ref) of §8.8 */; }
export interface AtmosphereLike {               // implemented by Atmosphere (3-D) and DiagnosticWind (fast)
  setAmbient(a: WeatherHour, b: WeatherHour): void;   // bracketing series stamps; u_bg solved and cached per stamp
  setTime(t: number): void;                           // unix ms: interpolation weight between the stamps
  setSurfaceHeating(sun: InsolationResult, w: WeatherHour, kbdi: number, night: StableNightState): void;
  addFireHeat(fireGrid: GridSpec, heatKwM2: Float32Array, crownShare: Float32Array): void;
  step(dt: number): void;
  maxStableDt(): number;
  sample(x: number, y: number, zAGL: number, out: Float32Array): void;       // out = [u, v, w] (m/s)
  sampleTurb(x: number, y: number, zAGL: number, out: Float32Array): void;   // out = [z_i, w*, u*]
  surfaceWindForFire(fireGrid: GridSpec, outU: Float32Array, outV: Float32Array, outBgU: Float32Array,
    outBgV: Float32Array, outIndU: Float32Array, outIndV: Float32Array, outRidge: Float32Array, ctx: FireWindContext): void;
  airAt(fireGrid: GridSpec, outT: Float32Array, outRho: Float32Array): void; // T (°C) at z_cell + 2 m, ρ (kg/m³)
  view(): AtmosphereView;                   // flat levels (§8.1), see the AtmosphereView note below
  diagnostics(): AtmosDiagnostics;
  readonly spunUp: boolean;
  checkpoint(): unknown; restore(c: unknown): void;
}
export interface SpreadEnvironment {            // built by sim/ each atmosphere step
  windU: Float32Array; windV: Float32Array;       // U_fire, 10 m open-equivalent (m/s), fire grid
  windBgU: Float32Array; windBgV: Float32Array;   // U_bg10 (no fire terms)
  fireIndU: Float32Array; fireIndV: Float32Array; // U_fireInd = c_f·m_f·(U_dyn10 − U_bg10) or c_p·∇ψ (fast)
  uRidge: Float32Array;                           // per cell (m/s), NaN where crest(k) is null (D42)
  moisture: Float32Array; availability: Float32Array; fuelTempC: Float32Array;
  airT: Float32Array; airRho: Float32Array;       // for N_c
  droughtFactor: number; kbdi: number; weather: WeatherHour; time: number;
  sunElevation: number; lmstHour: number; cloudFrac: number;
  mountainPhenomena: boolean; pyrogenicOn: boolean; coupling: number;
}
export interface FireAux { vls: Float32Array; vlsActive: Uint8Array; sep: Float32Array; attach: Float32Array /*A·E*/;
  junction: Float32Array; build: Float32Array; heatFlux: Float32Array; frontDist: Float32Array;
  nc: Float32Array /* N_c per front cell, 0 elsewhere */; cfb: Float32Array /* pine */; direction: Float32Array;
  debris: { path: Float32Array; t: number }[]; front: Int32Array; frontNormalX: Float32Array;
  frontNormalY: Float32Array; headIndex: number; leftDomain: boolean; }
export interface CellEvaluation { ros: number; rH: number; rB: number; rF: number; headDir: number; lb: number;
  intensity: number; flameHeight: number; phase: number; factors: SpreadFactors; driver: SpreadDriver; validated: boolean; }
export interface LandingInfo { moisture: number; fuelType: FuelType; burnable: boolean; burnt: boolean;
  fuelTempC: number; surfaceHazard: number; nearSurfaceHazard: number; family: FuelFamily; curing: number;
  bedWindMs: number /* U10/(2·wrf), the moisture u_f */; distToFront: number; frontDirX: number; frontDirY: number;
  rosLocal: number /* m/s */; }
export interface SpotProvenance { sourceCell: number; emberClass: 'flake' | 'ribbon' | 'leaf' | 'twig' | 'heavy';
  emitTime: number; maxHeightAGL: number; flightTime: number; distance: number; meanWindAloft: [number, number];
  landingState: 'flaming' | 'glowing' | 'reflamed' | 'holdover'; landingMoisture: number; pIgnite: number;
  landingSlope: number; landingAspect: number; leeEddy: boolean; ridgeDrop: number; convectiveNumber: number;
  sourceClass: 'ridge' | 'windward' | 'leeward' | 'valley'; }
export interface EmberStats { active: number; leftDomain: number; landings10min: number; ignitions10min: number;
  shortRange10min: number; maxIgnitableDistance10min: number; beyondEdgeHistogram: Float32Array /* 1 km bins to 30 km */;
  ignitionCapableShare: number; }
export interface SimStateView { time: number; terrain: Terrain; derived: TerrainDerived; features: TerrainFeatures;
  fuel: FuelMap; fire: FireField; aux: FireAux; moisture: Float32Array; moistureAfdrs: Float32Array;
  moistureAnomaly: Float32Array; availability: Float32Array; windU: Float32Array; windV: Float32Array;
  windBgU: Float32Array; windBgV: Float32Array; fireIndU: Float32Array; fireIndV: Float32Array; uRidge: Float32Array;
  surfaceHeatFlux: Float32Array; slopeFlowS: Float32Array; airT: Float32Array; airRH: Float32Array;
  weather: WeatherHour; series: WeatherSeries; droughtFactor: number; kbdi: number; sunElevation: number;
  lmstHour: number; cloudFrac: number; night: StableNightState; spotFires: SpotFire[]; emberStats: EmberStats;
  atmosDiag: AtmosDiagnostics; atmosphere?: AtmosphereView; tier: QualityTier; coupling: number;
  factorsAt(k: number): SpreadFactors; evaluateCell(k: number): CellEvaluation; }
```

`AtmosphereView` (existing contract, **meaning kept**): `view()` resamples the terrain-following solver fields to the
**flat** levels `levels[k]` = heights above `z_min` of the terrain-following levels of the lowest column (§8.1),
sets wind, θ′ and smoke to 0 below the terrain, and interpolates MAC face velocities to cell centres. This is what
`src/render/atmosphereSampler.ts` already assumes. Solver internals stay terrain-following.

### 2.3 Protocol, entry points and render

`src/sim/protocol.ts`:
```ts
ToWorker   += | { type: 'setQuality'; tier: QualityTier }             // recorded as an edit at the current sim time
setOption key: 'coupling' | 'embers' | 'mountainPhenomena' | 'maxEmbers'  // *changed*: add 'maxEmbers'
FromWorker += | { type: 'rewound'; time: number }   // UI drops insights and spot fires with time > rewound.time
SimController += setQuality(tier: QualityTier): void;   SimEvents += rewound: (time: number) => void;
```
Entry points the UI loads (`src/ui/modules.ts`): `src/scenario/index.ts` exports
`buildScenario(req: ScenarioRequest, onProgress: (p: BuildProgress) => void, signal?: AbortSignal): Promise<ScenarioData>`;
`src/sim/index.ts` exports `class SimClient implements SimController` (spawns `new Worker(new URL('./worker.ts',
import.meta.url), { type: 'module' })`); the worker entry is `src/sim/worker.ts`. `scenario/request.ts`:
`BuildProgress.step` gains `'drought'`.

`src/render/layers.ts` (render owner): `OverlayKind` gains `'vls' | 'attach' | 'trench' | 'dmz' | 'landing'`, drawn
from `SimSnapshot.layers[kind]` when present.

### 2.4 Module signatures (supersede ARCHITECTURE.md where they differ; update ARCHITECTURE when implementing)

```ts
// fuel/
export const FUEL_TYPES: Record<FuelType, FuelTypeInfo>; export const FUEL_CLASSES: FuelClassInfo[];
export function svtmToClass(vegForm: string, vegClass: string, elevationM: number): number;   // 255 = infer
export function rasteriseVegetation(grid: GridSpec, recs: VegetationRecord[], terrain: Terrain):
  { classId: Uint8Array /*255 = none*/; minorityWet: Uint8Array };
export interface HistoryRaster { timeSinceFire: Float32Array; lastFireKind: Uint8Array; fireCount30: Uint8Array;
  fireCountTfi: Uint8Array; compact: FuelHistoryCompact; included: FireHistoryRecord[];
  activeFires: FireHistoryRecord[]; warnings: string[]; }
export function parseFireHistory(geojson: unknown): FireHistoryRecord[];                        // §4.4
export function rasteriseFireHistory(grid: GridSpec, recs: FireHistoryRecord[], t0: number): HistoryRaster;
export function buildFuelMap(args: BuildFuelArgs): FuelMap;                                      // §4.7
export function fuelParamsAt(fuel: FuelMap, k: number): CellFuelParams;
export function applyFuelEdit(fuel: FuelMap, edit: FuelEdit, base: FuelMap, history: FuelHistoryCompact, t0: number): number;
// fuel/moisture + drought
export function droughtFactor(kbdi: number, rainLast20: number[], rainTodayMm?: number): number;  // §5.8
export function kbdiSeries(daily: DailyWeather[], annualRainfall: number): number[];             // two passes, §5.7
export function kbdiFromDf(df: number): number;                                                  // §11.5
export class MoistureModel {
  constructor(terrain: Terrain, fuel: FuelMap, derived: TerrainDerived, opts?: Partial<MoistureParams>);
  initialise(series: WeatherSeries, t0: number, drought: { kbdi: number; df: number }, night: StableNightState): void;
  update(w: WeatherHour, sun: InsolationResult, dtSeconds: number, ctx: MoistureContext): void;
  readonly field: Float32Array; readonly afdrs: Float32Array; readonly anomaly: Float32Array;
  readonly fuelTemp: Float32Array; readonly airT: Float32Array; readonly airRH: Float32Array;
  readonly availability: Float32Array;       // FA per cell (§5.9)
  checkpoint(): unknown; restore(c: unknown): void;
}
// fire/
export function fireBehaviour(input: FireBehaviourInput): FireBehaviourOutput;       // object API (§6.1)
export function headRosKernel(p: CellFuelParams, u10kmh: number, mPct: number, fa: number, out: HeadKernelOut): void;
export function afdrsFbi(fuelType: FuelType, w: WeatherHour, lonDeg: number, df: number, kbdi: number): { fbi: number; rating: string; intensity: number };
export class FireSpreadModel {
  constructor(terrain: Terrain, fuel: FuelMap, features: TerrainFeatures, opts: SimOptions, rng: Rng);
  ignite(ign: Ignition): void; igniteAt(x: number, y: number, time: number, driver?: SpreadDriver): boolean;
  refreshMoistureCache(env: SpreadEnvironment): void; refreshMasks(env: SpreadEnvironment): void;   // sep, VLS, frontDist
  prepare(env: SpreadEnvironment): void; step(dt: number, env: SpreadEnvironment): void; minuteTasks(env: SpreadEnvironment): void;
  maxStableDt(): number; readonly field: FireField; aux(): FireAux; ageAt(k: number): number;
  heatRelease(): Float32Array; crownShare(): Float32Array; frontCells(): Int32Array; firePowerW(): number;
  factorsAt(k: number): SpreadFactors; evaluateCell(k: number, env: SpreadEnvironment): CellEvaluation;
  checkpoint(): unknown; restore(c: unknown): void;
}
// atmosphere/
export class Atmosphere implements AtmosphereLike { constructor(terrain: Terrain, hiRes: ScenarioData['terrainHiRes'],
  fuel: FuelMap, features: TerrainFeatures, tier: QualityTier, extent: number, series: WeatherSeries, rng: Rng); }
export class DiagnosticWind implements AtmosphereLike { /* same constructor */ }
// embers/
export class EmberModel {
  constructor(terrain: Terrain /* fire grid */, fuel: FuelMap, opts: { maxEmbers: number; tier: QualityTier }, rng: Rng);
  emit(fire: FireField, fuel: FuelMap, burning: Int32Array, dt: number, time: number, aux: FireAux): void;
  step(dt: number, wind: (x: number, y: number, zAGL: number, out: Float32Array) => void,
       turb: (x: number, y: number, zAGL: number, out: Float32Array) => void,
       landing: (x: number, y: number) => LandingInfo,
       onIgnite: (x: number, y: number, travel: number, prov: SpotProvenance) => void): void;
  particles(): EmberParticles; stats(): EmberStats; overlays(): { landing: Float32Array; ignitions: Float32Array };
  checkpoint(): unknown; restore(c: unknown): void;
}
// explain/
export class InsightEngine {
  constructor(terrain: Terrain, derived: TerrainDerived, fuel: FuelMap, features: TerrainFeatures);
  update(s: SimStateView): Insight[]; explainAt(x: number, y: number, s: SimStateView): CellExplanation;
  forecastInsights(series: WeatherSeries, start: number, duration: number, lonDeg: number): Insight[];
  checkpoint(): unknown; restore(c: unknown): void;
}
```

---

## 3. System overview: what is computed where and how often

| Cadence (simulated) | Computation | Owner |
|---|---|---|
| once per scenario | fire-grid terrain from the 10 m DEM, terrain derived fields, `TerrainFeatures` (incl. trench, slope-flow geometry), fuel map, fire-cell static cache, atmosphere grid + multigrid, sky-view | scenario/, terrain/, fuel/, fire/spread, atmosphere/ |
| once per scenario + on edit | fire-cell static cache (`CellFuelParams`) | fire/spread |
| each weather-series stamp (hourly; 10 min inside preset change ramps) | background profile, mass-consistent `u_bg` for the new stamp (cached pair, linear in time between stamps) | atmosphere/ |
| every atmosphere step | `stableNight()` state, κ(z_ref), interpolated ambient | sim/, atmosphere/ |
| 600 s | insolation (terrain), moisture update, surface heat flux, per-cell R0/FME cache | sim/ → terrain/, fuel/moisture, atmosphere/, fire/spread |
| on 22.5° wind-sector change | crest search for the current sector, lee-separation & VLS masks | fire/spread |
| Δt_a (3–12 s) | atmosphere step, surface wind for fire, `prepare` (unburnt band cells with 0 < φ ≤ 4Δx), ember step, fire heat aggregation | atmosphere/, fire/spread, embers/, sim/ |
| Δt_f (≤ Δt_a, CFL) | level-set sub-steps, arrival times, heat release | fire/spread |
| 10 fire steps | narrow-band reinitialisation | fire/spread |
| 60 s | insight detectors, junction detection, rolling debris, front distance transform | explain/, fire/spread |
| 300 s (`snapshotInterval`) | snapshot, stats | sim/ |
| 1800 s | checkpoint (plus the permanent t0 checkpoint) | sim/ |

Coupling order inside one atmosphere step is fixed in §12.2. Never reorder it; the determinism test (§15 V18)
depends on it.

---

## 4. `fuel/` — catalogue, vegetation mapping, fire history, accumulation, edits

### 4.1 Fuel-type catalogue `FUEL_TYPES: Record<FuelType, FuelTypeInfo>` (P0)

`FuelTypeInfo`, `LayerParams`, `FuelFamily`, `MoistureFamily` are core types (§2.1). Loads are **steady-state fine
fuel** (t/ha, oven-dry). Values are the NSW RFS fuel LUT v4.02 rows named (doc 05 §3.2, [V] as parsed from PyroXL)
unless tagged; bark FHS is derived from the bark load by the step table of §4.5.

| FuelType | family / moisture | LUT row (source) | surface load/k | near-surf. | elevated | bark | canopy | FHS s/ns/el max | H_ns / H_el m | H_o m, cover, LAI | WRF (grassWaf) | wet | spot / bark | TFI min SFAZ/LMZ/max | τ_f s | R_fuel | c_ref | colour |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| NonFuel | none | — | 0 | 0 | 0 | 0 | 0 | 0/0/0 | 0/0 | 0, 0, 0 | — | – | – | – | – | 0 | 0 | `#9e9e9e` |
| Water | none | — | 0 | 0 | 0 | 0 | 0 | 0/0/0 | 0/0 | 0, 0, 0 | — | – | – | – | – | 0 | 0 | `#3b7dd8` |
| Grassland | grass / grass | 58 Native grasslands (total 5.1, k 0.9) | 1.0/0.9 | 4.1/0.9 | 0 | 0 | 0 | 1/3/0 [H] | 0.30/0 [H] | 0, 0, 0 | 1.2 (1.0) | – | no / none | 2/3/10 | 10 [H] | 1.0×curing | 0 | `#e3c565` |
| GrassyWoodland | grass / grass | 38 S. tableland grassy woodlands | 8/0.4 | 2/0.4 | 0.5/0.2 | 2.11/0.1 | 4.5/0.3 | 3.0/2.6/2.2 | 0.20/1.0 [H] | 15, 0.3, 1.0 | 2.5 (0.5 if cover < 0.3 else 0.3) | – | yes / mixed | 5/8/40 | 15 [H] | 0.9 | 0.3 | `#b9c46a` |
| DryForestShrubby | vesta2 / forest | 30 Sydney montane DSF | 14.5/0.17 | 1.9/0.17 | 4.9/0.2 | 2.67/0.1 | 3.5/0.3 | 3.4/2.9/3.3 | 0.20/2.0 | 20 [H], 0.6, 1.5 | 3.5 | – | yes / stringy | 7/10/30 | 45 [H] | 1.0 | 0.6 | `#6b8e3a` |
| DryForestGrassy | vesta2 / forest | 16 Central gorge DSF, ns/FHS blended with 32 [H] | 11/0.3 | 2.0/0.3 [H] | 2/0.2 | 3.0/0.1 | 4.5/0.3 | 3.0/2.8/2.0 [H] | 0.25/1.0 [H] | 20, 0.5, 1.2 | 3.0 | – | yes / mixed | 5/8/50 | 40 [H] | 1.0 | 0.5 | `#9aa84a` |
| WetForest | vesta2 / wetForest | 5 Southern escarpment WSF | 17/0.35 | 2/0.35 | 3/0.15 | 4.0/0.1 | 6.9/0.35 | 3.7/3.0/3.1 | 0.20/2.0 | 35 [H], 0.8, 2.5 | 4.5 | yes | yes / mixed | 25/30/60 | 60 [H] | 0.5 | 0.8 | `#2f7a4f` |
| Rainforest | vesta2 / wetForest | 1 Rainforests | 8/0.75 | 1/0.75 | 1/0.3 | 1/0.1 | 8/0.3 | 2.8/2.4/2.6 | 0.20/2.0 | 30, 0.95, 4.0 | 5.0 | yes | no / smooth | avoid | 60 [H] | 0.2 | 0.95 | `#1b4d3e` |
| Heath | heath / heath | AFDRS-RP generic heath (total 20, k 0.2, H_el 1.3) [V]; layer split [H] | 5/0.2 | 5/0.2 | 10/0.2 | 0 | 0 | 2.0/3.5/4.0 [H] | 0.40/1.3 | 3, 0.1, 0.5 | 1.5 | – | no / none | 7/10/30 | 20 [H] | 0.7 | 0 | `#b07aa1` |
| AlpineHeathGrass | heath / heath | 44 Montane & alpine heath (total 12.6, k 0.1, H_el 1.0) | 3/0.1 | 4.6/0.1 | 5/0.1 | 0 | 0 | 2/3/3 [H] | 0.30/1.0 | 0, 0, 0.3 | 1.5 | – | no / none | avoid | 15 [H] | 0.6 | 0 | `#c9a0dc` |
| SnowGumWoodland | vesta2 / forest | 39 Subalpine woodlands | 15/0.3 | 1/0.3 | 2/0.2 | 1.0/0.1 | 6.8/0.3 | 3.3/2.8/2.8 | 0.20/2.0 | 12 [H], 0.5, 1.2 | 2.5 | – | yes / smooth | 5/8/40 | 40 [H] | 0.9 | 0.5 | `#7fb3a3` |
| PinePlantation | pine / pine | no LUT row read [H] | 10/0.2 | 2/0.2 | 2/0.2 | 1/0.1 | 10/0.1 | 3.5/2.0/2.0 | 0.10/1.0 | 20, 0.8, 3.0 (CBH 8 m) | 4.0 | (pine FA uses wet C1, §5.9) | yes / mixed | – | 45 [H] | 0.9 | 0.8 | `#3e5f2b` |
| Urban | grass (eatenOut, waf 0.3) / grass | AFDRS urban → eaten-out grass (doc 03 §3.11) [V]; loads [H] | 2/0.5 | 1/0.5 | 1/0.2 | 0 | 2/0.3 | 1/1/1 | 0.10/1.0 | 8, 0.3, 1.0 | — (0.3) | – | no / none | – | 30 [H] | 0.3 | 0.3 | `#d17c5e` |

Notes. (1) Heath and AlpineHeathGrass use **total fine load** (s + ns + el) in the heath model; the layer split is
only for display and edits. (2) Canopy k for forests is the AFDRS-RP generic 0.3 (wet 0.35) [V doc 03 §3.4].
(3) Heights are held **constant with time since fire** (operational practice, doc 05 §3.1) except under the
post-fire regime (§4.5). (4) Canopy height/cover come from the CHM when present (§4.7); the table value is the
fallback. The Meta CHM reads low in tall eucalypt forest (doc 08 §7 item 8; demo stats: DSF median p90 13–16 m,
WSF 17–20 m), so the CHM height never *chooses* the canopy load and never gates canopy involvement on its own
(H_o,eff, §4.7).

### 4.2 Fuel classes and SVTM mapping `FUEL_CLASSES`, `svtmToClass()` (P0)

A **fuel class** is a NSW LUT-like row that overrides the FuelType defaults. Every cell stores `fuelClass`
(Uint8, index into `FUEL_CLASSES`). Class 0..12 are the generic classes of FuelType 0..12 (the §4.1 rows).
Classes ≥ 13 override only the fields listed; unlisted fields inherit the type row. **FHS maxima are part of every
class that changes loads** (LUT values, so the (FHS, load) pairs stay consistent for Vesta 2012 and H_u).
`family` and `moistureFamily` resolve **from the class** (`FUEL_CLASSES[c].overrides.family ?? FUEL_TYPES[type].family`).

| id | SVTM `vegClass` (exact string, as in the demo data) | FuelType | LUT (doc 05 §3.2) | Overrides |
|---|---|---|---|---|
| 13 | Sydney Montane Dry Sclerophyll Forests | DryForestShrubby | 30 | (= type row) |
| 14 | Sydney Hinterland Dry Sclerophyll Forests | DryForestShrubby | 24 | bark 2.62; H_o 25 |
| 15 | Sydney Coastal Dry Sclerophyll Forests | DryForestShrubby | 24 [H] | bark 2.62 |
| 16 | Sydney Sand Flats Dry Sclerophyll Forests | DryForestShrubby | 24 + bark 0.6, spot 0 [V partial, H] | bark 0.6; spotting false; barkClass smooth |
| 17 | South East Dry Sclerophyll Forests | DryForestShrubby | 27 | s 10/0.19; ns 2/0.19; el 5/0.19; bark 3.4; canopy 2.7; FHS 3.4/3.1/2.5; H_ns 0.32; H_el 1.7; H_o 30 |
| 18 | Southern Tableland Dry Sclerophyll Forests | DryForestShrubby | 32 | s 19/0.15; ns 1/0.15; el 2.5/0.15; bark 2.55; canopy 5.8; FHS 2.8/2.8/2.0; H_ns 0.18; H_el 0.9; WRF 3 |
| 19 | Western Slopes Dry Sclerophyll Forests | DryForestShrubby | 33 | s 12/0.16; ns 0.5/0.16; el 2.5/0.15; bark 0.86; canopy 2.7; FHS 3.2/2.7/3.0; WRF 3; spotting false |
| 20 | Central Gorge Dry Sclerophyll Forests | DryForestGrassy | 16 | ns 1/0.3; FHS 3.1/2.7/2.8 |
| 21 | North-west Slopes Dry Sclerophyll Woodlands | DryForestGrassy | 33 [H] | s 12/0.16; ns 1/0.16; el 2.5/0.15; bark 0.86; FHS 3.2/2.7/3.0; WRF 2.5 |
| 22 | Northern Hinterland Wet Sclerophyll Forests | WetForest | 4 [H] | bark 4.5; H_o 40; **WRF 4.0** (grassy WSF) |
| 23 | North Coast Wet Sclerophyll Forests | WetForest | 4 [H] | bark 4.5 |
| 24 | Northern Escarpment Wet Sclerophyll Forests | WetForest | 4 | bark 4.5 |
| 25 | Southern Escarpment Wet Sclerophyll Forests | WetForest | 5 | (= type row) |
| 26 | South Coast Wet Sclerophyll Forests | WetForest | 5 [H] | — |
| 27 | Southern Lowland Wet Sclerophyll Forests | WetForest | 5 [H] | WRF 4.0 |
| 28 | Southern Tableland Wet Sclerophyll Forests | WetForest | 9 | s 18/0.35; ns 0; el 2/0.15; bark 2.0; canopy 6.8; FHS 3.6/3.0/2.8; **WRF 3.5** |
| 29 | Northern Tableland Wet Sclerophyll Forests | WetForest | 8 | s 18/0.35; ns 0; el 2/0.15; bark 3.43; canopy 6.8; FHS 3.6/3.0/2.8 |
| 30 | Montane Wet Sclerophyll Forests | WetForest | 10 | s 24/0.2; ns 0; el 2/0.15; bark 2.6; canopy 8; FHS 4.0/3.0/2.8; **WRF 3.5**; barkClass ribbon |
| 31 | *any* Rainforest class (Cool Temperate, Dry, Northern Warm Temperate, Southern Warm Temperate, Subtropical, Littoral) | Rainforest | 1 | — |
| 32 | Sydney Montane Heaths | Heath | 43 short heath | total 11.8 k 0.6 (split 3/3.5/5.3); H_el 1.5 |
| 33 | Sydney Coastal Heaths | Heath | 42 tall heath | total 36.9 k 0.07 (split 9/10/17.9); H_el 4.0 |
| 34 | Coastal Heath Swamps (Blue Mountains upland "hanging" swamps) | Heath | wet heath [H] | total 12 k 0.3; H_el 1.0; moistureOffset +3 pp while KBDI < 100 [H] |
| 35 | Montane Bogs and Fens; Alpine Bogs and Fens | AlpineHeathGrass | 56 → AFDRS low wetland = eaten-out grass | family grass, **moistureFamily grass**, grassState eatenOut, total 2.6 k 0.7 |
| 36 | Montane Lakes | Water | — | — |
| 37 | Alpine Fjaeldmarks | AlpineHeathGrass | 45 | total 2.6 k 0.15; H_el 0.25 |
| 38 | Alpine Heaths | AlpineHeathGrass | 44 | (= type row) |
| 39 | Alpine Herbfields | AlpineHeathGrass | 46 → grass model | family grass, **moistureFamily grass** (natural/grazed by load), total 5.8 k 0.2; curing −15 points |
| 40 | Subalpine Woodlands | SnowGumWoodland | 39 | (= type row) |
| 41 | Southern Tableland Grassy Woodlands; Coastal Valley GW; Tableland Clay GW; Western Slopes GW | GrassyWoodland | 38 [H for non-ST] | — |
| 42 | New England Grassy Woodlands | GrassyWoodland | 37 | bark 3.3 |
| 43 | Eastern Riverine Forests; Coastal Floodplain Wetlands | WetForest | swamp/floodplain [H] | WRF 4.0; bark 3.0 |
| 44 | Inland Riverine Forests | DryForestGrassy | [H] | WRF 2.5 |
| 45 | Inland Rocky Hill Woodlands (semi-arid) | GrassyWoodland | [H] | — |
| 46 | Temperate Montane Grasslands (and other grassland classes) | Grassland | 58 | — |
| 47 | *(formation fallback)* Wet Sclerophyll Forests (Grassy sub-formation), generic | WetForest | 4/5 [H] | **WRF 4.0** |
| 48 | *(formation fallback)* Saline Wetlands | Grassland | [H] | grassState eatenOut; family/moistureFamily grass |

**Mapping algorithm** `svtmToClass(vegForm, vegClass, elevationM)` (GeoJSON → `VegetationRecord`: `formation ←
vegForm`, `className ← vegClass`, `pctId ← PCTID`; `fuelType` is filled by fuel/):
1. Exact `vegClass` match in the table (case-insensitive, trimmed) → that class.
2. Else by `vegForm`: `Rainforests` → 31; `Wet Sclerophyll Forests (Shrubby sub-formation)` → 6 (WetForest
   generic); `Wet Sclerophyll Forests (Grassy sub-formation)` → 47; `Dry Sclerophyll Forests (Shrubby
   sub-formation)` → 4; `Dry Sclerophyll Forests (Shrub/grass sub-formation)` → 5; `Grassy Woodlands` → 3;
   `Grasslands` → 46; `Heathlands` → 8; `Alpine Complex` → 38; `Freshwater Wetlands` → 34 if the sub-point
   elevation < 1200 m else 35 [H]; `Forested Wetlands` → 43; `Saline Wetlands` → 48 [H]; `Semi-arid Woodlands (…)`
   → 45; `Arid Shrublands (…)` → 8 [H].
3. `Not classified` or no polygon → 255 → **inference** (§4.3), flag `InferredVegetation`.

All distinct (vegForm, vegClass) pairs in the eight demo files (43; only "Not classified" goes to inference) map (checked). The SVTM-to-LUT join was checked only for
forest/woodland names (doc 05 §2.7); the heath, rainforest, grassland and wetland rows are [H] and need NSW RFS
review (§16).

**Rasterisation** `rasteriseVegetation(grid, recs, terrain)`: sample each fire cell at a 3×3 lattice of sub-points
(offsets ±Δx/3), point-in-polygon with the even-odd rule over all rings of the polygon (holes), evaluate
`svtmToClass` per sub-point with the bilinear terrain elevation there, take the **mode** class (ties → the wetter
FuelType order Rainforest > WetForest > others). `minorityWet = 1` if any sub-point is Rainforest/WetForest and the
mode is not (keeps sub-cell gully strips visible to explain; doc 05 §4.2) [H]. Scanline over polygon bounding boxes
(demo: 663–3059 polygons per site, < 300 ms).

### 4.3 Vegetation inference (no SVTM or "Not classified") `inferFuelTypes()` (P0)

Inputs per cell: CHM p90 height `h` (m) and cover `c` (0–1) where the canopy raster is valid, and terrain
(elevation z, slope s, aspect a, landform L, TPI). Rules in order [H] (calibrated against the demo statistics: "Not
classified" cells have median cover 0.05 and h ≈ 1 m, i.e. cleared land and towns):

1. `cliffFraction ≥ 0.5` or `s ≥ 55°` → **NonFuel** (rock, cliff).
2. With canopy data:
   - `c < 0.15 && h < 3` → **Grassland**, grassState `grazed` (cleared land) — card "cleared land or town? edit if urban";
   - `c < 0.15 && h ≥ 3` → **GrassyWoodland**;
   - `c ≥ 0.15 && h < 6` → **Heath** (if z > 1500 m → AlpineHeathGrass);
   - `0.15 ≤ c < 0.4 && h ≥ 6` → **GrassyWoodland** (z > 1500 m → SnowGumWoodland);
   - `c ≥ 0.4 && h ≥ 6`: z > 1500 m → SnowGumWoodland; else if `L ∈ {Gully, ValleyFloor, LowerSlope}` and aspect in
     the southern half (90° < a < 270°; false if a is NaN) and h ≥ 15 → **WetForest**; else → **DryForestShrubby**.
3. Without canopy data (or canopy `valid = 0`): z > 1850 m → AlpineHeathGrass; z > 1500 m → SnowGumWoodland;
   `L ∈ {Gully, ValleyFloor}` with s < 30° and southern-half aspect → WetForest; otherwise → DryForestShrubby.
   Warning: "vegetation inferred from terrain".

Urban land cannot be recognised from these layers; the user paints it (`setType: Urban`).

### 4.4 Fire history: parsing and inclusion rules (P0)

**Parse** `parseFireHistory(geojson)` (NPWS GeoJSON, fields verified live, doc 08b §3): for every feature,
```
kind      = FireType === 1 ? Wildfire : FireType === 2 ? PrescribedBurn : Unknown
season    = FireYear >= 10000 ? floor(FireYear / 100) : FireYear          // 196465 → 1964; one row carries 2004
startDate = StartDate != null ? localDate(StartDate) : null               // §0.2: 00:00Z and 13:00Z both → intended date
endDate   = EndDate   != null ? localDate(EndDate)   : (startDate ? startDate + 3 d : null)     // [H]
datesKnown = startDate != null
seasonMid = 1 January (season + 1), 12:00 AEST (UTC+10)                   // [H] mid-summer of the season
startTime = datesKnown ? 00:00 AEST of startDate : seasonMid
endTime   = datesKnown ? 12:00 AEST of endDate   : seasonMid               // burn time t_b = endTime
label     = Label ?? `${season}-${(season + 1) % 100} ${kind}`
Intensity: ignore (9999 = null sentinel; codes undocumented)
MultiPolygon → one FireHistoryRecord per polygon part (rings: first outer, rest holes)
skip rings with < 4 points; skip features with no geometry
```
Data check: Gospers Mountain StartDate = 2019-10-25T13:00Z → 2019-10-26 (the fire's start date); Wambelong
2013-01-12T00:00Z → 2013-01-12; Ngula Bulgarabang HR 2026-04-30T00:00Z → 2026-04-30.

**Inclusion at scenario start `t0`** (d0 = `localDate(t0)`; the rule that makes replays work):
- `datesKnown` and `startDate > d0` → exclude (future fire).
- `datesKnown` and `startDate ≤ d0 ≤ endDate + 1 d` → **active at t0**: exclude from fuel and return it in
  `activeFires` ("this fire was burning at the replay date"). Bundled cases: Gospers Mountain (2019-10-26 →
  2020-02-10) for gospers/grose 2019-12-19; Green Wattle Creek for kanangra 2019-12-17; Currowan 2 for budawangs
  2019-12-30; Pilot Lookout for thredbo 2020-01-02; Wambelong (2013-01-12, EndDate null → + 3 d) for
  warrumbungles 2013-01-12.
- `!datesKnown` and `season === season(t0)` → exclude, warn "undated fire in the current season".
- `!datesKnown` and `season > season(t0)` → exclude (future).
- otherwise include with burn time `t_b = endTime`.

Per-cell outputs: `timeSinceFire = (t0 − t_b,last)/(365.25 d)` (NaN if none), `lastFireKind`, `fireCount30`
(records with t_b within 30 yr), `fireCountTfi` (fires closer than the class TFI minimum to the next fire), flag
`NoFireRecord` if none, and the compact per-cell record list `FuelHistoryCompact` (records sorted by t_b; the scenario
builder copies it to `ScenarioData.fuelHistory`). The NPWS dataset holds only Wildfire and Prescribed Burn;
back-burns are inside wildfire perimeters or absent (doc 05 §2.5), so users draw them.

### 4.5 Fuel accumulation state machine (P0)

For each cell, each layer X ∈ {s, ns, el, b, o} with steady state `X_ss` and rate `k` (per yr) of the cell's class,
and each hazard H ∈ {FHS_s, FHS_ns, FHS_el} (class maxima; with the k of its layer), process the included records in
order of `t_b`:

```
X ← X_ss;  tPrev ← −∞                                   // no record = steady state (D40)
for rec of recordsSortedByTb:
  if tPrev finite: X ← X_ss − (X_ss − X)·exp(−k·(rec.t_b − tPrev)/YEAR)     // Olson with residual (doc 05 §2.2)
  if rec.kind == Wildfire or Unknown:  X_s = X_ns = X_el = X_b = X_o = 0;  H_* = 0        // operational reset
  if rec.kind == PrescribedBurn:       p = PATCHINESS (0.6 [H, UNVERIFIED Penman 2007])
      X_s ← (1−p)·X_s;  X_ns ← (1−p)·X_ns;  X_el ← (1 − 0.5p)·X_el;  X_b ← (1 − 0.5p)·X_b;  X_o unchanged
      H_s, H_ns ← (1−p)·H;  H_el ← (1 − 0.5p)·H_el                                  (doc 05 §5.2) [H]
  tPrev ← rec.t_b
if tPrev finite: X ← X_ss − (X_ss − X)·exp(−k·(t0 − tPrev)/YEAR)
```
`YEAR = 365.25·86400·1000` ms. Worked example, Sydney montane DSF surface (14.5 t/ha, k 0.17) after a wildfire:
X(1, 2, 5, 10, 20 yr) = 2.27, 4.18, 8.30, 11.85, 14.02 t/ha; FHS_s (max 3.4) = 0.53, 0.98, 1.95, 2.78, 3.29.
A 2019-20 burn seen in late 2026 (6.8 yr) carries 9.94 t/ha (69 %).

**Post-fire regime** (doc 05 §2.3, §5.2; ACT "2020_" LUT pattern [V values, H use]). If the last record is a
wildfire, `1 ≤ tsf ≤ 15` yr and the class is DryForestShrubby, SnowGumWoodland or Montane WSF (class 30):
evolve the layers since that fire with post-fire parameters `ns_ss ×4, el_ss ×2.5, k_ns = k_el = 0.45,
k_s ×0.67, k_b = 0.02, WRF − 1 (min 1.5)` and blend `X = (1 − w)·X_standard + w·X_postFire` with
`w = POSTFIRE_WEIGHT_UNKNOWN_SEVERITY = 0.5` [H] (w = 1 if a FESM class ≥ high is supplied, 0 if low/moderate).
Set flag `PostFire` when w > 0. Heights: `H_el ← H_el·(1 + 0.25·w)` [H]. Not applied to heath or grass families.

**Bark hazard** from the evolved bark load with the operational step table: `≤0 → 0, ≤1 → 1, ≤2 → 2, ≤5 → 3,
>5 → 4` [V PyroXL `fl_to_fhs`]. The long-range spotting flag is `barkHazard ≥ 3` [V AFDRS-RP §4.4.1].

### 4.6 Hazard ↔ load conversions (P0)

OFHAG rating → FHS [V AFDRS-RP Table 4.3]; FHS → load [UNVERIFIED Tolhurst workbook via FBCR, doc 03 §3.12]:

| Rating | FHS s/ns/el | FHS bark | surface t/ha | near-surface | elevated | bark |
|---|---|---|---|---|---|---|
| Low | 1 | 0 | 4 | 1 | 1 | 0 |
| Moderate | 2 | 1 | 8 | 2 | 2 | 1 |
| High | 3 | 2 | 12 | 3 | 3 | 2 |
| Very High | 3.5 | 3 | 14 | 3.5 | 4 | 5 |
| Extreme | 4 | 4 | 20 | 4 | 6 | 7 |

`loadFromFhs(layer, fhs)`: piecewise-linear through (0, 0) and the table points. `fhsFromLoad(layer, load)`
(user-entered loads only, D15): inverse of the same polyline for s/ns/el; the step table of §4.5 for bark. Litter
depth entry: `load (t/ha) = 0.4 × depth (mm)` (4 t/ha ≈ 1 cm, doc 05 §2.1 [V]).

### 4.7 `buildFuelMap` (P0)

```ts
export interface BuildFuelArgs {
  terrain: Terrain /* fire grid */; derived: TerrainDerived; classId: Uint8Array /* rasteriseVegetation or 255 */;
  history?: HistoryRaster; canopy?: { height: Float32Array; cover: Float32Array; valid: Uint8Array } | null;
  t0: number; droughtFactor: number; kbdi: number; month: number /* local 1–12 */; params?: Partial<FuelParams>;
}
export function buildFuelMap(args: BuildFuelArgs): FuelMap;   // FuelParams = FUEL_PARAMS shape (all [H] constants of §4)
```
Per cell: class → FuelType (+ inference where 255) → layer loads and FHS via §4.5 → `barkHazard` (§4.5) →
heights (class; post-fire factor) → **canopy**: `canopyHeight`, `canopyCover` from the CHM where `valid = 1`, else
the type default; **`canopyHeightEff = H_o,eff = max(CHM p90, 0.8·type H_o)`** (type H_o where the CHM is invalid;
0 for families grass/heath/none without trees) — used for intensity gating (§6.9), crown cards, ember launch and
z_ref; the CHM value is used for cover, drag (§8.1) and display → **WRF**: `wrf = class WRF − (PostFire ? w : 0)`,
then `−0.5` on exposed ridges (`Landform ∈ {Ridge, Peak, Spur}` and CHM p90 < 12 m) **except for the wetForest
moisture family** (D10) [H doc 03 §3.14], then `−1` if family vesta2 and CHM cover < 0.3 [H]; clamp `[1.5, 6]` →
**curing** (grass family): `clamp(C_month − 15·[z > 1400 m] + curingOffset + 3·(DF − 5), 20, 100)` with `C_month` =
Jan 90, Feb 95, Mar 90, Apr 80, May 70, Jun 55, Jul 45, Aug 45, Sep 50, Oct 60, Nov 75, Dec 85 [H] → grass state
from the grass load `L_g = surfaceLoad + nearSurfaceLoad`: `≥ 6 natural, 3–6 grazed, < 3 eatenOut` [V FBI-TG]
(class/type overrides for Urban, 35, 48) → flags (`WetSubmodel`, `Stringybark`/`RibbonBark` from barkClass,
`UnderWoodland` = heath family with CHM p90 ≥ 8 m and cover ≥ 0.1 [H], `Cliff` if `cliffFraction ≥ 0.3`, `HeavyFuel`
if FHS_s ≥ 3.5 or barkHazard ≥ 3, `NoFireRecord`, `InferredVegetation`, `WetGullyMinority`) → `moistureOffset`
(class 34: +3 pp if KBDI < 100). `sources[]` lists provenance strings ("SVTM C2.0 via NSW DCCEEW (CC BY 4.0)",
"NPWS Fire History current to <max VerDate>", "Meta/WRI CHM").

`fuelParamsAt(fuel, k)` returns the `CellFuelParams` of §2.1 (optional FuelMap fields fall back to the class/type
row). The fire and moisture modules call it once per cell at init and after edits, never per step.

`fuelSummary(fuel, k): string` for "Why here?", e.g. *"Dry forest (shrubby) — Sydney Montane DSF · wildfire 6.8 yr
ago · litter 9.9 t/ha (69 % of max) · shrubs 2.0 m · bark stringy (High)"*.

### 4.8 Fuel edits `applyFuelEdit(fuel, edit, base, history, t0) → number` (P0)

Cells = those whose centre lies in the `BrushShape` (circle test or even-odd polygon). Apply, in this order:
1. `setType` → class = generic class of the type; recompute §4.5 for the cell with the new parameters from its
   `FuelHistoryCompact` records (history kept).
2. `setTimeSinceFire = τ` → replace the cell's history with one synthetic record at `t0 − τ·YEAR`: a
   `PrescribedBurn` with p = 1 (full reset of s/ns; el and bark halved) [H] — "completed back burn / burnt N years
   ago". `lastFireKind = PrescribedBurn`.
3. Hazard deltas: `FHS_layer = clamp(FHS_layer + Δ, 0, 4)`, then `load_layer = loadFromFhs(layer, FHS_layer)` for
   s/ns/el; `barkHazard = clamp(+Δ)` and `barkLoad = loadFromFhs('bark', …)`.
4. `elevatedHeight` → H_el.
5. `moistureDelta` → `moistureOffset += Δ` (percentage points; clamp the offset to [−10, +40]).
Flag `UserEdited`; return the count of changed cells. **Idempotence**: the worker keeps an immutable base FuelMap
(and the base history) and re-applies all remaining edits in order on `removeEdit`, so `applyFuelEdit` may assume it
starts from the base plus earlier edits.

### 4.9 Tests (P0)

`svtmToClass` for every (vegForm, vegClass) pair in the eight demo `vegetation.geojson` files is total (no throw) and
maps "Sydney Montane Dry Sclerophyll Forests" → 13/DryForestShrubby, "Alpine Herbfields" → 39/grass family/grass
moisture family, "Montane Lakes" → Water. `localDate`: 2019-10-25T13:00Z → 2019-10-26; 2013-01-12T00:00Z →
2013-01-12. Fire-history inclusion: the five "active at t0" cases above are excluded; Katoomba "now" (2026-09-27)
includes "Ngula Bulgarabang HR" (2026-04-30 → 05-04) with tsf 0.40 ± 0.01 yr. Olson vectors above (±0.01).
Prescribed burn from steady state, p = 0.6: surface 14.5 → 5.8 t/ha immediately, 8.31 t/ha after 2 yr
(14.5 − 8.7·e^{−0.34}). `loadFromFhs('surface', 3.25) = 13.0`. Rasterisation of a 1 km × 1 km square on a 30 m grid
covers 1111 ± 67 cells. `fuelParamsAt` on a flat cell (aspect NaN) returns finite values for every field.

---

## 5. `fuel/moisture` and drought — dead fine fuel moisture, KBDI, DF, availability, ignition probability

### 5.1 What the module produces (P0)

Per burnable cell of the fire grid (the moisture grid is the fire grid; edits and `moistureOffset` apply per cell):

| Output | Meaning | Consumer |
|---|---|---|
| `field` M (%) | dead fine (surface litter) moisture used for spread | fire/models, embers, explain |
| `afdrs` M_A (%) | AFDRS-equivalent value (air T/RH only, operational equations) | explain ("AFDRS says…") |
| `anomaly` A (pp) | physical terrain/canopy/sun deviation added to M_A | explain |
| `fuelTemp` T_f (°C) | fuel-surface temperature | embers (P_ig), explain |
| `airT`, `airRH` | cell air temperature / RH (§5.2) | explain, fire (N_c fallback) |
| `availability` FA | fuel availability per cell (§5.9) | fire/models |
| `kbdi`, `df` | scenario-level drought state (domain scalars, fixed for the run) | fire, explain, stats |

`MoistureContext` (§2.2) is built by sim/: `u10` = **|U_bg10|, the open-equivalent 10 m background wind** (no fire
terms, so moisture never depends on fire winds); `night` = the `stableNight()` state. Update cadence: every **600 s**
of simulated time (and once at t0); the fire uses the latest field. Skip burnt cells (their value is frozen).

### 5.2 Air temperature and humidity at each cell (P0)

Inputs: the series grid-point values (T_s, T_d,s at `sourceElevation` z_s; the Open-Meteo `elevation` field, e.g.
715 m for Katoomba whose plateau is at ~1000 m — **the lapse correction is not optional**; presets: the domain median
elevation, §11.3).
```
Γ     = 6.5 + 3.3·smoothstep(5°, 15°, h_sun)·smoothstep(0.75·relief, 1.25·relief, BLH ?? 1500 m)   K/km   (D43)
        (h_sun < 5° → 6.5; relief = domain max − min elevation)
T_free(z) = T_s − Γ·(z − z_s)/1000 ;   Td_free(z) = T_d,s − 1.8·(z − z_s)/1000                            [K]
Cold pool (every hour, day or night; Δθ from §5.2a, zero when there is no stable night):
h_inv = night.hInv (150 m default, user 50–400 m);  hav = heightAboveValley(cell);  z_inv = z − hav + h_inv
if hav < h_inv:  T = T_free(z_inv) − Δθ·(1 − hav/h_inv);   Td = min(T, Td_free(z_inv))     (cold pool keeps its moisture)
else:            T = T_free(z);                           Td = Td_free(z)
```
The band `|hav − h_inv| ≤ 75 m` is the **thermal belt** (D26): it is automatically the warmest night air on the slope
(warmer than the valley by Δθ, warmer than the ridge by the lapse). Once the 3-D atmosphere is spun up and
`mountainPhenomena` is on, replace T by the atmosphere's `airAt()` value (T at z_cell + 2 m, §8.8) and keep Td from
the formula above; the §5.2a state also initialises the atmosphere's cold pool, so the two agree at t0.
`RH = rhFromTd(T, Td)`. Apply user belt-kit observations (§11.5) as a domain offset to T_s/T_d,s.

### 5.2a Stable-night state `stableNight()` (P0, `core/physics.ts`) [H doc 02 §2.4, doc 01 §4.4; D49]

One domain-level state drives the moisture template (§5.2), the atmosphere's cold-pool θ′ and nudging taper (§8.2,
§8.4), the fast-tier night decoupling (§8.9) and the katabatic, thermal-belt, inversion-break and night-slowdown
cards (§10.2). sim/ advances it every atmosphere step (exact update, any Δt):
```
g   = (1 − smoothstep(3, 5 m/s, U10_gp))·(1 − smoothstep(37.5, 62.5 %, cloud))        (gate 0–1; U10_gp = series wind)
night (h_sun < 0):   dΔθ/dt = g·(Δθ_max − Δθ)/3 h − (1 − g)·Δθ/1 h
    exact: b = g/3 h + (1 − g)/1 h;  Δθ_eq = (g·Δθ_max/3 h)/b;  Δθ ← Δθ_eq + (Δθ − Δθ_eq)·e^{−b·Δt}
at the sunrise crossing: Δθ_sr ← Δθ;  t_sr ← t;  t_break ← t_sr + 3.5 h (+ 1.5 h if rain24 ≥ 2 mm)
day (h_sun ≥ 0):     Δθ ← min( Δθ_sr·max(0, (t_break − t)/(t_break − t_sr)),  Δθ·e^{−(1 − g)·Δt/1 h} )
    3-D tiers: once the atmosphere reports breakEta (§8.10), t_break ← t + breakEta (re-evaluated every 600 s)
sn  = clamp(Δθ/3 K, 0, 1)                       ("stable-night strength", used by §8.4 and §8.9)
Δθ_max, h_inv = series.nightTemplate ?? { 5 K, 150 m }  (preset calm-night-katabatic: 6 K, 150 m)
initialise: Δθ = 0 at max(seriesStart, t0 − 24 h), then integrate the series hours to t0 (a 07:00 start inherits
            the night's cold pool; a 19:00 start on the night preset, 15 Mar, begins with ≈ 1.3 K)
```
Vectors (Δθ_max 5, from 0 with g = 1): after 3 h 3.16 K, 6 h 4.32 K; windy spell (g = 0) from 4 K for 1 h → 1.47 K;
sunrise with Δθ_sr 4.5 K: 1 h later 3.21 K, at t_break 0.

### 5.3 AFDRS-equivalent value M_A (P0) [V doc 03 §3.2, doc 04 §3.2]

Evaluate at the cell's air T (°C) and RH (%), **local mean solar time** (D37), month m:

| Moisture family (resolved from the class) | Equation (%) |
|---|---|
| forest (dry) | period 1 if m ∈ Oct–Mar and **12 ≤ LMST < 17** and cloud < 60 % [cloud test H] (D47): `2.76 + 0.124RH − 0.0187T`; period 3 if LMST < 7 or LMST ≥ 19: `3.08 + 0.198RH − 0.0483T`; else period 2: `3.60 + 0.169RH − 0.0450T` |
| wetForest (WetForest, Rainforest) | never period 1: day `3.60 + 0.169RH − 0.0450T`, night (LMST < 7 or ≥ 19) `3.08 + 0.198RH − 0.0483T` |
| heath | `MC1 + MC2`; `MC1 = 4.37 + 0.161RH − 0.1(T − 25) − 0.027RH·[RH ≤ 60]`; `MC2 = 67.128(1 − e^{−3.132·P48})·e^{−0.0858·h_r}` (P48 = rain in last 48 h, mm; h_r = hours since it stopped) |
| grass | `max(5, 9.58 − 0.205T + 0.138RH)` |
| pine | `4.3426 + 0.1188RH − 0.0211T` |
| none | 0 (unused) |

Vectors (T, RH → forest P1/P2/P3, grass, heath MC1, pine): (15, 80) → 12.40/16.45/18.20, 17.55, **18.25** (RH > 60,
so the Δ term is 0), 13.53; (25, 40) → 7.25/9.24/9.79, 9.98, 9.73, 8.57; (30, 20) → 4.68/5.63/5.59, 6.19, 6.55, 6.09;
(40, 10) → 3.25/3.49/3.13, 5.00, 4.21, 4.69. MC2(1 mm, 12 h) = 22.93; MC2(1 mm, 24 h) = 8.19. Period: 16:59 LMST in
October → 1; 17:00 → 2.

### 5.4 Physical anomaly A (P0) [D17; physics doc 04 §3.4–3.7, calibration H]

For the cell (c = canopy cover, LAI from type or CHM-derived `LAI = LAI_type·c/c_type`, sun elevation h):
```
τ_b = (1 − c) + c·exp(−0.4·LAI / max(0.1, sin h)) ;   τ_d = (1 − c) + c·exp(−0.8·LAI)
S_f = τ_b·sun.direct[k] + τ_d·(sun.total[k] − sun.direct[k])            (W/m²; insolation() already has shadows, SVF)
u_f = U10[k] / (2·wrf[k])                                              (m/s litter-level wind [H]; U10 = ctx.u10)
ΔT_LW = h < 0 ? −(3(1 − c) + 0.5c)·(1 − cloudFrac) : 0                 (K)
T_f  = T + a_s·S_f/(1 + b_u·u_f) + ΔT_LW ,   a_s = 0.02 K m²/W, b_u = 0.5 s/m
e    = RH/100·esat(T) ;  H_f = clamp(100·e/esat(T_f), 1, 100)
E_d(H, T) = 0.942H^0.679 + 11e^{(H−100)/10} + 0.18(21.1 − T)(1 − e^{−0.115H})     [V Van Wagner 1987]
E_cell = E_d(H_f, T_f)
```
Family reference column: the same formulas with flat ground (`direct_ref = DNI·sin h`, `diffuse_ref = DHI`, no
shadow, SVF 1) and the family reference canopy `c_ref = FUEL_TYPES[type].moistureRefCanopy`, same air T/RH, same
u_f: `E_ref = E_d(H_f,ref, T_f,ref)`. Then
```
A = (E_cell − E_ref) · (1 − 0.5·smoothstep(8, 10, DF))          (drought damping of terrain contrasts [H doc 04 §4.2 step 9])
  + G_gully                                                      (vesta2 families only)
G_gully = 3·clamp(−tpiSmall/20 m, 0, 1)·[Landform ∈ {Gully, ValleyFloor}]·(1 − smoothstep(100, 150, KBDI))   [H]
```
Calibration check [D, doc 04 §3.7 target NW–SE ≈ 2–3 pp]: 15 Oct 14:00 LMST, 33.7° S (sun elevation 49.9°, azimuth
301.7°, clear-sky DNI 900 W/m², DHI 110 W/m²), 30° slopes, T 25 °C, RH 30 %, U10 15 km/h, WRF 3.5, c = 0.6,
LAI 1.5: E_ref = 4.82 %; anomalies NW −0.62, N −0.19, W −0.46, E +1.42, S +1.09, SE +1.62 pp → **NW − SE = −2.24
pp** (acceptance band [−3.5, −1.2]). Start-up calibration hook: if the **family reference column** E_ref departs
from the family's AFDRS M_A by > 1.5 pp on a dry afternoon (period 1), log it (do not auto-tune a_s in v1); the
calibration case itself gives 4.82 vs 6.01 (1.19 pp, no log).

### 5.5 Time lag, rain and dew (P0)

State per cell: `M_lag` (%), `L_dew` (mm), `h_e` (effective hours since rain), and the domain rain history.
```
M_eq  = max(2, M_A + A)
Van Wagner rate ratio  f_τ = k(30 %, 5 km/h, 30 °C) / k(H_f, U10_kmh, T_f)       clamp [0.3, 5]
    k(H, W, T) = [0.424(1 − (H/100)^1.7) + 0.0694√W (1 − (H/100)^8)]·0.0579·e^{0.0365T}   (drying)
    wetting: same with H → 100 − H
τ = f_τ · (M_lag > M_eq ? 1.5 h : 2.0 h)                                          [H doc 04 §3.5 table]
M_lag ← M_eq + (M_lag − M_eq)·exp(−Δt/τ)                                          (exact; stable for any Δt)
```
Hysteresis bands are not modelled (the Vesta regressions already average field hysteresis) [H]. f_τ vectors:
(H 30, W 5, T 30) → 1.000; (15, 20, 35) → 0.609; (20, 10, 30) → 0.851; (60, 5, 15) → 2.274; (80, 2, 12) → 4.693.

Rain memory (all families; the AFDRS heath MC2 form, e-folding 11.7 h) [V form for heath, H for other families]:
```
S_c   = 0.5 + 1.0·c  (mm, canopy interception capacity)
P48_t = max(0, P48 − S_c)                        (throughfall over the trailing 48 h)
dh_e  = Δt_h · clamp(1 + (S_f − 200)/400, 0.5, 2) ;  h_e ← 0 in any step with throughfall > 0.2 mm/h
R_mem = 67.128·(1 − e^{−3.132·P48_t})·e^{−0.0858·h_e}
```
For the heath family M_A already contains MC2, so R_mem is **not** added again (use R_mem only for other families).
Dew (night, T_f < T_d): `L_dew += min(0.09, 0.02(T_d − T_f))·Δt_h` mm; drying when T_f > T_d:
`L_dew −= 0.1(1 + S_f/300)·Δt_h`, floor 0 [H doc 04 §3.8]. Dew term `D = min(40, 100·L_dew/0.3)` pp.

Final: `M = clamp(M_lag + R_mem + D + moistureOffset[k], 2, 250)`. The `afdrs` output is M_A exactly (no anomaly,
rain memory, dew or offsets — only heath's own MC2), so `M − M_A` is the teaching content ("sunlit NW slope", "rain
20 h ago", "cold-air pool"; explain cites it when |M − M_A| > 3 pp). A cell burnt by fire keeps its last M.

### 5.6 Spin-up `initialise(series, t0, drought, night)` (P0)

Run the §5.2–5.5 chain hourly from `max(seriesStart, t0 − 168 h)` to t0 (the `stableNight` state is re-integrated
alongside). **Before the 48 h window** use flat insolation, zero anomaly and a **look-up table**: evaluate M once per
(moisture family × 25 m elevation band × canopy-cover decile) and copy to the cells of that key. **Inside the 48 h
window** evaluate per cell with per-cell insolation. Budget: ≤ 1.5 s on a phone (review estimate for 168 h per
cell: 3–4 s, hence the LUT). Initialise `M_lag = M_eq` at the first hour. If fewer than 24 h precede t0 (replays
start at 00:00 of the date), take P48 and hours-since-rain from the last two entries of `series.daily`/`rainLast20`
(rain assumed to have ended at 18:00 of its day) [H]. Forecast responses carry 7 past days (`past_days=7`), so "now"
spins up fully.

### 5.7 KBDI (P0) [V doc 03 §3.3, doc 04 §3.9; D19]

Daily, in date order, K in mm (0–203.2), T = daily Tmax (°C), R = annual rainfall (mm):
```
ET = (T < 10) ? 0 : max(0, 1e-3·(203.2 − K)·(0.968·e^{0.0875T + 1.5552} − 8.30)/(1 + 10.88·e^{−0.001736R}))
K  = min(203.2, K + ET)                                        (ET before rain, each day)
rain: a "spell" = consecutive days with P > 0; the first 5 mm of each spell is removed once:
      rem = min(P, max(0, 5 − removedInSpell)); removedInSpell += rem; K = max(0, K − (P − rem))
```
Initialisation: **always two passes** over the 365-day history — pass 1 from K = 0, pass 2 from pass 1's final K;
report pass 2 (cyclic spin-up) [H]. Annual rainfall `R` (`series.annualRainfall`): scenario/ uses a 10-year
Open-Meteo archive mean when online (cached per site), else the bundled demo-site table, else `1.25 × (last-365-day
total)` [H]. Demo table [K, UNVERIFIED approximations of BoM climatology]: katoomba 1400, grose 1100, kanangra 900,
thredbo 1500, gospers 750, budawangs 1250, barrington 1300, warrumbungles 750 mm.

Vectors: dK(K 100, T 30 °C, R 1000) = 1.945 mm; dK(K 50, T 30, R 1000) = 2.888 mm; spell test: K 100, cold days
(T 5 °C), rain 3, 4, 2 mm → 100.0, 98.0, 96.0. Fixture results (table R, two passes) to ±3 mm: gospers-2019-12-19
125.4 (one pass would give 120.8); grose 118.6 (116.0); kanangra 76.1; budawangs 118.9; thredbo 63.9;
katoomba-2013-10-16 74.9; warrumbungles 145.9; katoomba archive only (to 2026-09-21) 58.2; **katoomba now
(2026-09-27, archive + forecast `past_days` gap-fill, §11.1) 64.6**.

### 5.8 Drought factor (P0) [V Griffiths 1999 + Finkele 2006; D18]

```
rain events: maximal runs of consecutive days with P > 2 mm in the last 20 days (index 19 = yesterday, N = 1)
per event: P = event total; N = days since the event's wettest day (0.8 if that is today)
           x_e = N^1.3 / (N^1.3 + P − 2)
x = min(1, min over events x_e);  x_lim = K < 20 ? 1/(1 + 0.1135K) : 75/(270.525 − 1.267K);  x = min(x, x_lim)
DF = min(10, 10.5·(1 − e^{−(K + 30)/40})·(41x² + x)/(40x² + x + 1))
```
Use K = KBDI of yesterday; today's scenario-hour rain before t0 counts as an event with N = 0.8. DF is a domain
scalar for the run. Vectors (single event of P mm N days ago): (K 0; N 1, 20 mm) 0.8; (K 0; 3, 20) 3.5; (K 50; 7, 20)
7.9; (K 100; 7, 20) 9.1; (K 150; 14, 20) 10.0; (K 100; 3, 50) 2.6; (K 150; 10, 50) 8.4. Fixtures (to ±0.3): gospers
10.0, grose 9.88, kanangra 8.86, budawangs 9.89, thredbo 8.45, katoomba-2013 8.83, warrumbungles 10.0; katoomba
archive only (to 2026-09-21) 8.23; **katoomba now 8.47** (one event 09-21/22, 5.8 mm, N = 5). Noble (1980) DF is kept
as `droughtFactorNoble()` for comparison only.

### 5.9 Fuel availability FA (P0) [D8, D9, D10]

| Family / case | FA |
|---|---|
| vesta2, dry (moistureFamily forest) | `FA_dry = 1.008/(1 + 104.9·e^{−0.9306·DF})` |
| vesta2, wetForest (WetForest, Rainforest) | `FA_wet = FA_dry(C1·DF)`, `C1 = clamp(0.1·[(0.0046W² − 0.0079W − 0.0175)·KBDI + (−0.9167W² + 1.5833W + 13.5)], 0, 1)`, W = clamp(wrf, 3, 6) (flag `validated=false` if wrf > 5) |
| topographic blend for wetForest cells [H] | `w = smoothstep(0, 30 m, tpiSmall)·a_w`, `a_w = isNaN(aspect) ? 0.5 : clamp(0.5 + 0.5·cos(aspect − 315°), 0, 1)`; `FA = w·FA_dry + (1 − w)·FA_wet` |
| pine | FA_wet with W = wrf (FBI-TG pine uses the wet-forest availability) |
| grass, heath | FA = 1 (availability is curing / not modelled) |
| Vesta 2012 / AFDRS-parity path | dry `0.1·DF`; wet `min(FA_dry(C1·DF), 0.1·DF)` |

Vectors: FA_dry(DF 3…10) = 0.136, 0.285, 0.504, 0.723, 0.872, 0.950, 0.984, 0.998. C1(KBDI 100, W 5) = 0.430;
C1(100, 4) = 0.762; FA_wet(DF 10; KBDI 0/50/100/150/200): W 3.5 → 0.939/0.966/0.983/0.993/0.998; W 4.5 →
0.061/0.298/0.736/0.954/0.998; W 5 → 0.010/0.034/0.345/0.893/0.998. Flat wet-forest cell (aspect NaN, tpiSmall 30 m):
w = 0.5.

### 5.10 Ignition probability (P0) [V Schroeder 1969 as coded in behave `ignite.cpp`; UNVERIFIED for eucalypt]

```
m = M/100;  Q = 144.51 − 0.266T_f − 0.00058T_f² − T_f·m + 18.54(1 − e^{−15.1m}) + 640m ;  Q = min(Q, 400)
X = (400 − Q)/10 ;  P_ig = clamp(0.000048·X^4.3/50, 0, 1)
```
Vectors (T_f 30 °C; M 3, 5, 6, 7, 10, 12, 15, 20, 25 %) = 0.811, 0.610, 0.529, 0.458, 0.293, 0.214, 0.129, 0.049,
0.014; (T_f 20 °C; 5 %, 10 %) = 0.571, 0.267. Exported as `ignitionProbability(tfC, mPct)` for embers and debris.

### 5.11 Signatures and tests

```ts
export function afdrsMoisture(family: MoistureFamily, tC: number, rh: number, lmstHour: number, month: number,
  cloudFrac: number, rain48: number, hoursSinceRain: number): number;
export function fuelTemperature(tC: number, sF: number, uF: number, dTlw: number, p?: MoistureParams): number;
export function vanWagnerEd(h: number, tC: number): number;  export function vanWagnerEw(h: number, tC: number): number;
export function kbdiSeries(daily: DailyWeather[], annualRainfall: number): number[];   // pass-2 values per day
export function fuelAvailabilityMk2(df: number): number;
export function wetForestC1(kbdi: number, wrf: number): number;
export function ignitionProbability(tfC: number, mPct: number): number;
// MoistureParams = MOISTURE_PARAMS shape: { aS, bU, tauDry, tauWet, lapseNight, lapseDay, dewRate, ..., lutElevBand: 25 }
```
Tests: every vector in §5.2a–5.10; stability of the exponential update at Δt = 3 h; a resting night with the
template gives M(thermal-belt cell) < M(valley-floor cell) by ≥ 3 pp at 05:00 (V8); the cold-pool term
(T − T_free) of any cell changes by < 0.5 K between consecutive 600 s updates across sunrise and across U10 = 4 m/s (D49); a 30° SE-facing cell is wetter
than a 30° NW cell by 1.2–3.5 pp on the calibration afternoon (V7); 10 mm of rain at 12:00 raises M by ≥ 30 pp at
13:00, the excess is 5–15 pp at 12:00 next day and < 3 pp just before the rain leaves the 48 h window (the drop to 0
at 48 h must be < 3 pp); the LUT spin-up and a full per-cell spin-up agree to ±0.3 pp at t0.

---

## 6. `fire/models` — point fire behaviour models

### 6.1 API and dispatch (P0)

`fireBehaviour(input)` dispatches on the **class** family (`FUEL_CLASSES[input.fuelClass ?? type]`, e.g. Alpine
Herbfields → grass):

| family | model | FBI table | LB form |
|---|---|---|---|
| vesta2 | Vesta Mk2 (§6.2); comparison: Vesta 2012 (§6.3), Mk5 (§6.4) | forest | forest |
| grass | CSIRO grass (§6.5) with WAF | grass (Grassland); savanna (GrassyWoodland, Urban, classes 35, 48) | grass |
| heath | AFDRS heath 2024 refit (§6.6); v1.0 selectable | shrub | grass |
| pine | pine (§6.7) | forest | forest |
| none | all outputs 0 | — | — |

Two interfaces: the **object API** (`fireBehaviour`, `vestaMk2`, `grassland`, `heath`, `pine`) used by explain/,
tests and the UI; and the **kernel API** used by fire/spread in its hot loop, allocation-free:
```ts
export interface HeadKernelOut { r0: number; rw: number; p2: number; p3: number; phase: number; fme: number; fa: number; valid: number }
export function headRosKernel(p: CellFuelParams, u10kmh: number, mPct: number, fa: number, out: HeadKernelOut): void; // m/h, flat
```
`rw` is the flat head ROS **after** the `max(·, r0)` floor of §6.2 (all families: `rw ≥ r0`). Units inside models:
km/h wind, m/h ROS, t/ha loads, m heights (cm only inside Vesta 2012). Object-API outputs use the **contract names**
(`FireBehaviourOutput`): `rosHead` (m/s, = R_w·SF(slopeDeg)), `rosBack` = R_B and `rosFlank` = R_F of §7.4 with the
same slope treatment (on flat ground `R_B = max(cb·R_w, R0)`, `R_F = h·R_w`), `lengthBreadth`, `fuelConsumed` (the
intensity fuel w of §6.9, t/ha), `intensity` (kW/m), `flameHeight` (m), `spottingDistance` (m), `phase`, `factors`
(§6.12), `model`, plus the optional `ros0`, `p2`, `p3`, `moistureFactor`, `fuelAvailability`, `fbi`, `rating`,
`validated`. fire/spread does not use `slopeDeg`; it calls the kernel with θ = 0 and applies §7.3–§7.4.

### 6.2 Vesta Mk2 (P0) [UNVERIFIED primary; single-source code lineage, doc 03 §3.5; D5–D7, D11, D21, D44]

```
FL  = surfaceLoad + nearSurfaceLoad (t/ha, after Olson; NOT × FA)            (D6)
H_u = max(0.05, −0.1 + 0.06·FHS_el + 0.48·H_el)                               (m; "Cruz 2021 eq 1")
φM  = 1 (M ≤ 4.1); 0 (M > 24); else 0.9082 + 0.1206M − 0.03106M² + 0.001853M³ − 0.00003467M⁴
FA  = §5.9 (dry or wet/blend);   FME = φM·FA ;   u = U10/WRF (km/h)
R1  = 1000·(0.03 + clamp(u − 2, 0, 1)·0.05024·(u − 1)^0.92628·(FL/10)^0.79928)·FME   (u > 1; else 30·FME)  (D21 ramp)
R2  = 1000·0.19591·u^0.8257·(FL/10)^0.4672·H_u^0.495·FME
R3  = 1000·0.05235·U10^1.19128·FME
P2  = FL < 1 ? 0 : logistic(−23.9315 + 1.7033u + 12.0822·FME + 0.95236·FL)
P3  = R2 < 300 ? 0 : logistic(−32.3074 + 0.2951·U10 + 26.8734·FME)            (gate in m/h, D11)
ROS_mix = P2 < 0.5 ? R1(1 − P2) + R2·P2 : R1(1 − P2) + R2·P2(1 − P3) + R3·P3 (coded mixing, D7)
      normalised switch: R1(1 − P2) + P2[(1 − P3)R2 + P3·R3]
R0  ≡ 30·FME m/h  (R1 at u ≤ 2; never the mixed kernel at U = 0)                (D44)
R_w = max(ROS_mix, R0) ;   phase = P2 < 0.5 ? 1 : (P3 < 0.5 ? 2 : 3)
validated = 5 ≤ U10 ≤ 70 km/h and 4 ≤ M ≤ 20 % and wrf ∈ [3, 5]
```
The ramp reproduces the coded R1 exactly for u ≥ 3 and u ≤ 2. Vectors (U10, M, DF, FL, H_u; WRF 3; flat) → FME, R1,
R2, R3, P2, P3, ROS m/h:
(30, 6, 10, 15, 1.5) → 0.868, 487.4, 1680.9, 2611.7, 1.000, 0.466, **2114.2** (phase 2);
(10, 8, 8, 15, 1.0) → 0.657, 119.8, 420.5, 534.4, 0.981, 0.000, **414.9**;
(40, 5, 10, 15, 1.5) → 0.943, 699.8, 2317.2, 3999.7, 1.000, 0.992, **3986.6** (phase 3);
wet (30, 8, 10, 18, 1.5; WRF 5, KBDI 100): C1 0.430, FME 0.239, ROS **330.0**;
WRF 5 (30, 6, 10, 5, 1.0): coded **1478**, normalised **1262**, P2 0.822; gate case (80, 4, 10, 1, 0.2; WRF 5): R2 296.8,
ROS **296.8** (no gate would give 9669).
Low wind (M 8, DF 10, FL 16.4, H_u 1.058, WRF 3.5; FME 0.690, R0 20.7): U10 0 → ROS_mix 10.2, **R_w 20.7**; 1 → 46.8;
3.6 → 156.7 (P2 0.856); 5 → 218.6; 10 → 415.0. Mk2 is extrapolated below U10 5 km/h (validated = false) and very
sensitive there (7.6 × R0 at 1 m/s); §8.6 limits how much sub-grid thermal wind reaches it.

Flame height (Vesta, FBI-TG eq 3.59) [V]: `FH = 0.0193·ROS^0.723·e^{0.64·H_el}·1.07` (m; ROS m/h) → (1000, 1.5) = 7.96 m.

### 6.3 Vesta 2012 (AFDRS forest at launch; comparison and AFDRS-parity FBI) (P1) [V FBI-TG]

```
U = U10·3/WRF ;  s' = FHS_s·FA ; ns' = FHS_ns·FA ;  H = min(H_ns_cm, 20)      FA = 0.1·DF (dry)
R0 = U ≤ 5 ? 30 : 30 + 1.5308(U − 5)^0.8576·s'^0.9301·(ns'·H)^0.6366·1.03
ROS = R0·φ ;  φ = 2.31 (M ≤ 4), 18.35·M^−1.495 (4 < M ≤ 20), 0 (M > 20)
```
Vector: U10 30, FHS_s 3.5, FHS_ns 3, H_ns 20 cm, M 6, FA 1, WRF 3 → **1402 m/h**.

### 6.4 McArthur Mk5 and FFDI (P0) [V FFDI; K rest]

```
FFDI = 2·exp(−0.450 + 0.987·ln DF − 0.0345·RH + 0.0338·T + 0.0234·U10)
R = 0.0012·FFDI·W km/h (flat; W = total fine load t/ha);  Z = 13R + 0.24W − 2 (m);  S = max(0, R(4.17 − 0.033W) − 0.36) km
```
Vectors: FFDI(35, 15, 40, 10) = 61.39 → with W 15: R 1105 m/h, Z 15.97 m, S 3.70 km; FFDI(30, 20, 30, 10) = 34.53;
(T 34, RH 18, DF 10) gives FFDI 25/50/100 at U10 7.5/37.1/66.7 km/h (S = 1.29/2.95/6.25 km at W 15; V9).
Legacy NSW FFDI bands (display only): 0–11 Low–Moderate, 12–24 High, 25–49 Very High, 50–74 Severe, 75–99 Extreme,
100+ Catastrophic (`legacyFfdiRating`).

### 6.5 CSIRO grassland (P0) [V FBI-TG; D13, D21]

```
state: input.grassState ?? (L ≥ 6 natural : L ≥ 3 grazed : eatenOut), L = surface + near-surface load
natural:  U < 5 ? 0.054 + 0.269U : 1.4 + 0.838(U − 5)^0.844          (km/h)
grazed:   U < 5 ? 0.054 + 0.209U : 1.1 + 0.715(U − 5)^0.844
eatenOut: U < 5 ? 0.027 + 0.1045U : 0.55 + 0.357(U − 5)^0.844        (Spark, continuous; FBI-TG form as switch)
φM = M < 12 ? e^{−0.108M} : (U10 ≤ 10 ? 0.684 − 0.0342M : 0.547 − 0.0228M), floor 0.001
φC = 1.036/(1 + 103.989·e^{−0.0996(C − 20)})
ROS = 1000·R·φM·φC·WAF (m/h);  WAF = grassWaf (Grassland 1.0; GrassyWoodland 0.5 if cover < 0.3 else 0.3; Urban 0.3)
R0 = ROS at U = 0;  FH = (natural ? 2.66 : 1.12)·(ROS/3600)^0.295 ;  intensity load = clamp(L, 1, 6) t/ha
```
Vectors: natural U 10, M 8, C 90 → **1854 m/h**; U 30, M 5, C 100 → **8205 m/h**, FH 3.39 m, I (5 t/ha) 21 196 kW/m;
eatenOut at **M 5 %, C 100 %**: U 4.99 → 320, U 5 → 321 (continuous; at M 8, C 90: 218/219). φC(20, 50, 70, 80, 90,
100) = 0.01, 0.17, 0.60, 0.82, 0.94, 1.00.

### 6.6 Heath / shrubland (P0) [refit: PyroXL 2024, published source UNVERIFIED; v1.0: V FBI-TG; D12]

```
waf = underWoodland ? 0.35 : 0.667 ;  U2 = waf·U10 ;  m = M/100 ;  H = H_el (m)
refit (default):
  SI  = logistic(2.57903 + 0.175609·U2 + 0.752449·H + 0.149167·H·U2 − 0.430727·M)
  ROS = SI·exp(3.34696 + 0.588662·√U2 − 0.788551·ln(m/(1 − m)) + 0.414993·ln H)       (m/h)
v1.0:
  ROS = 5.6715·(waf·U10)^0.9102·H^0.227·e^{−0.0762M}·60 · logistic(16.57 + 1.188·U10 − 2.705·M)
R0 = ROS at U10 = 0 ;  FH = e^{−4.142}·I^0.633 ;  intensity load = total fine load (s + ns + el) × 1 (no FA)
```
Vectors (H 1.3 unless stated): refit (30, 6) → **3860.6**, SI 1.00; (10, 10) → 694.5, **SI 0.85** (logit 1.7147);
(5, 12) → 181.5, SI 0.41; (40, 5, H 2.0) → 8079.2. v1.0 (30, 6) → 3495.8; (10, 10) → 760.6 (damping 0.802). Heath at
3860.6 m/h and 20 t/ha: **I = 39 892 kW/m**, FH = 12.99 m. The UI shows both heath values when they differ by > 25 %
("model spread").

### 6.7 Pine (P1) [V FBI-TG §3.3.8 structure; simplification H]

```
M_litter = 4.3426 + 0.1188RH − 0.0211T  (the moisture module supplies it for moisture family pine)
surface  = Vesta Mk2 (§6.2) with FL = s + ns, H_u from pine FHS_el/H_el, WRF = wrf (4), FA = FA_wet(C1(KBDI, wrf)·DF)
FH_surf  = Vesta FH(R_surf, H_el) ;  w_surf = FA·(min(s, 10) + ns) + (FH_surf > 1 m ? FA·el : 0)
I_surf   = 0.5167·w_surf·R_surf   (§6.9 without the canopy term: the crown is handled by CFB)
FMC = 150 − 5·DF ;  I_crit = (0.01·CBH·(460 + 25.9·FMC))^1.5 (kW/m), CBH default 8 m
W_s = U10·ln(0.36h/0.13h)/ln((10 + 0.36h)/0.13h)   (km/h wind at stand height h = H_o,eff)
R_active = 661.26·W_s^0.8966·ρ_c^0.1901·e^{−0.1714·M} (m/h), ρ_c = 0.15 kg/m³
CFB = clamp((I_surf − I_crit)/(2·I_crit), 0, 1)              (single stand stage instead of the 6-stage ensemble [H])
ROS = R_surf + CFB·max(0, R_active − R_surf)
FH  = FH_surf + CFB·(h − FH_surf) ;  w = w_surf + CFB·FA·canopy ;  I = 0.5167·w·ROS
```
Vectors (RH 20, T 30, DF 10, U10 30, FL 12 (s 10, ns 2, el 2, canopy 10), H_u 1.0, H_el 1.0, h 20, WRF 4):
**KBDI 100** (C1 0.762): M 6.09, FA 0.927, R_surf 1081, FH_surf 6.11, w_surf 12.97, I_surf 7245, I_crit 3811, W_s 16.17,
R_active 1970, CFB 0.451, **ROS 1481**, FH 12.37, I 13 128; **KBDI 200** (C1 1): FA 0.998, R_surf 1648, I_surf 11 905,
CFB 1, **ROS 1970**, FH 20.0. (RH 40, T 25, DF 8, U10 15): M 8.57; KBDI 100: FA 0.740, R_surf 172, I_surf 920 < I_crit
4307, **ROS 172**; KBDI 200: FA 0.950, **ROS 323**, I 2222.

### 6.8 Shape: length-to-breadth and the ellipse (P0) [V Spark forms; D20, D21]

`U_axis = max(0, U10·cos(e − windTo))` (km/h; the wind component along the head direction e, §7.3).
```
forest/pine:  LB = U < 5 ? 1 + (0.9286·e^{0.0505U} − 1)·clamp((U − 2)/3, 0, 1) : (U < 25 ? 0.9286·e^{0.0505U} : 0.1143U + 0.4143)
grass/heath:  LB = U < 2 ? 1 : 1 + (1.1·U^0.464 − 1)·clamp((U − 2)/3, 0, 1)        (ramps replace the jumps, D21)
cc = √(1 − LB⁻²);  cb = (1 − cc)/(1 + cc);  f = (1 + cb)/2;  g = (1 − cb)/2;  h = f/LB
ŝ(ψ) = g·cos ψ + √(h² + (f² − h²)·cos²ψ)          (support function of the flat ellipse: 1 head, h flank, cb back)
```
Vectors: forest LB(2, 3, 4, 5, 10, 20, 25, 30, 40, 60) = 1, 1.027, 1.091, 1.195, 1.539, 2.550, 3.272, 3.843, 4.986,
7.272; grass (5, 10, 20, 30) = 2.321, 3.202, 4.416, 5.331; grass ramp (3, 4) = 1.277, 1.729. LB 3.843: flank h 0.1324,
back cb 0.0175; LB 3: 0.1716, 0.0294; LB 2: ŝ(0, 45, 90, 135, 180°) = 1.0, 0.7518, 0.2679, 0.0955, 0.0718. On flat
ground the §7.4 ellipse with R_H = R_w, R_B = cb·R_w, R_F = h·R_w equals `R_w·ŝ(ψ)` exactly.

### 6.9 Intensity and flame height (P0) [V PyroXL gating, D28]

vesta2 (pine: §6.7):
```
FH = Vesta flame height (§6.2) ;  w = FA·(min(s, 10) + ns)  ;  if FH > 1 m: w += FA·el ;  if FH > 0.66·H_o,eff: w += 0.5·FA·canopy
I = 18600 · (w/10) · (ROS/3600)   kW/m   (= 0.5167·w·ROS with w t/ha, ROS m/h);   bark excluded (embers only)
```
grass: w = clamp(L, 1, 6); heath: w = s + ns + el; FH per §6.5/§6.6. Byram flame length `0.0775·I^0.46` is used only
for the refuge rule display (1.35, 2.56, 3.52, 5.36 m at 500, 2000, 4000, 10 000 kW/m). In fire/spread, ROS here is
the arrival normal ROS.
Vectors (s 14.5, ns 1.9, el 4.9, canopy 3.5, H_el 2.0, H_o,eff 20): ROS 2114, FA 0.95 → FH 18.83, w 17.62, I 19 248;
ROS 415, s 9.94, FA 0.72 → FH 5.80, w 12.05, I 2584; ROS 4000, FA 1 → FH 29.86, w 18.55, I 38 337;
ROS 100 (s 5, ns 1, el 1, FA 0.5, H_el 1) → FH 1.09, w 3.5, I 181.

### 6.10 Spotting envelope (P0) [V FBI-TG eq 3.51; monotone envelope D29]

```
S_raw(R) = |176.969·atan(FHS_s)·(R/U10^0.25)^0.5 + 1568800·FHS_s^−1·(R/U10^0.25)^−1.5 − 3015.09|   (m; R m/h)
S(R) = R < 150 ? 50 : R < 1000 ? 50 + (S_raw(1000) − 50)(R − 150)/850 : max(S_raw(R), S_raw(1000))
```
Vectors (U10 40, FHS_s 3.5): R 100 → 50; 150 → 50; 500 → 689; 1000 → 1603; 2000 → 3455; 4000 → 6114 m. (U 20,
FHS 2): 1000 → 1322; 2000 → 3037. Used as (a) `spottingDistance`, (b) the ember calibration target (§9.7), (c) the
"AFDRS says up to ~S km" line on spotting cards. Types with `spotting = true` use it whatever their family
(GrassyWoodland: the forest envelope with its FHS_s); types with `spotting = false` (grass, heath, Rainforest,
classes 16/19) report 0.

### 6.11 FBI and ratings (P0) [V FBI-TG v1.0; D14]

`FBI = floor(linear interpolation of the metric between breakpoints at FBI 0, 6, 12, 24, 50, 100; above the last
breakpoint interpolate to FBI 200 at 90 000 kW/m and extrapolate linearly beyond)`:

| table | metric | breakpoints |
|---|---|---|
| forest (vesta2, pine) | I kW/m | 0, 100, 750, 4000, 10 000, 30 000 |
| grass (Grassland) | I | 0, 50, 2000, 9000, 17 500, 25 000 |
| shrub (heath) | I | 0, 50, 500, 4000, 20 000, 40 000 |
| savanna (GrassyWoodland, Urban, eaten-out wetlands) | I | FBI 0/6/12/50/100 at 0, 100, 4000, 17 500, 25 000 (no 24 breakpoint) |

Variant tables `PYROXL_2024` (grass 0, 100, 3000, 9000, 17 500, 25 000; heath ROS-based 0, 1250, 2300, 3800, 7000,
14 000 m/h) are data behind a switch; the UI notes when the rating differs. Ratings: 0–11 **No rating**, 12–23
**Moderate**, 24–49 **High**, 50–99 **Extreme**, ≥ 100 **Catastrophic**; colours `#ffffff`/`#e0e0e0` border, `#64bf30`,
`#ffd200`, `#f78100`, `#c8102e` [K approximate AFDRS palette; confirm]. Vectors: forest 5000 → 28; 99 → 5; 100 → 6;
15 000 → 62; 30 000 → 100; 40 000 → 116; 90 000 → 200; grass 2500 → 12; grass 25 000 → 100; shrub 3000 → 20;
savanna 2000 → 8, 10 000 → 28, 20 000 → 66.
`fireDangerRating(fbi)` returns `{ rating, colour }` (the ARCHITECTURE name is kept; its argument is FBI). The FBI
shown to users and in `SimStats` is always the **AFDRS-parity** value (D41):
`afdrsFbi(fuelType, w, lonDeg, DF, KBDI)` takes the moisture period from `lmstHour(w.time, lon)`, the local month and
`w.cloudCover`, uses M_A (§5.3) of the type's moisture family at the grid-point T/RH, flat ground and the type's
steady-state row, and runs Vesta 2012 (FA = 0.1·DF; wet: min(FA_wet, 0.1·DF)), grass, heath 2024 or pine; intensity
per §6.9 with FA = 0.1·DF and FH from §6.2. Vectors (DryForestShrubby steady state, WRF 3.5, FHS 3.4/2.9, H_ns 20 cm;
20 Dec 15:00 LMST = period 1): 36 °C/T_d 2 °C/11 m/s/DF 9 → ROS 2360 m/h, I 20 359 kW/m, **FBI 75**; 42/−3/15 m/s/DF 10
→ I 35 785, **FBI 109**; 20/7.7/4 m/s/DF 6 → I 826, **FBI 12**; 21:00 LMST (period 3) 21 °C, T_d 6, 2 m/s, DF 7 →
**FBI 7**.

### 6.12 Spread factors and validity (P0) [D45]

`SpreadFactors` at a cell's arrival (fire/spread fills it from the kernel; §7.12 uses it for the driver). Let
`R(U, M, FA, fuel)` be the flat head kernel with its R0 floor, `generic` the steady-state type row (generic class,
type WRF; grass: natural state at curing 100), `M_ref = 10 %`, `FA_ref = 1`, U = the cell's U10 (fire wind):
```
base      = R(0, M_ref, 1, generic)                     (m/s; vesta2: 30·φM(10) = 15.43 m/h)
wind      = R(U, M_ref, 1, generic) / base
fuel      = R(U, M_ref, 1, cell) / R(U, M_ref, 1, generic)       (loads, FHS, heights, WRF, curing, grass state)
moisture  = R(U, M, FA, cell) / R(U, M_ref, 1, cell)             (includes FA; > 1 when drier than 10 %)
slope     = R_hyb / R_w                                           (§7.3, relative directional slope and Kataburn included)
direction = R_ell(ψ) / R_H                                        (§7.4 ellipse at the arrival normal; 1 at the head)
terrain   = ROS_arrival / (base·wind·fuel·moisture·slope·direction)
          (= G · build · cap ratios · (1 + R_VLS|n·t̂|/R_ell) · junction: the mountain and dynamic residual)
build     = b (§7.8);   fireWindShare = |U_fireInd| / max(|U_fire|, 0.1)     (U_fireInd from §8.8)
```
The product `base·wind·fuel·moisture·slope·direction·terrain` equals the arrival ROS to < 1 % (test; exact up to
float rounding). Vector (DryForestShrubby 2 yr after a p = 0.6 prescribed burn: FL 9.40, H_u 1.018; U10 15 km/h, M 8 %,
DF 8 → FA 0.950, WRF 3.5, flat): base 15.43 m/h, wind 28.03, fuel 0.311, moisture 2.133, R_w 286.7 m/h; the
long-unburnt neighbour: fuel 1.000, moisture 1.281, R_w 554.3 m/h. `validated=false` when: θ_head > +20° or < −30°,
U10 < 5 or > 70 km/h (Mk2) or outside the family's data range, M < 4 % or > 20 % (vesta2), C < 20 % (grass), wrf
outside [3, 5] (wet C1), SF cap or the forest 15 km/h cap reached, or any [H] mountain multiplier > 1.3.

---

## 7. `fire/spread` — level-set spread, mountain phenomena, attribution

### 7.1 State, caches and conventions (P0)

The fire grid is `terrain.grid` (§0.2). Map-plane convention [H, UNVERIFIED which convention the empirical slope data
used]: the empirical ROS is treated as the **horizontal** (map-plane) speed and loads as per horizontal area; no
cos θ corrections anywhere (doc 07 §4.3: the two corrections partly cancel in I).

Per-cell arrays (Float32 unless noted): `phi` (level set, m), `tArr` (= FireField.arrivalTime, +∞), `origin` (time
of the ignition that reached the cell), `E` (engagement 0–1), `junction` (boost, decaying), plus the `FireField`
outputs and `FireAux`. Static cache per cell (built at init and after edits): `CellFuelParams`, trench T, gullyAxis,
along-gully slope α, barrier (Uint8), breakWidth. Per-step cache for **prepared cells** (unburnt band cells with
0 < φ ≤ 4Δx): `R0, R_w (with the U10 and M it was computed at), e, θ_e, R_hyb, A, G, LB, R_H, R_B, R_F, windTo`.
`R_w` is recomputed only where |ΔU10| > 2 % or M changed since the last prepare. Other band cells keep their last
cached speeds (burnt cells: frozen φ).

`TerrainFeatures` (§2.2) is computed once per scenario by `computeTerrainFeatures(terrain, derived)` in
`src/fire/terrainFeatures.ts` (explain/ and atmosphere/ import it). `crest(k, windFrom)` caches results **for the
current 22.5° sector only** (Float32 d, zCrest, relief, Int32 kCrest per cell) and recomputes on a sector change
(caching all 16 sectors would take ≈ 17 MB).

### 7.2 Level-set step (P0) [V WRF numerics; corrected CFL and one-sided viscosity D1]

```
init: phi = 9Δx everywhere; ignition: phi = min(phi, signedDistance(ignition geometry) − r_ign),
      r_ign = max(radius ?? 0, 0.75·Δx); line/area ignitions rasterised as distance to the polyline/polygon;
      cells with phi ≤ 0 at ignition get tArr = t_ign, origin = t_ign (line ignitions: §7.8)
band = cells with |phi| ≤ 8Δx (recomputed at each reinitialisation), processed as a sorted index list;
      igniteAt/ignite insert the affected cells into the band list immediately
ghost cells: one ring outside the domain by linear extrapolation of phi; a front reaching the edge sets aux.leftDomain
per fire sub-step Δt_f (inside one atmosphere step):
  for k in band:
    upwind |∇φ|² = max(D⁻ₓφ,0)² + min(D⁺ₓφ,0)² + max(D⁻ᵧφ,0)² + min(D⁺ᵧφ,0)²        (Sethian, outward motion)
    n = ∇φ/|∇φ| by central differences (fallback e if |∇φ| < 1e-6)
    R = normalSpeed(k, n)                                                    (§7.4; 0 on barriers)
    tend = −R·|∇φ| + ν·R·Δx·min(0, ∇²φ)   (5-point Laplacian; ν = 0.2; viscosity only on concave parts: merge cusps)
  Heun RK2: φ* = φⁿ + Δt·tend(φⁿ);  φⁿ⁺¹ = ½(φⁿ + φ* + Δt·tend(φ*));  grows-only: φⁿ⁺¹ = min(φⁿ, φⁿ⁺¹)
  arrival: if φⁿ > 0 ≥ φⁿ⁺¹: tArr = t + Δt·φⁿ/(φⁿ − φⁿ⁺¹); record factors, driver, phase, ros, intensity, FH, spreadDir
maxStableDt() = 0.9 / max_band[ R·((|n_x| + 2ν)/Δx + (|n_y| + 2ν)/Δy) ]        (0.9 safety; ∞ if no band)
reinit every 10 sub-steps: fast sweeping (4 orderings × 2 iterations) of |∇φ| = 1 inside ±8Δx, keeping the zero
  crossing cells fixed (their φ from linear interpolation of the crossing); afterwards φ = sign(φ)·9Δx outside the band
```
`step(dt, env)` sub-steps with Δt_f = min(maxStableDt(), remaining) and asserts Δt_f ≤ 1.0001·bound. Global numeric
ROS cap 6 m/s (21.6 km/h) [V WRF `ros_max`]. Bound vectors (ν 0.2, diagonal front): Δx 20 m, R 1 m/s → 8.13 s
(axis 10.0 s); Δx 20, R 3 → 2.71 s; Δx 30, R 1 → 12.19 s; Δx 30, R 6 → 2.03 s (ν 0 / 0.1 / 0.4 at Δx 20, R 1: 12.73 /
9.92 / 5.97 s). Measured head speed of a pure LB 3.84 ellipse after 30 min (point ignition): 0.959 × analytic at
Δx 30 m one-sided (0.854 with the two-sided term); expanding circle 200 → 1400 m: axis 1399.8, diagonal 1385.6 m.

### 7.3 Head vector: hybrid wind–slope rule (P0) [H doc 01 §4.2; D3, D44]

Per prepared cell per atmosphere step, with R0 and R_w from the kernel (§6.2; `R_w ≥ R0`), θ = cell slope (deg),
ψ_up = upslope azimuth, ψ_w = windTo (of U_fire):
```
s⃗ = (SF(θ) − 1)·R0 · û(ψ_up) ;   w⃗ = (R_w − R0) · û(ψ_w) ;   v⃗ = s⃗ + w⃗
e = |v⃗| > 1e-6 ? azimuth(v⃗) : (isNaN(ψ_up) ? ψ_w : ψ_up)   (ψ_w := 0 when |U| < 1e-6; flat + calm is a circle)
(flat cells: aspect NaN → s⃗ = 0, θ_e = 0)
θ_e = atan(tan θ · cos(e − ψ_up))                              (directional slope along e)
R_mult = R_w · SF(θ_e) ;   R_add = R0 + |v⃗|
d = angle(ψ_w, ψ_up) ∈ [0°, 180°] ;   b = smoothstep(30°, 60°, d)
R_hyb = (1 − b)·R_mult + b·R_add ;   if θ_e < 0: R_hyb = min(R_hyb, R_w·SF(θ_e))          (Kataburn bound, D3)
SF(θ) = θ ≥ 0 ? min(16, 2^(θ/10)) : s/(2s − 1), s = 2^(−θ/10)                   (D2, D3)
then gully steering (§7.7) recomputes e, θ_e, R_hyb; the head R_H follows in §7.4
```
Vectors (R0 26, R_w 1681 m/h, θ 20°, ψ_up 90°): ψ_w 90 → e 90.0, R_hyb **6724**; ψ_w 45 → e 46.8°, θ_e 14.87°, R_mult
4712.1, R_add 1737.0, b 0.5, R_hyb **3224.6**; ψ_w 0 → e 2.7°, R_hyb **1682.8**; ψ_w 270 → e 270°, θ_e −20°, R_add
1603.0, **R_hyb 960.6** (Kataburn bound); no wind (R_w = R0) → e 90, R_hyb **104.0**. SF(−40…40 step 5/10): −40 0.516,
−30 0.533, −20 0.571, −10 0.667, −5 0.773, 0 1, 5 1.414, 10 2, 15 2.828, 20 4, 25 5.657, 30 8, 35 11.314, 40 16.

### 7.4 Normal speed: convex three-speed ellipse (P0) [D20; doc 07 §3.2]

```
prepare(k):     (after §7.3, §7.6, §7.7, §7.8; b = build, G = amplifier gain)
  LB   = LB(U_axis) (§6.8);  LB_b = 1 + (LB − 1)·b;  cb, h from LB_b
  R_H  = R_hyb·G·b ;  if family ∈ {vesta2, pine}: R_H = min(R_H, 15 km/h)  (D4; validated = false when capped)
  R_B  = min(R_H, max(cb·R_w, R0)·SF(θ(e + 180°))·b)                     θ(ψ) = directional slope along ψ; θ(e+180) = −θ_e
  R_F  = h·R_w·½[SF(θ(e + 90°)) + SF(θ(e − 90°))]·b
  a = (R_H + R_B)/2 ;  c = (R_H − R_B)/2 ;  bF = R_F
normalSpeed(k, n):
  if barrier[k] or burnState[k] === NonFlammable: return 0
  ψ = angle(n, e)  (cos ψ = n·ê)
  R = c·cos ψ + √(a²·cos²ψ + bF²·sin²ψ)       (support function of an offset ellipse: convex; R(0) = R_H, R(180°) = R_B, R(90°) = R_F)
  R += R_VLS(k) · |n·t̂_k|                     (§7.9; t̂ = contour tangent)
  R *= junction[k]                             (§7.10)
  return min(R, 6 m/s)
```
The directional slope is inside the three speeds, never a multiplier on R(ψ): a speed function multiplied by
`SF(θ_n)/SF(θ_e)` is not convex, and a level set then propagates its Wulff shape (head extent 0.96/0.76/0.55 of R_H
at 20/30/40° calm). Vectors: calm 30° plane (R_w = R0 = 26 m/h, LB 1): R_H = 8.0·R0, R_B = 0.533·R0, R_F = 1.0·R0;
R(45°) = 5.739·R0, R(135°) = 0.459·R0. Upslope wind case of §7.3 (R_hyb 6724, R_w 1681, LB 3.843, G = b = 1): R_B 16.84,
R_F 222.5; R(0, 45, 90, 135, 180°) = 6724.0, 4759.8, 222.5, 17.1, 16.8 m/h. Weak wind blowing downslope on 30°
(R0 26, R_w 100): e upslope, R_H 134, R_B = 100·0.533 = 53.3 (≥ the calm backing 13.9).

Sub-cell breaks (`breakWidth[k] > 0`): the first time the front reaches k, draw once (fire RNG stream) with the
Wilson breach probability `P = z/(1 + z), z = exp(1.36 + 0.00036·I − b·W)`, b = 0.38 if any cell within 20 m has
canopyCover ≥ 0.3 else 0.99, I = upwind intensity, W = breakWidth; not breached → the cell becomes a barrier for 30 min
(then re-draw) and raises `fuel-break-breached` (on breach) [V formula, 3 of 4 AFDRS-RP checks]. Vectors: (2000 kW/m,
3 m, no trees) 0.291; (2000, 5, no) 0.054; (5000, 10, trees) 0.345; (5000, 3, trees) 0.883; (10 000, 3, trees) 0.979.

### 7.5 Heat release and burn state (P0) [D doc 07 §3.6, D27]

```
w_c = intensity fuel of §6.9 (t/ha) → kg/m²: w_c/10 ;  τ_f = CellFuelParams.tauF
q(t) = HEAT_YIELD·(w_c/10)/τ_f · exp(−(t − tArr)/τ_f)      (kW/m², total heat; ∫₀^∞ q dt = H·w)
heatRelease(): per cell, the exact integral of q over the current atmosphere step divided by Δt_a;
  q = 0 once t − tArr > 7τ_f (loss e^{−7} = 0.09 %)
crownShare(): per cell, the share of w_c from the canopy term (0.5·FA·canopy or pine CFB·FA·canopy)/w_c
burnState: Burning while t − tArr < 3τ_f, then BurntOut; NonFuel/Water/cliff → NonFlammable
frontCells(): cells with Burning state and at least one unburnt 4-neighbour;  firePowerW(): Σ q·Δx_f²·1000 (W)
```
The atmosphere multiplies by χ_c = 0.85 (§8.7). Smouldering (coarse fuel, bark) is not in the heat flux; it is kept
only for embers' holdover and the "contained is not out" teaching (explain uses t − tArr < 6 h in HeavyFuel cells).

### 7.6 Attachment / eruptive amplifier (P1, on with `mountainPhenomena`) [H doc 01 §4.3; D4, D33]

Trench score (once): for drainage cells, sample the terrain perpendicular to `gullyAxis` at 10 m steps to ±150 m;
on each side find the crest (maximum rise) → rise h_L, h_R and mean wall slope δ_L, δ_R (atan(rise/distance)):
```
h_g = min(h_L, h_R) ;  T = clamp((min(δ_L, δ_R) − 10°)/10°, 0, 1) · clamp((h_g − 10 m)/20 m, 0, 1)
side walls within 60 m of an axis cell: T = T_axis·(1 − d/60 m)      [H]
gullyBase: lowest cell (min z) of each 8-connected drainage segment with T ≥ 0.3
```
Per prepared cell per atmosphere step:
```
S(x; c, w) = 1/(1 + exp(−4(x − c)/w)) ;  A = S(θ_e; 22°, 6°) · max(T, 0.4) · W_align
W_align = 1 if d ≤ 60° or U10 < 10 km/h;  0.5 if d ≥ 120° and U10 ≥ 10;  linear between
E: dE/dt = (A − E)/τ_e, τ_e = 180 s (exact exponential update per atmosphere step); a cell entering the band takes
   the maximum E of its burnt 8-neighbours
s_res = m_f·clamp(U_fireInd·û(ψ_up)/(3 m/s), 0, 1)        (resolved fire indraft up the slope replaces the amplifier)
G = 1 + (G_max − 1)·A·E·(1 − s_res) ,  G_max = 2.5 (user 1.5–4)
```
There is no separate ROS relaxation state: E provides the lag (G rises with τ_e, falls as soon as A falls), so wind
changes act without delay. Vectors (W_align 1, s_res 0): A(15°, T 0) 0.004; A(20°, 0.5) 0.104; A(22°, 1) 0.500;
A(25°, 1) 0.881; A(28°, 1) 0.982; A(30°, 0.2) 0.398; A(35°, 1) 1.000; steady G = 1 + 1.5A²: 1.000, 1.016, 1.375, 2.164,
2.447, 1.238, 2.499. When `A·E > 0.3` the cell's factors carry `validated = false` and explain adds "eruptive regime:
model indicative".

### 7.7 Gully-axis steering (P1) [H doc 01 §4.2 item 6]

Where T ≥ 0.5, the along-gully slope α (directional slope along `gullyAxis`) ≥ 15° and angle(e, gullyAxis) ≤ 90°:
rotate e toward `gullyAxis` by the fraction `w = clamp((α − 15°)/15°, 0, 1)` (shortest-arc interpolation), and
recompute θ_e and R_hyb with the new e. This keeps a gully fire running up the gully, not straight up a side wall.

### 7.8 Acceleration / build-up (P0) [K FBP α; H use]

`age = t − origin[k]` (origin propagates: a newly arrived cell takes the minimum `origin` of its burnt 8-neighbours;
ignition cells take the ignition time). `build = max(0.1, 1 − e^{−α·age_min})`, α = 0.115 min⁻¹, doubled where
A·E > 0.3; line ignitions of length L start with `origin = t_ign + 60·ln(1 − b₀)/α` s, `b₀ = min(0.9, L/500 m)` (ln < 0,
so the origin precedes t_ign and build starts at b₀) [H]. Apply `b = build` to R_H, R_B and R_F and shrink the shape,
`LB_b = 1 + (LB − 1)·b` (§7.4). Vectors: build(1, 6, 10, 20, 26 min) = 0.109, 0.498, 0.683, 0.900, 0.950.

### 7.9 VLS and lee separation (P1, `mountainPhenomena`) [doc 02 §4.5 corrected, D22–D25, D42]

Crest search `crest(k, windFrom)`: march from cell k toward windFrom in 30 m steps up to 600 m; the crest is the first
`ridge` cell with z > z_k after which the terrain descends windward (break of slope); returns d, z_crest, kCrest and
relief = z_crest − (valley floor below k, from heightAboveValley). **U_ridge(k) = |U_bg10| at kCrest** (10 m
open-equivalent background wind, no fire, §8.8; NaN if no crest) — sim passes it in `SpreadEnvironment.uRidge`.
```
lee      = isNaN(aspect) ? 0 : cos(aspect − windTo)
S_slope  = smoothstep(18°, 28°, slope30)            (edges assume a ~30 m DEM; UNVERIFIED calibration)
S_aspect = smoothstep(cos 45°, cos 25°, lee)
S_wind   = smoothstep(3.5, 6.5 m/s, U_ridge)
S_ridge  = crest exists with d ≤ 300 m  and  (z_crest − z_k) ≤ relief/3   (upper third of the lee slope)
S_fuel   = smoothstep(12 %, 8 %, M)                  (1 at ≤ 8 %, 0 at ≥ 12 %)
VLS      = S_slope·S_aspect·S_wind·S_ridge·S_fuel
```
Vectors (S_ridge 1): (slope 25°, aspect 90°, wind from 270° at U_ridge 30 km/h, M 6) → 0.784; (22°, 120°, same) →
0.315; (30°, 90°, 5 m/s) → 0.500; (30°, 90°, 40 km/h, M 10) → 0.500; S_ridge 0 → 0; U_ridge 2.5 m/s → 0.
**Activation**: a connected VLS zone (cells with VLS ≥ 0.5, 4-connected; labelled in `refreshMasks`) activates when
any of its cells is burning **and** the maximum intensity of burning cells within 300 m upwind of that cell (march
toward windFrom in Δx steps, ±1 cell laterally, crest cells included) is ≥ 4000 kW/m. It stays active while that
holds, plus 10 min. (Lee-slope cells themselves back against the eddy at ≈ 25 m/h and ≈ 200 kW/m, so their own
intensity cannot be the trigger.) In an active zone
```
v = clamp((VLS − 0.5)/0.5, 0, 1) ;  R̄ = (0.4 + 2.4v) km/h ;  R_VLS(t) = R̄·[1 + 0.8·sin(2π(t − t_act)/T_p)] ,
T_p ~ U(10, 15) min per zone activation (fire RNG) ;  t̂ = unit contour tangent (⊥ ∇z), both directions
```
Time-mean 2.0 km/h at v = 0.67 (range 0.4–3.6), 2.8 km/h at v = 1 (0.56–5.0) (D23), plus ember injection ×2.5 and
in-plume α_p 0.4 (§9.2–§9.4).
**Lee separation** weight for the fire wind (`aux.sep`, owned by `fire/spread.refreshMasks()`, passed to atmosphere/
in `FireWindContext.sep`, applied in `surfaceWindForFire`, §8.8):
`s_sep = smoothstep(15°, 25°, slope30)·smoothstep(cos 60°, cos 30°, lee)·smoothstep(4.2, 6.9 m/s, U_ridge)·[d ≤
min(5·relief, 1000 m)]`; `U_fire ← (1 − s_sep)·U + s_sep·(0.3·U_ridge·û(ψ_up))`. Vectors: (20°, lee 0°, 6 m/s) 0.370;
(25°, 0°, 6) 0.741; (25°, 0°, 5.56 = 20 km/h) 0.506; (18°, 20°, 4) 0.000; (30°, 45°, 8) 0.598.

### 7.10 Junctions (P1) [K geometry, H boost; doc 01 §4.5]

Only when the pyrogenic potential is off (`env.pyrogenicOn === false`, 3-D tiers). Every 60 s: for unburnt band
cells with 0 < φ ≤ 2Δx, collect the outward normals of front cells within 3Δx; if two of them differ by ≥ 120°
(included angle θ₀ = 180° − Δψ ≤ 60°) set `junction[k] = max(junction[k], 1 + 0.5·(min(1/sin(θ₀/2), 6) − 1))` [H: half
the geometric factor, because the level set already closes a V geometrically], decaying toward 1 with τ = 300 s.
Driver Junction. Geometric factors 1/sin(θ₀/2) at θ₀ = 10, 20, 30, 40, 60°: 11.47 (capped 6), 5.76, 3.86, 2.92, 2.00.

### 7.11 Rolling debris (P1) [H doc 01 §4.6]

Every 60 s, per burning cell with θ ≥ 25° and (HeavyFuel or barkHazard ≥ 3): `n ~ Poisson(λ·1 min)`,
`λ = 0.02·S(θ; 30°, 4°)·(HeavyFuel ? 1 : 0.5)`. Each item follows the D8 steepest-descent path; per 10 m of travel it
stops with p = 0.05 + 0.3·clamp(FHS_el/4, 0, 1), and always where slope < 15°. At the stop cell, if unburnt and
burnable: ignite with probability `ignitionProbability(T_f, M)·R_fuel` after a delay U(30, 300) s, driver Spotting,
provenance class 'heavy'. Keep the last 10 min of trajectories in `FireAux.debris` for render/explain.

### 7.12 Spread-driver attribution (P0)

At arrival, in this order (first match wins):
1. seeded by a spot or debris ignition (cell within the seed radius) → `Spotting`;
2. `R_VLS·|n·t̂| ≥ 0.3·R` → `LateralVorticity`;
3. junction boost ≥ 1.3 → `Junction`;
4. G ≥ 1.3 → `Eruptive`;
5. `direction ≤ 0.3` (flank/back part of the ellipse, §6.12) → `Backing`;
6. fireWindShare ≥ 0.3 → `FireInducedWind`;
7. with ℓ_w = ln max(wind, 1), ℓ_s = ln max(slope, 1), ℓ_m = ln max(moisture, 1) and ℓ_f = |ln fuel|: if
   max < ln 1.2 → `None`; if ℓ_w and ℓ_s both ≥ 0.4·max → `WindAndSlope`; else the largest of Wind / Slope /
   DryFuel (ℓ_m, only when moisture ≥ 1.5) / Fuel.
`phase` = Mk2 phase (0 for non-vesta families). `evaluateCell(k, env)` (used by explain `explainAt` for unburnt
cells) runs the same prepare + normalSpeed + attribution code with n = ê and returns `CellEvaluation` (§2.2); explain
never re-implements spread logic.

### 7.13 FireAux, checkpoints, ignition API, tests (P0)

`FireAux` (§2.2) also carries `nc` (Byram N_c per front cell, §8.10, computed with env.airT/airRho), `cfb` (pine),
`frontDist` (distance transform of burning cells, refreshed every 60 s) and `direction`.
```ts
igniteAt(x, y, time, driver = SpreadDriver.Spotting): boolean   // false if non-burnable or already burnt; radius 0.75Δx
checkpoint(): { phi, tArr, origin, E, junction, vls zone labels + t_act + T_p, breach timers, debris in flight,
  field arrays, aux rasters, rng state }   // typed-array copies
```
Tests: the §7.2–§7.10 vectors; expanding circle (R 1 m/s, Δx 20 m, ν 0.2, Δt at 0.9 bound, radius 200 → 1400 m): burnt
area within 5 % of πr² and axis/diagonal radius within 2 %; the same at 1.2× the bound is rejected by the guard;
constant-wind ellipse matches the analytic offset ellipse (area ±5 %, head/back positions within max(1 cell, 3 % of
travel)); two circles merge without oscillation; calm 30° plane (Δx 10 m, arrival-time gradient 100–300 m up,
20–60 m down): head/flat = 8.0 ± 5 %, back/flat = 0.533 ± 5 %; calm 20° plane: ×4.0 and ×0.571 ± 5 % (V1); restore
then step is bitwise equal to an uninterrupted step.

---

## 8. `atmosphere/` — background, 3-D solver, thermal flows, fire wind

### 8.1 Grid, metric and canopy (P0) [doc 07 §7.5–7.6]

- **Horizontal**: `Δx_a = clamp(extent/N_tier, 100 m, 270 m)`, N_tier = 45 (standard) / 60 (high) (9 km → 200/150 m;
  3 km → 100 m, 30 columns; 12 km → 267/200 m). MAC staggering (u, v, w on faces; p, θ′, smoke at centres). Terrain =
  `terrainHiRes` (10 m) block-averaged to the cell (fallback: the fire-grid terrain), then smoothed with a 3×3
  Gaussian until max slope ≤ 35°. Davies zone width `n_D = max(3, round(0.1·nx))` cells.
- **Vertical**: Gal-Chen terrain-following, `ζ = H′(z − z_s)/(H − z_s)`, H = z_min + H′, `H′ = max(atmosTop, relief +
  2000 m)`; nz = tier levels; geometric Δζ_k = Δζ₁·r^k with Δζ₁ = tier value (standard 30 m, high 25 m) and r solved
  so ΣΔζ = H′ (vectors: 24 levels/3000 m, Δζ₁ 25 → r = 1.1211; 20/3000, Δζ₁ 30 → 1.148). Physical height of level k in
  column c: `z_s + ζ_k·(H − z_s)/H′`. `AtmosphereView.levels[k] = ζ_k` (flat levels above z_min, §2.2).
- **Metric** (normative, all tiers that run 3-D): with derivatives at constant ζ,
  ```
  J = (H − z_s)/H′ ;  ζ_x|z = z_s,x·(ζ − H′)/(H − z_s)  (same for y) ;  ζ_z = 1/J ;  z_x|ζ = z_s,x·(1 − ζ/H′)
  contravariant vertical velocity  ω = (w − u·z_x|ζ − v·z_y|ζ)/J
  divergence  ∇·u = (1/J)·[∂x(J·u) + ∂y(J·v) + ∂ζ(J·ω)]
  gradient of a scalar p:  (∂p/∂x)_z = p_x + ζ_x p_ζ ,  (∂p/∂z) = p_ζ/J
  elliptic operator ∇·(K∇p) (K = R_h, R_v or 1):  (1/J)[∂x(J K_h (p_x + ζ_x p_ζ)) + ∂y(J K_h (p_y + ζ_y p_ζ))
      + ∂ζ(J (K_h ζ_x (p_x + ζ_x p_ζ) + K_h ζ_y (p_y + ζ_y p_ζ) + K_v p_ζ/J²))]
  ```
  The smoother and the coarse grids use the **7-point part** (J K_h p_xx, J K_h p_yy and the ζζ coefficient
  J(K_h(ζ_x² + ζ_y²) + K_v/J²)); the cross terms (p_xζ, p_yζ) enter the residual only (defect correction, §8.5).
  Semi-Lagrangian back-traces use (u, v, ω) in (x, y, ζ); buoyancy and `−w·dθ_env/dz` use the physical w.
- **Canopy roughness** (D51): per column, `H̄ = mean over its fire cells of canopyHeight·min(1, canopyCover/0.3)`;
  `z₀ = max(0.01 m, 0.1·H̄)`, `d = 0.67·H̄`; `z_eff = max(z₁ − d, 10·z₀)`; `C_D = min(0.030, [κ/ln(z_eff/z₀)]²)`
  (z₁ = first level centre AGL). Vectors: H̄ 20 m → C_D 0.030; grass (z₀ 0.01, z₁ 15 m) → 0.0030.

### 8.2 Background profile, stratification and κ (P0) [doc 07 §7.7–7.8; D30, D34]

`setAmbient(a, b)` builds, for each of the two bracketing stamps (cached by time), the profile u_prof(z) and θ_env(z_ASL)
from the grid-point weather:
1. Wind samples: 10 m (WeatherHour), `windProfile` heights (80/100/120/180 m AGL where non-null), pressure levels at
   geopotential height − z_gp (z_gp = `sourceElevation`; drop levels below ground + 50 m). Interpolate u, v linearly in
   ln z below 500 m AGL, linearly in z above, constant above the highest sample.
2. **Missing upper air** (`upperAirSource = 'synthetic'`: all replays; ERA5 has 100 m wind only) [H]: above the highest
   sample, `u(z) = u_top·(z/z_top)^0.14` up to 1000 m AGL, constant above; θ_env synthetic: day (sun > 5°): θ constant
   up to z_mix = BLH ?? 1500 m AGL, then dθ/dz = 3.3 K/km; **night: 3.3 K/km throughout** (the surface inversion comes
   only from the §5.2a cold-pool θ′, so the two never stack). C-Haines and PFT are disabled (cards say "upper-air data
   unavailable for this date").
3. θ_env from pressure levels when present (`'model'` or `'preset'`): θ = (T + 273.15)(1000/p)^0.2857 at each level
   height, plus the 2 m value at z_gp. N² = (g/θ)dθ/dz. **Wherever N is used** (Froude number, Briggs, plume) use
   `N = √max(N², 1e-6 s⁻²)`; a superadiabatic layer (hot afternoons, 2 m θ above the 850 hPa θ) must not produce NaN.
4. Cold pool: θ′ = −Δθ(t)·(1 − hav/h_inv) where hav < h_inv (Δθ, h_inv from §5.2a); the Davies target for θ′ contains
   the same cold pool (otherwise the boundary drains it).
5. **κ(z) = |u_prof(10 m)| / max(|u_prof(z)|, 0.5 m/s)** per stamp (interpolated in time with u_bg). It converts the
   model wind at z_ref back to the forecast's 10 m open-equivalent scale (D30). The open log law
   `ln(10/0.03)/ln(z/0.03)` (0.7831 at 50 m) is only the fallback for a degenerate profile (|u_prof(z)| < 0.5 m/s).
   Fixture check: median U80/U10 = 1.51 (Katoomba forecast), 1.50 (gospers), 1.54 (grose), 1.59 (thredbo), ERA5
   U100/U10 1.72 (katoomba-2013); with rev. 1's log law these gave U10_fire/U10 = 1.09–1.18 at the median and 1.30–1.78
   at P90.

### 8.3 Mass-consistent background wind u_bg (P0) [V WindNinja `ninja::discretize`]

Minimise ∫[α_h²((u − u₀)² + (v − v₀)²) + α_v²(w − w₀)²]dV subject to ∇·u = 0 →
`∇·(R∇φ) = −∇·u₀` with R = diag(R_h, R_h, R_v), R = 1/(2α²), u = u₀ + R∇φ (operator of §8.1).
`α_h = 1, α_v = α_h·clamp(1/Fr_h, 1, 10)` [H stability weighting], `Fr_h = U/(N·h)` with U = profile speed at
z_min + relief, N over the relief layer (floored, §8.2), h = relief; a non-finite α_v is set to α_h.
**Boundary conditions** (WindNinja): φ = 0 (Dirichlet) on the lateral and top faces (flow may pass), ∂φ/∂n = 0 at the
ground (no penetration). **First guess** (doc 07 §7.7):
```
u₀(z) = z − z_s ≤ 300 m ? u_prof(z − z_s)                                   (terrain-following near the ground)
      : z − z_s ≥ 800 m ? u_prof(max(10 m, z − z_gp))                          (same ASL height as the grid-point column)
      : linear blend of the two in z − z_s
```
**User wind edits** (`WindEdit`, §11.5) enter only here: for stamps with time ≥ edit.time, `u₀ ← (1 − w)u₀ + w·u_edit`
with `w = exp(−(d/r)²)·(1 − smoothstep(0, 300 m, z − z_s))`, then solve (no post-blend anywhere else).
**Time**: solve at every series stamp (warm-started, cached); `u_bg(t) = (1 − a)·u_bg(h) + a·u_bg(h+1)` (a linear
combination of divergence-free fields is divergence-free). If the direction differs by > 20° between consecutive
stamps more than 10 min apart, solve extra stamps at 10-min intervals from the interpolated ambient (preset series
are already 10-min inside change ramps, §11.3).

### 8.4 Dynamics step (P1 standard/high tiers) [doc 07 §7.1–7.4, §9.1]

Dry Boussinesq perturbation form, `b = gθ′/θ₀`, advect θ′ (not θ) with `−w·dθ_env/dz` added explicitly. One step:
```
1  semi-Lagrangian advection of u, v, w, θ′, smoke (RK2 midpoint back-trace in (x, y, ζ) with (u, v, ω), trilinear)
2  w += Δt·g·θ′/θ₀                       ← buoyancy FIRST
3  θ′ += −Δt·w·dθ_env/dz                 ← with the NEW w (forward–backward; never reorder, doc 07 §7.2)
4  heat sources: θ′ += Δt·(Q_fire + Q_h profile)/(ρ c_p Δz)·(1/Π)   (§8.6, §8.7; W/m² per horizontal area); cap θ′ ≤ +60 K
5  implicit drag (lowest level): u₁ ← u₁/(1 + Δt·C_D|u₁|/Δz₁), C_D from §8.1
   implicit nudging: u ← (u + Δt·w_n/τ_n·u_bg)/(1 + Δt·w_n/τ_n), τ_n = 45 min, taper w_n (below)
   implicit sponge (top z_d = 800 m): w ← w/(1 + Δtγ), γ = 0.2·sin²(π/2·(z − z_b)/z_d) s⁻¹; u, v, θ′ relax to bg at 0.01 s⁻¹
6  Smagorinsky: K_m = (0.25ℓ)²·√max(0, D² − N²/Pr), Pr = 1/3, K_h = 3K_m, ℓ_h = Δx, ℓ_v = Δz, K ≤ 0.1ℓ²/Δt;
   horizontal explicit, vertical implicit (tridiagonal); diffuse θ′ about θ_env(z_ASL)
7  projection: ∇·(∇p′) = (ρ₀/Δt)∇·u*, multigrid V(2,2) (§8.5): standard 1 cycle, high 2, tol 1e-3; u ← u* − (Δt/ρ₀)∇p′
8  Davies relaxation zones (n_D cells): ψ ← ψ − Δt·λ(d)(ψ − ψ_bg), λ(d) = e^{−d/2}/(5Δt); for u and v, λ × w_n(z)
```
Nudging taper [H doc 07 §7.10], continuous in the stable-night strength sn (§5.2a):
`w_n(z) = (1 − sn)·w_day + sn·w_night`, `w_day = 0.3 + 0.7·smoothstep(50, 150 m, z − z_s)`,
`w_night = smoothstep(z_low, z_low + 300 m, z_ASL)` with `z_low = min(P90 terrain elevation, z_floor,col + h_inv)`
(z_floor,col = z_s − heightAboveValley of the column). The same w_n multiplies the Davies u, v relaxation so the
boundary does not push ridge-level wind into decoupled valleys; as Δθ decays after sunrise (§5.2a) w_n returns to
w_day smoothly. Vorticity confinement ε = 0 (visual-only ≤ 0.1, never fed to ROS).
`Δt_a = clamp(3·min(Δx/|u|max, Δz_min/|w|max), 3 s, 12 s)`. **Spin-up**: 900 s without fire, run as
t ∈ [t0 − 900 s, t0) with the t0 ambient, t0 surface heating and the §5.2a cold pool (`spunUp = true` after it); these
steps are also the auto-tune timing sample (§12.6).

### 8.5 Pressure / mass-consistent solver (P0) [V doc 07 §7.4 measurements]

Multigrid: horizontal semi-coarsening (nx, ny halve; nz fixed) down to ≤ 8 cells, z-line (tridiagonal) zebra
relaxation, bilinear prolongation, full-weighting restriction, metric cross terms in the residual only (defect
correction); if the residual reduction per V-cycle is worse than 0.3 on steep terrain, wrap as a preconditioner for
BiCGSTAB. **Boundaries**: mass-consistent solve — §8.3 (Dirichlet lateral/top, Neumann ground). Dynamic projection —
Neumann at the ground, p′ = 0 on outflow faces (u_bg·n_out > 0), Neumann elsewhere; if no face is Dirichlet
(all-Neumann), subtract the mean of the source and of p′ (compatibility). Acceptance: 48×48×24, Δx 150 m, stretched
Δζ₁ 20 m r 1.13: residual × < 1e-5 after 4 V-cycles.

### 8.6 Surface heating and slope flows (P0 heat flux; P1 top-up) [V WindNinja `cellDiurnal.cpp`; D50]

Per fire cell k (sun = `insolation(terrain, t, {ghi, cloudCover})` on the fire grid, cloud fraction N ∈ [0, 1], T = the
cell air temperature in K):
```
Q_sw = sun.total[k]                       (slope, cast shadow, sky view, diffuse and cloud already applied — D50)
Q*   = [(1 − A)·Q_sw + 5.31e-13·T⁶ − σT⁴ + 60N]/(1 + 0.12)
B    = 1 + 3·smoothstep(50, 150, KBDI)     [H: dry soil, higher Bowen ratio on drought days]
Q_h  = B/(1 + B)·Q*·(1 − c_g) ;  A = 0.25 grass/heath, 0.10 forest; c_g = 0.15 ; same Q* at night (no Holtslag iteration in v1)
column flux (per horizontal area): Q_h,col = mean over the column's fire cells of Q_h,k / cos β_k
```
Vectors (KBDI < 50): Q_sw 564, N 0, T 300 K, A 0.10 → Q* 388.8, **Q_h 165.2 W/m²**; KBDI 150 (B = 4) → 264.4; night
T 288 K, N 0 → **−33.04**; N 1 → **−10.27**. The column flux is injected into θ′ in the lowest layer with e-folding
depth Δz₁. Q_h,k (per slope area) is published on the fire grid (`AtmosDiagnostics.heatFlux`) for slope flows and
detectors.
Sub-grid slope-flow top-up (fire wind only; D31, doc 07 §7.9):
```
upslope   (Q_h > 0): S = [Q_h·g·Δz_u/((0.2 + 0.2)·ρ c_p T)]^{1/3},   Δz_u = valleyDrop[k] (rise from the valley bottom)
downslope (Q_h < 0): S = [−Q_h·g·L·sin α/(ρ c_p T·(1e-4 + 0.01))]^{1/3}·(1 − e^{−L/L_e})^{1/3},
     Δz_d = crestRise[k] (rise to the local crest along the reversed fall line), L = crestDist[k] (distance from that
     crest), sin α = min(Δz_d/L, sin(slope_k)), L_e = 0.05·Δz_d/0.0101
S_top = min(3 m/s, max(0, S − U_resolved·ŝ))·(1 − smoothstep(3, 8 m/s, U_ridge,median))    along the fall line ŝ
contribution to U_fire:  by day (Q_h > 0) max(0, S_top − 1.5 m/s)·û(ψ_up)  (the SF fit already contains typical
     anabatic flow, §16 item 14);  downslope (Q_h < 0): S_top·û(aspect) in full
```
Vectors: Q_h 300, Δz 300 m → **1.84 m/s**; Q_h 150, Δz 200 → 1.28; Q_h −30, L 1000, sin α 0.3, Δz 300 → **2.30**;
Q_h −20, L 500, sin α 0.2, Δz 150 → 1.39 (ρc_pT = 1.2·1005·293). In the fast tier U_resolved = 0 (full S). V1 and V2
run with surface heating off (`setSurfaceHeating` not called).

### 8.7 Fire heat injection (P1) [V WRF; D27]

`addFireHeat(fireGrid, q, crownShare)` (called only when coupling > 0): per column,
`Q [W/m²] = 1000·χ_c·Σ_k(q_k [kW/m²]·Δx_f²)/Δx_a²`, χ_c = 0.85; vertical profile `F(z) = Q·e^{−z/α_g}`,
α_g = max(50 m, Δz₁); the canopy share (`crownShare·Q`, cells with FH > 0.66·H_o,eff) is injected with
`F = const below H_o,eff, e^{−(z − H_o,eff)/50 m}` above. θ′ tendency −(1/(ρc_p))∂F/∂z × 1/Π (Exner; 1.03 at
900 hPa, 1.07 at 800 hPa). First-layer fraction 1 − e^{−Δz₁/α_g} = **0.330** (Δz₁ 20, α_g 50) / **0.632** (Δz₁ 60,
α_g 60). Smoke source ∝ Q, decay τ = 3 h.

### 8.8 Wind for the fire (P0) [D30, D31, D32, D42]

`surfaceWindForFire(fireGrid, outU, outV, outBgU, outBgV, outIndU, outIndV, outRidge, ctx)`:
```
z_ref(k) = max(50 m, H_o,eff + 20 m, z₁ + Δz₁/2)            (AGL)
sample the model at z_ASL = max(z_cell + z_ref, z_s,atm + z₁) in the column, bilinear between columns
   (the fire cell's real elevation, not the smoothed atmosphere terrain)
κ = κ(z_ref) (§8.2 item 5)
U_bg10  = κ·u_bg(z_ref)     U_dyn10 = κ·u_dyn(z_ref)     (fast tier: u_dyn ≡ u_bg)
m_f = P_fire > 0 ? clamp(1 − d_fire/max(2·z_plume, 500 m), 0, 1) : 0
      (d_fire = ctx.frontDist, z_plume = ctx.plumeTopAGL, default 1000 m)
c_f = SimOptions.coupling (0–1.5)
3-D tiers:  U_fire = c_f > 0 ? U_bg10 + (U_dyn10 − U_bg10)·[(1 − m_f) + c_f·m_f] : U_dyn10     (c_f = 0: one-way, no fire heat)
            U_fireInd = c_f·m_f·(U_dyn10 − U_bg10)
fast tier:  U_bg10 ← U_bg10·[1 − 0.7·sn·(1 − w_night(z_cell))]      (night decoupling, §8.4 w_night)
            U_fire = U_bg10 + c_p·u_p ,  U_fireInd = c_p·u_p ,  c_p = c_f        (pyrogenic, below)
all tiers:  U_fire += slope-flow term (§8.6);  then the lee-separation blend (§7.9) with ctx.sep
outBg = U_bg10 (+ slope-flow term, no fire terms);  outInd = U_fireInd;  outRidge[k] = |U_bg10| at crest(k).kCrest
```
Near-surface T for moisture and N_c (`airAt`): T at z_cell + 2 m, interpolated in the column (θ → T with the local Π;
points below the lowest level centre take the lowest level's θ), bilinear between columns.

**Pyrogenic potential** (fast tier only, c_p = c_f; D32) [H, UNVERIFIED Hilton constant]: on the fire grid coarsened
×2, solve `∇²ψ = −k·q` (q = fire heat flux kW/m², ψ = 0 on the boundary) every 60 s with 2-D multigrid; `k = 6e-4` (SI
with q in kW/m², so that an infinite strip of intensity I kW/m induces u_in = k·I/2 m/s each side: 3 m/s at 10 MW/m);
`u_p = ∇ψ`, |u_p| ≤ 5 m/s. **Head correction**: at head cells (prepared cells with direction ≥ 0.8 of the local front
normal) remove the component opposing the head, `u_p ← u_p − min(0, u_p·ê)·ê`, because the empirical head ROS already
contains the near-field indraft.

Tests: flat terrain, no fire, every tier and every weather source → U10_fire = forecast U10 ± 1 %; c_f = 0 ⇒ FireField
bitwise independent of χ_c (0.85 vs 0.5; embers off, since the ember plume flux uses χ_c) (V17); a 2 km line fire on flat ground in the fast tier has a steady head ROS
within ±5 % of the uncoupled (c_f = 0) value.

### 8.9 Fast tier `DiagnosticWind` (no 3-D solver) (P0)

`DiagnosticWind implements AtmosphereLike`: u_bg (mass-consistent per stamp, time-interpolated), night decoupling,
slope flows (§8.6, full S), lee separation, pyrogenic potential, user edits (via u₀, §8.3); `view()` returns the 10 m
fields and a zero 3-D volume; `airAt()` returns the §5.2 template T; `sampleTurb` from similarity (§9.3) with
z_i = BLH ?? 1500 m by day, 200 m at night; `spunUp` is always false; diagnostics: inversion from §5.2a, Briggs plume
top. **No wall-clock fallback**: the tier changes only at init (auto-tune) or by `setQuality`, which is recorded as an
edit at a simulation time and replayed on rewind (§12.6), so physics never depends on wall-clock time.

### 8.10 Diagnostics (P1) `diagnostics(): AtmosDiagnostics`

- Inversion: `dTheta` = max over valley columns of θ(z_floor + 300 m) − θ(z_floor + 10 m); present if ≥ 3 K.
  Break ETA: first time the column-integrated heating since sunrise ∫Q_h dt exceeds the heat deficit
  `c_p∫ρ(θ_top − θ)dz` [K Whiteman], extrapolated with the current Q_h; fed back to §5.2a as t_break.
- C-Haines [V Mills & McCaw 2010] (`upperAirSource` 'model' or 'preset'): `CA = 0.5(T850 − T700) − 2`;
  `CB = min(30, T850 − Td850)/3 − 1`, if CB > 5 then `CB = 5 + (CB − 5)/2`; CH = CA + CB. Where 850 hPa is below the
  grid-point surface, use the 2 m values instead of 850 hPa and flag it. Vectors: (T850 20, T700 6, Td850 −5) → 5.00 +
  6.17 = **11.17**; (28, 12, −10) → **13.0**; (15, 5, 10) → 3.67.
- **1-D plume column** (P1; MTT top-hat, Boussinesq, bent-over), integrated in z with Δz = 20 m (RK2) through the §8.2
  sounding:
  ```
  fluxes: Q = b²w, M = b²w², F = b²w·g′ (g′ = gθ′_p/θ_env), P = b²w·u_p, W = b²w·q_p   (b = Q/√M, w = M/Q)
  v_e = α·|w| + β·|U_env(z) − u_p| ,  α = 0.1, β = 0.5
  dQ/dz = 2b·v_e ;  dM/dz = b²·g′ ;  dF/dz = −Q·N² ;  dP/dz = 2b·v_e·U_env ;  dW/dz = 2b·v_e·q_env
  source at 10 m AGL: F₀ = χ_c·P_fire·g/(π ρ c_p T) (m⁴/s³), b₀ = max(30 m, √(A_burning/π)),
    w₀ = max(1 m/s, (F₀/b₀)^{1/3}), g′₀ = F₀/(b₀²w₀), u_p0 = U_env, q_p0 = q_env (no combustion water [H])
  stop at w < 0.1 m/s or M ≤ 0 (plume top; cap 16 km). LCL: first z with q_p ≥ q_sat(T_p, p(z)),
    T_p = (θ_env + θ′_p)·Π(z). q_env from the 2 m T_d and the level RH (synthetic: 2 m mixing ratio up to z_mix, RH 30 % above)
  ```
- Briggs cross-check: `F = g·χ_c·P_fire/(πρc_pT)`; stable windy `2.6(F/(U N²))^{1/3}`, calm `5.0F^{1/4}N^{−3/4}`, take
  the smaller. Vectors (ρ 1.2, T 293, heat entering the plume χ_c·P_fire): 1 GW, U 5, N 0.01 → F 8837, windy 677 m,
  calm 1533 m → **677 m**; 10 GW → **1459 m**.
- PFT (**P2**, model upper air only) [form verified, constant UNVERIFIED]: `PFT = 0.3·z_fc²·U·Δθ_fc` GW with z_fc (km)
  the free-convection height of the 1-D plume parcel (moist adiabat above its LCL), U (m/s) the mean wind 0–z_fc and
  Δθ_fc (K) = θ_env(z_fc) − θ_env(2 m).
- Byram N_c (computed by fire/spread per front cell into `aux.nc`, reported by explain):
  `N_c = min(100, 2gI/(ρ c_p T·max(U·ê − R, 0.5 m/s)³))` with local ρ, T (env.airRho, airT), U = U_fire along the spread
  direction, I in W/m. Vectors (ρ 1.1, T 300): I 20 MW/m, U 5, R 0.5 → 13.0; (ρ 1.15, T 305): I 10 MW/m, U 5 → 4.45;
  U 3 → 20.6; I 1 MW/m, U 3 (ρ 1.1, T 303) → 2.17; U·ê − R ≤ 0.5 m/s (calm, or head against the wind) → capped
  formula, never negative or infinite. Because ρT = p/R_d, N_c ∝ 1/p: +27.4 % at 2000 m ISA vs sea level for the same
  fire and wind.

### 8.11 Tests (P0/P1)

Projection `max|∇·u|·Δx/|u| < 1e-3`; mass-consistent solve over the Katoomba DEM with the §8.3 boundaries converges
(no drift of φ) and leaves the flat-terrain profile unchanged; resting stratified atmosphere over the real Katoomba DEM
with a 5 K cold pool, no sun, no fire: loses < 1 K in 3 h and spurious winds < 0.5 m/s; neutral flow over a Gaussian
hill (h/L < 0.3): crest speed-up within ±30 % of 1.6h/L (3-D hill); warm bubble 0.5 K rises symmetrically; plume top
within ×2 of Briggs; an unstable column (2 m θ 315.5 K at 715 m vs 309.2 K at 850 hPa, as sunny afternoons give with model levels) gives finite
α_v, Fr_h and Briggs heights; diurnal: 1–3 m/s upslope on sunlit slopes by 11:00, cold pool by 05:00, valley-floor
wind < 2 m/s under a 10 m/s ridge wind before sunrise in the 3-D and fast tiers (nudging taper, Davies taper, night
decoupling); the §8.8 flat-terrain and coupling tests; restore then step is bitwise equal to an uninterrupted step.

---

## 9. `embers/` — Lagrangian firebrands and spot fires

### 9.1 Design (P0 core, P1 mountain hooks)

Stratified, weighted super-particles (structure of arrays; `maxEmbers` active: tier table §12.6). Each particle: x, y,
z (ASL), u′, v′, w′, age, v_t0, τ_f, τ_b, W (real brands represented, may be < 1), class, state (flaming/glowing),
source cell, emit time, max z AGL. RNG: `Rng(seed)` stream 0 (§12.5). Wind is frozen per atmosphere step. `v_t0` is
defined at ρ_ref = 1.1 kg/m³ (`RHO_REF`).

| Class | Share | v_t0 (m/s) | τ_f (s) | τ_b (s) | Launch height | Fall-speed exponent n |
|---|---|---|---|---|---|---|
| E1 stringybark flake | 35 % (Stringybark or mixed bark) | lognormal median 4.5, σ_ln 0.15, clip 3–6 | lognormal median 30, σ_ln 0.5 | lognormal median 150, σ_ln 0.7, tail ≥ 600 | U(0.3, 1.0)·min(FH, 8 m) | 1/2 |
| E2 ribbon strip | 30 % when RibbonBark, else 0 | U(5.2, 5.8) [V] | 60 | mixture of means 251/122/429 s [V] + tail to 1500 s | crown base to H_o,eff if FH > 0.66H_o,eff or I > 10 MW/m, else as E1 | 1/4 |
| E3 leaf | 15 % when FH > 0.66H_o,eff | U(1.5, 2.5) | 10 | 25 | H_o,eff | 1/2 |
| E4 twig | 15 % | U(4, 7) | 20 | 24.3·v_t0 [D Albini] | U(0.5, 1)·FH | **1** (Albini-consistent: mean fall speed v_t0/2, z_b = v_t0·τ_b/2) |
| E5 heavy | 5 % | U(8, 12) | 60 | 600 | 0.5 m (hand-off to debris) | 1/4 |

σ_ln values are [H] (doc 06 gives none). Shares are renormalised per cell over the classes present; E2's far tail and
E1's long lifetimes are sampled with importance weights (heavier-tailed proposal, W × likelihood ratio) [standard MC].

### 9.2 Emission (P0) [A doc 06 §4.2; E0 H, UNVERIFIED; D52]

Per burning cell k (t − tArr < 3τ_f) whose type has `spotting = true`, integrated exactly over each atmosphere step:
```
ṅ_k(t) = E0 · 3^(BH_k − 2) · (I_k/1000) · e_k · g(I_k) · VLSboost_k · Δx_f · (Δx_f / max(R_k, 0.01 m/s))
         · e^{−(t − tArr)/τ_f} / (τ_f·(1 − e^{−3}))                                        (real brands / s)
I_k, R_k = arrival intensity (kW/m) and normal ROS (m/s);  e_k = clamp((FH_k − 1)/(h_bark − 1), 0, 1), h_bark = 8 m;
g(I) = clamp((I − 500)/1500, 0, 1);  VLSboost = 2.5 in an active VLS zone (E1–E4 only), else 1;
BH = barkHazard (0–4); E2 only if BH ≥ 3
E0 = 3e-6 s⁻¹ m⁻¹ (MW/m)⁻¹  (range 1e-7…1e-4)
```
Each cell emits its share `Δx_f²/R_k` of front passage over its flaming time, so the emission **per unit front
length** is `E0·3^(BH−2)·(I/1000)·e·g` brands m⁻¹ s⁻¹, independent of R, τ_f, Δx and front orientation. Reference:
10 MW/m, BH 3, e = g = 1 → 9e-5 m⁻¹ s⁻¹ = **324 brands km⁻¹ h⁻¹**; E0 is calibrated so the reference severe day gives
5–50 spot ignitions per km of head front per hour (§9.7).
Super-particles per class c: `N ~ Poisson(ṅ_c·Δt_a/W_c)` with
`W_c = max(1e-3, n̄_c·τ̄_c/(π_c·0.8·maxEmbers))`, n̄_c = class emission rate smoothed over 300 s (EMA), τ̄_c = the class
median τ_b, π_c = 1/(number of classes with n̄_c > 0) (equal allocation: rare long-range classes are sampled as well
as common ones); recompute every atmosphere step; initial W_c = 1; each particle keeps its own W. Class populations
then sum to ≈ 0.8·maxEmbers. If the budget is full, drop the oldest glowing E3/E4 first.

### 9.3 Lofting and transport (P0) [doc 06 §4.3–4.4]

```
Δt_e = clamp(0.4·min(Δz_local/|w_rel|, Δx_a/|u_h|), 0.5 s, 5 s)   (sub-steps inside Δt_a)
(u, v, w) = atmosphere.sample(x, y, zAGL) ;  w += w_sg
w_sg = C_w·F_L^{1/3}·exp(−(z − z0)/z_d)·φ ,  C_w = 1.5, z_d = 200 m, z0 = source ground elevation,
       F_L = g·χ_c·I/(ρ c_p T) (I in W/m) of the plume-source raster (max over burning cells per atmosphere column),
       φ = max(0, 1 − d⊥/Δx_a), d⊥ = horizontal distance from the tilted plume axis x − (U/(C_w F_L^{1/3}))(z − z0)·û
3-D tiers: w_sg ← max(0, w_sg − w_resolved(x, y, z))   (the resolved plume updraft is not counted twice)
OU turbulence per component: u′ ← u′e^{−Δt/T} + σ√(1 − e^{−2Δt/T})·ξ ;  (z_i, w*, u*) = atmosphere.sampleTurb(x, y, zAGL)
   surface layer (z < 0.1z_i): σ_u,v,w = 2.4, 1.9, 1.25·u*, u* = κ·U(z_ref)/ln((z_ref − d)/z₀) with the local canopy
       z₀, d of §8.1 (U(z_ref) = the physical model wind); T = clamp(0.5z/σ_w, 5, 60) s
   daytime CBL above: σ_w² = 1.8w*²(z/z_i)^{2/3}(1 − 0.8z/z_i)², σ_u = σ_v = 0.6w*, T = 0.15z_i/σ
   in plume (φ > 0): σ_w = α_p·w_plume, α_p = 0.25 (0.4 in active VLS zones); crossing trajectories
   T_eff = T/√(1 + (v_t/σ)²); drift term ½∂σ_w²/∂z on w′
mass and speed: m/m0 = max(0, 1 − age/τ_b); v_t = max(0.3v_t0, v_t0·(m/m0)^n)·√(ρ_ref/ρ_air)
state: flaming while age < τ_f; E1 re-flames with hazard 0.005 s⁻¹ while glowing
x += (u + u′)Δt_e; y += (v + v′)Δt_e; z += (w + w′ − v_t)Δt_e
die if age ≥ τ_b; land if z ≤ z_ground(x, y) (bilinear on the fire-grid terrain); outside the domain → analytic continuation
```
Above the model top: ambient pressure-level winds by height above ground (drop sub-surface levels), w = 0; w_sg
continues up to the diagnosed plume top when it exceeds the lid. Domain exit: remaining time t = min(z/v_t,
τ_b − age), distance += Ū·t; histogram of beyond-edge distances weighted by W·P_ig(ambient M); `leftDomain += 1`.
Fast tier / atmosphere off: loft height **z_L = z_p·√ξ, ξ ~ U(0, 1)** (ember RNG; z_p = Briggs plume top), capped
where `C_w·F_L^{1/3}·exp(−z/z_d) ≤ v_t`, then fall through the 1-D profile.

### 9.4 Mountain hooks (P1)

- Lee eddy: on cells with s_sep ≥ 0.5 and z AGL < 0.3·relief, blend the horizontal wind toward
  0.3·U_ridge·û(ψ_up) (i.e. upslope) with weight s_sep.
- VLS injection: ×2.5 emission and launch at crest height (§9.2); α_p 0.4.
- Ridge release and thermal-belt moisture need nothing special (explicit terrain; per-cell moisture).
- Record `ridgeDrop` = z_launch − z_land and the source location class (ridge / windward / leeward / valley, from TPI
  and aspect vs wind) in the provenance.

### 9.5 Landing, exclusion zone and ignition (P0)

```
LandingInfo = landing(x, y)   (§2.2: moisture M, fuelType, family, burnable, burnt, fuelTempC, surfaceHazard,
                               nearSurfaceHazard, curing, bedWindMs = U10/(2·wrf), distToFront, frontDirX/Y, rosLocal)
discard if !burnable or burnt (unburnt islands inside the perimeter CAN ignite)
exclusion: if distToFront < d_ex and (landing − nearestFront)·ŵindTo > 0 → count "short-range", no ignition
    d_ex = max(2Δx_f, rosLocal·180 s)     (aux.frontDist, refreshed every 60 s)
p = P_ig(T_f, M)·S_state·R_fuel·(m/m0)^0.25
    S_state = 1 (flaming) | 0.3·clamp(bedWindMs/2 m/s, 0, 1) (glowing; range 0.1–0.5)
    R_fuel = receptivity × (vesta2, pine: min(1, FHS_s/2) | heath: min(1, FHS_ns/2) | grass: curing/100)
pile synergy: n ≥ 3 landings in one cell within 60 s → p ×(1 + 0.2·min(n − 1, 10)), p ≤ 0.95
P_spot = 1 − exp(−W·p) ;  ignite if rng < P_spot after delay U(5, 30) s flaming / U(60, 600) s glowing
holdover: 2 % of glowing landings on cells with FHS_s ≥ 3 or HeavyFuel smoulder (≤ 24 h) and convert with hazard
    (1/3600 s⁻¹)·clamp((10 − M)/5, 0, 1)
```
`onIgnite(x, y, travel, prov)` → sim schedules `fire.igniteAt(x, y, t, SpreadDriver.Spotting)` (applied in §12.2 step
1) and records a `SpotFire` with provenance. Overlay rasters (fire grid, decayed with τ = 10 min): landing density
ΣW/m² and expected ignitions ΣW·p (`SimSnapshot.layers.landing`). `SpotProvenance` and `EmberStats`: §2.2.

### 9.6 Aerodynamic and burnout relations (reference) [V doc 06 §3.1–3.2]

Plate `v_t = √(2ρ_sδg/(ρ_aC_d))`, cylinder `v_t = √(πρ_sDg/(2C_dρ_a))`, C_d = 1.2. Vectors (ρ_a 1.1): bark flake ρ_s 300,
δ 2 mm → 2.99 m/s; δ 4 mm → 4.22; twig ρ_s 400, D 5 mm → 4.83. Albini burnout τ = 4C_dv_t0/(πKg) = 24.3·v_t0 (K =
0.0064): v_t0 5 m/s → **121.7 s**, burning fall height z_b = 2C_dv_t0²/(πKg) = **304 m** (= v_t0·τ/2, which is why E4 uses
n = 1).

### 9.7 Performance and tests (P0)

Budget: ≤ 300 ns per particle-step; ≤ 4000 active × (Δt_a/Δt_e ≈ 3) → **2–5 ms per atmosphere step** on a phone,
4–18 s per 6 h (1800–3600 steps). Tests (doc 06 §4.9): v_t table; uniform 16.7 m/s wind, no plume, ρ = ρ_ref: an E2
brand released at **z* = 0.8005·v_t0·τ_b** (the fall height with n = 1/4 and the 0.3 floor) lands at Ū·τ_b ± 5 %, and an
E4 brand released at z_b = v_t0·τ_b/2 lands at Ū·τ_b ± 5 %; plume top of a 1 km × 10 MW/m line fire in N = 0.01,
U = 10 → 1.2 km ± 30 %; BH 2 → 3 triples landing density (±10 %); flat, W 15, T 34 °C, RH 18 %, DF 10, U10 37.1 km/h
(FFDI 50): P95–P99 spot distance within ×2 of Mk5 S ≈ 3.0 km; ROS 2000 m/h, U10 40, FHS_s 3.5: P95–P99 of
ignition-capable landings within ×0.5–×2 of the §6.10 envelope 3.46 km; M 6 % → 18 % cuts successful spots 5–10× with
similar landings; lee-eddy ridge (25° lee slope, 10 m/s): lee-slope landing fraction > no-eddy run; fixed seed →
identical spot sequence; class populations sum to 0.8·maxEmbers ± 10 % in steady emission; emission per km of front
equal (±5 %) for a grid-aligned and a 45° front; reference severe day gives 5–50 spots/km/h (E0 calibration).

---

## 10. `explain/` — detectors, insight cards, cell explanation

### 10.1 Engine rules (P0) [H doc 10 §9.1, doc 09 §11.1; D33]

- **One registry** `INSIGHT_RULES: Record<InsightKind, InsightRule>` (below). Detectors run every **60 s** of
  simulated time on `SimStateView` (§2.2, which carries `features`); cost < 5 % of the worker (front cells ≤ 20 000,
  spatial hash).
- Each rule returns candidates `{ key, x, y, score, severity, values }` with `score ≥ 1` meaning "on". Spatial cards:
  `key = kind:tileX:tileY` on 500 m tiles; domain-level cards (wind-change, high-drought, pyroconvection-risk,
  afternoon-peak, inversion-break, general notes): `key = kind:domain` (or `general:<sub>:domain`), positioned at the
  domain centre unless a location is meaningful (e.g. the exposed flank).
- Per key state machine `idle → armed → shown → cooldown → idle`: armed when score ≥ 1; shown after the rule's
  persistence (default 2 detector cycles = 2 min); stays active while score ≥ 0.8 (hysteresis); cooldown 15 min
  (default) after it turns off; a severity **escalation** bypasses cooldown. At most 3 new insights per 60 s,
  ranked danger > watch > info, then score, then distance to the head.
- Every card: title, 2–4 sentence body (plain words, "because" language, numbers with "about" and units km/h, °,
  %, m), one **safety** line consistent with LACES, `source`, `confidence` badge, `showLayers`, `factors` (the
  triggering numbers). Danger cards end the safety line with *"Education only. LACES first. Follow your Crew Leader
  and NSW RFS procedures."* Never "you are safe" (say "safer"/"less exposed"). Add *"(steeper than the tested range,
  so it could be faster)"* when θ > 20°, and *"the model can't see this precisely"* when a sub-grid term (VLS,
  attachment, slope-flow top-up, lee eddy) contributes > 30 % of the local ROS or wind.
- Symbols: θ slope along spread (deg), ψ_up upslope azimuth, windTo, ∠(a, b) smallest angle, **head cells** = front
  cells with `aux.direction ≥ 0.8`, U10 km/h, M %, I kW/m, FH m, LMST local mean solar time, U_ridge (D42; per cell
  `s.uRidge`, domain value `atmosDiag.uRidgeMedian`), night = `s.night` (§5.2a).
- **Crest-normal** (ridge cards) = circular mean aspect of the non-ridge cells within 90 m of the ridge cell on its
  windTo side (the lee-facing direction). **Gully base** = `features.gullyBase` of the trench segment; the **lower
  third** of a gully = cells with z ≤ z_base + (z_top − z_base)/3, z_top = highest cell of the segment.

```ts
export interface Candidate { key: string; x: number; y: number; score: number; severity: InsightSeverity;
  values: Record<string, number | string>; }
export interface InsightRule { kind: InsightKind; priority: 'P0' | 'P1' | 'P2'; persistence: number /* cycles, default 2 */;
  cooldown: number /* s, default 900 */; detect(s: SimStateView): Candidate[];
  render(c: Candidate): Pick<Insight, 'title' | 'body' | 'safety' | 'factors' | 'source' | 'confidence' | 'showLayers'>; }
```

### 10.2 Card registry (P0 unless marked)

| kind | trigger (score ≥ 1 when all hold) | sev | title — body template | safety | source · badge · show |
|---|---|---|---|---|---|
| upslope-run | ≥ 5 front cells in the tile with ∠(spreadDir, ψ_up) ≤ 45°, θ ≥ 10°, ROS ≥ 0.05 m/s | info; watch if θ ≥ 20° | Fire runs uphill — "On this {θ}° slope the flames lean into the fuel above and pre-heat it, so the fire is spreading about ×{SF} faster than on flat ground." | Never position yourself upslope of a fire; escape routes should not go uphill. | McArthur 1967; Noble 1980; Cruz 2021 · physics · slope, spread |
| downslope-backing | ≥ 5 front cells with ∠(spreadDir, ψ_up + 180) ≤ 45°, θ_d ≤ −10°, wind component along spread < 10 km/h. Variant S43: backing front within 50 m of a `narrowValley` floor whose opposite wall θ ≥ 15° → watch. Variant S10: downslope wind ≥ 25 km/h, θ ≥ 10°, M ≤ 8 → watch | info | Backing downhill — "The fire is creeping downhill at about {ros} m/h, about {pct} % of its flat-ground speed. Downhill spread slows but never stops (kataburn)." S43: "…when it reaches the gully floor it will start running up the other side." S10: "Strong wind down this slope can push fire downhill fast." | "Fire doesn't go downhill" is not a safe rule; don't be on the opposite slope above a narrow gully. | Sullivan 2014; IRPG 2025 · physics · slope |
| gully-chimney | drainage cells with axial slope ≥ 20°, TPI_small ≤ −10 m, trench ≥ 0.3; burning cells in the lower third of the gully or within 200 m of its base; wind within 45° of up-gully or anabatic (Q_h ≥ 150 W/m², U_ridge,median ≤ 5 m/s) | watch; danger if A·E ≥ 0.5 in that gully | Chimney / gully run — "This steep gully works like a chimney: the fire's own heat pulls air up it and the walls heat each other, so fire can race up it in minutes." | Do not work in, above or at the head of a gully with fire below. | Viegas & Pita 2004; IRPG 2025 · rule-of-thumb · slope, trench |
| eruptive-slope | front heading upslope ∠ ≤ 30° with A ≥ 0.5 (§7.6) over ≥ 60 m of upslope run (≥ 2 cells) | watch; danger if A·E ≥ 0.5 and G ≥ 1.5 | Flames may "stick" to the slope — "On ground this steep ({θ}°) the flame lies down along the slope like a blowtorch. Heating jumps and the fire can accelerate without any wind change. Eruptive regime: model indicative only." | Expect sudden runs; keep well clear above and beside. | Wu 2000; Xie 2017; Fan 2025 · model-estimate · slope, attach |
| ridge-crest | perimeter within 150 m of a `ridge` cell with U_ridge ≥ 15 km/h and ∠(windTo, crest-normal) ≤ 60° | watch | Fire reaching the ridge — "The run up this slope will slow at the crest, but there the fire meets stronger wind and throws embers into the next valley." | If you are on the ridge or beyond, post a lookout facing the far side. | Sharples 2009 · rule-of-thumb · wind, embers |
| lee-slope-eddy | s_sep ≥ 0.5 on cells within 500 m ahead of the front or burning | info; watch if burning | The wind on this slope blows the "wrong" way — "Behind this steep ridge the main wind lifts off; underneath, air circulates back up the slope, gusty and shifting. Fire here can creep uphill against the main wind." | Embers from the ridge can land anywhere on this face. | Wood 1995; Sharples 2012 · sub-grid · wind |
| vorticity-lateral-spread (P1) | active VLS zone (§7.9); pre-warning: VLS ≥ 0.5 terrain within 1 km downwind of the head and U_ridge ≥ 5 m/s there → watch | danger | Fire can run sideways along this lee slope — "Wind pouring over the ridge rolls into an eddy on this steep lee slope. Fire caught in it is dragged sideways across the wind, about {rl} km/h in 10–15 min surges, while throwing embers far downwind." | Don't assume the flanks are safe on lee slopes. | Sharples 2012; Simpson 2013 · sub-grid · vls, wind |
| saddle-channelling | `saddle` within 1 km of the head, ∠(head dir, saddle) ≤ 45°, U_ridge ≥ 15 km/h at the saddle | watch | Saddle ahead — "Wind squeezes through the low point in the ridge and speeds up, and fire follows it into the next valley." | Don't park, rest or plan a refuge in a saddle. | IRPG 2025 · rule-of-thumb · wind |
| valley-channelling | valley with localRelief ≥ 150 m within 2 km of fire; valley-floor 10 m wind direction differs ≥ 45° from the U_ridge direction | info | This valley has its own wind — "Valleys steer the wind along their length whatever the wind does above the ridges: up-valley in the afternoon, down-valley at night." | Check the wind where you are, not only the forecast. | Whiteman 2000 · physics · wind |
| ridge-speed-up (P1) | crest cell within 1 km of the front with background speed-up ≥ 25 % (U_bg10,crest/U_bg10,upwind − 1; analytic min(2H/L, 1) in the fast tier) | info | Stronger wind on the crest — "Wind speeds up over the top of this ridge (about +{pct} %). A fire reaching it will suddenly get stronger wind." | Expect a flare-up and spotting at the crest. | Jackson & Hunt 1975; Taylor & Lee 1984 · physics · wind |
| spotting | ignition-capable landings (p ≥ 0.05) ≥ 500 m ahead of the head in the last 10 min, or burning cells with BH ≥ 3, U10 ≥ 30 km/h, M ≤ 7 | watch | Embers landing far ahead — "Burning bark is being carried {d} km ahead. The Australian operational model says up to about {S} km for this fire." | Your location can be "ahead of the fire" even if the edge is far away; watch behind you. | Storey 2020; FBI-TG eq 3.51 · model-estimate · embers |
| spot-fire | each new spot ignition ≥ 200 m from the main front (cooldown 10 min per tile) | info; watch if ≥ 1 km | Spot fire — "An ember from {src} flew {d} m ({t} s, up to {h} m high) and landed on {M} % litter." | Report spot fires; they grow and join quickly. | provenance · model-estimate · embers |
| mass-spotting | ≥ 10 spot ignitions within 30 min within 2 km | danger | Mass spotting — "Embers are starting many new fires ahead of the front. They will merge and the fire can jump forward suddenly." | Treat any ember as a new fire; be ready to move. | Cruz 2012 · model-estimate · embers |
| junction-zone | two front cells ≤ 300 m apart, normals facing each other within 45°, unburnt between, included angle α = 180° − ∠(n_p, n_q) ≤ 45° (watch if ≤ 60° and ≤ 200 m) | danger | Two fire lines meeting — "Where two fires meet at a sharp angle the join races forward about ×{1/sin(α/2)} faster by geometry alone, and faster again as they feed each other." | Never be in the unburnt pocket between two fires. | Viegas 2012; Raposo 2018 · physics · spread |
| wind-change | forecast (§10.3) or live change ≥ 45° with post-change U10 ≥ 15 km/h within 3 h; countdown; exposed flank = perimeter length with outward normal within 45° of the new windTo | danger | Wind change: this flank becomes the head — "When the wind swings to the {dir} at about {time}, this {L} km flank becomes the front and runs at full speed almost at once." | Know the change time; move off the flank that will become the head, or into the black, before it. | Cheney 2001; Linton coroner 2002 · rule-of-thumb · wind, dmz |
| dead-man-zone (P1) | change ≤ 60 min away: DMZ = cells reached within 5 min after the change (§10.5) | danger | Dead-man zone — "If the wind changed now, fire could reach anywhere in the shaded zone within 5 minutes." | Work close to the black or move out of the zone. | Cheney, Gould & McCaw 2001 · model-estimate · dmz |
| plume-dominated | `aux.nc` ≥ 10 over ≥ 200 m of head front for ≥ 5 min (persistence 5) | watch | The fire is making its own weather — "The fire's heat is stronger than the wind. The column stands up, winds near the fire pull toward it from all sides and can change quickly." | Expect erratic behaviour and inflow winds; stay near your refuge. | Byram 1959; Nelson 1993 · physics · plume |
| pyroconvection-risk | upper air 'model' or 'preset' only. watch: C-Haines ≥ 8 and FFDI ≥ 25; danger: C-Haines ≥ 10 and FFDI ≥ 50, or plume top ≥ LCL + 500 m, or (P2) P_fire > PFT | watch/danger | Fire thunderstorm possible — "The air above is unstable and dry. A big enough fire can build its own storm: violent gusts, downdrafts, lightning and long-range embers." ("Upper-air data unavailable for this date" when synthetic) | Crews should be in safe areas before this; vehicles are not safe from these winds. | Di Virgilio 2019; Tory & Kepert 2021 · rule-of-thumb · plume |
| fire-induced-wind (P1) | coupling > 0: on ≥ 30 % of front cells \|U_fireInd\| ≥ max(1.5 m/s, 0.3\|U_bg10\|), for 5 min | watch | The fire is making its own wind — "Heat rising from the fire pulls air in from the sides; near the fire the wind can blow toward the flames, against the forecast." | Expect gusty, shifting winds close in. | Clark 1996; doc 07 · model-estimate · wind |
| anabatic-wind | Q_h ≥ 150 W/m² (`surfaceHeatFlux`), θ ≥ 10°, upslope component of the thermal wind (resolved U_dyn − U_bg along ψ_up plus `slopeFlowS`) ≥ 1 m/s, U_ridge,median ≤ 5 m/s, 09–17 LMST, fire within 1 km | info | Sun-warmed slope pulling fire uphill — "This slope has been in the sun; warm air creeps up it (about {S} km/h) and adds to the slope effect." | Expect the fire to pick up on sunny slopes. | Whiteman 2000; WindNinja · physics · wind, sun |
| katabatic-wind | (Q_h < 0 or sun < 5°), θ ≥ 5°, `night.gate` ≥ 0.5, fire within 1 km; variant S17: within 90 min of sunset the near-surface wind at fire cells turned ≥ 90° vs 2 h earlier | info | Evening: the wind turns downhill — "Cool air now drains down the slope and valley (about {S} km/h). Upslope runs slow, the fire may back downhill, smoke sinks into the valley." | Re-check which side is "the head" at dusk. | Whiteman 2000; IRPG · physics · wind |
| thermal-belt | sun < 0, `night.dTheta` ≥ 3 K (3-D tiers: or inversion.present), burning cells with \|hav − h_inv\| ≤ 75 m, or T ≥ T_floor + 2 °C and RH ≤ RH_floor − 10 (T_floor, RH_floor = valley-floor cells within 1 km); variant "ridges don't sleep": burning ridge cells with hav > h_inv + 75 m and U_ridge ≥ 15 km/h | info | Thermal belt — "Cold air has pooled in the valley; this band part-way up the slope stays warmer and drier all night ({M} % litter vs {Mf} % on the valley floor), so fire keeps burning here." | Night doesn't always mean quiet; expect activity on mid-slopes. | Schroeder & Buck 1970; IRPG · physics · temperature |
| inversion-break | after sunrise with `night.dTheta` ≥ 3 K and `night.tBreak` − t ≤ 60 min (watch); "breaking now" when Δθ < 1 K (3-D: surface θ ≥ θ at the inversion top); smoke-trapped variant (info) at night/morning for valley cells below z_inv; wet-ground variant adds "later than usual" if rain24 ≥ 2 mm | watch | Morning inversion about to break — "The cold lid holding the fire and smoke down is about to break. Stronger, drier wind from above will reach the fire within minutes." | A quiet smoky morning is not a safe morning; re-check escape routes before mid-morning. | Whiteman 1982; IRPG · physics · temperature, smoke |
| aspect-dry-fuel | fire spreading onto slopes θ ≥ 10° with aspect 300–60° (any time) or 240–300° after 12 LMST, where M ≤ M(opposite aspect within 1 km) − 1.5 pp; variant S38 "forces aligned" 3/3 (wind, slope, sun aspect within 45° of head) → watch | info | Sunny-side slope — "This slope faces the sun; its litter is about {dM} points drier than the shady side, so the fire speeds up crossing onto it." | Expect the fire to pick up on sunny slopes in the afternoon. | Slijepcevic 2015; Nyman 2018 · physics · moisture, sun |
| moist-gully | fire within 300 m of wet-forest/`WetGullyMinority` gully cells with M ≥ M_front + 3 pp or FA ≤ 0.5·FA_dry; drought variant (KBDI ≥ 150 and FA ≥ 0.8) → watch "the gullies have dried out" | info | Wet gully slowing the fire — "This shaded gully holds moister fuel and wetter forest ({M} %), so the fire slows here." | Moist gullies can still carry fire in drought; don't rely on them. | FBI-TG eq 3.2; AFDRS-RP §10.1 · rule-of-thumb · moisture |
| heavy-fuel | fire entering HeavyFuel cells (FHS_s ≥ 3.5 or BH ≥ 3 or FHS_el ≥ 3); watch if FH ≥ 10 m | info | Tall understorey: flames will get taller — "Shrubs and bark act as a ladder; flames here are about {FH} m." | Taller flames need a bigger refuge: clear ground ≥ 4 × flame height ({4FH} m). | Hines 2010; Gould 2007 · physics · fuel |
| recent-burn | head within 500 m of cells with timeSinceFire ≤ 5 yr | info | This area burned recently — "It burned {n} years ago; litter is about {pct} % of its long-unburnt amount, so the fire should slow and burn lower." If the head P3 > 0.5: adds "On extreme days a recent burn may not slow a crown fire much." | Use it as an anchor, but check for hazard trees; it won't stop embers. | Olson 1963; FBI-TG eq 3.52 · physics · fuel, history |
| crown-fire | I ≥ 10 000 kW/m, or FH > 0.66·H_o,eff with I ≥ 4000, or pine CFB ≥ 0.5 | danger | The fire is climbing into the treetops — "It is hot enough to set the canopy alight; crown fire spreads faster and throws far more embers." | Direct attack is not possible; go to your refuge or the black. | AFDRS-RP Tables 2.9–2.11 · rule-of-thumb · intensity |
| high-drought | at t0 and daily: DF ≥ 9 or KBDI ≥ 150 | watch | Deep drought — "Drought factor {DF}: nearly all fine fuel is available, heavy fuels burn, and wet gullies and forests can carry fire." | Expect fire where you'd normally expect it to stop. | Griffiths 1999; Finkele 2006 · physics · moisture |
| night-slowdown | sun < 0 and head ROS ≤ 50 % of the day's maximum, with M rising ≥ 3 pp since sunset | info | Night slowdown — "Cooler, moister night air has slowed the fire (litter {M} %)." (adds the thermal-belt caveat when present) | It will pick up again after the morning inversion breaks. | Vesta night eq · physics · moisture |
| afternoon-peak | 13–17 LMST and within ±1 h of the forecast hour of minimum M_A at the grid point (§10.3), once per day; variant S13: wind from 270–340° ≥ 30 km/h, RH ≤ 20, T ≥ 32, or FBI ≥ 50 → watch | info | Afternoon peak — "Litter is driest and the air hottest now; north- and west-facing slopes are the driest." | Expect the biggest runs now; re-check terrain, weather and fuel. | IRPG 2025 · rule-of-thumb · moisture |
| fuel-break-breached | a `breakWidth` cell breached (§7.4) or a spot ignites beyond a ≥ 10 m NonFuel break | watch | Fire crossed the break — "A {W} m break at {I} kW/m has about a {P} % chance of being crossed (Wilson)." | Breaks need to be wide and patrolled; embers cross them. | Wilson 1988 · rule-of-thumb · fuel |
| rolling-debris (P1) | ≥ 1 debris item launched in the last 10 min that stopped below the front | watch | Rolling embers and logs — "Burning material is rolling down this {θ}° slope and can start fires below you." | Patrol below the line; don't stand in the fall line of a burning slope. | Watch Out #13 · rule-of-thumb · debris |
| general | system notes, key `general:<sub>:domain` (templates below) | info | per sub-note | per sub-note | per sub-note |

**`general` sub-notes** (each its own key and cooldown):

| sub | trigger | text (title — body) | safety · badge |
|---|---|---|---|
| steep | validated = false on ≥ 10 % of front cells because θ > 20° | Steeper than the tested range — "Parts of this fire are on slopes over 20°. Fire models are tested on gentler ground, so spread here could be faster than shown." | Treat steep-slope estimates as a minimum. · model-estimate |
| embers-exit | embers leaving the domain > 5 % of ignition-capable embers (10 min) | Embers beyond the map — "About {pct} % of burning embers are carried past the edge of the model area, up to about {d} km." | Spot fires can start outside this map. · model-estimate |
| wind-driven | median head N_c ≤ 2 and U10 ≥ 20 km/h | Wind-driven fire — "The wind dominates this fire: it runs with the wind and its plume leans over." | Watch the wind direction; the head follows it. · physics |
| light-wind | head U10 < 5 km/h on vesta2 cells for ≥ 10 min | Light winds — "Winds at the head are below the range the forest model was tested on, so spread here is less certain." | Small wind shifts can change the head direction. · model-estimate |
| narrow-gully | burning drainage cells with trench width < 2Δx_a and θ ≥ 25° | What the model can't see — "This gully is narrower than the wind model's grid, so its channelled winds are only estimated." | Expect local winds stronger than shown. · sub-grid |
| mountain-wave (P1) | cross-ridge wind (≥ 30 % of ridge cells with lee aspect within 45° of windTo) and either Fr_h ∈ [0.6, 1.2] with median lee slope30 > windward slope30, or `night.sn` ≥ 0.5 with U_ridge,median ≥ 10 m/s; badge "uncertain" when upperAirSource = 'synthetic' | Strong gusts possible on lee slopes — "Wind crossing this range in a stable layer can plunge down the far side in strong, gusty bursts (a downslope windstorm), well beyond what the forecast wind suggests." (doc 02 card 13) | Expect sudden strong winds on lee slopes and in the valleys below. · rule-of-thumb |
| foehn (P1) | 850 or 700 hPa wind from 250–320° at ≥ 15 m/s and the site is east (lee) of the Great Dividing Range (demo flag `leeOfDivide`: katoomba, grose, gospers, kanangra, budawangs, barrington, thredbo true; warrumbungles false; other sites: east of the coarse divide line (lat, lon) (−28.3, 152.2), (−30.0, 151.6), (−31.5, 151.1), (−32.0, 150.4), (−33.0, 150.0), (−34.0, 150.0), (−35.0, 149.6), (−36.0, 149.1), (−36.8, 148.2) [H, UNVERIFIED]) | Hot dry wind off the range — "Air crossing the range sinks and warms on this side, so it arrives hotter and drier than the air it came from. Temperatures can jump and humidity drop quickly." Optional drawdown toggle (P2): T_s ← max(T_s, θ_850·Π_s), T_d,s ← min(T_d,s, T_d at 850 hPa carried dry-adiabatically) | Expect the fire to become more active as the wind comes over the range. · rule-of-thumb |

**"Show me" layer mapping** (`Insight.showLayers` → render `LayerState`): slope → overlay 'slope'; spread → 'arrival';
sun → 'insolation'; moisture → 'moisture'; fuel → 'fuelLoad'; history → 'timeSinceFire'; intensity → 'intensity';
wind → `wind: 'surface'`; plume → `wind: 'volume'` + `crossSection.enabled` through the head along windTo;
temperature → `crossSection` (θ′); smoke → `smoke`; embers → `embers` + overlay 'landing'; trench → 'trench';
attach → 'attach'; vls → 'vls'; dmz → 'dmz'; debris → overlay 'driver' + the `FireAux.debris` paths. The rasters for
'vls', 'attach', 'trench', 'dmz' and 'landing' travel in `SimSnapshot.layers` (§2.1).

### 10.3 `forecastInsights(series, start, duration, lonDeg)` (P0)

For each hour h in [start, start + duration + 3 h]: circular-mean direction and mean speed over [h − 1 h, h] vs
[h + 1 h, h + 2 h]; a **change** at the hour of maximum |Δdir| when Δdir ≥ 45° and post-change U10 ≥ 15 km/h (merge
changes < 2 h apart). Also emit: `afternoon-peak` time (hour of minimum AFDRS forest M_A at the grid point, LMST from
lonDeg), `high-drought` (DF, KBDI), `pyroconvection-risk` from pressure levels (C-Haines, upper air 'model' or
'preset') with the hourly FFDI, the S13 hot-dry-windy variant, `inversion-break` expectation for night starts (the
§5.2a t_break), and the P1 foehn / mountain-wave notes from the profile.

### 10.4 Cell explanation `explainAt(x, y, s)` (P0)

Fill `CellExplanation` from the cell: arrival values if burnt, else `s.evaluateCell(k)` (the fire module's own code,
§7.12): terrain, fuel summary (§4.7), M, time since fire, U10, arrival, ros, intensity, FH, driver, factors.
`narrative` = up to 5 lines: the top three factors ranked by share `s_i = |ln f_i|/Σ|ln f_j|` over {wind, slope,
moisture, fuel, terrain} (direction is reported as the position on the fire: head/flank/back), each from a template:
- slope: "Slope: {θ}° {uphill|downhill} along the spread → about ×{f} (doubles every 10° uphill)."
- wind: "Wind: {U} km/h from {dir} → ×{f}{; about {fw} km/h of it is air drawn in by the fire}." (fw = |U_fireInd|)
- moisture: "Litter moisture {M} % ({MA} % by the AFDRS equations; {reason}) → ×{f}." reason = the largest of: sunlit/
  shaded aspect (radiation part of A), canopy shade, cold pool/thermal belt (T − T_free), rain {h} h ago, dew, user
  edit.
- fuel: "{fuelSummary} → ×{f} relative to typical {type}."
- terrain: eruptive / VLS / junction / build-up lines with "(model indicative)".
Then the validity line (§6.12) and the wind decomposition "ambient {Ua} + terrain {Ut} + slope flow {Us} + fire {Uf}
km/h" (Ua = forecast U10; Ut = |U_bg10| − Ua; Us = slope-flow term; Uf = |U_fireInd|). Example target: "Running
uphill here because: slope 28° upslope (about ×7.0), wind 25 km/h aligned with the gully (7 km/h drawn in by the
fire), and dry litter (6 %). (steeper than the tested range, so it could be faster)".

### 10.5 Safety overlays (P1)

DMZ and hypothetical spread: Dijkstra on a 60 m grid from the current perimeter with the §7.4 ellipse ROS under the
post-change wind (mass-consistent re-solve for the new direction), current moisture; recompute every 5 min or on edit
(≤ 100 ms); published as `SimSnapshot.layers.dmz`. Refuge rule display: clear distance ≥ 4 × FH (doubling note when
the approach slope > 11° or U10 > 16 km/h). Tobler walking speed `v = 6·exp(−3.5|tan θ + 0.05|)` km/h × 0.6 off-track
× 0.8 load (0°, −3°, 10°, 20°, 30° → 5.04, 5.95, 2.72, 1.41, 0.67 km/h before factors). Crew/line-dependent cards of
doc 10 (S05, S06, S19, S21, S30–S34, S37, S40–S42, S44–S46) wait for the crew/line UI and are P2.

---

## 11. `scenario/` — weather, presets, replays, belt kit, build

### 11.1 Weather sources by mode (P0) [V doc 08b; D34]

| WeatherMode | Source | Variables actually present (fixtures) |
|---|---|---|
| now / forecast | `api.open-meteo.com/v1/forecast`, `models=best_match`, `past_days=7`, `forecast_days=7`, `timezone=UTC` (fixtures used Australia/Sydney; the parser handles both via `utc_offset_seconds`), `wind_speed_unit=ms`, hourly = the 42 fixture variables | best_match: all 42 present, no nulls (Katoomba grid point −33.708, 150.261, 715 m). **Never** `bom_access_global` (all-null; its units even read `'undefined'`). If pressure levels come back null: re-request them from `ecmwf_ifs025` (3-hourly), then `gfs_seamless` |
| past, t0 ≥ now − 92 d | forecast API with `past_days` up to 92 | as above |
| past, 2016 ≤ t0 < now − 92 d | `historical-forecast-api`, `models=ecmwf_ifs` | 2019 fixtures: 2 m, 10/80/120 m wind, radiation, VPD, surface pressure present; **all-null** 180 m wind, BLH, CAPE, soil moisture and all 20 pressure-level variables → `upperAirSource = 'synthetic'` |
| past, t0 < 2016 [H] | `archive-api`, `models=era5`, hourly | 10 m and **100 m** wind only (no 80/120/180 m, no pressure levels), BLH, VPD, radiation, gusts present, CAPE null (katoomba/warrumbungles 2013 fixtures) |
| replay | bundled `tests/fixtures/live/replay-<id>.json` + `-daily365.json` (copied to `public/demo/replays/` at build) | as the source above; offline |
| preset | §11.3 generator | designed; offline |
| manual | user/belt-kit readings (§11.5) | offline |

**Daily history** for KBDI/DF (365 days ending yesterday, local days): the `archive-api` daily
`precipitation_sum, temperature_2m_max, temperature_2m_min` (`timezone=Australia/Sydney`) **up to its last date**, then
**local-day aggregates of the forecast `past_days` hourly data** (rain = Σ precipitation, Tmax = max temperature_2m,
Tmin = min) up to yesterday (the archive lags ≈ 5–6 days: the Katoomba archive ends 2026-09-21 on 2026-09-27). 10-year
daily precipitation (cached forever per site) for `annualRainfall`. Cache every response (KV, key by URL); on HTTP 429
back off 60 s ×3, then use cache/stale.

### 11.2 Parsing Open-Meteo (P0) [D48]

- Time: `epochMs = Date.UTC(parse(time[i])) − utc_offset_seconds·1000` using the response's single
  `utc_offset_seconds` (fixtures: 36000 even in December — fixed UTC+10, not AEDT).
- Units: read `hourly_units`; convert km/h → m/s if present; a unit of `'undefined'` means the variable is absent.
- Nulls: a variable that is null for every hour → absent (undefined); isolated nulls → linear interpolation across
  gaps ≤ 3 h, else undefined for those hours. Required: temperature_2m, relative_humidity_2m, wind_speed_10m,
  wind_direction_10m; if any required field has a gap > 3 h, try the next model, else fail with a clear message.
- **Radiation**: Open-Meteo radiation is the mean of the **preceding** hour. The parser computes the clearness
  `k_t = clamp(GHI_hour / GHI_clear(t − 30 min), 0, 1.2)` (clear-sky model of `terrain/solar.ts` at the hour
  mid-point; when GHI_clear < 20 W/m² copy k_t from the nearest daylight hour, or from `cloudAttenuation(cloud)` if
  none) and stamps it at t − 30 min (`WeatherHour.clearness`).
- Mapping to `WeatherHour`: temperature, relativeHumidity, dewPoint, windSpeed10, windDir10, windGust10, windProfile
  ({80, 100, 120, 180} m where present), pressureLevels ({925, 850, 700, 500} with height = geopotential height),
  cloudCover, shortwaveRadiation, directRadiation, diffuseRadiation, clearness, precipitation, boundaryLayerHeight,
  cape, vpd, surfacePressure. `sourceElevation = elevation` (grid point, e.g. 715 m for Katoomba; replays 363–1545 m).
  `upperAirSource = 'model'` when ≥ 3 pressure levels are non-null, else `'synthetic'`.
- `series.timezone = 'Australia/Sydney'` for display; physics uses LMST (§0.2).
- **`weatherAt(t)`**: instantaneous fields (T, RH, T_d, cloud, BLH, pressure, profile and level values) interpolate
  linearly between stamps, wind as u/v vectors (speed = |mean vector|); precipitation is piecewise-constant over the
  preceding hour (rate = P/1 h); radiation: k_t interpolated linearly between its mid-hour stamps and
  `ghi(t) = k_t(t)·GHI_clear(t)`, which sim passes to `insolation(terrain, t, { ghi, cloudCover })`.

### 11.3 Weather presets `WEATHER_PRESETS[id].build(start, hours, site)` (P0) [H; D46]

Each preset has a **canonical date** (the UI's default start; the FBI chip is defined there because period 1 of the
forest moisture only exists in Oct–Mar). Diurnal shape by LMST hour h:
`D(h) = 0.5 − 0.5cos(π(h − 6)/9)` for 6 ≤ h ≤ 15, else `0.5 + 0.5cos(π((h − 15) mod 24)/15)`;
`T = T_min + (T_max − T_min)·D`; T_d constant per air mass; `U10 = U_n + (U_d − U_n)·D`; gust = factor·U10; cloud
constant; radiation undefined (insolation uses clear sky × cloud); precipitation 0. Series stamps: hourly, and every
10 min inside [t_c − 1 h, t_c + 2 h] of a change.
**Change** at t_c: `f = logistic((t − t_c)/7.5 min)` (10–90 % in 33 min); wind vector
`U = (1 − f)·U_pre(t) + f·U_post(t)` with direction by shortest arc, where U_pre follows the diurnal shape and U_post
does not (hot-nw: 12 m/s for 1 h then 9 m/s via `smoothstep(1 h, 1.5 h, t − t_c)`; catastrophic: 13 m/s); cooling
and moistening `T = T_diurnal − ΔT·smoothstep(0, 2 h, t − t_c)`, `T_d = T_d,pre + (T_d,post − T_d,pre)·smoothstep(0, 2 h,
t − t_c)`.
**Reference elevation** (D46): `sourceElevation = z_s` = the domain median elevation, so the preset's stated surface
values are what the middle of the domain gets; T_d applies at the same reference; the chip test evaluates the FBI at
z_s (no lapse). **Upper air** (`upperAirSource = 'preset'`, C-Haines enabled): levels 850 (1500 m), 700 (3100 m),
500 (5800 m) with winds 1.3×, 1.6×, 2.0× the day surface wind (same direction); temperatures from the table's
sea-level-referenced air mass, forced non-superadiabatic above the reference:
`T850 = max(T850_tab, T_max − 9.8·(1.5 − z_s/1000))` (when z_s < 1500 m; otherwise 850 hPa is below ground and dropped),
`T700 = T850 − (T850_tab − T700_tab)`, `T500 = T700 − 20 K`, Td850 from the table (RH850 = rhFromTd(T850, Td850)),
RH700/RH500 from the table (every `PressureLevelData` field is filled).

| id | canonical date, start | T_min/T_max °C | T_d °C | wind from, day/night m/s, gust× | change | cloud | DF / KBDI | T850/T700/Td850 (table), RH700/RH500 | chip (FFDI, FBI at z_s) |
|---|---|---|---|---|---|---|---|---|---|
| hot-nw-sw-change | 20 Dec, 11:00 LMST | 22/36 | 2 | 310°, 11/6, ×1.5 | t_c 15:00 LMST → 230°, 12 m/s (gust ×1.8) for 1 h then 9; ΔT 8 K, T_d → 10 | 10 % | 9 / 120 | 22/8/−6 (C-Haines 11.7 at z_s = 0), 15/20 % | at 14:30 (pre-change): T 35.9, U10 10.96 m/s → FFDI 62.6, **FBI 75 Extreme** |
| calm-night-katabatic | 15 Mar, 19:00 | 8/24 | 6 | 270°, 2/1.5, ×1.3 | — | 0 % | 7 / 60 | 16/6/4 (6.0), 40/40 % | at 21:00 (period 3): T 18.5, U 1.83 → **FBI 6 No rating**; nightTemplate Δθ_max 6 K, h_inv 150 m |
| mild-spring-hr | 15 Oct, 10:00 | 8/20 | 7.7 | 130°, 4.5/1.5, ×1.4 | — | 20 % | **8 / 60** | 10/0/2 (4.7), 45/40 % | at 15:00: RH 45 %, M_A 7.96, ROS 272 m/h, I 1889 → FFDI 6.0, **FBI 16 Moderate** (DF 6 gave FBI 12, exactly on the boundary) |
| catastrophic-black-summer | 30 Dec, 10:00 | 28/42 | −3 | 315°, 15/10, ×1.6 | t_c 18:00 → 225°, 13 m/s; ΔT 10 K, T_d → 8 | 5 % | 10 / 170 | 28/12/−10 (13.0), 10/15 % | at 15:00: FFDI 147, **FBI 109 Catastrophic** |

`rating` chips in `ui/content.ts` must match the chip column (test; the UI texts stay valid: mild spring is still
"20 °C, 45 % RH"). A preset started on another date keeps its weather, but its FBI can differ (e.g. mild-spring in
September has no period 1): the UI shows the FBI computed for the chosen date, and the chip only for the canonical
date.

### 11.4 Replays (P0)

Replay id `<site>-<yyyy-mm-dd>` → demo site bundle + fixture pair. Default start: the date at 10:00 LMST (user can
move it within the file's hours, keeping ≥ 4 h of weather after it). KBDI/DF from the `-daily365` file with the demo
annual-rainfall table (§5.7); spin-up from the file hours before t0 plus the daily fallback (§5.6). Fire history uses
the §4.4 inclusion rule; `activeFires` (e.g. Gospers Mountain for grose/gospers 2019-12-19, Green Wattle Creek for
kanangra, Currowan for budawangs, Pilot Lookout for thredbo, Wambelong for warrumbungles) are shown as "burning at
this date" outlines; the user places ignitions (the final perimeters are not the t0 perimeters). Replays have no
upper-air data: synthetic profile, C-Haines unavailable (§8.2). Replays and offline demo runs clamp the extent to the
bundled 9 km.

### 11.5 Belt weather kit and manual entry (P0) [D38, D39]

`beltKitReading({dryBulb, wetBulb, windKmh, windDir, time, pressureHpa?, exposure = 'open'})`:
`e = esat(T_w) − 6.53e-4·(1 + 9.44e-4·T_w)·p·(T − T_w)`, `RH = 100e/esat(T)`, p = pressureHpa ?? pressureIsa(z_site);
`windSpeed10 = windKmh/3.6 × {open 1.25, woodland 1.67, forest 2.4}` (kit reading at ~2 m → 10 m open). Vectors
(T/T_w at 0, 1000, 2000 m ISA p 1013.3/898.7/795.0 hPa): 25/15 → 32.6/35.0/37.2 %; 30/18 → 29.6/31.7/33.7 %; 35/19 →
19.9/22.0/24.0 %.
**Manual series** (`WeatherMode.manual`): readings are interpolated **linearly** between their times (wind as u/v
vectors); before the first and after the last reading the nearest reading is held; a single reading is held for the
whole run with the diurnal template turned off. Defaults: cloud = the user's cloud chip, else 0 %; `sourceElevation`
= the reading's site elevation; `upperAirSource` absent (synthetic profile); if only DF is entered, KBDI =
`kbdiFromDf(DF)` (bisection on K ∈ [0, 203.2] of DF(K, x = x_lim(K)), i.e. no recent rain); if neither, DF 7 and KBDI 60
with a warning. **Belt-kit readings in a forecast run** become a domain offset on T and T_d (reading minus the
lapse-corrected forecast at the reading's elevation) that decays linearly to 0 over 3 h after the reading, and a
`WindEdit` of radius 1 km at the reading location (§8.3).

### 11.6 Build pipeline, grids, fallbacks and defaults (P0)

Order (with `BuildProgress.step`): **terrain → canopy → vegetation → fire history → weather → drought → fuel →
options** (fuel needs DF, KBDI and the month for curing and the class-34 offset). Moisture spin-up runs in the worker
at `init`.
- **terrain**: demo `dem5m` (10 m Terrarium, row 0 north → flip) or terrain tiles → 10 m grid (`terrainHiRes`);
  block-average to the fire grid (3×3 at 30 m, 2×2 at 20 m), `buildTerrain` on the fire grid, `slopeP90Deg` and
  `cliffFraction` from the 10 m sub-cells.
- **canopy**: demo `canopy` (R = p90 height, G = mean, B = cover·255), aggregated to the fire grid, with a `valid`
  mask; or remote CHM for extents ≤ 3 km.
- **vegetation**: SVTM layer 3 → `rasteriseVegetation(grid, recs, terrain)`; **fire history** → `parseFireHistory`,
  `rasteriseFireHistory` (→ `fuelHistory`, `activeFires`); **weather** (§11.1–11.5); **drought** (§5.7–5.8);
  **fuel** (§4.7); **options** (§12.6: `fireCellSize` 20 m only if the user pre-selected High and extent ≤ 6 km, else
  30 m).

Fallbacks (first available wins; each fallback adds a warning):

| layer | chain |
|---|---|
| terrain | demo bundle → area pack → cache → Terrarium tiles → error (no synthetic terrain for real sites) |
| canopy | demo → area pack → remote (extent ≤ 3 km) → none (type defaults per cell, also where `valid = 0`) |
| vegetation | demo / area pack / network SVTM → inference (§4.3) |
| fire history | demo / area pack / network → none (steady-state fuel, D40) |
| weather | network (§11.1) → cached response covering [t0 − 7 d, t0 + duration] → error "offline: choose a preset, manual entry or a replay" |
| daily history | archive (+ forecast gap-fill) → cache → none: DF 7, KBDI 60 with a warning |
| annual rain | 10-yr archive mean → demo table → 1.25 × 365-day total |

Defaults: duration 4 h, extent 9 km (demo), fireCellSize 30 m, tier auto. Non-fatal warnings (exact strings in
`scenario/messages.ts`): vegetation inferred; no fire record (steady-state fuel assumed); undated fires in current
season; fires active at the start; synthetic upper air; weather model fallback used; KBDI from < 365 days; daily
history gap-filled from the forecast; canopy unavailable (type defaults); drought defaults used.

### 11.7 Live context feeds (P1) [V doc 08b §8–9]

- **RFS major incidents** (`feeds/majorIncidents.json`, ACAO *): FeatureCollection; geometry is a `Point` or a
  `GeometryCollection[Point, GeometryCollection[Polygon…]]` (take the Point as `location`, the polygons as `rings`);
  `pubDate` is `dd/mm/yyyy h:mm:ss AM|PM` local civil time (Australia/Sydney) → `updated`; `category` → `alertLevel`
  ("Advice", "Watch and Act", "Emergency Warning", "Not Applicable", "Planned Burn"); `description` fields
  `STATUS`, `TYPE`, `SIZE: <n> ha` → `status`, `sizeHa`. Shown as context only; never used as an ignition without
  user confirmation.
- **RFS fire danger / fire ban** (`feeds/fdrToban.xml`): `<District><Name/><Councils/>` (`;`-separated)
  `<DangerLevelToday/>`, `<FireBanToday/>` — pick the district whose council list contains the site's council (or the
  nearest district by name), show "Official rating today: {DangerLevelToday}" as a comparison chip beside the model's
  AFDRS-parity rating.
- **DEA hotspots** (WFS `public:hotspots_three_days`, GeoJSON): `bbox=lonMin,latMin,lonMax,latMax,EPSG:4326`
  (lon,lat order with the CRS suffix, else 0 features); properties `datetime`, `power`, `confidence`, `satellite`,
  `hours_since_hotspot` → map markers with age; never auto-ignite.

---

## 12. `sim/` — orchestrator, coupling loop, worker

### 12.1 Worker protocol (P0)

`sim/protocol.ts` as existing plus §2.3 (`setQuality`, `rewound`, `'maxEmbers'`). The worker (`src/sim/worker.ts`)
runs in **chunks of ≤ 40 ms wall time** and yields (`MessageChannel` post-to-self) so `pause`, `explain`, `edit`,
`setOption`, `setQuality` are handled between chunks. Snapshots every `snapshotInterval` (300 s) simulated, arrays
copied into transferable buffers; a **t0 snapshot** is posted right after the moisture spin-up (before the 3-D
spin-up) so the first picture appears within 3 s.

### 12.2 Coupling order (normative, P0)

```
init(scenario):
  assert fuel.grid === terrain.grid;  tier = options.tier ?? 'auto'
  derived = terrainDerived(terrain); features = computeTerrainFeatures(terrain, derived)
  rngEmbers = Rng(seed); rngFire = Rng(seed + 1); rngExplain = Rng(seed + 2); rngAtm = Rng(seed + 3)
  fuelBase = scenario.fuel; fuel = applyAll(fuelBase, edits with time ≤ 0)
  night = stableNight spin-up over the series (t0 − 24 h → t0, §5.2a)
  moisture = new MoistureModel(terrain, fuel, derived); moisture.initialise(series, t0, drought, night)
  fire = new FireSpreadModel(terrain, fuel, features, opts, rngFire)
  atm = tier === 'fast' ? new DiagnosticWind(...) : new Atmosphere(...)      (auto: build the standard tier)
  atm.setAmbient(stamp_i ≤ t0, stamp_i+1); atm.setTime(t0)
  post 'ready' (forecastInsights) and the t0 snapshot (u_bg wind, moisture, no 3-D volume)
  3-D tiers: spin-up t ∈ [t0 − 900 s, t0) with the t0 ambient, setSurfaceHeating(sun(t0), w(t0), kbdi, night) and the
    cold pool; tier auto: the first 20 spin-up steps are the timing sample (§12.6); if the choice is 'fast', replace atm
    by DiagnosticWind
  explain = new InsightEngine(terrain, derived, fuel, features); checkpoint(t0) (kept permanently)
loop while t < tEnd (each iteration = one atmosphere step Δt_a):
  1  apply due ignitions, edits and setQuality records (time ≤ t) in insertion order; fuel edits → fire/moisture caches
  2  if t ≥ next stamp: atm.setAmbient(stamp_i, stamp_i+1);  atm.setTime(t);  w = weatherAt(t)
     stableNight(night, { h_sun, hoursSinceSunrise, u10: w.windSpeed10, cloud, rain24, breakEta }, Δt_a)
  3  every 600 s (and at t0): sun = insolation(terrain, t, { ghi: k_t(t)·GHI_clear(t), cloudCover });
       atm.setSurfaceHeating(sun, w, kbdi, night); moisture.update(w, sun, 600, ctx); fire.refreshMoistureCache(env)
  4  every 60 s and on a 22.5° wind-sector change: fire.refreshMasks(env)   (crest cache, s_sep, VLS zones, frontDist;
       uses the previous step's uRidge)
     atm.surfaceWindForFire(fireGrid, U, V, Ubg, Vbg, Uind, Vind, uRidge, ctx);  atm.airAt(fireGrid, airT, airRho)
  5  fire.prepare(env)          (prepared cells: kernel, hybrid head, A/E/G, build, ellipse speeds, VLS; §7)
  6  fire.step(Δt_a, env)       (CFL sub-steps; arrivals; heat accumulation)
  7  if coupling > 0: atm.addFireHeat(fireGrid, heatPrev, crownPrev)   (heat of the PREVIOUS iteration: fixed one-step lag)
     atm.step(Δt_a);  heatPrev = fire.heatRelease(); crownPrev = fire.crownShare()
  8  embers.emit(fire.field, fuel, fire.frontCells(), Δt_a, t, fire.aux());
     embers.step(Δt_a, atm.sample, atm.sampleTurb, landing, onIgnite)   (ignitions scheduled with delays, applied in step 1)
  9  every 60 s: fire.minuteTasks(env) (junctions, debris, exclusion distance map); insights = explain.update(view)
 10  t += Δt_a; every 300 s: snapshot + stats; every 1800 s: checkpoint
Δt_a = min(atm.maxStableDt(), 12 s) (fast tier: 10 s fixed); the fire sub-steps inside it.
```
The one-step heat lag (≤ 12 s, physically negligible, doc 07 §8) makes the P1 **two-worker pipeline** (worker A: fire
+ embers + explain; worker B: atmosphere; they exchange the 2-D heat field and the fire-grid winds each step) produce
results bitwise identical to the single-worker order.

### 12.3 Stats (P0)

burntAreaHa = N(tArr ≤ t)·Δx²/10⁴; burningCells; perimeterKm = (burnt/unburnt 4-neighbour edges)·Δx·π/4/1000 [D:
staircase correction]; maxRos, maxIntensity over burning cells; head = front cell of max normal ROS (dir, ros);
activeEmbers, spotFires, embersLeftDomain; convectiveNumber = max over head cells of `aux.nc` smoothed over 5 cells;
weather = weatherAt(t); deadFuelMoistureMean over unburnt burnable cells within 2 km of the front (domain if no fire);
ffdi at the grid point (U10 in km/h, DF); fireDangerRating from `afdrsFbi(dominant burnable FuelType, weatherAt(t),
lon, DF, KBDI)` (D41); msPerSimMinute.

### 12.4 Checkpoints and rewind (P0)

Checkpoint every 1800 s simulated into a ring of 8, **plus the t0 checkpoint kept permanently** (so a 6 h run can
always rewind). Contents: fire (φ, tArr, origin, E, junction, field arrays, aux rasters, VLS zone labels with t_act
and T_p, breach barrier timers, debris in flight), moisture (M_lag, L_dew, h_e, rain history, all output fields),
`stableNight` state, atmosphere (u, v, w, θ′, smoke, p′, cached u_bg pair and stamp times, breakEta integrals, fast-tier
pyrogenic ψ, spunUp), embers (SoA, holdovers, W_c and n̄_c, decayed overlay rasters, delayed ignitions), insight
engine (per-key state machines, day maxima, change bookkeeping), spot list, pending ignitions/edits/setQuality
records, all RNG states, stamp index, t. `rewind(time)`: restore the latest checkpoint ≤ time, drop insights/spots
with time > target, re-run deterministically (same edits at their times) to `time`, post `{type: 'rewound', time}`.
Edits added after the rewind point are kept only if their `time` ≥ target. Every module has a test: restore then step
is bitwise equal to an uninterrupted step.

### 12.5 Determinism (P0)

No `Math.random`, no wall-clock in physics (tier changes are recorded edits, §8.9). Independent `mulberry32`
streams: seed (embers), seed + 1 (fire: VLS periods, breach draws, debris), seed + 2 (explain tie-breaks), seed + 3
(atmosphere, reserved), so toggling one subsystem does not change others' sequences. Fixed iteration orders (index
order; band list sorted), Float64 time accumulators, Float32 fields. Test: two runs with the same scenario and seed
produce bitwise-identical snapshots (V18).

### 12.6 Quality tiers and auto-tune (P0)

| tier | atmosphere | Δx_a | levels / Δζ₁ | V-cycles per step | fire cell | maxEmbers |
|---|---|---|---|---|---|---|
| fast | none (`DiagnosticWind`, pyrogenic on, c_p = c_f) | — | — | — | as built (30 m) | 2000 |
| standard | 3-D | clamp(extent/45, 100, 270) m | 20 / 30 m | 1 | as built (30 m) | 4000 |
| high | 3-D | clamp(extent/60, 100, 270) m | 24 / 25 m | 2 | as built (20 m if the scenario was built for High and extent ≤ 6 km) | 4000 |

`fireCellSize` is fixed by scenario/ when it builds the grids; auto-tune and `setQuality` change only the atmosphere
tier, Δt_a and `maxEmbers` (a user-set `maxEmbers` wins). **Auto-tune** (tier 'auto'): from the mean wall time of the
first 20 standard-tier spin-up steps, predict `T_pred = 1.4 · t_step · duration/10 s` (1.4 = fire + embers +
overheads in one worker; 1.0 with the two-worker pipeline); choose standard if `T_pred ≤ budget = 120 s ×
duration/6 h` (min 30 s), else fast. High is used only when requested. `setQuality(tier)`: at the next step boundary,
restore the latest checkpoint ≤ now, rebuild the atmosphere for the new tier and re-spin it for 900 s at the
checkpoint time, then re-run to now; recorded as an edit at that simulation time and replayed on rewind.
`setOption` changes (coupling, embers, mountainPhenomena, maxEmbers) apply from the next step and are recorded the
same way.

---

## 13. Performance budgets (P0) [doc 07 §8, doc 01 §4.9, doc 06 §4.7; D]

Target (brief): **6 h scenario ≤ 120 s wall on a mid-range phone**, first snapshot ≤ 3 s. Phone ≈ 2–3× slower than one
x86 Node core [K doc 09]. Evidence: doc 07 measured 7.9 ms per step on one Xeon core for 38.4k cells; standard tier
45×45×20 = 40.5k cells → 8.3 ms × 1.5 (MAC/metric) × 1–1.5 (multigrid) = 12.5–19 ms on Xeon, **25–56 ms on a phone**.

| component (phone) | per call | calls per 6 h | total |
|---|---|---|---|
| atmosphere step, standard (1 V-cycle) | 25–56 ms | 1800–3600 | 45–200 s |
| fire prepare (≤ 20k prepared cells × 180–300 ns; R_w reused where ΔU10 ≤ 2 %) | 2–6 ms | 1800–3600 | 4–22 s |
| fire sub-steps (band, Heun) | 0.5–1.5 ms | 4.5–22k | 3–18 s |
| embers ≤ 4000 (≈ 3 sub-steps × 300 ns) | 2–5 ms | 1800–3600 | 4–18 s |
| moisture + insolation (90k cells) | 10–20 ms | 36 | < 1 s |
| u_bg solves (stamps + change ramps) | 50–150 ms | 6–25 | < 4 s |
| detectors, junctions, debris | ≤ 10 ms | 360 | < 4 s |
| snapshot copy/transfer | 5–10 ms | 72 | < 1 s |
| start-up: moisture spin-up (LUT + 48 h per cell) + t0 snapshot | ≤ 1.5 s + 0.5 s | 1 | ≤ 2 s |

Consequences: the **fast tier** (15–60 s per 6 h) always meets the budget; the **standard tier** in one worker needs
60–260 s per 6 h and meets the budget only on the faster half of mid-range phones, so auto-tune decides from the
measured step (§12.6); the **two-worker pipeline** (P1, §12.2; ≈ 1.7–1.9×) brings standard to ≈ max(atmosphere,
fire + embers) = 45–200 s. WASM SIMD for advection and smoothers (1.5–3× [H], doc 07 §8) is the next lever; WASM
threads are not relied on (Capacitor cross-origin isolation UNVERIFIED). Memory: < 150 MB in the worker (atmosphere
~50 fields × 40k cells; fire ~30 fields × 90k; checkpoints 9 × ~8 MB). **CI gates** (x86 Node, one worker, Katoomba
9 km, 4 h): standard ≤ 40 s, fast ≤ 15 s, t0 snapshot ≤ 1.5 s (V20). Re-measure on target phones before fixing tier
thresholds (§16).

---

## 14. Test vectors (index and extra vectors)

All vectors were recomputed with independent Python (rev. 2: every changed vector re-derived after the reviews).
**Tolerance**: half a unit of the last printed digit, or ±0.1 % for closed-form functions, whichever is larger;
±1 m/h for ROS and ±1 kW/m for I printed as integers; exact integers for FBI; fixture-derived values (KBDI/DF)
±3 mm / ±0.3.

| Module | Where | Functions covered |
|---|---|---|
| core/physics | §0.3, §5.2a | esat, dewPoint, pressureIsa, localDate, stableNight (growth, windy decay, sunrise decay) |
| fuel | §4.4, §4.5, §4.6, §4.9 | NPWS dates, Olson (incl. residual/prescribed), FHS curve, loadFromFhs, inclusion rule, SVTM mapping (incl. 47/48, moisture family), rasterisation |
| moisture | §5.2–§5.10 | lapse Γ (D43), AFDRS equations (all families, period boundary 17:00), MC2, anomaly calibration, f_τ, KBDI (dK, spell, two-pass fixtures, katoomba now), DF (table, fixtures, katoomba now), FA dry/wet/C1/blend, P_ig |
| fire/models | §6.2–§6.12 | Mk2 (6 cases + mixing + gate + low wind + R0 floor), flame height, Vesta 2012, FFDI/Mk5 (+V9 winds), grass (4 + φC), heath refit/v1.0 (+I), pine (4), LB (forest ramp, grass, ramp), ellipse ŝ, intensity gating (4), spotting envelope (8), FBI (14), AFDRS-parity FBI (4), SpreadFactors (2) |
| fire/spread | §7.2–§7.10 | Δt_f bound (7), hybrid head (5, incl. Kataburn bound), SF (17), ellipse speeds (calm 30°, windy, downslope wind), breach (5), amplifier A and G (7), build (5), VLS (6), lee separation (5), junction geometry (5) |
| atmosphere | §8.1–§8.10 | stretch ratio, C_D (2), κ fallback 0.7831, Q_h (4), slope flow (4), first-layer fraction (2), C-Haines (3), Briggs (2), N_c (5) |
| embers | §9.2, §9.6, §9.7 | emission reference 324 km⁻¹ h⁻¹, v_t (3), Albini τ and z_b, E2/E4 fall heights |
| scenario | §11.3, §11.5 | preset chips (4), psychrometer (9), kbdiFromDf |
| explain | §10.5 | Tobler (5) |

Extra cross-module vectors:
- `insolation` (terrain/): Katoomba 21 June solar-noon elevation 32.85° geometric (32.9° with refraction); 35°
  south-facing slope receives 0 h of direct sun on 21 June; 30° slopes, 15 Oct, clear sky: **beam energy integrated
  over 13:00–16:00 LMST** relative to flat = N ≈ 1.07, NW 1.29, SE 0.45 (as in `terrain/solar.test.ts`; instantaneous
  ratios at 14:00 LMST are N 1.09, NW 1.28, SE 0.46).
- Heat-release normalisation: ∫q dt over 10τ_f (q cut at 7τ_f) equals HEAT_YIELD·w/10 to < 0.1 % (loss 0.09 %).
- `SpreadFactors` product equals the arrival ROS to < 1 % on head, flank and back cells.
- `weatherAt` wind interpolation: 350° 5 m/s and 10° 5 m/s at the midpoint → 0°, 4.92 m/s (vector mean).
- Psychrometer RH(25/15 °C, 898.7 hPa) = 35.0 % (doc 04 quotes 35.1; the difference is Bolton vs Magnus e_s).
- Flat terrain, no fire: U10_fire = forecast U10 ± 1 % for the Katoomba forecast fixture, the gospers replay and the
  katoomba-2013 ERA5 replay, in every tier (§8.8).
- Preset upper air at z_s = 800 m, hot-nw: T850 29.1 °C, T700 15.1 °C, C-Haines 12.0 (CA 5.0, CB 7.0).

---

## 15. Validation scenarios (automated where marked A; qualitative Q)

Each runs on a synthetic or demo terrain with fixed seed, embers off unless stated, `mountainPhenomena` on. "Moisture
hook" = a test-only constant moisture field; "manual weather" = §11.5 constant readings.

| # | Scenario | Setup | Pass criterion |
|---|---|---|---|
| V1 A | Upslope vs downslope | planar 20° slope and a flat plane, DryForestShrubby, calm, M 8 % (hook), DF 10, surface heating off, Δx 10 m, 6 h, point ignition | ROS from the arrival-time gradient along the axis (100–300 m upslope, 20–60 m downslope, same windows on flat): up/flat = 4.0 ± 5 %; down/flat = 0.571 ± 5 % (backing never < 0.5×) |
| V2 A | Wind aligned with slope | 10° slope, U10 30 km/h upslope, heating off, straight line ignition 1 km wide across the slope | head ROS from the arrival-time gradient 200–600 m from the line = flat Mk2 × 2.0 ± 5 % |
| V3 A | Cross-slope wind | 20° slope, wind across slope | head direction between wind-to and upslope (vector sum, ±5°); ROS ≤ flat wind ROS × 1.2 |
| V4 A | Slowing at a ridge crest | symmetric 2-D ridge, 25° sides, U10 20 km/h across it, ignition on the windward base | ROS drops ≥ 60 % within 2 cells after the crest; driver changes Slope/WindAndSlope → Backing/Wind on the lee side; ridge-crest card fires (U_ridge ≥ 15 km/h) |
| V5 A | Backing at night | V1 slope, hot-nw day then its night; ignition at 14:00 | head ROS at 02:00 ≤ 35 % of 14:30; night-slowdown card; downslope backing ≥ 0.5 × flat at the same M |
| V6 Q/A | Katabatic at night | calm-night-katabatic preset, Katoomba demo | 3-D tier: by 03:00 near-surface wind on ≥ 60 % of slopes > 10° points downslope (within 60°) at 0.5–3 m/s; katabatic card; valley floor < 2 m/s (also in the fast tier) |
| V7 Q/A | Anabatic by day | mild-spring-hr (15 Oct), Grose demo, 11:00–15:00 | sunlit (cos i > 0.5) slopes > 10° get 1–3 m/s upslope component; shaded opposite slopes < 0.5 m/s; anabatic card; SE-facing 30° cells 1.2–3.5 pp wetter than NW (moisture) |
| V8 A | South-facing gully wetter | Katoomba demo, mild-spring-hr on 15 Oct, 14:00 | mean M in S/SE-facing gully cells (Landform Gully, aspect 135–225°) ≥ mean M of N/NW slopes + 2 pp; thermal-belt cells drier than valley floor by ≥ 3 pp at 05:00 on the night preset |
| V9 A | Spotting distance vs FFDI | flat 9 km, DryForestShrubby BH 3, embers on, T 34 °C, RH 18 %, DF 10, U10 7.5 / 37.1 / 66.7 km/h (FFDI 25 / 50 / 100) | P95 landing distance of ignition-capable embers ordered 25 < 50 < 100 and within ×2 of Mk5 S = 1.29 / 2.95 / 6.25 km; §9.7 envelope test |
| V10 A | VLS on a lee slope | 2-D ridge, lee slope 28°, W wind 40 km/h, M 6 %, ignition on the windward side | once the fire crosses the crest: lateral spread along the lee slope at 1.5–3 km/h mean with 10–15 min pulses; VLS card (danger); driver LateralVorticity on ≥ 20 % of lee cells; no VLS at 10 km/h |
| V11 A | Chimney | V-gully 30° axial slope, 25° walls, depth 60 m, calm afternoon | head ROS in the gully ≥ 1.8 × the open 30° slope ROS after τ_e; eruptive + gully cards; "indicative" flag |
| V12 A | Wind change | hot-nw-sw-change (20 Dec), flat forest, ignition 11:00 | after 15:00 the NE flank becomes the head within 30 min; wind-change card ≥ 60 min before with flank length within 20 % |
| V13 A | Recent burn | flat forest (DryForestShrubby), a 2-yr-old prescribed burn record (p 0.6) downwind of the ignition; manual weather U10 10 km/h, M 8 % (hook), DF 8, WRF 3.5 | ROS inside / outside ≤ 0.5 and I inside / outside ≤ 0.4 (expected 0.25 / 0.20; the ratio rises to 0.72 at 20 km/h, which the recent-burn card's extreme-day caveat covers); recent-burn card |
| V14 A | Junction | two line fires at 30° included angle | junction card; vertex closing speed ≥ geometric 1/sin(15°) × R · 0.9 |
| V15 Q | Plume-dominated | catastrophic preset, calm hour | N_c ≥ 10 → plume card; fire-induced wind card (coupling > 0) |
| V16 A | Level-set stability | §7.13 circle, ellipse and calm-plane tests | as §7.13; 1.2× bound rejected |
| V17 A | Coupling off | coupling = 0, any tier, embers off | FireField bitwise independent of χ_c (0.85 vs 0.5) and identical to a run with `addFireHeat` stubbed out |
| V18 A | Determinism & rewind | any scenario, rewind 2 h → 1 h; also a 6 h run rewound to 0.5 h | snapshots after re-run bitwise equal to the first run |
| V19 A | Replay sanity | gospers-2019-12-19 | Gospers Mountain perimeter excluded from fuel reset (active); KBDI 125 ± 3, DF 10; synthetic upper-air warning |
| V20 A | Performance | Katoomba 9 km, 4 h, x86 Node CI, one worker | standard ≤ 40 s, fast ≤ 15 s, t0 snapshot ≤ 1.5 s (≈ 6 h ≤ 120 s on a phone 2× slower than CI) |
| V21 A | Wind scale | flat terrain, no fire, each tier; forecast, ERA5 replay and preset weather | U10_fire = forecast U10 ± 1 % (D30) |
| V22 A | Coupled head | fast tier, 2 km line fire, flat, U10 20 km/h, coupling 1 vs 0 | steady head ROS equal ± 5 % (pyrogenic head correction, D32) |

---

## 16. Unresolved issues and UNVERIFIED register

Implement as specified; label dependent outputs "uncertain"/"indicative"; keep every parameter below in `*_PARAMS`.

1. **Vesta Mk2 coefficients** come from one code lineage (PyroXL/PyroPy2); primary (Cruz et al. 2021/2022) not read;
   FL definition (s + ns), coded phase mixing, P3 gate, H_u equation all UNVERIFIED (D6, D7, D11). Below U10 5 km/h the
   coded model is extrapolated and very sensitive (phase 2 at 1–2 km/h sub-canopy wind gives 5–10 × R0); the R0 floor
   (D44) and the R1 ramp (D21) are FireSim choices.
2. **Heath 2024 refit** published source not identified (PyroXL only); FBI heath ROS table variant unresolved (D12, D14).
3. **FBI grass breakpoints** 50/2000 (FBI-TG) vs 100/3000 (PyroXL, possibly operational) unresolved.
4. **FHS → load table** (Tolhurst workbook) not checked against OFHAG 4th ed.; near-surface bins inconsistent with PyroXL.
5. **SVTM → fuel-class mapping** for heath, rainforest, grassland, wetland, riverine and semi-arid rows (and classes
   47/48) is [H]; needs NSW RFS review. Meta CHM heights read low in tall eucalypt forest (H_o,eff floor 0.8 × type H_o
   is [H]).
6. **Prescribed-burn patchiness** p = 0.6 and post-fire regime weights (w = 0.5 unknown severity) UNVERIFIED (Penman 2007
   not read); FESM severity not ingested.
7. **Olson residual c** meaning unknown (ignored, D16).
8. **Moisture anomaly model** (a_s, b_u, canopy transmittance, LAI, gully offset, rain memory for non-heath fuels, dew
   store) is calibrated only to a derived 2–3 pp NW–SE contrast; field data (Slijepcevic, Nyman) not fitted.
   Period-hour convention (standard vs daylight time) unverified; solar time chosen (D37). Lapse-rate switch (D43) and
   the `stableNight` constants (τ 3 h / 1 h, break 3.5 h + 1.5 h wet, gates) are [H].
9. **KBDI annual rainfall**: demo-site climatology table is approximate [K]; the 10-year archive mean must replace it
   online. KBDI cold-day rule and two-pass spin-up (D19) are choices.
10. **Schroeder P_ig** is US-derived; Ellis 2015 eucalypt coefficients not transcribed.
11. **Ember emission E0** has no Australian calibration; spot counts are relative. Glowing multiplier 0.3, pile
    synergy 0.2, holdover rates, class lifetimes and σ_ln are [A/H].
12. **Mountain parameterisations**: attachment amplifier (G_max 2.5, τ_e, 22° logistic, resolved-indraft substitution
    s_res), trench score, gully steering, VLS score edges (DEM-resolution dependent), activation by upwind intensity and
    lateral rates, lee-separation thresholds (D42) and 0.3 eddy fraction, junction extra boost, rolling debris rates —
    all [H]. VLS slope edges need calibration on the Canberra 2003 / Grose 2006 DEMs.
13. **Pyrogenic potential constant k** (Hilton et al. 2018) not retrieved; k = 6e-4 and the head correction are design
    choices.
14. **Double counting** of the empirical slope factor with resolved/sub-grid anabatic flow has no published separation:
    the sub-grid top-up is reduced by 1.5 m/s upslope by day and capped at 3 m/s; resolved anabatic flow in the 3-D
    tiers is not reduced. Mk2's light-wind sensitivity (item 1) magnifies any error here.
15. **Map-plane vs along-ground ROS** convention of the empirical slope data unknown (map-plane chosen).
16. **Upper air for historical dates** is unavailable from Open-Meteo (replays); synthetic profiles disable C-Haines;
    the PFT constant is UNVERIFIED and PFT is P2.
17. **AFDRS colours** and the "No rating" styling approximate; confirm against the AFDRS style guide.
18. **Belt-kit wind-height ratios** assume FBI-TG Table 3.4 (10:8 / 10:6 / 10:4.2); default exposure 'open' needs
    instructor confirmation.
19. **Doctrine wording** of every card safety line needs NSW RFS instructor review (doc 10 §11); crew/line cards are P2.
20. **Performance** numbers are extrapolated from Xeon/Node measurements; re-measure on target phones before fixing
    tier thresholds; the two-worker pipeline speed-up (1.7–1.9×) is an estimate.
21. **Wind reduction on exposed ridges** (−0.5, not for wet forest) and low-cover forest (−1) adjustments are [H].
22. **Replay fixtures' fixed UTC+10 offset** (even in AEDT months): parser uses `utc_offset_seconds`; live requests use
    UTC to avoid DST ambiguity. NPWS dates mix UTC-midnight and local-midnight stamps (handled by `localDate`, §0.2).
23. **Canopy roughness** (z₀ = 0.1H, d = 0.67H, C_D ≤ 0.03) and the drought Bowen ratio (B up to 4) are [K form, H use].
24. **Preset reference elevation** (domain median, D46) and the forced non-superadiabatic preset upper air are design
    choices; the Great Dividing Range line for the foehn note is coarse and UNVERIFIED (demo flags are authoritative).
25. **P2 backlog** (not specified in detail): cross-valley radiant preheating (doc 01 §4.7); smoke shading of
    insolation (raise the Linke turbidity under a dense plume); high-country night drying (doc 02 card 22); southerly
    buster on the coastal escarpment (Budawangs); foehn drawdown toggle; PFT.

---

## 17. Revision 2 change log (for agents who read revision 1)

- Wind for the fire now uses κ from the grid-point profile (D30), a fire mask for any fire and one-way coupling at
  c_f = 0 (D31), c_p = c_f with a head correction in the fast tier (D32), sampling at the fire cell's real elevation.
- The normal speed is a convex ellipse of R_H/R_B/R_F (D20); viscosity is one-sided (D1); the hybrid head has a
  Kataburn bound (D3); the forest 15 km/h cap applies to R_H (D4); R0 ≡ 30·FME with R_w ≥ R0 (D44); rDyn removed.
- VLS activates from the upwind intensity; U_ridge is the crest's 10 m background wind (D42); pulse amplitude 0.8.
- Factors use a generic-fuel reference and a direction factor (D45, SpreadFactors.direction).
- Atmosphere: extent-scaled grid, Dirichlet/Neumann boundaries, explicit metric, ASL-blended first guess, stability
  floor on N, canopy roughness from the fuel map (D51), Q_sw from insolation (D50), time-interpolated u_bg, no
  wall-clock fallback, night decoupling and tapered Davies zones, 1-D plume ODEs, PFT → P2.
- Moisture: `stableNight()` state (D49), daytime lapse 9.8 K/km (D43), period 1 ends 17:00 (D47), clearness-index
  radiation (D48), LUT spin-up, two-pass KBDI, archive + forecast gap-fill.
- Embers: area-based emission (D52), per-class weights, E4 n = 1, σ_ln, √ξ loft, χ_c plume flux, resolved-updraft
  subtraction, family-specific receptivity.
- Contracts: shared simulation types in `core/simTypes.ts`, grid identity, `SimOptions.tier`, standard-tier defaults,
  protocol additions, render overlay kinds, `ScenarioData.terrainHiRes/fuelHistory/activeFires`.
- Scenario: preset canonical dates, median-elevation reference and consistent upper air (D46), mild-spring DF 8,
  manual-mode rules, build order with drought before fuel, fallback table, live feeds (P1).
- Vectors corrected: heath MC1 (15, 80) 18.25, heath SI 0.85 and I 39 892, pine (KBDI 100/200), eaten-out conditions,
  night Q_h −33.04/−10.27, first-layer fraction 0.632, hybrid ψ_w 270 → 960.6, lee separation (new edges), katoomba
  now KBDI 64.6 / DF 8.47, VLS ranges.
