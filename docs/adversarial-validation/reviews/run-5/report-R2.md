# R2 | plans / Missing requirements

### R2.1 The plan never says how tiers are chosen in the C# engine, although the TypeScript choice is a wall-clock decision.
- Where: prototype plan section 1 rule 4 ("identical results on 1, 2, 4 and 8 threads") and section 3 stage 3 bars ("same tier"). Nothing on Auto. Main plan section 2: "The only wall-clock-dependent decision in the engine is the auto-tune tier choice at start" (`src/sim/simulation.ts:1187`, `autoTuneDecide`).
- Evidence: main plan section 6.2 shows the same 41.1 ms phone reading giving Fast under the old rule and Detailed under the new one. A faster C# engine on the same phone would time lower and pick Detailed where the TypeScript picks Fast. Results would then differ across engines for a reason that is not solver correctness, and the stage 3 bars would compare different tiers.
- Already covered?: no. Rule 4 is about thread count only. Auto, start-up timing and tier selection are not mentioned anywhere in the plan.
- Severity: should-fix
- Confidence: high
- Suggested change: state whether the port keeps Auto, or pins the tier for the gates, and require each result to record the tier chosen and why.

### R2.2 Stage 1 profiles and times the fast tier only, but the phone's default is the 3-D air tier.
- Where: stage 1 detail (line 40): "profiling the TypeScript solver ... on the Katoomba 6 km fast-tier scenario"; gate (line 34): "All-core C# is under 1.5x the TypeScript on desktop, or under 2.0x on the phone".
- Evidence: main plan section 1 row B and section 6.2 make Detailed (Standard and High 3-D air) the phone's default, marked built in 0.3.0 (status line). Main plan section 15e, Measured: the air is 63 % (Standard) and 82 % (High) of compute on the 3-D tiers, while the fast tier's fire is 58 %. The kernel chosen and the gate verdict therefore come from a tier most phones are not set to run by default.
- Already covered?: no. Section 10 point 3 says the tiers are different models, but the stage 1 gate and kernel choice do not use the 3-D tier.
- Severity: must-fix
- Confidence: medium (the default-tier claim rests on the main plan's status and section 6.2, not on a read of the built default setting)
- Suggested change: profile and benchmark the Standard tier as well as Fast, and gate on each tier the phone is expected to run.

### R2.3 "All pass means B is technically feasible" drops the caveat that the slice may skip the atmosphere.
- Where: section 7, row "All pass": "B is technically feasible. The remaining cost is the port of the rest of the solver". Stage 3b (line 46): "the slice may take the TypeScript's own wind rasters as input and defer the atmosphere port; the report then says so."
- Evidence: the atmosphere is the 3-D air that Detailed runs (R2.2). A slice fed by the TypeScript's wind rasters passes gate 3 without running the part that is most of the Detailed cost, so a pass would read as feasibility for a tier that was never ported.
- Already covered?: partly. Line 46 says the report will state the deferral, but gate 3 (line 36) and section 7 do not carry it into the verdict.
- Severity: should-fix
- Confidence: medium
- Suggested change: gate 3's pass line and section 7 should name the tiers and parts the pass covers, for example "feasible for the Fast tier; the air is not ported".

### R2.4 "Practical to ship" is answered for Android only, but the app also ships on iOS.
- Where: section 5 (APKs, phone check-lists), stage 5 ("APK size against 33 MB", "Android 7.0 (API 24) floor"). No iOS in any stage or gate.
- Evidence: README.md, Capacitor section: `@capacitor/ios` is installed, and the iOS app is served from `capacitor://localhost`; desktop/README.md ("The Android and iOS apps") lists the iOS origin in `--allow-app`. The README says an iOS build needs Xcode on macOS, which this container does not have. The plan does not mention iOS, WKWebView, or the macOS build host.
- Already covered?: no.
- Severity: should-fix
- Confidence: high (the omission is clear; the impact on the verdict is a judgement)
- Suggested change: add an iOS line to stage 5 (WebView behaviour, build host needed), or state that the verdict is for Android only.

### R2.5 The desktop-host stage does not list the owner's host features that a C# host would have to keep.
- Where: stage 4 (line 51): "an ASP.NET Core host with the same engine, checked with a variant of `e2e/desktop-real.spec.ts`, the cross-origin and hostile-name specs, and the throttled-link tool"; stage 5 (line 53): "A MAUI shell serves from a different origin."
- Evidence: desktop/README.md describes features the test list does not cover: the 8-character pairing code with lockout after 5 wrong codes (60 s), the 4426 close for other link versions, the Origin allow-list (`--allow-app` for `https://localhost` and `capacitor://localhost`, `--allow-origin`), and the `--lan` no-TLS warning. Main plan D35 adds Desktop detail (finer cells down to 10 m, labelled "finer grid, results differ, not validated", byte-identical when off). D36 has the Android app connect to the desktop. A MAUI shell on a new origin would need that origin added to the host's allow-list, which the plan does not mention.
- Already covered?: partly. Protocol 2 and cross-origin are named. The pairing lockout, the origin list, Desktop detail and the D36 phone link are not.
- Severity: should-fix
- Confidence: high
- Suggested change: list these host behaviours as acceptance items for stage 4, and add the MAUI origin to the allow-list plan.

### R2.6 Keeping a second solver in step with the TypeScript is not costed or gated, though that was D34's reason.
- Where: section 7: "The remaining cost is the port of the rest of the solver"; the agreement bars (section 10) compare against a fixed set of 41 fixture folders.
- Evidence: main plan D34 (line 121) sets the .NET idea aside "because it means maintaining two solvers". The TypeScript solver changes from release to release: D23 says results change with the model, and the 0.9.0 and 0.10.0 plans change the same solver. Nothing in the plan says whether the port is re-checked when the TypeScript changes, how often, or who pays for it.
- Already covered?: no. The only treatment is "D34 would then be reopened by the owner."
- Severity: should-fix
- Confidence: medium
- Suggested change: add the per-release parity cost to section 7 as a decision input for the owner, with the fixture re-run it would need.

### R2.7 Ground rule 6 (offline) is not carried over, and the plan treats a listening socket in the phone app as a measurement.
- Where: stage 2 (c): "a loopback WebSocket from an in-app Kestrel server"; stage 4: "Loopback exposure on a phone (other apps can reach 127.0.0.1) is measured and written up".
- Evidence: main plan section 4 rule 6: no network calls from new code, with two named exceptions (the desktop link and the Android app's typed address). D34: "the phone's own offline engine is unchanged". An in-app Kestrel server opens a listening socket on the phone, which is not one of the exceptions. The plan does not say that the owner must accept it under rule 6.
- Already covered?: partly. The airplane-mode test and the exposure measurement are there. The rule and the owner sign-off are not.
- Severity: should-fix
- Confidence: medium
- Suggested change: state in section 5 that a listening socket in the shipped phone app needs the owner's decision under rule 6, and make the choice between this and the interop route an explicit owner question.

Totals: 7 findings (must-fix 1, should-fix 6, nitpick 0)
Checked and found correct:
- D34 is quoted accurately in section 1 ("What this is not"): the owner's text in the main plan (line 121) says one solver, and the prototype plan keeps it in force.
- Stage 4 names a cross-origin spec: `e2e/desktop-cross-origin.spec.ts` exists in the snapshot.
- Protocol 2 and close code 4426 described in stage 4 match desktop/README.md ("The pairing code" section).
- Rule 4 (thread-count identity) is consistent with main plan rule 1 for thread count; only the tier-choice part is missing (R2.1).
Could not check:
- The "FireSim on .NET" artifact (https://claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9) is not available to me, so claims that rest only on it are unverified.
- The `android/` project is not in the snapshot, so the applicationId and signing key needed for an in-place APK update could not be checked.
- Whether the built app's default is Detailed on phones today: taken from the main plan's status line and section 6.2, not from the code's default setting.

Verdict: Fix first.
