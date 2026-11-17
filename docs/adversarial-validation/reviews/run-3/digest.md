Overall call: fix the must-fix items and resend
Checked: read plan and 5 reports; ran greps (plan terms, RNG sites, rule 4 target), line counts, SE arithmetic, 3a report reads; not checked: artifact, dotnet/skills clone, container facts, Vitest config, production app ID.
Must fix:
- M1 Gate 1 names no TypeScript baseline (threads, one core or all) (raised by R4.1). Evidence: plan l.34/40 silent; master plan 15e l.1014 gives 1.8-2.0x on 4 cores for the fire step, so a parallel split alone clears 1.5x.
  Fix direction: state the baseline, report per-core and all-core ratios, say what a pass may claim against D34's in-TypeScript routes.
Should fix:
- S1 Add a worker-split TypeScript arm of the same partition to Stage 1 (R4.1). Full WebAssembly/WebGPU arm is not needed for a gate.
- S2 Gate 1 verdicts rest on indicative container numbers, no repeat or quiet-run confirmation (R1.3, R3.3). Add a confirmation rule; Rule 6 already pauses for the owner.
- S3 Section 4 does not say P3b waits for phone numbers, nothing covers owner silence (R1.4, R5.4). State the wait and the default.
- S4 Owner phone rounds (3 to 4, +1 if MAUI build fails) not costed in Section 8 (R5.3). Add rounds and owner time.
- S5 Section 3 bars and Stage 3 gate row not marked as replaced by Section 10 (R3.7, R1.6). Mark them and point to Section 10.
- S6 Recurring cost of two solvers, and whether B keeps the TypeScript solver, not stated (R2.4, R4.4). Add parity upkeep and owner to the report.
- S7 Stage 5 install over the current APK can wipe saved data (R3.1, narrowed). Separate app IDs for test APKs; export or spare phone first.
- S8 Section 10 names only the ember model; spread model also draws on the fire stream (R1.1, narrowed; streams are separate). 3b lists every draw site.
Optional:
- O1-O3 Gate 1 direction wording, D39 2-2.6x figure, no absolute speed target (R1.3, R2.5, R3.3); O4 no mixed-outcome rows (R4.5).
- O5-O8 P3a still pending in order, stale Section 8 estimate, unsupported budget claim, size figure scope (R1.6, R5.1, R5.2, R1.5).
- O9-O11 targeted ulp check, 12 % bar power (SE of difference 4.9-7.0 %), loopback containment (R1.2, R3.2, R3.6).
- O12-O16 offline audit, iOS scope, licences, battery, release checks for a replacement (R2.1, R2.2, R2.3, R2.7, R2.8).
- O17-O19 alternatives not named, Rust/C++/native module, origin test ordering (R4.2, R4.3, R5.5).
- O20-O23 scratchpad durability, version pinning, install route after refusal, ambiguous "plan section 4" (R2.6, R3.4, R5.7, R5.8, R3.5, R5.6, R3.8).
Rejected:
- X1 Dangling rule 4 reference (R3.8): resolves to master plan Section 4 ground rules 1 and 2.
- X2 env.sh other session's folder (R3.4): authoring session's, has reinstall note. X3 Regeneration uncosted (R5.7): about 1 minute.
- X4 No fallback for Android build failure (R1.4): Section 5 gives one. X5 Compute hours, RNG port biggest item (R5.1): 3a gives seconds per run.
- X6 Perturbation test misses ember math (R1.2): embers-on seeds 11-14 included, no ember decision flipped. X7a 3.4 SE arithmetic (R3.2): it is 1.7-2.4 SE of the difference. X7b Not put to owner (R3.2): it is in the plan.
Own observations:
- N1 Stage 1 phone gate has no stated way to time the TypeScript on the same phone; repo has a speed-test harness (src/ui/speedTest*.ts) the plan ignores.
- N2 Section 10 item 1 calls a "correction" what 3a confirms: hashes did change in perturbed runs; only results are insensitive.
Full ruling: /tmp/claude-0/-home-user-FireSim/87003abe-40a8-5b42-ac05-c1f8b4f0083f/scratchpad/run3/ruling.md
