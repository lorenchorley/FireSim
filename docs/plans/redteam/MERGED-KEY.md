# Merged findings: provenance and control key (orchestrator only; verifiers never see this)

55 findings from 7 teams merged into 35 canonical items in 5 batches. Controls: in every batch, CTRL-T (true) and CTRL-F (false) are placed under neutral IDs.

| ID | Canonical finding | Source findings (team F#) | Teams |
|---|---|---|---|
| P-1 | No measured user-visible shortfall; free stage 0 on the owner's phone could end the question | R4F2, R7F1, R2 (cheapest experiment), R6 A3 | 4 |
| P-2 | CTRL-T: min Android API for .NET MAUI 11 is 24 | control (true) | - |
| P-3 | "All pass -> D34 reopened" has no evidence criteria tied to D34's reason | R4F6 | 1 |
| P-4 | Owner's reason for .NET unrecorded; plan tests the solver; shell-only route untested | R4F7, R6F2 | 2 |
| P-5 | B means two solvers for good (browser, PWA, desktop-served page, Node validation, e2e) | R4F5, R6F10, R7F6 | 3 |
| P-6 | Cheaper routes inside D34 not compared (WebView SAB allowlist androidx.webkit 1.18, WASM SIMD, WebGPU, moving band) | R4F3 | 1 |
| P-7 | CTRL-F: rng uses Math.random | control (false) | - |
| P-8 | No outcome if phone numbers never come back; opportunity cost against 0.9.0 | R6F6, R4F8 | 2 |
| G-1 | Gate 1 compares all-core C# with single-thread TypeScript | R4F1, R2F8, R6F1 | 3 |
| G-2 | Gate 1 bars at or below 15e's "not worth starting"; kernel not whole-run | R6F1, R7F8, R2F1 | 3 |
| G-3 | CTRL-F | control | - |
| G-4 | Wrong tier: auto -> Standard, air dominates; stage 1 profiles fast; atmosphere deferrable | R2F1, R6F3 | 2 |
| G-5 | No TypeScript phone baseline; frozen speed-test kernel exists | R2F2, R6 A8 | 2 |
| G-6 | Stage 1 kernel need not match outputs, RNG order or thread identity; exact order forces serial embers | R2F3, R3F2 | 2 |
| G-7 | No phone protocol (big.LITTLE, fixed partition, thermal, warm-up, A-B-B-A) | R4F4, R2F8, R7F7, R5F6 | 4 |
| G-8 | CTRL-T | control | - |
| G-9 | Phone numbers from Debug builds | R1F3, R5F1, R6F5 | 3 |
| G-10 | Gate 2 rates not derived; 16 MB desktop-only synthetic; 6.5 MB is init; idle CPU | R2F4, R6F8, R5F8 | 3 |
| N-1 | 3a 1e-15 evidence vacuous; libm-sized noise flips cells at 3600 s | R3F1, R6F4, R7F2, R5F8 | 4 |
| N-2 | Cross-platform determinism: .NET CRT, V8 15 LLVM libc; no C#-vs-C# check | R3F3, R7F2, R6F4 | 3 |
| N-3 | CTRL-T | control | - |
| N-4 | JS-vs-C# semantic traps (float32 arithmetic K1 repro, round, sort, NaN, Map, pow, culture) | R7F3, R3F5 | 2 |
| N-5 | 30-seed 12 % bar weak; cv from n=6; "run to run" wording | R2F6, R3F6 | 2 |
| N-6 | Seed 11 runs no ember code | R2F7 | 1 |
| N-7 | Gate 3 only 30 min, one site | R6F7, R3F1 | 2 |
| N-8 | CTRL-F | control | - |
| N-9 | Port size: closure 37,727 + 21,182 tests; stage 4 needs rewind/explain; churn | R3F4, R7F5 (R4/R6 found 25k/15k sound for 6 dirs) | 2 (+2 contrary) |
| N-10 | Rule 4 vs tier auto (wall-clock tier) | R3F2 part | 1 |
| T-1 | Transports (a)(b) base64 strings on main thread; missing (d) intercepted fetch, (e) ArrayBuffer | R1F1, R2F5, R7F4, R6F8 | 4 |
| T-2 | No ASP.NET Core runtime pack for Android: no in-app Kestrel | R1F2 | 1 |
| T-3 | CTRL-T | control | - |
| T-4 | Container cannot reliably build an APK (ENOSPC, no APK, no KVM, Linux not a listed host) | R1F4, R5F7, R6F5 | 3 |
| T-5 | Page depends on the Capacitor bridge; "page needs no change" false | R1F5, R5F2 | 2 |
| T-6 | Saved data: origins differ; install-over needs id, cert, versionCode; export release first | R6F9, R5F2, R1 (sound) | 3 |
| T-7 | CTRL-F | control | - |
| T-8 | Target SDK 37 default, Android 17 local network permission; WebView floor | R1F6, R5F5 | 2 |
| T-9 | Photino.Blazor latest targets net8/net9 only | R1F7 | 1 |
| S-1 | No host-security parity rule; ASP.NET Core template defaults; tests cover a minority of guards | R5F3 | 1 |
| S-2 | Protocol 2 on in-app loopback: shared address, typed code, fixed port | R5F4 | 1 |
| S-3 | CTRL-T | control | - |
| S-4 | No background, process-death or sustained-load test; link lost after background | R5F6 | 1 |
| S-5 | Signing key exists only in the container | R5F2, R5F7 | 1 |
| S-6 | CTRL-F | control | - |
| S-7 | Toolchain provenance only in scratchpad logs; env.sh path; unpinned packages; licences | R5F7 | 1 |
| S-8 | Overstated statements (33 MB, 16 MB measured, "tested", MAUI 11 support end, CoreCLR Android regressions) | R5F8 | 1 |

Controls: CTRL-T = "The minimum Android API level supported by .NET MAUI apps targeting .NET 11 is 24 (Android 7.0)." TRUE (Learn What's new in MAUI 11). CTRL-F = "FireSim's simulation draws its random numbers from Math.random(), so the sequence cannot be reproduced in another language." FALSE (src/core/rng.ts is a seeded mulberry32).
