# Scoring of run3 against the answer key

Step 1 (scope) was decided from the key, the plan and the snapshot before ruling.md and the reports were opened.

| Key id | Scope | Scope reason | Result | Run id | Evidence |
|---|---|---|---|---|---|
| P-1 | in scope | Plan has no measured phone shortfall; README says releases "not seen on a phone"; 15e holds desktop numbers. | Partly matched | O3 | O3 (Partly valid) says "fast enough" has no absolute target; it does not say a free phone measurement could end the question. |
| P-3 | in scope | Plan section 7 "All pass ... D34 reopened" gives no criteria; follows from plan text. | Partly matched | S6 | S6 (Valid) says the "All pass" row omits the recurring cost D34 was set for; it does not ask for reopening criteria. |
| P-4 | in scope | Plan never records why the owner wants .NET; follows from plan text. | Partly matched | O17 | O17 (Partly valid) says the plan names no alternatives to B and why B beats them; the owner's goal and the shell-only route are not named. |
| P-5 | in scope | Plan sections 3, 4, 7 keep the TS host and add a C# solver; D34 text says one solver. | Matched | S6 | S6: the plan does not say whether B keeps the TypeScript solver for web and desktop, which decides whether there are two solvers. |
| P-6 | in scope | Missing comparison follows from plan; 15e/research 09 in snapshot list WASM, SAB, WebGPU (platform specifics need web). | Matched | S1 (M1) | S1 (Partly valid): add a worker-split TS arm; WASM/WebGPU arm declined as beyond a gate, consistent with the key's "WebGPU unconfirmed". |
| P-8 | in scope | Section 7 has no row for phone numbers never arriving; cost against 0.9.0 follows from section 8. | Partly matched | S3 | S3 (Partly valid): "nothing covers a phone result that never arrives"; the opportunity cost against 0.9.0 is not raised (O7 only asks for a source for the budget claim). |
| G-1 | in scope | Gate says "all-core C#"; snapshot shows TS runs one worker thread. | Matched | M1 | M1 (Valid): Gate 1 names no TS baseline; all-core C# against one-thread TS clears 1.5x by threads alone. |
| G-2 | in scope | 15e in snapshot says threads/WASM/WebGPU "not worth starting" at about 2 to 2.6x; plan bars are 1.5x/2.0x. | Partly matched | O2 (M1) | O2 and M1 cite the 15e/D39 2 to 2.6x and Amdahl figures as the comparison; neither says the bars sit at or below "not worth starting", and kernel vs whole step is not raised. |
| G-4 | in scope | Plan profiles the fast tier; README says Balanced/Auto picks another tier. | Not found | | |
| G-5 | in scope | Plan has no TS phone baseline; snapshot holds `speedTestKernels.ts`. | Matched | N1 | N1 (Valid): no method to time the TS on the phone; cites `speedTest.ts` and the frozen kernels. |
| G-6 | in scope | Stage 1 states no output, draw or thread equivalence for the kernel; embers/RNG in section 10. | Not found | | S8 is about stage 3 draw sites, not the stage 1 kernel contract. |
| G-7 | in scope | Section 5 has no phone measurement protocol; follows from plan text. | Not found | | S2 concerns repeat rules for container numbers, not a phone protocol (big.LITTLE, thermal, warm-up). |
| G-9 | in scope | Section 5 says "debug builds, sideload"; effect on timing follows from plan (start-up failure is a platform fact). | Not found | | R3.1 quotes "debug builds" only for the saved-data wipe. |
| G-10 | in scope | Stage 2 rates asserted; 0.9.0 sizes and README wire-size table in snapshot. | Not found | | |
| N-1 | in scope | Section 10 item 1 and `reports/3a-*.md` hold the 1e-15 result. | Matched | O9 | O9 (Partly valid): perturbation changes inputs, not libm; a targeted few-ulp check would add evidence. |
| N-2 | needs web | Rests on .NET CRT vs V8 15 LLVM libc behaviour, outside the snapshot. | Not found | | |
| N-4 | in scope | JS/C# semantic traps can be checked against TS source in the snapshot. | Not found | | |
| N-5 | in scope | Section 10 table and 3a reports hold the 12 %, cv and 30-seed figures. | Matched | O10 | O10 (Partly valid): the 12 % ensemble bar has low power and was set before the ensembles ran; it is a fallback bar. |
| N-6 | in scope | Section 10 item 2 says seed 11 has no effective spot fire; gate names no seed. | Not found | | |
| N-7 | in scope | Plan states 900 s and 1800 s on Katoomba only; follows from plan text. | Not found | | |
| N-9 | in scope | Line counts can be made from `src/`; plan says 25,000 plus 15,000; rewind and explain are in the snapshot. | Partly matched | O8 | O8 (Valid but minor): port-size figure has no scope or method; the judge found it reproducible, and rewind/explain and 30,000+ lines are not raised. |
| N-10 | in scope | Rule 4 vs tier auto-tune (wall-clock) documented in README. | Not found | | R3.8/O23 concerns the "plan section 4" cross-reference, a different defect. |
| T-1 | needs web | Rests on BlazorWebView/HybridWebView encoding and main-thread behaviour. | Not found | | |
| T-2 | needs web | Rests on absence of an ASP.NET Core runtime pack for Android. | Not found | | |
| T-4 | needs web | Rests on MAUI/Android host support and a build log outside the snapshot; plan already says "not guaranteed". | Not found | | X4 rejected only the "no fallback" claim. |
| T-5 | in scope | `src/` imports Capacitor (`prefs.ts`, `desktopHost.ts`); "page needs no change" is checkable. | Not found | | O16 notes release checks are Capacitor-specific; that is not the page's bridge dependency. |
| T-6 | needs web | Rests on MAUI WebView origin and Android install-over rules. | Partly matched | S7 | S7 (Partly valid): install over the current APK; if the signing key differs Android refuses it; separate app ID needed. Origin direction and versionCode not raised. |
| T-8 | needs web | Rests on Android 17 / target SDK 37 / WebView floor facts. | Not found | | |
| T-9 | needs artifact | Photino.Blazor appears only in the artifact. | Not found | | |
| S-1 | in scope | Desktop host guards and tests are in `desktop/` and `src/sim/remote`; plan has no parity rule. | Not found | | O11 is about phone loopback containment, not host-security parity or template defaults. |
| S-2 | in scope | Protocol 2 and pairing code in snapshot; stage 4 mentions loopback exposure. | Partly matched | O11 | O11 (Partly valid): no default-off, teardown or exclusion rule for the loopback server on a phone; shared address, typed code and fixed port not raised. |
| S-4 | in scope | Stage 4 is a 10-minute foreground run; absence of background/kill test follows from plan text. | Not found | | O15 (battery, thermal) is a different defect. |
| S-5 | in scope | README says the current APK is signed with the debug key built in this container; plan stage 5 installs over it. | Not found | | S7 assumes the key may differ; it does not say the key exists only in the container. |
| S-7 | in scope | `env.sh` points at a scratchpad path; plan keeps provenance in logs. | Matched | O20, O21 | O20 (Partly valid): SDK and fixtures live in a session scratchpad; O21: SDK and package versions not recorded in results. |
| S-8 | in scope | Sizes (33 MB, 6.5 MB, 16 MB) and "tested" can be checked against the snapshot; support dates need web. | Not found | | N2 is a different overstated statement (hashes vs results). |

in scope: 28
needs web: 6
needs artifact: 1
Matched: 7 (of which in scope: 7)
Partly matched: 8 (in scope: 7)
Raised, not ruled: 0 (in scope: 0)
Rejected: 0 (in scope: 0)
Not found: 20 (in scope: 14)
Recall strict, all items: 7 / 35
Recall strict, in-scope items: 7 / 28
Recall lenient, in-scope items: 14 / 28
Reviewer-level recall, in-scope items: 14 / 28

## Step 3: ruled Valid or Partly valid, matching no key item (unverified extras)

- S2: Gate 1 verdicts rest on indicative container numbers with no repeat or confirmation rule.
- S4: owner phone rounds (three to four, plus one if the MAUI build fails) are not costed in section 8.
- S5: section 3 bars and the Stage 3 gate row are not marked as replaced by section 10.
- S8: section 10 names only the ember model; the spread model also draws on the fire stream, so 3b must list every draw site.
- O1: "under 1.5x the TypeScript" can be read either way (direction of the ratio).
- O4: section 7 has no rows for a desktop-only or phone-only Gate 1 fail.
- O5: the order line still shows P3a as pending.
- O6: section 8 estimate predates the revisions and has no retry allowance.
- O7: "large use of the weekly budget" has no figure or source.
- O12: offline rule and network-audit specs are not mentioned for the shell or HTTP client.
- O13: plan does not say it is Android-only; no iOS project exists.
- O14: no licence or attribution check for the shell and new packages.
- O15: battery and thermal are not measured.
- O16: stage 5 does not list release checks (check-android-apk, check:bundle) to retire or replace.
- O18: Rust or C++ and a Capacitor native module are not considered.
- O19: origin and saved-data test comes last and cannot stop the work.
- O22: install route changed after a refusal; no recorded owner OK.
- O23: "plan section 4" in Rule 4 is ambiguous within this document.
- N2: section 10 item 1 "correction" conflates hashes with results.
