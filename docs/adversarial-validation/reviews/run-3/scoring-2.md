# Scoring of run3 against the answer key

Scope was decided from the key, the plan and the snapshot before `ruling.md` and the reports were opened. Ledger ids are from `ruling.md` section D; report ids are from `report-R1.md` to `report-R5.md`.

| Key id | Scope | Scope reason | Result | Run id | Evidence |
|---|---|---|---|---|---|
| P-1 | in scope | Plan has no measured phone shortfall; snapshot says "nothing seen on a phone"; follows from plan text and snapshot | Partly matched | O3 (R2.5) | O3 says "fast enough" has no absolute target. It does not say that almost nothing is measured on a phone or propose a free phone check first |
| P-3 | in scope | Section 7 "All pass" row vs D34 in snapshot; plan text alone | Partly matched | S6 (R2.4, R4.4) | S6 says D34's reason (two solvers) is not weighed in the "All pass" row. It sets no evidence criteria for reopening D34 |
| P-4 | in scope | Plan names Razor as excluded and never records the owner's goal; plan text alone | Partly matched | O17 (R4.2) | O17 says the plan names no alternatives to B. The owner's goal and the shell-only route are not named |
| P-5 | in scope | Option B keeps TS solver for browser/PWA/Node host; plan and snapshot | Matched | S6 (R2.4, R4.4) | S6 says the plan does not say whether B keeps the TypeScript solver for the web build and desktop host, which decides whether there are two solvers |
| P-6 | in scope | Missing comparison with in-D34 routes follows from plan plus 15e in snapshot (WebView facts would need web, the defect does not) | Matched | S1, M1 (R4.1) | S1 adds an in-TypeScript speed arm (worker split); M1 asks what a pass may claim against the in-TypeScript routes D34 permits. The judge cut WASM and WebGPU arms |
| P-8 | in scope | Sections 7 and 8 have no outcome for missing phone numbers; plan text alone | Matched | S3 (R1.4, R5.4) | S3: nothing covers a phone result that never arrives. The cost against 0.9.0 is not raised |
| G-1 | in scope | Gate 1 says all-core C#; snapshot TS solver is one worker thread per session | Matched | M1 (R4.1) | M1: all-core C# against an unstated TypeScript thread count can clear 1.5x by parallel split alone |
| G-2 | in scope | 15e "not worth starting" text in snapshot; bars 1.5x/2.0x in plan | Partly matched | O2 (R2.5), M1 evidence | O2 and M1 cite 15e/D39 (2 to 2.6x on four cores, Amdahl 1.77x). Neither says the bars sit at or below 15e's "not worth starting", or that a kernel is not the whole step |
| G-4 | in scope | desktopDetail.ts maps auto to standard; plan profiles the fast tier | Not found | none | No ledger item or report raises the fast-tier profile against Auto building Standard |
| G-5 | in scope | Plan has no TS phone baseline; speedTestKernels.ts in snapshot | Matched | N1 | N1: Stage 1 phone gate has no method for timing the TypeScript on the same phone; names speedTest.ts and speedTestKernels.ts |
| G-6 | in scope | Stage 1 text does not require matching outputs, draws or thread count; plan text | Not found | none | S8 (R1.1) covers stage 3 RNG draw sites, not that the stage 1 kernel is unconstrained or the serial cap on embers |
| G-7 | in scope | Plan has no phone protocol; absence visible in plan | Partly matched | S2 (R1.3, R3.3) | S2 asks for repeats and recorded load for container Gate 1 numbers. No phone protocol (big.LITTLE, thermal, warm-up, A-B-B-A) |
| G-9 | in scope | Section 5 says debug builds for phone numbers; defect follows from plan text | Not found | none | R3.1 quotes "debug builds" only for the data-wipe risk; no item says debug builds distort timings |
| G-10 | in scope | Gate 2 rates in plan; 0.9.0 contract in snapshot shows what was measured | Not found | none | No item questions the derivation of the Gate 2 rates or the 16 MB desktop-only figure |
| N-1 | in scope | Section 10 1e-15 perturbation vs float32 storage argued from plan text | Partly matched | O9 (R1.2); X6 rejected the strong form | O9: perturbation changes inputs, not libm; a few-ulp check would add evidence. The judge calls the evidence strong (X6) and does not say it is vacuous or that 3600 s matters |
| N-2 | needs web | .NET CRT vs V8 LLVM libc is platform fact outside snapshot | Not found | none | No mention of C runtime or libc differences |
| N-4 | in scope | Snapshot solver code plus JS/C# semantics | Not found | none | No item on float32 arithmetic, round, sort, NaN or Map differences |
| N-5 | in scope | Section 10 bars (12 %, cv 19 %, six seeds) in plan text | Matched | O10 (R3.2) | O10: the 12 % ensemble bar has low power (SE of difference 4.9 to 7.0 %) and was set before the 30-seed runs; treated as a fallback |
| N-6 | in scope | Section 10 says seed 11 starts no spot fire; gate names no seed | Not found | none | No item mentions seed 11 or ember ignition in the gate |
| N-7 | in scope | Gate 3 uses 900/1800 s on one site; plan text | Not found | none | No item questions Gate 3 duration or site count |
| N-9 | in scope | Plan says 25,000 lines; snapshot line counts give 30-38k; stage 4 needs rewind/explain | Partly matched | O8 (R1.5) | O8: the figure has no stated scope, and the judge found many directory sets reproduce 25k/15k. It does not say the port is 30,000 to 38,000 lines or that stage 4 needs rewind and explain |
| N-10 | in scope | Rule 4 vs auto tier; auto-tier code in snapshot | Not found | none | O23/X1 concern only the "plan section 4" cross-reference in Rule 4, not the conflict with tier auto |
| T-1 | needs web | BlazorWebView/HybridWebView interop behaviour outside snapshot | Not found | none | No mention of string transports or missing transports (d), (e) |
| T-2 | needs web | Whether an ASP.NET Core runtime exists for Android is outside snapshot | Not found | none | No mention of in-app Kestrel feasibility |
| T-4 | needs web | MAUI Android build host support, disk, KVM facts outside snapshot | Not found | none | X4 rejected "no fallback if Android build fails"; no item says the container cannot reliably build an APK |
| T-5 | in scope | Snapshot src/ui imports Capacitor plugins; contradicts "page needs no change" | Not found | none | No item mentions the Capacitor bridge dependency |
| T-6 | needs web | Origin claim rests on MAUI/BlazorWebView behaviour outside snapshot | Partly matched | S7 (R3.1); O19 (R5.5) | S7: install over the current APK can wipe saved data if the signing key differs; separate app IDs, export first. Origin reversal and versionCode are not raised |
| T-8 | needs web | Target SDK 37, Android 17 permission, WebView floor are platform facts | Not found | none | No item on target SDK, local network permission or WebView floor |
| T-9 | needs artifact | Photino.Blazor is in neither plan nor snapshot | Not found | none | Not raised |
| S-1 | in scope | desktop/security.ts and tests in snapshot; plan has no parity rule | Not found | none | O12 covers offline/network audit only; no host-parity rule or ASP.NET Core defaults |
| S-2 | in scope | Protocol 2 token/address in desktop/ and src/ui/desktopAddress.ts; plan says loopback | Partly matched | O11 (R3.6) | O11: no default-off or teardown rule for the loopback server on a phone. Shared address, typed code and fixed port are not raised |
| S-4 | in scope | Stage 4 lists only a 10-minute airplane-mode run; absence follows from plan text | Not found | none | No item on background, process kill or sustained-load testing |
| S-5 | in scope | build-android-apk.sh uses the Android debug key; Stage 5 installs over current APK | Partly matched | S7 (R3.1) | S7 mentions a differing signing key blocking the update, but not that the key exists only in this container. The judge could not check the production key |
| S-7 | in scope | env.sh points into a scratchpad; `dotnet add package` unversioned | Matched | O20, O21 (R3.4, R5.7, R5.8) | O20: fixtures and SDK live in a session scratchpad (env.sh path); O21: SDK patch and package versions are not recorded or pinned |
| S-8 | in scope | Snapshot holds actual APK sizes (about 30 MB vs 33 MB budget) and 0.9.0 measurement notes | Not found | none | N2 flags a different overstatement (hashes vs results). Sizes, "tested", support dates and CoreCLR are not raised |

## Counts

in scope: 28
needs web: 6
needs artifact: 1
Matched: 7 (of which in scope: 7)
Partly matched: 10 (in scope: 9)
Raised, not ruled: 0 (in scope: 0)
Rejected: 0 (in scope: 0)
Not found: 18 (in scope: 12)
Recall strict, all items: 7 / 35
Recall strict, in-scope items: 7 / 28
Recall lenient, in-scope items: 16 / 28
Reviewer-level recall, in-scope items: 16 / 28

## Ledger items ruled Valid or Partly valid that match no key item (unverified extras)

- S4: owner phone rounds (three to four, plus one if the MAUI build fails) are not costed in Section 8.
- S5: Section 3 bars and the Stage 3 gate row are not marked as replaced by Section 10.
- S8: Section 10 names only the ember model; the spread model also draws from the fire stream, so 3b must list every draw site.
- O1: "Under 1.5x the TypeScript" can be read either way.
- O4: Section 7 has no rows for a desktop-only or phone-only Gate 1 fail.
- O5: the order line still shows P3a as pending.
- O6: the Section 8 estimate predates the revisions and has no retry allowance.
- O7: the weekly-budget comparison has no figure or source.
- O12: the offline rule and network-audit specs are not mentioned for the shell or HTTP client.
- O13: the plan does not say it is Android-only; no iOS project exists.
- O14: no licence or attribution check for the shell and new packages.
- O15: battery and thermal are not measured.
- O16: Stage 5 does not list release checks (check-android-apk, check:bundle) to retire or replace.
- O18: Rust or C++ and a Capacitor native module are not considered.
- O19: the origin and saved-data test comes last and cannot stop the work.
- O22: the install route was changed after a refusal, with no recorded owner OK.
- O23: "plan section 4" in Rule 4 is ambiguous within this document.
- N2: Section 10 item 1 "correction" conflates hashes with results.
