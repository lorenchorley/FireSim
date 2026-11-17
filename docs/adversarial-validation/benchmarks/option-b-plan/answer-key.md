# Answer key (kept outside the run directory; never shown to reviewers or the judge)

Source: the verified verdicts of an independent red team of this plan (two verifiers per item). Items below are the 35 canonical findings; CTRL items are planted controls and are excluded.

### 4.3 Verdicts

S is the Sonnet verifier and O the Opus verifier. C means confirmed and P partly. Severities: B blocker, M major, m minor. The plan column gives the section of the revised plan where each finding is addressed.

| ID | Finding (short) | S | O | Outcome | Plan |
|---|---|---|---|---|---|
| P-1 | No measured user-visible shortfall; a free stage 0 | P M | P M | narrowed: almost nothing has been measured on a phone, and the Detail tier may run below 60x | 11.2 (0b) |
| P-3 | "All pass" reopens D34 without criteria | C m | C M | stands | 11.8 |
| P-4 | The owner's goal is not recorded; the shell-only route is untested | P M | P M | narrowed: the Razor costs are declared exclusions | 11.2 (0a), 11.6 (4-0) |
| P-5 | B keeps two solvers (browser, PWA, Continue on this device, Node suites) | C M | C M | stands | 11.2 (0a.2), 11.8 |
| P-6 | Cheaper routes inside D34 are not compared | P M | C M | stands. WebGPU in WebView is unconfirmed | 11.3 |
| P-8 | No outcome if phone numbers never come back; cost against 0.9.0 | P M | C M | stands | 11.2, 11.8 |
| G-1 | All-core C# against one-thread TypeScript | C M | P M | stands. On the phone today's status quo is one thread | 11.3 |
| G-2 | Bars at or below 15e's "not worth starting"; a kernel, not the whole step | C M | C M | stands | 11.3 |
| G-4 | Fast tier profiled, while Auto builds Standard | C M | C M | stands | 11.3 |
| G-5 | No TypeScript baseline on the phone | C M | C B | stands | 11.3 |
| G-6 | The kernel need not match outputs, draws or thread count | P M | P M | narrowed: embers are 12.8 %; the serial cap is about 1.3 times | 11.3 |
| G-7 | No phone measurement protocol | C M | C M | stands | 11.3 |
| G-9 | Debug builds on the phone | C M | C B | stands. A sideloaded Debug APK may not start | 11.1, 11.3 |
| G-10 | Gate 2 rates not derived; 16 MB is desktop only; measured with the CPU idle | C M | C M | stands | 11.1, 11.4 |
| N-1 | 1e-15 evidence vacuous; libm noise matters at 3600 s | P m | P m | narrowed: stays inside the bars | 11.1, 11.5 |
| N-2 | .NET maths uses the C runtime; V8 15 uses LLVM libc | C m | C m | stands | 11.5 |
| N-4 | JavaScript against C# traps | P m | P M | narrowed: about 4 of 8 reach the solver | 11.5 |
| N-5 | The 12 % 30-seed bar is weak | P m | P m | narrowed: fallback only | 11.5 |
| N-6 | Seed 11 tests no ember ignition | P m | P m | narrowed: the plan says so, but the gate names no seed | 11.5 |
| N-7 | Gate 3 covers only 30 minutes on one site | P M | C M | stands | 11.5 |
| N-9 | Port is 30,000 to 38,000 lines; stage 4 needs rewind and explain | C M | C B | stands. Test-line count depends on the definition | 11.1, 11.6 |
| N-10 | Rule 4 against tier `auto` | C m | C m | stands (wording) | 11.5 |
| T-1 | Routes (a) and (b) are strings decoded on the main thread; (d) and (e) missing | C M | P M | stands. Route (c) is already binary | 11.4 |
| T-2 | No ASP.NET Core runtime for Android, so no in-app Kestrel | C M | C M | stands. `HttpListener` is an option | 11.1 |
| T-4 | The container cannot reliably build an APK | C M | P m | narrowed: the build was cut off, not shown to fail | 11.2 (0d) |
| T-5 | The page depends on Capacitor's bridge | C M | P M | stands. Preferences fall back to localStorage | 11.6 |
| T-6 | Origins differ; installing over needs the same id, key and a higher versionCode | P m | P M | narrowed: the origin was reversed; a localhost origin is possible | 11.7 |
| T-8 | Target SDK 37; Android 17 local network permission; WebView floor | C M | C m | stands | 11.4, 11.7 |
| T-9 | Photino.Blazor targets .NET 8 and 9 only | C m | C m | stands | artifact |
| S-1 | No host-parity rule; template defaults | C M | C M | stands | 11.6 |
| S-2 | Loopback on a phone: shared address, typed code, fixed port | C M | C m/M | stands | 11.6 |
| S-4 | No background, kill or sustained-load test | C M | C M | stands | 11.6 |
| S-5 | The signing key exists only in this container | C M | C M | stands | 11.2 (0c) |
| S-7 | Toolchain provenance lives only in logs | C m | P m | narrowed: package versions are recorded on commit | 11.2 (0d) |
| S-8 | Overstated sizes, "tested", support dates, CoreCLR | P m | P m | narrowed: the verifiers disagree on Mono | 11.1, 11.7 |

**Tally.**

## Provenance and claim titles
| ID | Canonical finding | Source findings (team F#) | Teams |
|---|---|---|---|
| P-1 | No measured user-visible shortfall; free stage 0 on the owner's phone could end the question | R4F2, R7F1, R2 (cheapest experiment), R6 A3 | 4 |
| P-3 | "All pass -> D34 reopened" has no evidence criteria tied to D34's reason | R4F6 | 1 |
| P-4 | Owner's reason for .NET unrecorded; plan tests the solver; shell-only route untested | R4F7, R6F2 | 2 |
| P-5 | B means two solvers for good (browser, PWA, desktop-served page, Node validation, e2e) | R4F5, R6F10, R7F6 | 3 |
| P-6 | Cheaper routes inside D34 not compared (WebView SAB allowlist androidx.webkit 1.18, WASM SIMD, WebGPU, moving band) | R4F3 | 1 |
| P-8 | No outcome if phone numbers never come back; opportunity cost against 0.9.0 | R6F6, R4F8 | 2 |
| G-1 | Gate 1 compares all-core C# with single-thread TypeScript | R4F1, R2F8, R6F1 | 3 |
| G-2 | Gate 1 bars at or below 15e's "not worth starting"; kernel not whole-run | R6F1, R7F8, R2F1 | 3 |
| G-4 | Wrong tier: auto -> Standard, air dominates; stage 1 profiles fast; atmosphere deferrable | R2F1, R6F3 | 2 |
| G-5 | No TypeScript phone baseline; frozen speed-test kernel exists | R2F2, R6 A8 | 2 |
| G-6 | Stage 1 kernel need not match outputs, RNG order or thread identity; exact order forces serial embers | R2F3, R3F2 | 2 |
| G-7 | No phone protocol (big.LITTLE, fixed partition, thermal, warm-up, A-B-B-A) | R4F4, R2F8, R7F7, R5F6 | 4 |
| G-9 | Phone numbers from Debug builds | R1F3, R5F1, R6F5 | 3 |
| G-10 | Gate 2 rates not derived; 16 MB desktop-only synthetic; 6.5 MB is init; idle CPU | R2F4, R6F8, R5F8 | 3 |
| N-1 | 3a 1e-15 evidence vacuous; libm-sized noise flips cells at 3600 s | R3F1, R6F4, R7F2, R5F8 | 4 |
| N-2 | Cross-platform determinism: .NET CRT, V8 15 LLVM libc; no C#-vs-C# check | R3F3, R7F2, R6F4 | 3 |
| N-4 | JS-vs-C# semantic traps (float32 arithmetic K1 repro, round, sort, NaN, Map, pow, culture) | R7F3, R3F5 | 2 |
| N-5 | 30-seed 12 % bar weak; cv from n=6; "run to run" wording | R2F6, R3F6 | 2 |
| N-6 | Seed 11 runs no ember code | R2F7 | 1 |
| N-7 | Gate 3 only 30 min, one site | R6F7, R3F1 | 2 |
| N-9 | Port size: closure 37,727 + 21,182 tests; stage 4 needs rewind/explain; churn | R3F4, R7F5 (R4/R6 found 25k/15k sound for 6 dirs) | 2 (+2 contrary) |
| N-10 | Rule 4 vs tier auto (wall-clock tier) | R3F2 part | 1 |
| T-1 | Transports (a)(b) base64 strings on main thread; missing (d) intercepted fetch, (e) ArrayBuffer | R1F1, R2F5, R7F4, R6F8 | 4 |
| T-2 | No ASP.NET Core runtime pack for Android: no in-app Kestrel | R1F2 | 1 |
| T-4 | Container cannot reliably build an APK (ENOSPC, no APK, no KVM, Linux not a listed host) | R1F4, R5F7, R6F5 | 3 |
| T-5 | Page depends on the Capacitor bridge; "page needs no change" false | R1F5, R5F2 | 2 |
| T-6 | Saved data: origins differ; install-over needs id, cert, versionCode; export release first | R6F9, R5F2, R1 (sound) | 3 |
| T-8 | Target SDK 37 default, Android 17 local network permission; WebView floor | R1F6, R5F5 | 2 |
| T-9 | Photino.Blazor latest targets net8/net9 only | R1F7 | 1 |
| S-1 | No host-security parity rule; ASP.NET Core template defaults; tests cover a minority of guards | R5F3 | 1 |
| S-2 | Protocol 2 on in-app loopback: shared address, typed code, fixed port | R5F4 | 1 |
| S-4 | No background, process-death or sustained-load test; link lost after background | R5F6 | 1 |
| S-5 | Signing key exists only in the container | R5F2, R5F7 | 1 |
| S-7 | Toolchain provenance only in scratchpad logs; env.sh path; unpinned packages; licences | R5F7 | 1 |
| S-8 | Overstated statements (33 MB, 16 MB measured, "tested", MAUI 11 support end, CoreCLR Android regressions) | R5F8 | 1 |

