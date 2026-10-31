# Desktop simulation

A topic that has **not started**. **Question:** can there be a desktop version that runs more detailed simulations than a phone can?

**Status:** a stretch goal in no release ([plan](../../docs/plans/air-slice-wind-detail-honest-speed.md) section 15e, decision D32).
**Recorded with a low-detail desk note (2026-10-31); nothing has been measured, run or built.** The note comes from reading the repository
and from a few web searches (search summaries only; the pages were not read in full, so figures are indicative). There is no study folder yet.

## Why it matters

- A phone sets how detailed the simulation can be: 30 m fire cells (200 x 200 at Katoomba 6 km), a 10 m grid for the view and the air, the fast
  tier or the 3-D air (one phone measured 41 ms a 3-D step), and a history budget that thins keyframes.
- A computer could run finer cells (20 m, 10 m), smaller steps, more embers, the richest 3-D air, bigger domains, longer runs, and many runs at once.
- It is where the references of the other stretch goals would be made: the reference run and convergence ladder of
  [simulation-validity](../simulation-validity/README.md) (idea 4) and the experiment of
  [adaptive-simulation-quality](../adaptive-simulation-quality/README.md) (question 2) are the same experiment as the first step here.

## What the repository has today

- The simulation is TypeScript in a Web Worker, and the same `Simulation` runs headless in Node (the validation suite and benchmarks do), so the
  code is not tied to the phone. The app runs in a desktop browser and as a PWA, and the controls have a mouse mapping.
- It is deterministic (V18): the same scenario and seed give the same result.
- It runs on one thread. README figures, one desktop core: the fast tier about 900 s of fire per second, the 3-D tier about 220.
- Not measured: how time and memory grow with finer cells and steps (a guess: nine times the cells at 10 m, plus a smaller step, so one to two
  orders of magnitude), and the finest settings the code accepts.
- `public/replays/` holds files for the bundled replay presets; whether a precomputed result could be stored and played back in that form is
  unchecked.

## Options, roughly cheapest first (none tried)

| # | Option | For | Against |
|---|---|---|---|
| 1 | The same web app in a desktop browser with a "Desktop" detail setting | cheapest; no install; one code base | still one thread: the limit is one core |
| 2 | A desktop shell around the same app: **Electron** (ships Chromium and Node) or **Tauri** (OS web view, Rust back end) | Electron: consistent rendering, Node worker threads, file access. Tauri: small installers (a few MB against roughly 80 to 150 MB) and less memory; a Rust back end could host a native solver | Electron is large; Tauri's rendering can differ between systems, which matters for a WebGL-heavy app. Figures are from blogs. Licences unchecked |
| 3 | Several workers sharing memory (SharedArrayBuffer needs a cross-origin-isolated page) or Node worker threads | uses all cores; keeps TypeScript | determinism: parallel sums can change the last bits; the grid and the air must be split by region |
| 4 | WebAssembly with threads and SIMD for the hot loops, the 3-D air first | big speed-ups for the stencil | shared-memory support is uneven by browser; needs a single-thread fallback; SIMD support not established by my search |
| 5 | GPU compute (WebGPU) | natural for the 3-D air stencil, maybe the fire front; reported broadly available on desktop Chrome and Safari 26, weaker on Firefox for Linux | the largest rewrite; float32 results are not guaranteed identical across GPUs |
| 6 | A native solver (Rust or C++) behind a desktop shell or as a batch tool | fastest | most effort; two code bases can drift, so it needs golden scenarios and a cross-engine comparison (validity idea 19) |
| 7 | Remote compute (a server runs the big simulation) | no local limit | needs a network, conflicts with the offline rule; not recommended |

**An idea that may cost less than a full desktop app:** the desktop (or a batch tool) makes a detailed run and exports it, and the phone only plays
the results back. Playback needs no solver, so the phone no longer sets the detail. What a result file would hold, and how large it is, is unchecked.

## Questions to settle before any build

1. **Who is it for?** Instructors preparing scenarios, analysts, or the developers' reference runs. That decides live view versus batch plus a result file.
2. **Which detail matters?** Finer cells, longer runs, a larger domain, richer air, or many runs; each costs differently.
3. **Honesty.** Results change with detail (D23), so the app must say which detail a result came from and not present a phone result and a desktop
   result as the same thing (plan rule 4).
4. **One code base or two?** The cheaper options keep one; a native solver does not.
5. **How do the phone and the desktop exchange scenarios and results?**

## First steps if it is investigated (not now)

1. Measure time and memory against cell size, step size, ember count and tier on the bundled sites, headless in Node (shared with the two other topics).
2. Pick the user and the output (live, or batch plus a result file).
3. A small spike of option 2 or 3 and a measured speed-up over one core.
4. Choose between WebAssembly, WebGPU and native only on those numbers.

## Sources (search summaries only)

- [Tauri and Electron compared (OpenReplay)](https://blog.openreplay.com/comparing-electron-tauri-desktop-applications/)
- [Tauri 2 and Electron (noqta)](https://noqta.tn/en/blog/tauri-2-desktop-apps-rust-web-technologies-2026)
- [WebGPU compute in the browser, 2026 (CodeRcops)](https://blog.codercops.com/blog/webgpu-browser-gpu-compute-2026)
- [WebGPU browser support](https://abratabia.com/webgpu/browser-support.php)
- [WebAssembly threads (web.dev)](https://web.dev/articles/webassembly-threads?authuser=0)
- [Enabling SharedArrayBuffer with COOP and COEP](https://app.cinevva.com/tutorials/coop-coep-sharedarraybuffer.html)

## Log

No studies yet. Rules for adding one are in [`../README.md`](../README.md).

- 2026-10-31: the owner asked for a desktop version that can run more detailed simulations as a new stretch goal, to be researched in low
  detail and saved in the docs. This page and plan section 15e are that note. Nothing was run.
