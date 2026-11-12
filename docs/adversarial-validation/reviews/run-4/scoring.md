# Scoring of runC against the option-b-plan answer key

Scope was copied from SCOPE_PATH (28 in scope, 6 needs web, 1 "needs artifact", counted below as "needs other source"). Step 1 was written to this file before `ruling.md` and the reports were opened.

## 1. Table

| Key id | Scope | Scope reason | Result | Run id | Evidence |
|---|---|---|---|---|---|
| P-1 | in scope | Absence of a measured phone shortfall follows from the plan alone | Not found | | No ledger item or report says nothing user-visible has been measured or proposes a free first step on the owner's phone |
| P-3 | in scope | "All pass reopens D34" criteria gap follows from plan text and D34 in the snapshot | Partly matched | S12 (R4.4) | S12 quotes section 7 "D34 would then be reopened" and ties it to D34's reason (two solvers), but asks only for a cost line in the report, not evidence criteria for reopening |
| P-4 | in scope | Owner goal unrecorded and shell-only route untested are visible in the plan | Partly matched | O3 (R4.3) | O3 asks whether MAUI/shell options were weighed (Capacitor plus native library); no item says the owner's reason for .NET is unrecorded or tests a shell-only route |
| P-5 | in scope | Two-solver consequence follows from the plan and the repo layout | Partly matched | S12 (R4.4) | S12 covers the ongoing two-solver cost (bars re-run on each TypeScript change) but not the surfaces that keep TypeScript for good (browser, PWA, Continue on this device) |
| P-6 | in scope | Cheaper routes inside D34 can be named from the plan alone | Matched | O4 (R4.2) | O4: WebAssembly and worker threads left open by D34 are not weighed against C#; direction says a pass must not rule out cheaper in-TypeScript routes |
| P-8 | in scope | Missing no-numbers outcome and opportunity cost follow from the plan | Partly matched | O7b (R3.7) | O7b: no end state if phone numbers never arrive (first half); nothing on the cost against 0.9.0 |
| G-1 | in scope | All-core C# vs one-thread TypeScript is visible in gate 1 text | Matched | M2 (R4.1) | M2: Gate 1 compares all-core C# with one-thread TypeScript, threads alone could pass it |
| G-2 | in scope | Bars against 15e's "not worth starting" are in README and the plan | Not found | | No item compares the 1.5x/2.0x bars with the repository's own threshold; M2 uses Amdahl estimates, a different point |
| G-4 | in scope | Auto builds Standard while stage 1 profiles Fast: both in snapshot | Partly matched | O5 (R4.5) | O5 cites the existing profile (fast tier, 3-D air 63 % and 82 %) but its defect is "already profiled", not "wrong tier profiled"; direction does not switch the tier |
| G-5 | in scope | No TypeScript phone baseline is visible in the plan | Matched | S3 (R2.7) | S3: the phone half of Gate 1 has no TypeScript comparator on the phone; proposes the in-app speed test |
| G-6 | in scope | Kernel output/RNG/thread identity follows from the plan and source | Matched | S5 (R1.2) | S5: Parallel.For form cannot keep RNG draw order; the draw-exact decision caps the speed-up (embers, fire draws) |
| G-7 | in scope | Absent phone protocol is visible in the plan | Partly matched | O16 (R2.7, R2.4) | O16: rule 3 omits thermal state, power mode, WebView version; no big.LITTLE, fixed partition, warm-up or A-B-B-A |
| G-9 | in scope | Debug builds on the phone follow from the plan text | Not found | | O15 (R2.3, R5.1) names the debug APKs but only on signing and delivery; no item says numbers from Debug builds mislead or that the APK may not start |
| G-10 | in scope | Gate 2 rates and 16 MB synthetic are in the plan and studies | Not found | | R1 lists the 6.5 MB/2.2 MB/27 MB/s figures as "found correct"; no finding on rate derivation or idle CPU |
| N-1 | in scope | 1e-15 evidence and libm noise follow from the plan and snapshot tests | Not found | | No item on the tolerance evidence or libm-sized noise at long durations |
| N-2 | needs web | Rests on .NET CRT vs V8 15 libc facts outside the snapshot | Not found | | No item on cross-platform maths determinism |
| N-4 | in scope | JS vs C# semantic traps follow from the source in the snapshot | Not found | | R1 notes mulberry32 and Math.log/cos only as "checked"; no finding on float32, round, sort, NaN, pow traps |
| N-5 | in scope | 12 % 30-seed bar weakness follows from plan and data | Matched | S9 (R3.4) | S9: the loose bar has little power (cv 19 to 27 %, 12 % is two standard errors, 10 % off passes about 63 %) |
| N-6 | in scope | Seed 11 ember coverage can be checked in the snapshot | Not found | | No item on which seed or scenario exercises ember ignition |
| N-7 | in scope | Gate 3 covering 30 minutes on one site is in the plan | Not found | | No item on gate 3 duration or site coverage |
| N-9 | in scope | Port size can be counted from the snapshot sources | Not found | | The judge's line count (26,005 plus 14,098) only corroborated the plan's 25k/15k; no finding on 30,000 to 38,000 lines or on rewind/explain |
| N-10 | in scope | Rule 4 against tier auto follows from plan text and source | Partly matched | N2 (own) | N2 is about rule 4's wrong cross-reference and the thread-count wording, not the conflict between identical results and the wall-clock tier `auto` |
| T-1 | needs web | Transport costs rest on current Capacitor/WebView behaviour | Not found | | No item on string decoding on the main thread or missing transports |
| T-2 | needs web | Absence of an ASP.NET Core Android runtime pack is an external fact | Not found | | S2 and O12 concern loopback prerequisites and exposure, not the in-app Kestrel feasibility |
| T-4 | needs web | Container APK build feasibility rests on external tooling facts | Not found | | The plan's own concession (section 5) was not raised as a finding |
| T-5 | in scope | The page's dependence on Capacitor's bridge follows from the plan and the page source | Matched | S1 (R2.1) | S1: "the page needs no change" ignores Capacitor use in 9 non-test files (http, location, prefs, desktop); prefs returns null off native |
| T-6 | needs web | Origin and install-over rules rest on Android/Capacitor behaviour | Partly matched | O6 (R5.5) | O6 covers the saved-data origin loss and its late, informational placement, not the same-id/key/versionCode install-over rules |
| T-8 | needs web | Target SDK 37 and Android 17 permission are current platform facts | Partly matched | O11 (R2.8) | O11 covers the WebView 108 floor only; nothing on target SDK 37 or the local network permission |
| T-9 | needs other source | Photino.Blazor target frameworks live in an artifact the reviewers could not reach | Not found | | No item on Photino.Blazor |
| S-1 | in scope | Host-parity rule absence follows from the plan and desktop host source | Matched | O2 (R2.5) | O2: host behaviours (Host allowlist, lockout, open link, admission, frame limit) not carried into "protocol 2 met"; direction maps each to a test |
| S-2 | in scope | Loopback shared address, typed code, fixed port follow from the protocol in the snapshot | Partly matched | O12 (R3.3) | O12: a loopback socket reachable by other apps exists from stage 2; no item on the shared address, typed code or fixed port of protocol 2 in-app |
| S-4 | in scope | Missing background/kill/sustained-load test follows from the plan | Matched | O1 (R2.4) | O1: backgrounding, process death and thermal state are in no gate; adds a screen-off check to stage 4 |
| S-5 | in scope | Signing key only in the container is stated in the plan | Partly matched | O15 (R2.3, R5.1) | O15 asks how sideloaded APKs are signed and delivered; no item says the key exists only in the container or affects install-over |
| S-7 | in scope | Toolchain provenance only in logs is stated in the plan | Partly matched | S7 (R1.8, R3.2, R5.6) | S7: toolchain and fixtures sit in another session's scratchpad paths (env.sh), no manifest; fix is about fixtures, not toolchain version and licence records |
| S-8 | in scope | Overstated sizes and "tested" can be checked against the snapshot | Not found | | R1/R2 list the 33 MB budget and sizes as "found correct"; no item on overstated statements |

## 2. Counts

- in scope: 28, needs web: 6, needs other source: 1
- Matched: 8 (of which in scope: 8)
- Partly matched: 12 (in scope: 10)
- Raised, not ruled: 0 (in scope: 0)
- Rejected: 0 (in scope: 0)
- Not found: 15 (in scope: 10)
- Recall strict, all items: 8 / 35
- Recall strict, in-scope items: 8 / 28
- Recall lenient, in-scope items: 18 / 28
- Reviewer-level recall, in-scope items: 18 / 28

## 3. Ledger items ruled Valid or Partly valid that match no key item (unverified extras)

- M1: downloads of toolchains with no owner approval step, antivirus rule ignored, second route after a refusal
- S2: loopback ws:// from the MAUI page has cleartext, mixed-content and origin prerequisites
- S4: Gate 1 can stop the plan on indicative shared-machine numbers with no margin or re-measure rule
- S6: Fs.Tests has no owner and the thread-count test is placed twice
- S8: 30-seed ensembles and quiet-machine timings have no stage, owner or cost
- S10a: "cannot be reproduced bit for bit" has no test and no decision point
- S10b: switching to the loose bar needs the owner's approval or a second report row
- S11: Gate 2 passes on any transport but stage 4 builds the loopback route regardless
- S13: the plan is silent on iOS
- S14: section 8 omits owner phone round trips, retries and compute for ensembles
- N1: section 2 says the SDK is not installed; section 9, env.sh and README say it was
- O7a: desktop-only parts of Gates 1 and 3 could run while phone results are pending
- O8: the heavy-work lock serialises the parallel stages for heavy steps
- O9: no target branch or stage undo is named
- O10: Gate 1 wording ambiguous between time ratio and speed ratio
- O13: fixture meta.gitCommit predates the exporter commit
- O14: the airplane-mode run names no scenario
