# 07 — Fire–atmosphere coupling and numerical methods for a phone-scale 3-D simulator

Scope: how coupled fire–atmosphere models work, and exactly how FireSim should implement the coupled loop at our resolutions:
- fire grid 10–30 m;
- atmosphere 100–200 m horizontal, 20–30 levels to about 3 km;
- a 2–6 h scenario must run in under 1–2 min in a phone Web Worker.

Companion notes:
- `01-terrain-fire-behaviour.md`: slope functions, VLS, eruptive fire;
- `02-mountain-meteorology.md`: slope and valley winds, inversions, Byram Nc, C-Haines, PFT;
- the ROS and ember notes.

This note does not repeat them. It supplies the numerics and the coupling rules that connect them. It follows the layer stack in 02 §4.1 (layers C, D, F, G) and the interfaces in `docs/ARCHITECTURE.md` (`FireSpreadModel`, `Atmosphere`).

## 0. Provenance and tags (read first)

**Research environment.**
- The session's shared web-search budget ran out after the first four searches of this task.
- WebFetch was blocked for every publisher and agency host I tried: Copernicus/GMD, AMS, arXiv, CSIRO Publishing, MDPI, BoM, OSTI, NHRA, Wikipedia.
- GitHub raw content *was* reachable. So I read the primary **implementation** of the reference coupled model, WRF-Fire in `wrf-model/WRF` (files `Registry/registry.fire`, `phys/module_fr_fire_{core,phys,atm,driver}.F`, `Registry/Registry.EM_COMMON`, `dyn_em/module_{small_step,diffusion}_em.F`), and the WindNinja diagnostic wind model (`firelab/windninja`, `src/ninja/ninja.cpp`, `cellDiurnal.cpp`).
- I also benchmarked the proposed kernels in V8 (Node 22).

| Tag | Meaning |
|---|---|
| **[V]** | Verified this session, either from a primary abstract or search extract, or by reading the open-source implementation (file named). |
| **[K]** | Standard literature knowledge that I could not re-read this session. **Check it against the cited primary source before hard-coding it.** |
| **[D]** | Derived here from first principles; the working is shown. |
| **[M]** | Measured here by micro-benchmark (method in §8). |
| **[H]** | FireSim heuristic or design choice. No published value exists. Make it tunable and label it in the UI. |

No numbers were invented. Where a value is uncertain, the text says so.

---

## 1. Executive summary: what matters most for FireSim

1. **The coupled loop is simple and well established.** Every atmospheric step:
   - the fire model takes near-surface wind;
   - it advances the front with an empirical ROS;
   - it returns sensible and latent heat fluxes, which the atmosphere inserts as a θ tendency decaying with height.

   This is the WRF-SFIRE design: "in every time step, the fire model inputs the surface wind, which drives the fire, and outputs the heat flux from the fire into the atmosphere" [V] (Mandel et al. 2011). FireSim should copy this loop, with Australian ROS models.
2. **Fire front: level set.** Use a Godunov/ENO1 upwind level set with Heun RK2 (the WRF-SFIRE 0.1 baseline [V]).
   - Stable step: `dt ≤ 1 / max[R(|n_x|/Δx + |n_y|/Δy)]` [V, WRF code].
   - Use a small artificial viscosity, "grows only", and periodic reinitialisation.
   - Take the normal speed as the **support function of the local elliptical Huygens wavelet**, `R(n) = c(n·e) + √(a²(n·e)² + b²(n·e⊥)²)` [D]. This reproduces FARSITE/Prometheus-style elliptical growth without marker tangling. Its first term is pure advection, which gives a clean upwind split.
3. **Wind height is the most common coupling bug.** Australian models (Vesta Mk2, McArthur, CSIRO grass) want the **10 m open wind**. A model wind at 10 m AGL inside a 25 m eucalypt canopy is not that.
   - Take the resolved wind at a reference height above the canopy and above the fire-contaminated layer. WRF has exactly this option (`fire_lsm_zcoupling_ref = 50 m`, log profile down) [V code].
   - Convert it to 10 m-open with a log law.
4. **Double counting.** Empirical ROS already contain the fire's own near-field indraft.
   - At 100–200 m the atmosphere resolves only the broad fire-induced convergence.
   - Feed the resolved perturbation into ROS scaled by a user "coupling factor" (default 1.0 [H]).
   - Use pyrogenic potential (Hilton et al. 2018) only for the *sub-grid* (high-pass-filtered) part of the heat release, so the two never overlap [H].
5. **Heat release** (WRF code [V]):

   ```
   sensible flux:  Q_s = (ṁ)(1 − M/(1+M)) h_c ,  h_c = 17.433 MJ/kg
   latent flux:    Q_l = ṁ [M/(1+M) + 0.56(1 − M/(1+M))] L_v
   vertical shape: e-folding depth 50 m
   ```

   Here ṁ is the fuel mass-loss rate. If each cell's heat release integrates to `H·w`, the front-integrated heat equals Byram's `I = H·w·R` [D].
6. **The plume will outgrow our 3 km box.**
   - Briggs final rise for a 1–10 GW fire in 5 m/s wind and stable air is about 0.7–1.5 km [D]. In a deep mixed layer the plume goes much higher.
   - Use a top sponge, plus a 1-D Morton–Taylor–Turner (MTT) plume column for "how high / pyroCu?" answers (links to PFT in 02).
7. **Atmosphere solver.**
   - Boussinesq "stable fluids" on a MAC grid in terrain-following coordinates: semi-Lagrangian advection of u, v, w and θ′; buoyancy; Smagorinsky (WRF form, c_s = 0.25, stability-corrected [V code]); pressure projection.
   - The projection *is* the WindNinja mass-consistent solve with equal weights, so one elliptic solver serves both [D].
8. **The pressure solver must handle the anisotropic cells** (Δx = 150 m, Δz = 20–60 m).
   - Point Jacobi/Gauss–Seidel stalls on these grids. 40 red-black sweeps reduced the residual only about 70× [M].
   - Multigrid with horizontal semi-coarsening and vertical line relaxation reduced it 2×10⁴–2.5×10⁵× in 4 V-cycles, in less time [M].
9. **Diurnal slope winds.**
   - Force the resolved model with slope-aware sensible heat flux (Holtslag–van Ulden constants, as in WindNinja [V code]).
   - Because 100–200 m cannot resolve 10–50 m-deep drainage layers, *top up* the fire wind with WindNinja's slope-flow formula. For example, 300 W/m² over 300 m relief gives about 1.8 m/s upslope [D from V code].
10. **Performance.**
    - Measured in V8 on one 2.1 GHz Xeon core, a full step at 48×48×24 took about 12 ms and a 300² level-set step about 2 ms [M].
    - A phone is plausibly 1–3× slower [H]. That gives 30–90 s for 4 h at Δt_a = 6 s on the CPU.
    - WebGPU is an optional accelerator, not a dependency.
11. **Why-explanations come from diagnostics this solver already has:**
    - fire-induced wind share;
    - Byram Nc;
    - near-surface convergence;
    - plume tilt;
    - Q_h sign and slope;
    - inversion depth and breakdown;
    - front-to-front distance.

---

## 2. How coupled fire–atmosphere models work

### 2.1 The loop and the scale problem

Physically, the scales span about 4 orders of magnitude:
- flames and radiative preheating: 1–50 m;
- plume and indraft: 100 m–10 km;
- terrain-forced flow: 100 m–10 km;
- synoptic changes: more than 100 km.

No model resolves all of them. Coupled models therefore:
1. solve the atmosphere at Δ_a and the fire on a refined mesh Δ_f = Δ_a/r;
2. use an *empirical* spread law at the fire scale;
3. exchange two fields every step:
   - wind: atmosphere → fire, at a chosen height;
   - heat and moisture fluxes: fire → atmosphere, spread over a chosen depth.

WRF's own idealised hill test gives a concrete instance [V, `test/em_fire/namelist.input_hill_simple`]:
- Δx = 50 m, 51 levels to 4 km, Δt = 0.5 s;
- `sr_x = sr_y = 4`, a 12.5 m fire mesh;
- a stable sounding, with θ rising by 0.7 K per 100 m.

### 2.2 Model landscape

| Model | Atmosphere | Fire front | Coupling details | Typical use and cost | What FireSim takes |
|---|---|---|---|---|---|
| **WRF-SFIRE / WRF-Fire** (Mandel, Coen, Kochanski, Muñoz-Esparza) | WRF compressible non-hydrostatic, LES-capable | Level set on a refined mesh. Upwinding default `fire_upwinding=9` (WENO5 near the front, ENO1 elsewhere). WRF 4.x calls `prop_ls_rk3` + `reinit_ls_rk3`; SFIRE 0.1 uses RK2 Heun + ENO1 [V code/README] | Wind log-interpolated to `fire_wind_height = 6.096 m` (20 ft, for Rothermel midflame via a wind-reduction factor) [V]. Heat e-folding `fire_ext_grnd = 50 m`; crown heat below `fire_crwn_hgt = 15 m` [V] | "faster than real time on a cluster… at dekameter resolution" [V abstract] | The whole loop, the CFL rule, the heat-flux formulas, the reinit and viscosity defaults |
| **CAWFE** (Clark, Coen) | Clark terrain-following anelastic model | Tracer-based front, Rothermel | Established convective feedback: fire-line fingering, bulging head [K] (Clark et al. 1996, 2004) | Research | Convective Froude number idea (§6.3) |
| **ACCESS-Fire** (BoM / Kepert, Peace, Toivanen) | UK Met Office Unified Model (ACCESS), nested | Level-set spread [K] | Used for Waroona WA (evening ember storms linked to "above-surface wind fields, local topography and the fire plume") and for NSW's **Sir Ivan** fire [V]. Also Black Summer case studies [V] | Research / hindcast, supercomputer | NSW validation cases; the message that above-surface winds matter |
| **MesoNH–ForeFire** (Univ. Corse / CNRS) | MesoNH LES | Lagrangian front markers (ForeFire, C++) | Two-way coupling with MesoNH [V README] | Research / forecast | — |
| **FIRETEC / HIGRAD** (LANL) | Multiphase physics-based CFD, metre-scale | Resolved combustion, no ROS law | Fully physical [K] | Supercomputer, hours per minute [K] | Qualitative benchmarks |
| **QUIC-Fire** (Linn et al. 2020) | QUIC-URB rapid 3-D diagnostic wind solver | "Physics-based cellular automata fire spread model Fire-CA" with FIRETEC-like 3-D fuels | Coupled feedback. Results "show strong agreement" with FIRETEC [V abstract] | Laptop-scale prescribed-burn planning | Evidence that **diagnostic wind + cheap fire + plume feedback** is credible |
| **Spark** (CSIRO Data61) | None natively; add-ons | Level set, "speed … defined at every point… merging … without additional computational cost" [V] | Pyrogenic potential for convective feedback (Hilton et al. 2018); rapid wind–terrain correction (Hilton & Garg 2021) [K] | Operational-style, seconds | Pyrogenic potential for sub-grid indraft |
| **Phoenix RapidFire** (Tolhurst) | None; uses input weather | Huygens-type propagation on a raster [K] | Empirical ember and convection terms [K] | Operational in Victoria [K] | — |
| **FARSITE / Prometheus** | None | Vector front, Huygens elliptical wavelets (Richards 1990 ODEs) [K] | None | Operational, seconds | Ellipse → level-set speed (§3.2) |
| **Cellular automata** | None | Cell-to-cell ignition times | None | Very fast | Avoid: grid-orientation distortion (§3.7) |
| **WindNinja** (USFS) | Diagnostic mass-conserving FE wind, plus an optional OpenFOAM momentum solver | — | Diurnal slope-flow add-on [V code] | Seconds–minutes on a laptop | Mass-consistent background (§7.10) and slope-flow top-up (§7.9) |

### 2.3 What FireSim takes and why

- The WRF-SFIRE **loop and numerics**, which are mature and open.
- QUIC-Fire's lesson: a **diagnostic terrain wind** plus a cheap dynamic perturbation is good enough for planning-grade behaviour.
- Spark's **pyrogenic potential** for fire-scale indraft that our atmosphere grid cannot resolve.
- The **ACCESS-Fire NSW cases** (Sir Ivan, Black Summer fires) as qualitative replays.

---

## 3. Fire-front propagation numerics (level set)

### 3.1 Formulation

- φ(x, y, t) is a signed-distance-like function: φ < 0 is burnt or burning, φ = 0 is the front.
- n = ∇φ/|∇φ| is the outward normal.

```
∂φ/∂t + R(x, n, t) |∇φ| = 0                       (Osher & Sethian 1988)   [K]
arrival time t_a(x): the time when φ(x) first becomes ≤ 0
```

The fire can only grow: WRF enforces `φ^{n+1} ≤ φ^n` (`fire_grows_only = 1`) [V code]. A new spot fire or a user-marked "fire has jumped ahead" is a union: `φ ← min(φ, |x − x_s| − r_s)` [D].

### 3.2 Normal speed from an elliptical wavelet (the key coupling to empirical models)

Australian models give a head ROS `R_h` (m/s) and a length-to-breadth ratio LB. See the ROS note; Vesta/McArthur use the 10 m open wind.

Assume the Huygens wavelet is an ellipse with the ignition at its rear focus (the FARSITE/Prometheus convention [K]):

```
ε = √(1 − 1/LB²) ,  R_b = R_h (1 − ε)/(1 + ε)                     [K, Alexander 1985 / Anderson et al. 1982]
a = (R_h + R_b)/2  (semi-major speed) ;  c = (R_h − R_b)/2  (centre drift) ;  b = a / LB  (flank speed)
R(n) = c (n·e) + √( a² (n·e)² + b² (n·e⊥)² )                                                      [D]
```

- e is the unit vector of the 10 m wind (U_fire, §4.2). Slope enters only through the directional factor below. **Do not also fold slope into e**, or slope is counted twice.
- R(n) is the **support function** of the offset ellipse. A level set moving with normal speed equal to the wavelet's support function traces exactly the Huygens envelope [D; the same geometry underlies Richards 1990].
- Checks:
  - n = e gives R_h;
  - n = −e gives R_b;
  - n ⊥ e gives b.
- Worked example, LB = 3: ε = 0.943, R_b = 0.029 R_h, flank b = 0.17 R_h [D].
- Slope: multiply by the *directional* slope factor along n, with θ_n = atan(∇z·n) (01 §4.2). WRF likewise uses `tanφ = ∇z·n` [V code].

**Split for robust upwinding** [D]:

```
c (n·e)|∇φ| = c e·∇φ
```

- This term is linear advection with velocity c·e. Discretise it with first-order (or WENO) upwinding.
- The remaining symmetric ellipse term uses the Godunov form below.
- This mirrors WRF's `fire_upwind_split = 1`, which advects the wind part separately from the normal backing spread [V code].

### 3.3 Discretisation

One-sided differences: `D⁻ₓφ = (φ_i − φ_{i−1})/Δx`, `D⁺ₓφ = (φ_{i+1} − φ_i)/Δx`.

For outward motion (R ≥ 0), the upwind gradient magnitude, identical to WRF option 4 "Sethian" [V code], is:

```
|∇φ|² ≈ max(D⁻ₓφ,0)² + min(D⁺ₓφ,0)² + max(D⁻ᵧφ,0)² + min(D⁺ᵧφ,0)²
```

Heun RK2 (SFIRE 0.1 [V README]):

```
φ* = φⁿ − Δt·R|∇φⁿ| ;   φⁿ⁺¹ = ½[φⁿ + φ* − Δt·R|∇φ*|]
```

Artificial viscosity (WRF, `fire_viscosity = 0.4` [V]) adds

```
ν·|R|·[(D⁺ₓφ − D⁻ₓφ) + (D⁺ᵧφ − D⁻ᵧφ)]      ≡ ν R Δx ∇²φ
```

- It damps kinks where fronts merge.
- WRF can taper it near the front: `fire_viscosity_bg` within `fire_viscosity_ngp = 2` cells, ramping to `fire_viscosity` outside. Both default to 0.4, so it is uniform by default [V code].
- WENO3/5 in a band of `fire_lsm_band_ngp = 4` cells (WRF 4.x default, Muñoz-Esparza et al. 2018) sharpens fronts but costs about 3×. ENO1 is adequate at 10–30 m for education.

### 3.4 Time step

WRF computes the bound directly [V, `tend_ls` in `module_fr_fire_core.F`]:

```
Δt_f ≤ 1 / max_cells[ R·(|φ_x|/Δx + |φ_y|/Δy)/|∇φ| ]   ⇒   worst case Δt_f ≥ Δx/(√2·R_max)
```

Use a safety factor of 0.7, giving `Δt_f ≈ 0.5·Δx/R_max` (consistent with ARCHITECTURE.md).

| Δx | R_max | Δt_f |
|---|---|---|
| 20 m | 1 m/s (fast forest run) | 10 s |
| 20 m | 3 m/s (grass run) | 3.3 s |

WRF caps ROS at `ros_max = 6 m/s` [V code]. A cap is sensible for us too.

### 3.5 Reinitialisation, narrow band, arrival time

- Keep φ close to a distance function, otherwise gradients steepen or flatten and the CFL bound drifts.
- WRF runs one iteration per step of the Sussman–Smereka–Osher (1994) PDE with RK3 and hybrid WENO5/ENO1 [V code]:

  ```
  ∂φ/∂τ + S(φ₀)(|∇φ| − 1) = 0 ,   S(φ₀) = φ₀ / √(φ₀² + Δx²)                              [V code, K]
  ```

- Cheaper for us: every 10–20 fire steps, recompute a signed distance within a band of ±6 cells by fast sweeping (Zhao 2005) [K]. Only update cells in that band (Adalsteinsson & Sethian 1995 [K]).
- Keep the arrival time `t_a` per node, interpolated linearly where φ crosses zero within a step (WRF `tign_g`) [V code]. This gives isochrones and burn-out timing for free.

### 3.6 Burn-out and heat release on the fire grid

WRF's fuel remaining after ignition is [V code, `module_fr_fire_phys.F`]:

```
F(t) = exp(−(t − t_a)/T_f) ,   T_f = weight / 0.85  (s)
```

- `weight` = 7 for grass (T_f ≈ 8 s), 100–180 for shrubs, 900 for timber litter (T_f ≈ 1,060 s).
- The code comment reads "weight=1000 ⇒ 40% decrease over 10 min" [V].
- The burnt fraction of a cell straddling the front is computed on a 2×2 sub-mesh (`fire_fuel_left_irl = 2`) [V].

For FireSim, use two phases [H]:
- **flaming**: fine fuel, τ_f ≈ 30–60 s, carrying most of the convective heat (value uncertain, tunable);
- **smouldering**: coarse fuel and bark, τ_s ≈ 10–30 min, releasing little heat but important for ember and re-ignition visuals.

Energy consistency [D]:
- A fuel load `w` (kg/m²) burnt at heat yield `H` releases `H·w` J/m².
- If the front moves at R and the local flux is `q(x) = (H·w/τ)·exp(−x/(Rτ))` behind the front, then `∫q dx = H·w·R = I`. That is Byram's fireline intensity.
- **Always normalise the release law to H·w per cell** so the coupling is independent of τ.

### 3.7 Why not markers or cellular automata

- Vector Huygens fronts (FARSITE, Prometheus) need de-looping and re-meshing when fronts cross, merge or split [K]. That is common on broken mountain terrain with spot fires.
- Raster CA on 4/8-neighbour stencils produce square or octagonal fire shapes unless they use large stencils or irregular grids [K] (Johnston et al. 2008; Ghisu et al. 2015).
- The level set handles merging, holes and new ignitions "without additional computational cost" [V] (Spark; Miller et al. 2015), at about 2 ms per step on a full 300² grid [M].

---

## 4. Coupling the atmosphere's wind to the empirical ROS

### 4.1 Which wind, which height

- **Rothermel** wants midflame wind. WRF therefore uses the 6.1 m (20 ft) wind and a fuel-specific reduction factor [V]. Even WRF's own hill test sets `fire_wind_height = 1 m` [V], which shows the choice is case-specific.
- **Australian models** (McArthur Mk5, Vesta Mk2 / DEFFM, CSIRO grassland) are fitted to the **10 m open wind** [K]; see the ROS note. So FireSim must give the ROS a *10 m open-equivalent* wind, not the physical in-canopy wind.

Recommended recipe [H, modelled on WRF's `fire_lsm_zcoupling` / `fire_lsm_zcoupling_ref = 50 m` [V]]:

```
z_ref = max(50 m, h_canopy + 20 m, z_1 + ½Δz_1)          (above canopy and the most fire-contaminated air)
U10_open = U(z_ref) · ln(10/z0_open) / ln(z_ref/z0_open) ,   z0_open ≈ 0.03 m  [K]
```

- U(z_ref) is the resolved horizontal wind vector at z_ref AGL, interpolated in the terrain-following column.
- Keep the direction of U(z_ref), optionally veered by a surface-layer rule [H].
- WRF itself does the vertical step by log interpolation between the roughness height and model levels (`interpolate_atm2fire`) [V code].
- For the *physical* near-surface wind used by embers and visuals, use the canopy log law `U(z) = (u*/κ) ln((z − d)/z₀)` with κ = 0.4 [V, WRF constant].
- WindNinja's vegetation defaults [V code]:

  | Vegetation | z₀ | d | h |
  |---|---|---|---|
  | Grass | 0.01 m | 0 | 0 |
  | Brush | 0.43 m | 1.8 m | 2.3 m |
  | Trees | 1.0 m | 12 m | 15.4 m |

### 4.2 Double counting of fire-induced wind

**Problem.** Empirical ROS relationships were fitted to experimental fires under ambient winds measured away from the fire. The fire's own near-field indraft at *that* scale is implicitly inside the fit [K; this is the standard argument in the coupled-modelling literature, e.g. the discussions in Clark et al. 2004, Coen et al. 2013 and Hilton et al. 2018].

Adding a resolved fire-induced wind can therefore count the effect twice. The size of the error depends on resolution:
- a finer atmosphere resolves a stronger indraft, so ROS changes with Δ_a;
- a fire-scale resolution study showing ROS drift is the symptom.

**What is not double-counted.** The empirical fits do not include:
- the *non-local* effects of a large fire: convergence from the whole plume, and attraction between separate fires or fronts;
- terrain–plume interactions;
- fire-modified winds (Waroona, Sir Ivan [V]).

These are what coupling should add.

**Recommendation** [H]:

```
U_fire = U10_open,bg                                  (ambient + terrain + diurnal, no fire)
       + c_f · (U10_open,dyn − U10_open,bg)           (resolved perturbation incl. fire-induced; c_f = coupling factor)
       + c_p · ∇ψ_sub                                  (sub-grid pyrogenic indraft, only from high-pass heat)
       + S_slope,top-up                               (sub-grid slope flow, §7.9)
```

Defaults and switches:
- c_f = 1.0 at Δ_a ≥ 100 m. There the resolved perturbation is mostly broad convergence and plume–terrain interaction.
- UI slider 0–1.5 for teaching: 0 means "no fire-made wind", i.e. an uncoupled prediction.
- c_p = 0 in the coupled 3-D mode by default. It is on in the "fast" mode, where there is no 3-D solver.
- ψ_sub solves `∇²ψ = −k·I_sub(x)`, with `I_sub = I − G_{Δa} * I` (heat minus its Gaussian-filtered version at the atmosphere scale). This separates scales so the parameterised and resolved indraft never overlap.
- Sign convention: ψ has a maximum over the fire, so ∇ψ points inward. Take the form and the calibrated k from Hilton et al. (2018); they were not retrieved here [K].

### 4.3 Interpolation between grids

- Atmosphere → fire: bilinear in the horizontal, in computational (terrain-following) coordinates, at constant height AGL. This is trivial because every column has the same levels (§7.5).
- Fire → atmosphere: sum the energy released in all fire cells inside an atmosphere column's footprint over the atmospheric step. Divide by column area × Δt_a to get W/m². This is energy-conserving [D].

---

## 5. From heat release to the atmosphere

### 5.1 Energy partition (WRF formulas, verbatim logic) [V, `heat_fluxes` in `module_fr_fire_phys.F`]

```
dmass  = fgi · Δ(fuel fraction burnt)                 [kg m⁻²]   fgi: fuel load
bmst   = M/(1+M)                                      M: fuel moisture content (fraction, dry basis)
Q_s    = (dmass/Δt)·(1 − bmst)·h_c                    [W m⁻²]   h_c = 17.433×10⁶ J kg⁻¹ ("cmbcnst")
Q_l    = (bmst + (1 − bmst)·0.56)·(dmass/Δt)·L_v      [W m⁻²]   L_v = 2.5×10⁶ J kg⁻¹; "56% of cellulose mass is water"
```

- WRF scales both fluxes by `fire_atm_feedback` (default 1) [V].
- It puts **all** of the combustion heat into the air as sensible heat, with no radiative loss.
- Laboratory radiative fractions of roughly 10–20% of the total energy are reported (e.g. Freeborn et al. 2008) [K].
- FireSim: expose a convective fraction χ_c, default 0.85 [H], and use `H ≈ 18.6 MJ/kg` if matching Australian intensity conventions [K; verify against the ROS note].
- Latent heat matters only for plume condensation. The dry Boussinesq model ignores it. Optionally carry the vapour flux as a passive tracer for the pyroCu diagnostic (§6.5).

### 5.2 Vertical distribution [V, `fire_tendency` in `module_fr_fire_atm.F`]

```
F(z) = Q_s,ground · exp(−z/α_g) + Q_s,crown · { 1 for z < z_c ; exp(−(z − z_c)/α_c) above }
∂θ/∂t|_fire = −(1/(ρ c_p)) · ∂F/∂z        (discretely: −(F_{k+1} − F_k)/(ρ c_p Δz_k))
α_g = fire_ext_grnd = 50 m ,  α_c = fire_ext_crwn = 50 m ,  z_c = fire_crwn_hgt = 15 m     [V defaults]
```

- The exponential deposits exactly Q_s in the column.
- WRF also offers a truncated-Gaussian injection (`fire_sfc_flx = 1`, peak height `fire_heat_peak`, upper bound 1,000 m) [V]. That is useful when the grid is too coarse for the resolved plume to carry heat upward.
- Fraction deposited in the first layer: `1 − e^{−Δz₁/α_g}`. That is 33% for Δz₁ = 20 m and 70% for Δz₁ = 60 m [D].
- FireSim [H]:
  - keep α_g = 50 m when Δz₁ ≤ 30 m;
  - with coarser first layers, use α_g = max(50 m, Δz₁) so that more than 60% does not land in one cell.

### 5.3 Magnitudes, and why elevation matters

**Flaming-zone flux** [D].
- Example fire: I = 10 MW/m, flame depth D = R·τ_f = 0.5 m/s × 40 s = 20 m.
- Flaming-zone flux = I/D = 500 kW/m².
- If it covers 20% of a 150 m cell, the column-average Q is about 100 kW/m².

**Temperature increment** [D].
- With Δz₁ = 20 m, ρ = 1.1 kg/m³ and 33% of the flux in layer 1, the first layer warms at 33,000/(1.1·1005·20) ≈ 1.5 K/s. The resolved updraft then carries the heat away.
- Cap θ′ at about +60 K for numerical safety [H]. The Boussinesq assumption (θ′/θ₀ ≲ 0.1) holds for cell-averaged perturbations, not for flames.

**Convective velocity scale** [D]:

```
w* = (g Q h/(ρ c_p T))^{1/3}
```

For Q = 100 kW/m², h = 50 m, ρ = 1.1 kg/m³ and T = 293 K, this gives about 5 m/s.

**Elevation effect** [D, standard atmosphere].
- ρ ≈ 1.11 kg/m³ at 1,000 m (Blue Mountains plateau) and 1.01 kg/m³ at 2,000 m (Kosciuszko), against 1.23 at sea level.
- The same fire produces about 10–20% larger buoyancy per unit heat, and a correspondingly larger Byram Nc.
- Always use the local ρ(z) in `1/(ρ c_p)`.

**Resolution effect** [K/D].
- At 100–200 m the resolved plume is wider and slower than reality. Near-source updrafts and indraft are underestimated.
- The buoyancy *flux* is conserved, so the plume *rise* in a stratified environment (which scales with F^{1/4}–F^{1/3}, §6.2) is much less resolution-sensitive. That is a useful validation target.

---

## 6. Plumes and fire-induced winds

### 6.1 Entrainment plume theory (Morton, Taylor & Turner 1956) [K]

Top-hat plume, with radius b, vertical velocity w and reduced gravity g′ = g(θ_p − θ_e)/θ_e. Fluxes per π:

```
Q = b²w  (volume) ,  M = b²w²  (momentum) ,  F = b²w g′  (buoyancy)
dQ/dz = 2 α M^{1/2}          α ≈ 0.09–0.12 (top-hat; Gaussian-profile α ≈ 0.08)          [K]
dM/dz = F Q / M
dF/dz = −N² Q                N² = (g/θ_e) dθ_e/dz
```

Point source in a neutral environment: b = (6/5)αz and w ∝ F₀^{1/3} z^{−1/3} [K].

For a line source (a long fire front), w is roughly constant with height and b grows linearly [K]. In crosswind, bent-over plumes entrain faster (β ≈ 0.5–0.6 on the cross-flow velocity; Briggs 1975 [K]). This is the physics of plume "lean".

**Indraft from entrainment** [D]: mass continuity requires horizontal inflow at the plume edge of about `u_e ≈ α·w`. With w = 10–20 m/s, that is 1–2 m/s averaged over the plume boundary. It is larger near the ground, where the inflow converges into the flaming zone. Field and model studies report fire-induced near-surface perturbations of a few m/s [K].

### 6.2 Briggs plume-rise formulas (sanity checks) [K]

```
F = g Q_H / (π ρ c_p T)                 [m⁴ s⁻³]  ≈ 8.8×10⁻⁶ · Q_H[W]  (ρ=1.2, T=293 K)      [D]
neutral, transitional:  Δh(x) = 1.6 F^{1/3} x^{2/3} / u
stable, windy (final):  Δh = 2.6 (F/(u s))^{1/3} ,   s = (g/θ) dθ/dz
stable, calm (final):   Δh = 5.0 F^{1/4} s^{−3/8}                (same scaling as MTT z_max ∝ F^{1/4} N^{−3/4})
```

Worked examples [D], all in a stable layer with s = 10⁻⁴ s⁻² (N = 0.01 s⁻¹):

| Fire power Q_H | F (m⁴ s⁻³) | Wind | Δh |
|---|---|---|---|
| 1 GW (1 km front at 1 MW/m) | 8.8×10³ | calm | 1.5 km |
| 1 GW | 8.8×10³ | 5 m/s | 0.68 km |
| 10 GW | 8.8×10⁴ | 5 m/s | 1.46 km |

Caveats:
- Briggs is calibrated on industrial stacks.
- For large fires in a deep daytime mixed layer (θ nearly constant), the plume reaches the capping inversion and beyond, and moisture adds buoyancy.
- Use Briggs only to check our resolved plume (factor-of-2 agreement is a pass [H]), not to predict pyroCb.

### 6.3 Regime numbers

**Byram convective number** (form and thresholds verified in 02 §2.6 [V]):

```
N_c = 2 g I / (ρ c_p T_a (U − R)³)
N_c > 10: plume-dominated
N_c < 2: wind-driven
```

- Which U to use (midflame, 6.1 m or 10 m) varies between papers [K]. FireSim uses U10_open and states this.

**Convective Froude number** (Clark et al. 1996) [K; verify the exact definition]:

```
F_c² = U² / (g (Δθ/θ) W)
```

- W is the fire width.
- F_c ≲ 1 means strong dynamic feedback: fingering, erratic spread.

In FireSim both come from fields the solver already has. Use N_c for insight cards because firefighters' training material uses it.

### 6.4 Indraft on the fire grid: pyrogenic potential

In the no-3-D "fast" mode, or for the sub-grid part in coupled mode (§4.2), the near-surface fire-induced flow is irrotational convergence toward heat sources:

```
∇²ψ = −k·I(x) ,   u_p = ∇ψ
```

- Hilton et al. (2018) showed that this reproduces parabolic heads, attraction between fires and fast closure of junction ("V") fires, at a tiny fraction of CFD cost [V via 01/02 extracts].
- Solve it with the same 2-D multigrid on the fire grid (or coarsened ×2–4), every 30–60 s of simulated time.

### 6.5 Above the lid: 1-D plume column

Our 3 km lid (§7.7) truncates strong plumes. In each snapshot, integrate §6.1 (with bent-over entrainment) through the full forecast sounding (pressure levels up to 300–200 hPa). Starting conditions:
- F₀ = χ_c·ΣQ_H·g/(πρc_pT);
- r₀ = √(A_burning/π).

Outputs:
- plume-top height;
- lifting condensation level (LCL) of the mixed plume air, which gives pyroCu likelihood;
- a PFT comparison (02 §2.6).

This is a *diagnostic*, drawn as a translucent column above the 3-D box. It is labelled as indicative [H].

---

## 7. The atmospheric solver

### 7.1 Equations (dry Boussinesq, perturbation form)

```
∂u/∂t + (u·∇)u = −∇p′/ρ₀ + b k̂ + ∇·(K_m ∇u) − (u − u_bg)/τ_n − γ(z)(u − u_bg) + F_drag
∇·u = 0
∂θ′/∂t + (u·∇)θ′ = −w dθ_env/dz + ∇·(K_h ∇θ′) + S_surface + S_fire
b = g θ′/θ₀ ,  θ′ = θ − θ_env(z_ASL)
```

Notes:
- **Advect θ′, not θ**, and add `−w dθ_env/dz` explicitly [K/D]. Semi-Lagrangian interpolation of the full θ would numerically diffuse the background stratification and create spurious heating in valleys.
- **Build θ_env from altitude ASL**, not AGL. Ridges and valley floors sit at different altitudes in the same air mass [H].
- **Coriolis is negligible** for the perturbation [D]. f = 2Ω sin(−33.7°) ≈ −8.1×10⁻⁵ s⁻¹, so Rossby number U/(fL) ≈ 5/(8×10⁻⁵ × 3,000) ≈ 20. The balanced background comes from the forecast and nudging.

### 7.2 One "stable fluids" step (Stam 1999; Fedkiw et al. 2001) [K]

1. **Advect** u, v, w, θ′ and smoke semi-Lagrangianly:
   - back-trace x_d = x − Δt·u (midpoint RK2 for the trace);
   - interpolate trilinearly in computational space.
   - This is unconditionally stable, but first-order dissipative.
   - Optional MacCormack/BFECC (Selle et al. 2008) with a min/max limiter for θ′ and w: about 2–3× the advection cost, much sharper plumes [K].
2. **Sources and forces**:
   - fire and surface heating (§5.2, §7.9);
   - buoyancy on w;
   - surface drag, implicit: u₁ ← u₁/(1 + Δt C_D|u₁|/Δz₁), with C_D = [κ/ln((z₁ − d)/z₀)]² [K];
   - nudging, implicit;
   - sponge, implicit: `u ← (u + Δtγ u_bg)/(1 + Δtγ)`.
3. **Diffuse** (§7.3): explicit horizontally, implicit (tridiagonal) vertically.
4. **Project** (§7.4): solve for p′, subtract its gradient, and apply boundary conditions.
5. **Vorticity confinement** (Fedkiw et al. 2001) [K]:

   ```
   f = ε h (N × ω) ,   N = ∇|ω|/|∇|ω||
   ```

   - It re-injects small-scale rotation lost to numerical diffusion.
   - Graphics codes use large ε (the WebGL demo uses `CURL: 30` with 20 pressure iterations at 128² [V, PavelDoGreat script.js]).
   - FireSim: default ε = 0. Allow ε ≤ 0.1 for visuals only, and never let confinement-generated wind feed the ROS [H]. It adds energy that has no physical source.

**Grid: use a staggered MAC grid** (u, v, w on faces, p and θ′ at centres; Harlow & Welch 1965) [K].
- A collocated grid with central differences has checkerboard pressure null-modes.
- My benchmark used collocated arrays only for timing.

### 7.3 Sub-grid turbulence

Use WRF's Smagorinsky form with stability correction [V, `module_diffusion_em.F`]:

```
K_m = (c_s ℓ)² · √max(0, D² − N²/Pr) ,   K_h = K_m/Pr
c_s = 0.25 (WRF default "Smagorinsky coeff") ,  Pr = 1/3 in WRF's code (so K_h = 3K_m)
anisotropic grids: ℓ_h = √(ΔxΔy) for horizontal, ℓ_v = Δz for vertical (WRF mix_isotropic=0)
limiter: K ≤ 0.1 ℓ²/Δt   (WRF mix_upper_bound = 0.1)                                   [V]
```

- D² is the squared deformation.
- The N² term shuts mixing off in stable layers. That is what keeps cold pools and inversions alive overnight.
- The limiter also guarantees explicit-diffusion stability. It only needs `K Δt/ℓ² ≤ 1/6` in 3-D [K].
- Worked example [D]: ℓ_h = 150 m, deformation 0.02 s⁻¹ gives K_m ≈ 28 m²/s. The limiter allows up to 225 m²/s at Δt = 10 s.
- A constant eddy viscosity (5–30 m²/s) is an acceptable fallback, but loses the stable-layer shut-off [H].
- The canopy is not resolved. Add form drag in canopy layers, `−C_d a|u|u` with leaf-area density a, only if a canopy layer exists in the grid [K].

### 7.4 Pressure solver (the dominant design decision)

Solve:

```
∇·(𝐌∇p′) = (ρ₀/Δt) ∇·u*
```

- 𝐌 is the metric tensor of the terrain-following transform (§7.5); 𝐌 = I on a flat Cartesian grid.
- Use Neumann boundary conditions at the ground and top, and at lateral walls. Open outflow faces instead get p′ = 0.

**Anisotropy kills point smoothers.** With Δx = 150 m and Δz = 20–60 m, the vertical coupling is 6–56× stronger than the horizontal. Measured on 48×48×24 with a random right-hand side [M]:

| Method | Uniform Δz = 60 m | Stretched Δz₁ = 20 m, ratio 1.13 |
|---|---|---|
| Point red-black Gauss–Seidel, 40 sweeps | residual × 1.2×10⁻² | × 1.5×10⁻² |
| z-line (tridiagonal) GS, 40 sweeps | × 1.0×10⁻³ | × 6.3×10⁻³ |
| Multigrid V(2,2), z-line smoother + horizontal-only coarsening, 4 levels, 4 cycles | **× 3.9×10⁻⁶** in 40% of the time | **× 4.9×10⁻⁵** in 45% of the time |

Timings were unoptimised Float64 code, so compare them relatively.

Recommendations:
- **Multigrid** (Trottenberg et al. 2001) [K]:
  - horizontal semi-coarsening, vertical-line relaxation, zebra ordering;
  - 1–2 V-cycles per step, warm-started from the previous p′;
  - stop at a relative residual of 10⁻³.
- **Metric cross terms**: keep them in the residual and drop them from the smoother (defect correction). If convergence stalls on steep terrain, wrap the V-cycle as a preconditioner in CG (symmetric part) or BiCGSTAB [K].
- **Jacobi** is acceptable only on WebGPU, where 50–100 cheap iterations per step are parallel. Even there, prefer multigrid.

### 7.5 Terrain representation

**Option A: terrain-following (Gal-Chen & Somerville 1975)**, recommended [K/D]:

```
ζ = H (z − z_s)/(H − z_s) ,   G = (H − z_s)/H  (Jacobian)
∂ζ/∂x = ((ζ − H)/(H − z_s)) ∂z_s/∂x
ω = [H w + (ζ − H)(u ∂z_s/∂x + v ∂z_s/∂y)] / (H − z_s)            (contravariant vertical velocity)
continuity: ∂(G u)/∂x|_ζ + ∂(G v)/∂y|_ζ + ∂(G ω)/∂ζ = 0
surface: ω = 0 ⇔ w = u·∇z_s (no penetration);  top: w = 0
```

Pros:
- every column has the same levels, so the first level is 10–20 m AGL *everywhere*: ridge, gully and valley floor;
- the fire-wind height, surface heat flux and drainage flows all sit at the right height;
- ember sampling is simple.

Cons:
- a 19-point-type elliptic operator;
- growing metric error with slope.

Removing the hydrostatic reference state analytically (the Boussinesq θ′ form above) avoids the classic sigma pressure-gradient error that comes from differencing two large hydrostatic terms [K].

**Option B: Cartesian with masked (stair-step) solid cells.** This is the graphics approach (Crane et al. 2007).
- Pros: simplest, and a 7-point Poisson operator.
- Cons: with Δz = 50 m and Δx = 150 m, slopes are quantised to steps. The first fluid cell sits 0–Δz above the ground, so near-surface wind is inconsistent. Steps create spurious separation.
- Shaved or cut cells (Adcroft et al. 1997) and immersed boundaries (Lundquist et al. 2010) fix this, but at high implementation cost [K].

**FireSim** uses Option A on terrain smoothed to a maximum slope of 35° at the atmosphere resolution [H]:
- iterate a 3×3 Gaussian filter until the slope limit holds;
- the 150 m-averaged Blue Mountains cliffs otherwise remain 45–60°;
- the **full-resolution** DEM stays on the fire grid for ROS slope effects;
- keep H ≥ z_s,max + 2 km.

Consequence: separation off cliff lines is weaker and delayed in the resolved flow. The lee-separation parameterisation in 01 §4.4 and 02 §4.2 covers it.

### 7.6 Vertical grid [D]

- Stretch geometrically: Δz_k = Δz₁·r^k.
- With Δz₁ = 20 m and r = 1.13, 24 levels give about 2.7 km and 25 levels about 3.1 km (my test used 2.74 km).
- The first level at 10 m AGL (cell centre) is ideal for the 10 m wind diagnostic. The z_ref in §4.1 is 50 m, around level 3.
- For the fast CPU preset use Δz₁ = 30 m, r = 1.15 and 18–20 levels [H].

### 7.7 Boundary conditions

**Inflow and outflow (lateral).** Use Davies (1976) relaxation zones 4–6 cells wide [K]:

```
∂ψ/∂t = … − λ(d)·(ψ − ψ_bg) ,   λ(d) = λ₀·e^{−d/2} ,  λ₀ = 1/(5Δt) ,  d = cells from the edge          [H]
```

- The zones cover u, v, w and θ′ on all four sides.
- That handles inflow and outflow without deciding faces. Wind changes enter naturally as ψ_bg changes.

**Background profile u_bg(z)** [H]:
- Below the lowest forecast level: log law with z₀ from land cover.
- From forecast height winds: 10, 80, 120 and 180 m where the model provides them (Open-Meteo exposes these for some models) [K; availability per model must be checked at runtime].
- Above: pressure-level winds placed at their geopotential heights (1000–500 hPa).
- Interpolate the *vector* components linearly in ln z. The near-surface part follows AGL. Above about 500 m AGL, blend to ASL-based free-atmosphere values.
- Then run the mass-consistent adjustment (§7.10).

**Top.** Rigid lid (w = 0) plus a Rayleigh sponge in the top 25–35%, implicit. WRF damp_opt = 3 [V, `module_small_step_em.F`]:

```
w ← (w − Δt γ(z) w_ref) / (1 + Δt γ(z)) ,   γ(z) = γ_max sin²( (π/2)(z − z_b)/z_d )
γ_max = dampcoef = 0.2 s⁻¹ (WRF default) ,  z_d = zdamp (5,000 m default in WRF)
```

- Klemp et al. (2008) derived this w-damping for NWP [K].
- FireSim: z_d = 800–1,000 m, γ_max = 0.2 s⁻¹ on w [V default value, H depth], and a weaker 0.01 s⁻¹ relaxation of u, v and θ′ toward the background [H].

**Bottom.**
- No penetration (ω = 0).
- Log-law drag (§7.2).
- Heat fluxes: diurnal (§7.9) plus fire (§5.2).

### 7.8 Ambient stratification

```
θ = T (p₀/p)^{R_d/c_p} ,  R_d/c_p = 0.2857 (WRF rcp) ,  p₀ = 1000 hPa                 [V constants, K formula]
N² = (g/θ) dθ/dz
Fr = U/(N h)
```

- Build the pressure-level T with geopotential heights, the 2 m T and, where given, 80–180 m temperatures.
- Blocking and channelling for Fr < 1 emerge in the resolved model if N² is right. Interpretation is in 02 §4.2.
- **Valley inversions are usually missing from coarse NWP.** Let the user, or a preset such as "clear calm night", add a valley cold pool: Δθ = 3–8 K over 100–300 m above the valley floor at dawn [H; physics in 02 §2.4]. Initialise θ′ with it.
- The model then erodes the inversion as surface heating ramps up. That produces the "fire wakes up" moment dynamically, and the explanation engine can detect it (§10).

### 7.9 Surface heating and diurnal slope/valley winds

**Surface sensible heat flux per atmospheric column** [V constants, `cellDiurnal.cpp`; K for Holtslag & van Ulden 1983]. WindNinja's formulation:

```
Q_sw = (a₁ sin ψ + a₂)(1 + b₁ N_c^{b₂})        a₁=990, a₂=−30 W m⁻², b₁=−0.75, b₂=3.4; ψ: sun elevation relative to the slope; shaded ⇒ sin ψ = 0
Q*   = [(1 − A) Q_sw + c₁ T⁶ − σT⁴ + c₂ N_c] / (1 + c₃)     c₁=5.31×10⁻¹³, c₂=60, c₃=0.12
Q_h  = B/(1+B) · Q*(1 − c_g)                   B (Bowen) = 1.0, c_g = 0.15, albedo A = 0.25 grass/brush, 0.10 trees
night: Q_h = −ρ c_p u* θ*  (van Ulden & Holtslag 1985 iteration)
```

- N_c is cloud fraction.
- The insolation module already gives slope-aware direct radiation, so sin ψ comes from `terrain/insolation`.
- Apply Q_h as the θ′ source in the lowest layers with an e-folding depth of about Δz₁ [H].

**Can 100–200 m resolve slope winds?**
- *Partially.* Daytime anabatic layers (tens to a few hundred metres deep) and valley-scale circulations and cold pools will emerge, after about 30–60 min of spin-up [K/H].
- *Night drainage flows cannot.* They are 10–50 m deep; 02 §2.3 derives a Prandtl jet at about 10 m.

**Sub-grid top-up for the fire wind** [V formulas, `cellDiurnal.cpp`]:

```
upslope:    S = [ Q_h g Δz / ((C_d + E) ρ c_p T) ]^{1/3}                          C_d = 0.2, E = 0.2
downslope:  S = [ −Q_h g L sin α / (ρ c_p T (C_d + E)) ]^{1/3} · (1 − e^{−L/L_e})^{1/3}
            L_e = 0.05 Δz/(C_d + E) ,  C_d = 10⁻⁴, E = 0.01
```

- Δz is the elevation drop to the valley bottom (upslope) or the rise to the hilltop (downslope), found by tracking along the fall line. L is the along-slope distance and α the slope angle.
- For light winds WindNinja floors the wind used in the flux computation at 1.788 m/s.
- This hydraulic slope-flow form follows Mahrt (1982) [K].
- Worked examples [D]:
  - Q_h = 300 W/m², Δz = 300 m: **S ≈ 1.8 m/s upslope**;
  - Q_h = −30 W/m², L = 1 km, sin α = 0.3, Δz = 300 m: **S ≈ 2.3 m/s downslope**.
  - Both fall within the NWCG ranges quoted in 02 §2.3.
- Add only the *unresolved remainder*: `S_top-up = max(0, S − U_resolved·ŝ)` along the fall line ŝ.
- Fade it out as the ridge wind rises from 3 to 8 m/s (02 §2.3) [H].

### 7.10 Background wind, initialisation and nudging

**Mass-consistent background** [V, `ninja::discretize`]. This is the WindNinja formulation:

```
minimise ∫[α_h²((u−u₀)² + (v−v₀)²) + α_v²(w−w₀)²] dV  subject to ∇·u = 0
⇒ ∂/∂x(R_x ∂φ/∂x) + ∂/∂y(R_y ∂φ/∂y) + ∂/∂z(R_z ∂φ/∂z) + ∇·u₀ = 0 ,   R_x = R_y = 1/(2α_h²), R_z = 1/(2α_v²)
u = u₀ + R∇φ
```

- α_v/α_h > 1 makes vertical adjustment "expensive": stable air goes around hills. WindNinja sets α_v = α_h/α_stab, with α_stab from solar radiation or a sounding [V].
- This is the pressure projection with anisotropic weights, so **reuse the §7.4 multigrid** [D].
- Re-solve on each forecast-hour change or user wind edit, warm-started.

**Initialisation.**
- u = u_bg; θ′ = cold pool if any.
- Spin up 15 min of model time without fire (about 100–150 steps) [H].

**Nudging.** Relax toward u_bg(t) with τ_n = 30–60 min in the interior [H].
- The model tracks the forecast, including a southerly change arriving through the boundaries.
- Fire-induced and thermal perturbations still evolve on their own timescale of minutes.

### 7.11 Time-step summary

| Process | Constraint | Typical value at our grids |
|---|---|---|
| Semi-Lagrangian advection | unconditionally stable; for accuracy keep Courant ≤ 2–3 | Δt_a = 3–10 s (w = 10 m/s, Δz = 30 m gives Courant 1–3) [H] |
| Buoyancy (gravity waves) | N Δt ≲ 1 | N = 0.01–0.03 s⁻¹ gives ≤ 30 s; not binding [D] |
| Horizontal diffusion (explicit) | K Δt/ℓ² ≤ 0.1 (WRF limiter) | automatically enforced [V] |
| Vertical diffusion, drag, sponge, nudging | implicit | no limit |
| Level set | Δt_f ≤ 1/max(R(\|n_x\|/Δx + \|n_y\|/Δy)) | 3–10 s at 20 m [V formula] |
| Embers | move ≤ 1 atmosphere cell per step | ≤ 7 s at 20 m/s and 150 m; sub-step particles independently [H] |
| Coupling | exchange every atmosphere step; fire sub-steps inside | energy accumulated over the sub-steps [D] |

---

## 8. Performance on phones

**Method [M].**
- Node 22 (V8, the same JIT as Chrome/Android WebView), one core of a 2.1 GHz Intel Xeon, Float32Array.
- One step = 4-field trilinear semi-Lagrangian advection + 4-field explicit diffusion + buoyancy + divergence + 20 red-black GS sweeps + gradient subtraction.
- The benchmark scripts are throwaway and not committed. The kernels are about 150 lines and should be ported to a debug page and re-run on target phones before the presets are fixed.

| Grid | Cells | ms/step (Xeon core) |
|---|---|---|
| 32×32×20 | 20,480 | 4.1 |
| 40×40×24 | 38,400 | 7.9 |
| 48×48×24 | 55,296 | 11.9 |
| 64×64×30 | 122,880 | 26.8 |

- Components at 48×48×24: advection 1.15 ms per field (≈ 21 ns/cell, the dominant cost); diffusion 0.26 ms per field; one RBGS sweep 0.25 ms.
- Level set (full grid, ENO1 + Heun): 0.9 ms at 200², 2.1 ms at 300², 8.2 ms at 600² [M]. A narrow band cuts this 3–5×.

**Scaling to phones [H].**
- Flagship phone big cores are comparable to this server core single-threaded; mid-range phones are plausibly 2–3× slower.
- Long runs throttle thermally.
- Add about 50% for MAC staggering, metrics, Smagorinsky, boundary conditions and surface fluxes.

**Budgets [D from M×H]:**

| Preset | Atmosphere | Δt_a | 4 h steps | Est. wall time |
|---|---|---|---|---|
| Fast CPU | 32×32×20 @ 200 m (6.4 km) | 10 s | 1,440 | 9–27 s |
| Standard CPU | 40×40×24 @ 150 m (6 km) | 6 s | 2,400 | 30–90 s |
| WebGPU (if `navigator.gpu`) | 64×64×30 @ 100 m | 3 s | 4,800 | ≈ 5–20 s (unmeasured; dispatch-overhead bound) |

Plus fire: 300² × 1,440–2,400 steps × 1–4 ms ≈ 2–10 s. Plus embers: ≤ 4,000 particles, under 1 ms per step.

**Engineering choices [H]:**
- **Auto-tune.** Time 20 steps at start-up and pick the largest preset that fits the user's time budget.
- **Pipeline two workers.**
  - Worker A: fire + embers. Worker B: atmosphere.
  - Exchange only 2-D fields per step: about 6 kB each for the heat field and the 10 m wind. The coupling lags by one step, a few seconds, which is physically negligible.
  - Expect about 1.7–1.9× speed-up without needing SharedArrayBuffer.
- **WASM SIMD** (Chrome ≥ 91, Safari ≥ 16.4 [K]) for advection and smoothers: expect 1.5–3× [H].
- **WASM threads** need cross-origin isolation, which is uncertain in Capacitor WebViews [K/unverified]. Don't depend on them.
- **WebGPU.**
  - Shipped in Chrome for Android 121+ on Android 12+ devices and in Safari/iOS 26 [K].
  - Support *inside Capacitor WebViews* is not verified. Feature-detect it and keep CPU parity tests.
  - Read back only 2-D slices, never the full 3-D field, per step.
- **Stream results.** Post a snapshot every 5 simulated minutes, so the user sees the first hour within seconds.
- Keep time accumulators in Float64; use Float32 elsewhere.

---

## 9. Implementation recommendations

### 9.1 Recommended coupled algorithm (pseudo-code)

```ts
// ---------- setup (once per scenario) ----------
fireGrid  = DEM @ 10–30 m (full slopes)                         // fire/, terrain/
atmTerr   = smoothToMaxSlope(resample(DEM, dxA), 35°)          // §7.5
grid      = terrainFollowing(atmTerr, dz1=20, r=1.13, K=24, H=zsMax+2000)   // §7.6
mg        = buildMultigrid(grid, {coarsen:'horizontal', smoother:'zLineZebra'}) // §7.4
bg        = backgroundProfile(weatherAt(t0))                   // log-law + 10/80/120/180 m + p-levels, §7.7
ubg       = massConsistent(bg, grid, alphaFromStability(bg), mg)                 // §7.10
atm.u     = ubg; atm.thetaP = coldPool(userInversion)          // §7.8
spinUp(atm, 900 s, noFire)

// ---------- main loop ----------
while (t < tEnd) {
  dtA = clamp(3 * min(dx/|u|max, dz/|w|max), 3, 10)             // §7.11, Courant ≤ 3
  if (weatherHourChanged(t)) ubg = massConsistent(backgroundProfile(weatherAt(t)), grid, …, mg /*warm*/)
  Qh = surfaceHeatFlux(insolation(t), cloud, veg)               // §7.9, W/m² per column

  // --- wind for fire (10 m open-equivalent) ---
  Ubg10 = logTo10mOpen(sampleAGL(ubg, zRef))                   // §4.1
  Udy10 = logTo10mOpen(sampleAGL(atm.u, zRef))
  Uf = Ubg10 + cf*(Udy10 - Ubg10) + slopeFlowTopUp(Qh, atm) + cp*gradPsiSub   // §4.2
  // --- fire sub-steps ---
  E.fill(0); tau = 0
  while (tau < dtA) {
    Rh, LB = rosModel(fuel, moisture, |Uf|, ...)               // Vesta/McArthur/grass (ROS note)
    dtF = min(dtA - tau, 0.7 / max_band(R(n)*(|nx|/dxF + |ny|/dyF)))   // §3.4
    heunStep(phi, n => ellipseSupport(n, Rh, LB, unit(Uf)) * slopeFactor(∇z·n))  // §3.2–3.3 (slope once, along n)
    updateArrival(phi, tA); E += heatRelease(tA, fuel, tau, dtF)       // §3.6 (normalised to H·w)
    tau += dtF
  }
  if (++nf % 15 == 0) reinitFastSweep(phi, band=6)             // §3.5
  Qfire = chiC * aggregateToColumns(E) / dtA                    // §4.3, §5.1

  // --- atmosphere step ---
  addHeat(atm, Qfire, alphaG=max(50, dz1)); addHeat(atm, Qh, dz1)          // §5.2
  semiLagrangian(atm, [u, v, w, thetaP, smoke], dtA)            // §7.2 (BFECC optional)
  atm.w += dtA * g * atm.thetaP/theta0; atm.thetaP += -dtA * w * dThetaEnv_dz
  implicitDragNudgeSponge(atm, ubg, dtA)                        // §7.2, §7.7, §7.10
  smagorinsky(atm, cs=0.25, Pr=1/3, limit=0.1)                  // §7.3
  project(atm, mg, cycles=1..2, tol=1e-3)                        // §7.4
  davies(atm, ubg, width=5)                                      // §7.7

  embers.step(dtA, (x,y,z,out) => atm.sample(x,y,z,out))         // ember note
  if (t % 60 < dtA) insights.update(diagnostics(atm, fire))       // §10
  if (t % 300 < dtA) postSnapshot(); t += dtA
}
```

### 9.2 Mapping to ARCHITECTURE.md

- `Atmosphere.setAmbient` builds bg and u_bg.
- `setSurfaceHeating` computes Q_h.
- `addFireHeat` takes kW/m² on the fire grid, aggregates and applies the χ_c convective fraction.
- `surfaceWind(grid, …, heightAGL)` returns the §4.1 10 m open-equivalent by default.
- `maxStableDt` implements the Courant rule.
- `view()` exposes θ′, w, smoke, plume-top diagnostics and the 1-D plume column.
- `FireSpreadModel.maxStableDt` implements §3.4.
- `factorsAt(k)` stores the wind decomposition (ambient / terrain / slope-flow / dynamic) for "why".

### 9.3 Simplifications and their consequences

| Simplification | Consequence | Mitigation |
|---|---|---|
| Dry Boussinesq, 3 km lid | No pyroCb dynamics, downbursts or deep-plume feedback; strong plumes are capped | 1-D plume column + PFT diagnostic (§6.5); label "indicative" |
| 100–200 m atmosphere | No VLS, no gully attachment; plume core too weak; indraft underestimated | Parameterisations in 01/02; sub-grid pyrogenic potential; ember lofting uses MTT core w |
| Semi-Lagrangian trilinear | Numerical diffusion smears plumes and slows rise | BFECC for θ′ and w; validate rise against Briggs |
| Terrain smoothed to 35° | Weaker, delayed separation off cliffs | Lee-separation mask on the fire grid |
| Single-column background + nudging | Horizontal gradients of the forecast ignored within 3–10 km | Acceptable at this domain size; user local-wind edits |
| Empirical ROS + resolved wind | Some double counting; resolution sensitivity | c_f slider, z_ref ≥ 50 m, scale-separated pyrogenic term |
| No radiation transport | Pre-heating across gullies not modelled here | Cross-valley radiant parameterisation (01 §4.7) |
| No Coriolis | None over 3–10 km and hours for the perturbation | Background carries it |

### 9.4 User-editable inputs (coupling/atmosphere)

| Input | Default | Range | Effect |
|---|---|---|---|
| Fire-made wind (coupling factor c_f) | 1.0 | 0–1.5 | 0 shows the "uncoupled" prediction; teaching contrast |
| Local wind observation (belt-weather kit at a point) | — | dir/speed | Gaussian-weighted correction of u₀ (radius 0.5–1 km) + mass-consistent re-solve [H] |
| Valley inversion (depth, strength, break time) | from preset | 0–400 m, 0–10 K | Cold pool, smoke trapping, "wake-up" timing |
| Cloud cover | forecast | 0–1 | Q_h, slope winds |
| Diurnal slope flows | on | on/off | Isolates the thermal-wind lesson |
| Convective fraction χ_c | 0.85 | 0.6–1.0 | Plume strength |
| Wind reference height z_ref | 50 m | 20–100 m | Sensitivity of ROS to coupling |
| Quality preset | auto | fast/standard/GPU | Grid and Δt |

### 9.5 Validation (qualitative, automated where possible)

1. **Level-set isotropy.**
   - Test: constant R, circle.
   - Pass: area error < 2% after 100 steps; axis/diagonal radius ratio within 2% [H].
   - Test: constant wind ellipse.
   - Pass: it matches the analytic offset ellipse from §3.2.
2. **Merging.** Two ignitions merge without spurious oscillation. A spot-fire union behaves correctly.
3. **Slope.** A head fire on a 10° slope with no wind runs about 2× the flat ROS (exp(0.069·10) = 1.99, McArthur-type factor [K]; see 01).
4. **Projection.** After projection, `max|∇·u|·Δx/|u| < 10⁻³`. Energy conservation: ∫ρc_pθ′ dV increases by Σ Q Δt (minus boundary losses).
5. **Neutral flow over an isolated hill.**
   - Pass: crest speed-up ΔS ≈ B·h/L, with B ≈ 1.6 for 3-D hills and 2.0 for 2-D ridges (Taylor & Lee 1984) [K], for gentle hills (h/L < 0.3).
   - Pass: no upstream drift.
6. **Stratified ridge.** Fr < 1 gives blocking and flow around or along the valley. Fr > 1 gives flow over, with lee acceleration.
7. **Warm bubble** (Robert 1993-style). Test: 0.5 K. Pass: symmetric rise and mushroom shape, with no grid imprint.
8. **Plume.** Rise height within a factor of 2 of Briggs (§6.2). Tilt increases with U.
9. **Diurnal.**
   - Pass: 1–3 m/s upslope on sunlit slopes by late morning.
   - Pass: a nocturnal cold pool forms in the valley.
   - Pass: the inversion erodes after sunrise.
   - The magnitudes should match 02 §2.3.
10. **Coupling sensitivity.**
    - Halve Δ_a. Pass: ROS at the head changes by < 20% [H]. Otherwise revisit z_ref and c_f.
    - Pass: fire-induced convergence appears ahead of the flanks and between fronts.
11. **Case replays** (qualitative): the Sir Ivan fire NSW (ACCESS-Fire case) [V]; the Grose Valley VLS (02); the Waroona evening ember storm mechanism [V].

---

## 10. Explaining it to a beginner firefighter: insight cards and detection criteria

All thresholds are [H] unless noted, and all are tunable. Cards need 5 min of persistence and a cooldown.

| # | Card (plain language) | Detection criterion |
|---|---|---|
| 1 | **The fire is making its own wind.** "Heat rising from the fire is pulling air in from the sides. Near the fire the wind can blow *toward* the flames, even against the forecast direction. Expect gusty, shifting winds close in." | On ≥ 30% of active-front cells, \|U10,dyn − U10,bg\| ≥ max(1.5 m/s, 0.3\|U10,bg\|) |
| 2 | **Plume-dominated fire: harder to predict.** "The fire's heat is stronger than the wind. Its column stands up tall and it can spread in any direction, surge suddenly, or throw embers all around." | N_c ≥ 10 over the head for ≥ 5 min [V threshold, 02] |
| 3 | **Wind-driven fire: fast and long.** "The wind is in charge. The fire runs fast downwind in a narrow head and embers land well ahead." | N_c ≤ 2 and U10 ≥ 20 km/h [V threshold, 02] |
| 4 | **Smoke leaning over: heat and embers go downwind.** "The column is bent over by the wind, so hot gases and embers are carried over unburnt fuel ahead of the fire." | Plume tilt from vertical ≥ 45°, i.e. mean U(0–1 km) ≥ plume-core w |
| 5 | **Tall column: storm-cloud (pyroCu) risk.** "The smoke column may reach cloud height and could make its own storm, with sudden wind changes and lightning." | 1-D plume top ≥ LCL + 500 m, or PFT exceeded (02) |
| 6 | **Sun-warmed slope pulling fire uphill.** "This slope has been in the sun. Warm air creeps up it and drags the fire with it, even with little wind." | Q_h ≥ 150 W/m² and slope ≥ 10° and upslope S ≥ 1 m/s and ridge wind ≤ 5 m/s, 09:00–17:00 |
| 7 | **Cool air draining downhill tonight.** "After sunset, cold air slides down slopes into the valley. Fires back downhill slowly and smoke pools low. Upper slopes can stay warm and active (thermal belt)." | Q_h < 0 and slope ≥ 5° and ridge wind ≤ 4 m/s, after sunset |
| 8 | **Inversion lid: quiet now, not for long.** "A layer of warm air above the valley is holding the smoke down and the wind off. When the sun breaks it, stronger winds from above reach the fire." | Δθ ≥ 3 K within 300 m above the valley floor. Then a "breaking now" card when the surface θ reaches θ at the inversion top |
| 9 | **Winds above the ground matter.** "Winds a few hundred metres up are much stronger than at your position. Where the terrain or the fire's column brings them down, the fire can flare suddenly." (The Waroona lesson [V]) | U(300–800 m AGL)/U10 ≥ 2 and a downward w or mixing reaching the fire |
| 10 | **Two fires pulling together.** "These fire edges are drawing air, and each other, together. The gap between them can close very fast." | Fronts < 200 m apart at an angle < 60°, or pyrogenic/resolved convergence between them |
| 11 | **Strong updraft: embers lifted high.** "The rising column here is strong enough to carry burning bark high up and far downwind." | Resolved or MTT plume-core w ≥ 5 m/s at 200–500 m (the ember note sets thresholds by particle type) |
| 12 | **Wind reverses behind the ridge.** "On the sheltered side of the ridge the air swirls back uphill. A fire here can creep back toward the ridge and flare when it reaches the wind." | Lowest-level wind component along the ridge-crest wind < 0 on a lee slope |
| 13 | **What the model can't see.** "Gullies narrower than about 200 m can make fire race uphill faster than shown here. Treat steep gullies as more dangerous than the colours suggest." | Fire-grid slope ≥ 25° in a gully (TPI < 0) whose width is smaller than 2Δ_a |

**"Why here?" decomposition** for a tapped cell. Report the ROS factors and the wind decomposition:

```
U = ambient forecast + terrain adjustment (u_bg − u_forecast) + slope flow + fire/thermal perturbation (c_f · Δ_dyn)
```

- Attribute the dynamic perturbation to the *fire* within 2 plume heights of burning cells when fire power exceeds 50 MW, otherwise to *heating* [H].
- Example text: "Running uphill here because: slope 28° upslope (×4.8), wind 25 km/h aligned with the gully (of which 7 km/h is air being drawn in by the fire), and dry litter (6%)."

---

## 11. Open questions and uncertainties

1. **Coupling factor and wind height.** There is no published calibration of c_f or z_ref for Vesta/McArthur coupled to a 100–200 m LES-lite model. This needs sensitivity studies against ACCESS-Fire or WRF-SFIRE hindcasts (Sir Ivan).
2. **Pyrogenic potential constant.** k and the exact source term are in Hilton et al. (2018) and were not retrieved. Scale separation (§4.2) is my design, not published.
3. **Convective fraction and flaming residence time for Australian eucalypt fuels.** The values are uncertain; χ_c = 0.85 and τ_f = 30–60 s are placeholders.
4. **Byram N_c wind height** varies across papers. The convective Froude number definition should be verified in Clark et al. (1996).
5. **ACCESS-Fire configuration** (resolution, ROS model, wind level) was not retrievable. Check Toivanen et al. (2019) and Peace et al. (2022, 2023).
6. **Phone performance** is extrapolated from a server core. Port the benchmark kernels to a debug page and run them on target devices; SIMD, WebGPU in Capacitor WebViews and thermal throttling are unverified.
7. **Terrain-following metric error** at 30–35° smoothed slopes with our Poisson solver: measure divergence and spurious flow at rest over the real Blue Mountains DEM (a resting-atmosphere test: u should stay near 0).
8. **Open-Meteo 80/120/180 m and pressure-level availability** for the BOM ACCESS models needs a runtime capability check.

---

## 12. References

Links with a † were not resolved in this session. They are given from bibliographic knowledge, so check them.

**Coupled models and fire spread**
- Mandel, J., Beezley, J.D., Kochanski, A.K. (2011). Coupled atmosphere–wildland fire modeling with WRF 3.3 and SFIRE 2011. *Geosci. Model Dev.* 4, 591–610. https://gmd.copernicus.org/articles/4/591/2011/ [abstract V]
- Coen, J.L. et al. (2013). WRF-Fire: coupled weather–wildland fire modeling with the Weather Research and Forecasting model. *J. Appl. Meteor. Climatol.* 52, 16–38. https://journals.ametsoc.org/view/journals/apme/52/1/jamc-d-12-023.1.xml
- Muñoz-Esparza, D., Kosović, B., Jiménez, P.A., Coen, J.L. (2018). An accurate fire-spread algorithm in the Weather Research and Forecasting model using the level-set method. *J. Adv. Model. Earth Syst.* 10. https://doi.org/10.1002/2017MS001108 [cited in the WRF code, V]
- WRF source (fire module, registry, dynamics): https://github.com/wrf-model/WRF (`Registry/registry.fire`, `phys/module_fr_fire_core.F`, `module_fr_fire_phys.F`, `module_fr_fire_atm.F`, `module_fr_fire_driver.F`, `dyn_em/module_small_step_em.F`, `dyn_em/module_diffusion_em.F`, `Registry/Registry.EM_COMMON`, `test/em_fire/namelist.input_hill_simple`) [V]
- WRF-SFIRE README (SFIRE 0.1 features): https://github.com/openwfm/WRF-SFIRE [V]
- Clark, T.L., Jenkins, M.A., Coen, J., Packham, D. (1996). A coupled atmosphere–fire model: convective feedback on fire-line dynamics. *J. Appl. Meteor.* 35, 875–901. †
- Clark, T.L., Coen, J., Latham, D. (2004). Description of a coupled atmosphere–fire model. *Int. J. Wildland Fire* 13, 49–63. https://doi.org/10.1071/WF03043 †
- Kochanski, A.K. et al. (2013). Evaluation of WRF-SFIRE performance with field observations from the FireFlux experiment. *Geosci. Model Dev.* 6, 1109–1126. https://doi.org/10.5194/gmd-6-1109-2013 †
- Toivanen, J. et al. (2019). Coupled atmosphere–fire simulations of the Black Saturday Kilmore East wildfires with the Unified Model. *J. Adv. Model. Earth Syst.* 11, 210–230. https://doi.org/10.1029/2017MS001245 †
- Peace, M., Greenslade, J., Ye, H., Kepert, J.D. (2022). Simulations of the Waroona fire using the coupled atmosphere–fire model ACCESS-Fire. *J. South. Hemisph. Earth Syst. Sci.* https://doi.org/10.1071/ES22013 [V]
- Peace, M. et al. (2023). The destructive Sir Ivan fire in New South Wales, Australia; simulations using a coupled fire–atmosphere model. *Fire* 6(11), 438. https://doi.org/10.3390/fire6110438 [V]
- NHRA: Coupled fire–atmosphere simulations of five Black Summer fires using ACCESS-Fire. https://www.naturalhazards.com.au/resources/publications/report/coupled-fire-atmosphere-simulations-five-black-summer-fires-using [V]
- Peace, M., Mattner, T., Mills, G., Kepert, J., McCaw, L. (2015). Fire-modified meteorology in a coupled fire–atmosphere model. *J. Appl. Meteor. Climatol.* 54, 704–720. †
- Linn, R., Reisner, J., Colman, J.J., Winterkamp, J. (2002). Studying wildfire behavior using FIRETEC. *Int. J. Wildland Fire* 11, 233–246. †
- Linn, R.R. et al. (2020). QUIC-fire: a fast-running simulation tool for prescribed fire planning. *Environ. Model. Softw.* 125, 104616. https://www.sciencedirect.com/science/article/abs/pii/S1364815219307388 [abstract V]
- Miller, C., Hilton, J., Sullivan, A., Prakash, M. (2015). SPARK – a bushfire spread prediction tool. ISESS 2015, IFIP AICT 448. https://link.springer.com/chapter/10.1007/978-3-319-15994-2_26 [V]
- Hilton, J.E., Sullivan, A.L., Swedosh, W., Sharples, J., Thomas, C. (2018). Incorporating convective feedback in wildfire simulations using pyrogenic potential. *Environ. Model. Softw.* 107, 12–24. †
- Hilton, J.E., Garg, N. (2021). Rapid wind–terrain correction for wildfire simulations. *Int. J. Wildland Fire* 30, 410–427. †
- Sharples, J.J., Hilton, J.E. (2020). Modeling vorticity-driven wildfire behavior using near-field techniques. *Front. Mech. Eng.* 5:69. †
- ForeFire: https://github.com/forefireAPI/forefire [V README]
- Finney, M.A. (1998, rev. 2004). FARSITE: Fire Area Simulator — model development and evaluation. USDA FS RMRS-RP-4. https://www.fs.usda.gov/rm/pubs/rmrs_rp004.pdf †
- Richards, G.D. (1990). An elliptical growth model of forest fire fronts and its numerical solution. *Int. J. Numer. Meth. Eng.* 30, 1163–1179. †
- Tymstra, C., Bryce, R.W., Wotton, B.M., Taylor, S.W., Armitage, O.B. (2010). Development and structure of Prometheus. NoFC Inf. Rep. NOR-X-417. †
- Tolhurst, K., Shields, B., Chong, D. (2008). Phoenix: development and application of a bushfire risk management tool. *Aust. J. Emerg. Manag.* 23(4), 47–54. †
- Johnston, P., Kelso, J., Milne, G.J. (2008). Efficient simulation of wildfire spread on an irregular grid. *Int. J. Wildland Fire* 17, 614–627. †
- Ghisu, T. et al. (2015). An optimal cellular automata algorithm for simulating wildfire spread. *Environ. Model. Softw.* 71, 1–14. †
- Hädrich, T., Banuti, D.T., Pałubicki, W., Pirk, S., Michels, D.L. (2021). Fire in Paradise: mesoscale simulation of wildfires. *ACM Trans. Graph.* 40(4). † (a GPU coupled fire–atmosphere simulation for graphics)

**Level-set numerics**
- Osher, S., Sethian, J.A. (1988). Fronts propagating with curvature-dependent speed. *J. Comput. Phys.* 79, 12–49. https://doi.org/10.1016/0021-9991(88)90002-2 †
- Osher, S., Fedkiw, R. (2003). *Level Set Methods and Dynamic Implicit Surfaces.* Springer. (cited in the WRF code) [V citation]
- Sussman, M., Smereka, P., Osher, S. (1994). A level set approach for computing solutions to incompressible two-phase flow. *J. Comput. Phys.* 114, 146–159. [V citation in the WRF code]
- Zhao, H. (2005). A fast sweeping method for Eikonal equations. *Math. Comp.* 74, 603–627. †
- Adalsteinsson, D., Sethian, J.A. (1995). A fast level set method for propagating interfaces. *J. Comput. Phys.* 118, 269–277. †

**Plumes and regimes**
- Morton, B.R., Taylor, G.I., Turner, J.S. (1956). Turbulent gravitational convection from maintained and instantaneous sources. *Proc. R. Soc. A* 234, 1–23. https://doi.org/10.1098/rspa.1956.0011 †
- Briggs, G.A. (1969). *Plume Rise.* USAEC TID-25075. Briggs, G.A. (1975). Plume rise predictions. In *Lectures on Air Pollution and Environmental Impact Analyses*, AMS, 59–111. †
- Byram, G.M. (1959). Combustion of forest fuels. In Davis, K.P. (ed.) *Forest Fire: Control and Use*. McGraw-Hill. Nelson, R.M. (1993). Byram's energy criterion for wildland fires. USDA FS Res. Note INT-415. Morvan, D., Frangieh, N. (2018). *Int. J. Wildland Fire* 27, 636–641. [thresholds V via 02]
- Freeborn, P.H. et al. (2008). Relationships between energy release, fuel mass loss, and trace gas and aerosol emissions during laboratory biomass fires. *J. Geophys. Res.* 113, D01301. †

**Atmospheric numerics**
- Stam, J. (1999). Stable fluids. *Proc. SIGGRAPH 99*, 121–128. https://doi.org/10.1145/311535.311548 †
- Fedkiw, R., Stam, J., Jensen, H.W. (2001). Visual simulation of smoke. *Proc. SIGGRAPH 2001*, 15–22. †
- Selle, A. et al. (2008). An unconditionally stable MacCormack method. *J. Sci. Comput.* 35, 350–371. †
- Harlow, F.H., Welch, J.E. (1965). Numerical calculation of time-dependent viscous incompressible flow of fluid with free surface. *Phys. Fluids* 8, 2182. †
- Crane, K., Llamas, I., Tariq, S. (2007). Real-time simulation and rendering of 3D fluids. *GPU Gems 3*, ch. 30. https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids †
- WebGL fluid reference implementation (Jacobi 20 iterations, vorticity confinement): https://github.com/PavelDoGreat/WebGL-Fluid-Simulation [V]
- Trottenberg, U., Oosterlee, C.W., Schüller, A. (2001). *Multigrid.* Academic Press. †
- Gal-Chen, T., Somerville, R.C.J. (1975). On the use of a coordinate transformation for the solution of the Navier–Stokes equations. *J. Comput. Phys.* 17, 209–228. †
- Lundquist, K.A., Chow, F.K., Lundquist, J.K. (2010). An immersed boundary method for the Weather Research and Forecasting model. *Mon. Wea. Rev.* 138, 796–817. †
- Adcroft, A., Hill, C., Marshall, J. (1997). Representation of topography by shaved cells in a height coordinate ocean model. *Mon. Wea. Rev.* 125, 2293–2315. †
- Klemp, J.B., Dudhia, J., Hassiotis, A.D. (2008). An upper gravity-wave absorbing layer for NWP applications. *Mon. Wea. Rev.* 136, 3987–4004. † (the implementation is V in the WRF code)
- Davies, H.C. (1976). A lateral boundary formulation for multi-level prediction models. *Q. J. R. Meteorol. Soc.* 102, 405–418. †
- Smagorinsky, J. (1963). General circulation experiments with the primitive equations. *Mon. Wea. Rev.* 91, 99–164. † (WRF form V)
- Robert, A. (1993). Bubble convection experiments with a semi-implicit formulation of the Euler equations. *J. Atmos. Sci.* 50, 1865–1873. †

**Terrain winds and diurnal flows**
- WindNinja source (mass-consistent solver `src/ninja/ninja.cpp`; diurnal slope flow `src/ninja/cellDiurnal.cpp`; vegetation roughness): https://github.com/firelab/windninja [V]
- Forthofer, J.M., Butler, B.W., Wagenbrenner, N.S. (2014). A comparison of three approaches for simulating fine-scale surface winds in support of wildland fire management, Part I. *Int. J. Wildland Fire* 23, 969–981. †
- Wagenbrenner, N.S. et al. (2016). Downscaling surface wind predictions from numerical weather prediction models in complex terrain with WindNinja. *Atmos. Chem. Phys.* 16, 5229–5241. †
- Holtslag, A.A.M., van Ulden, A.P. (1983). A simple scheme for daytime estimates of the surface fluxes from routine weather data. *J. Clim. Appl. Meteor.* 22, 517–529. † (constants V in WindNinja)
- Mahrt, L. (1982). Momentum balance of gravity flows. *J. Atmos. Sci.* 39, 2701–2711. †
- Taylor, P.A., Lee, R.J. (1984). Simple guidelines for estimating wind speed variations due to small-scale topographic features. *Climatol. Bull.* 18(2), 3–32. †
- Whiteman, C.D. (2000). *Mountain Meteorology: Fundamentals and Applications.* Oxford University Press. †
