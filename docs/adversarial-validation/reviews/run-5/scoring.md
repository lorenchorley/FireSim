| Key id | Scope | Scope reason | Result | Run id | Evidence |
|---|---|---|---|---|---|
| P-1 | in scope | Follows from the plan: no measured phone shortfall is recorded. | Not found | - | No ledger item or report says nothing user-visible has been measured, or that a free stage 0 on the phone could end the question. |
| P-3 | in scope | Follows from the plan: section 7 "All pass -> D34 reopened" has no criteria. | Partly matched | S12, O7 | S12 says "reopen D34" has no comparator, and O7 says D34's reason (two solvers) is not costed in section 7. Neither gives evidence criteria tied to D34's reason. |
| P-4 | in scope | Follows from the plan: the owner's reason for .NET is not recorded. | Partly matched | O9 | O9 says the plan gives no non-speed reason for the ASP.NET host. This is the desktop half only. The owner's goal and the untested shell-only route are not raised. |
| P-5 | in scope | Follows from the plan: B keeps two solvers. | Matched | O7 | O7 (R2.6, R5.4) says the ongoing cost of keeping the C# port in step with the TypeScript solver is missing from section 7, and that D34's reason was two solvers. Same change: record the two-solver cost. |
| P-6 | in scope | Follows from the plan: cheaper routes inside D34 are not compared (WebGPU part unconfirmed). | Matched | S12 | S12 (R4.1, R4.3): in-TypeScript routes (threads, single-thread WASM SIMD) are not measured, so "reopen D34" has no comparator. |
| P-8 | in scope | Follows from the plan: no outcome if phone numbers never return. | Matched | O13 | O13 (R5.8): owner phone time is not priced and there is no rule if the numbers are late. |
| G-1 | in scope | Gate 1 design is visible in the plan. | Matched | M2 | M2 (R4.2): Gate 1 does not state the TypeScript core count, and compares all-core C# with what is read as single-thread TypeScript. |
| G-2 | in scope | Gate 1 bars against 15e's threshold, both in the snapshot. | Matched | S3, M2 | S3: Gate 1 is on one kernel with no kernel-to-run step (1.5x on a 58 % kernel gives about 1.24x). M2: the bar sits below the 1.8 to 2.0x ceiling recorded in 15e. |
| G-4 | in scope | Auto-tier and fast-tier profile choice is visible in the plan and snapshot. | Matched | M1, N1 | M1 (R2.2): stage 1 profile and Gate 1 are on the fast tier, but the phone's default tier is the 3-D air. N1: the fast-tier profile cannot select the 3-D solver. |
| G-5 | in scope | The absence of a phone TypeScript baseline follows from the plan. | Matched | S5 | S5 (R1.4): the phone half of Gate 1 has no defined TypeScript baseline. Direction names the same kernel in the benchmark APK's JavaScript engine. |
| G-6 | in scope | Kernel match rules follow from the plan and solver sources. | Not found | - | No item says the stage 1 kernel need not match outputs, draw order or thread count. R5.4 and O7 treat the exact random-stream port only as a coupling cost. |
| G-7 | in scope | Absence of a phone protocol follows from the plan. | Partly matched | S4 | S4 (R1.3, R3.3, R5.7) asks for a repeat count and margin rule on noisy timings. It concerns container noise only. big.LITTLE, thermal, warm-up and A-B-B-A are not raised. |
| G-9 | in scope | Debug-build use on the phone follows from the plan. | Not found | - | R3.1 and R5.8 quote "debug builds, sideload" only as context. No finding says Debug builds invalidate phone numbers or may not start. |
| G-10 | in scope | Gate 2 rates and the 16 MB synthetic basis are in plan and snapshot. | Not found | - | No item says the Gate 2 rates are not derived, are desktop-only or were measured with an idle CPU. O1 is about received-equals-sent. |
| N-1 | in scope | 1e-15 evidence and bars are visible in plan and snapshot. | Not found | - | Nothing on the 1e-15 evidence or libm noise at 3600 s. R5 lists the section 10 correction as checked and correct. |
| N-2 | needs web | Rests on .NET and V8 15 libm behaviour outside the snapshot. | Not found | - | Nothing on .NET C runtime maths against V8 LLVM libc. |
| N-4 | in scope | JS-vs-C# traps follow from the plan plus solver sources. | Not found | - | No item on float32 arithmetic, rounding, sort, NaN, Map, pow or culture traps. |
| N-5 | in scope | The 12 % 30-seed bar follows from plan and snapshot data. | Not found | - | R5.2 and X4 are about the loosened embers-off 2.5 % bars (rejected). Nothing says the 12 % 30-seed fallback bar is weak. |
| N-6 | in scope | Seed 11 ember behaviour is checkable in the snapshot. | Matched | S9 | S9 (R5.3): the stage 3 gate names no seed set and seed 11 never exercises the embers. Same as the key's narrowed form. |
| N-7 | in scope | Gate 3 duration and site follow from the plan. | Not found | - | Nothing on Gate 3 covering only 30 minutes on one site. S2 is about the atmosphere caveat. |
| N-9 | in scope | Port size is countable from the snapshot. | Not found | - | No item challenges the 25,000-line port figure or says stage 4 needs rewind and explain. R5.5 and S10 take 25,000 as given. |
| N-10 | in scope | Rule 4 against tier auto follows from the plan and snapshot. | Matched | O5 | O5 (R2.1, which cites rule 4 and the wall-clock auto-tune): a faster C# engine would pick different tiers under Auto, which is not mentioned. The ruling gives it a one-line fix. |
| T-1 | needs web | Rests on current Capacitor and WebView transport behaviour. | Not found | - | Nothing on transports (a) and (b) being strings decoded on the main thread, or on missing routes. |
| T-2 | needs web | Rests on whether an ASP.NET Core runtime pack exists for Android. | Not found | - | R2.7 and O8 take the in-app Kestrel server as buildable and only ask for an owner decision on the socket. |
| T-4 | needs web | Rests on container and Android build tooling facts. | Not found | - | R1 lists container disk and builds as "could not check". No finding. |
| T-5 | in scope | The Capacitor bridge dependency is visible in the page sources. | Partly matched | S7 | S7 (R1.7, R2.5) challenges the same "page needs no change" line, for origin allowlist and cleartext. The Capacitor bridge and Preferences are not raised. |
| T-6 | needs web | Rests on Android install-over and origin rules. | Partly matched | S8 | S8 (R3.1): give each test APK its own applicationId and export saved data before an install over the current app. The key and versionCode conditions and the origin correction are not raised. |
| T-8 | needs web | Rests on Android 17 and target SDK 37 platform facts. | Not found | - | Nothing on target SDK 37, the local network permission or the WebView floor. |
| T-9 | needs other source | Rests on Photino.Blazor target frameworks (an artifact the reviewers could not reach). | Not found | - | Nothing on Photino.Blazor. |
| S-1 | in scope | The missing host-parity rule follows from the plan and desktop host sources. | Partly matched | O14, S7 | O14 (R2.5): pairing lockout, close 4426 and the --lan warning are missing from stage 4's acceptance list. This is one part of the composite. No parity rule and no template-defaults point. |
| S-2 | in scope | Loopback protocol 2 issues follow from the plan and protocol sources. | Partly matched | O8, S7 | O8 (R2.7): a listening socket in the phone app needs an owner decision under rule 6. S7: loopback ws:// origin and cleartext. Shared address, typed code and fixed port are not raised. |
| S-4 | in scope | Absence of background, kill and sustained-load tests follows from the plan. | Not found | - | O4 (R3.6) is about stage 4 gate terms with no numbers. No finding on background, process death or a lost link. |
| S-5 | in scope | The signing key location is stated in the plan. | Not found | - | R2 lists the signing key as "could not check". S8 concerns test-APK applicationId and backup, not key custody. |
| S-7 | in scope | Toolchain provenance statements are in the plan. | Partly matched | M3 | M3 (R1.6, R3.7): list each download with its source and signed or checksum-only state. Versions, hashes, unpinned packages and licences are not raised. |
| S-8 | in scope | Overstated claims are checkable against plan and snapshot. | Not found | - | No item on overstated sizes, "tested", support dates or CoreCLR. |

in scope: 28
needs web: 6
needs other source: 1
Matched: 9 (of which in scope: 9)
Partly matched: 8 (in scope: 7)
Raised, not ruled: 0 (in scope: 0)
Rejected: 0 (in scope: 0)
Not found: 18 (in scope: 12)
Recall strict, all items: 9 / 35
Recall strict, in-scope items: 9 / 28
Recall lenient, in-scope items: 16 / 28
Reviewer-level recall, in-scope items: 16 / 28

## Step 3: ledger items ruled Valid or Partly valid that match no key item (unverified extras)

- S1 [Partly valid]: the raster fallback in stage 3b cannot feed the embers (3-D wind, turbulence, coupling).
- S2 [Valid]: Gate 3 and the "All pass" row do not carry the "atmosphere deferred" caveat.
- S6 [Valid]: `Fs.Tests` is required but owned by no agent.
- S10 [Valid]: the 12-run estimate has no retry allowance and the "still to run" items have no owner.
- S11a [Valid, minor]: stale `Vector<T>` text and stale agreement bars remain beside the revisions.
- S11b [Partly valid]: Gate 1's comparison wording is unclear and split outcomes have no row in section 7.
- N2 [Valid, own]: section 7 maps any Gate 1 failure to "no speed argument anywhere", wrong if only the phone half fails.
- O1 [Partly valid]: stage 2 gate does not count pictures received against sent.
- O2 [Partly valid]: no guard that the solver commit equals the fixture's gitCommit.
- O3 [Valid, minor]: no one-line rollback statement.
- O4 [Partly valid]: stage 4 cadence and memory terms have no numbers, and the protocol 2 definition is not linked.
- O6 [Partly valid]: the verdict should say it is for Android only.
- O10 [Valid, minor]: option A is not named in the plan.
- O11 [Partly valid]: the origin and saved-data check could come at stage 2.
- O12 [Valid, minor]: the owner's go-ahead for stages 0 and 3a is not recorded.
