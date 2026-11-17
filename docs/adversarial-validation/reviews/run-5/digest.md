Overall call: fix the must-fix items and resend
Checked: read the plan and all 5 reports; opened the cited source and docs; ran wc -l, grep, ls and a node one-liner (1.63x and 1.24x). Could not check the artifact, whether the owner's download rule covers the Linux container, Android WebView loopback rules, or the built app's default tier (taken from the main plan).
Must fix:
- M1 Stage 1 profile and Gate 1 are fast-tier only, but the phone default is the 3-D air (63 to 82 % of compute) (R2.2). Evidence: main plan D2 line 89 and 15e line 1014; fast tier runs DiagnosticWind. Fix direction: profile Standard too, or state the verdict is fast-tier only.
- M2 Gate 1 does not state the TypeScript core count; the 1.5x bar sits below the 1.8 to 2.0x in-TypeScript ceiling (R4.2, R4.1 narrowed). Evidence: plan lines 34, 40; main plan line 1014. Fix direction: state the baseline, add an all-core TypeScript arm or caveat section 7.
- M3 No step asks the owner about downloads; line 25 substitutes a tarball route after a refusal (R1.6, R3.7, R5.6). Evidence: plan line 25, README "SDK" (checksum, not signature); applicability to the container unverified. Fix direction: list each download with source and signature state, get the owner's yes first.
Should fix:
- S1 Raster fallback cannot feed the embers; but the fast tier uses DiagnosticWind, not the 6,260-line port (R1.1). Say what to export, or drop the fallback for embers-on.
- S2 Gate 3 and the "All pass" row omit the "atmosphere deferred" caveat (R2.3). Name the tiers and parts a pass covers.
- S3 Gate 1 has no kernel-to-run step: 1.5x on a 58 % kernel is about 1.24x on the run (R1.2, R4.2). Record kernel share and implied run speed-up.
- S4 No repeat count or margin rule inside the roughly 15 % measured spread (R1.3, R3.3, R5.7). Add a re-run rule.
- S5 Phone half of Gate 1 has no TypeScript baseline and no written wait for the owner's phone (R1.4). Name the baseline, add the wait.
- S6 Fs.Tests is required (line 112) but unowned; C3 owns the thread-count test in Fs.Compare (R1.5). Assign it.
- S7 "Page needs no change" ignores the shell's origin allowlist entry and the cleartext decision (R1.7, R2.5). State both.
- S8 No applicationId or backup step before sideloading and install-over tests (R3.1). Own id per APK; owner exports data first.
- S9 Stage 3 gate names no seeds; seed 11 never fires embers (R5.3). Name seeds 12 and 13 (fixtures exist).
- S10 "Still to run" items have no agent; the 12-run estimate has no retries (R5.5). Assign or mark conditional.
- S11a Stale Vector<T> text (line 40) and bars (line 48) (R1.8, R5.2). S11b Gate 1 wording and split outcomes unclear (R1.8, N2). Fix both.
- S12 In-TypeScript routes (threads, WASM SIMD) unmeasured, so "reopen D34" has no comparator (R4.1, R4.3). Add arms or state it.
Optional:
- O1 Stage 2 does not count received against sent (R3.2). O2 no solver-commit guard in C3 (R3.4). O3 no rollback line (R3.5).
- O4 Stage 4 cadence and memory have no numbers (R3.6). O5 Auto tier not mentioned (R2.1). O6 verdict is Android only (R2.4).
- O7 parity cost with TypeScript not an owner input (R2.6, R5.4). O8 listening socket vs rule 6 (R2.7). O9 ASP.NET vs Node host (R4.4).
- O10 option A not named (R4.5). O11 origin check could move to stage 2 (R5.1). O12 owner go-ahead for stages 0 and 3a not recorded (R5.6).
- O13 owner phone time not priced (R5.8). O14 pairing lockout, close 4426, Desktop detail not in stage 4 acceptance (R2.5).
Rejected:
- X1 timing runs not under the lock (R1.3): README rule 5 lists benchmarks. X2 no fixture regeneration command (R3.4): ts-export/README.md has it.
- X3 stage 4 commits to the origin (R5.1): prototype only. X4 bars loosened without approval (R5.2): proposals; floor measured; embers-on bars unchanged.
- X5 bars compare different tiers (R2.1): fixtures pin the tier. X6 plan never mentions desktop/ (R4.4): line 5 does. X7 ships on iOS (R2.4): no iOS project.
- X8 port is hard to reverse (R5.4): prototype folder. X9 P3a work wasted by a stop (R1.8): already merged. X10 hottest-kernel failure proves nothing (R1.2): fair stop signal.
Own observations:
- N1 Stage 1 lists the 3-D atmosphere solver as a candidate, but the fast-tier profile cannot select it (DiagnosticWind runs instead).
- N2 Section 7 maps any Gate 1 failure to "no speed argument anywhere", which is wrong if only the phone half fails.
Full ruling: C:/Users/lchorley/AppData/Local/Temp/claude/4968719846455d7e/62dbc2cd-27ae-4fdc-a848-1cc1ed2e5298/scratchpad/runD/ruling.md
