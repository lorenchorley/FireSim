# R1 | plans / Feasibility

### R1.1 The exact RNG port is needed for the spread step, not only the ember model
- Where: Section 10, "**Decision taken for stage 3.** The slice ports the TypeScript random generator and its draw order exactly, so that the tight column applies." Also item 1: "The risk is the ember model's random stream and its draw order."
- Evidence: `src/fire/spread/FireSpreadModel.ts` draws from the same `Rng` it is handed (constructor, line 330, documented as "the fire RNG stream", line 327). Draws are at line 1207 (`zTp` period), line 1504 (breach test `rng.next() < p`), line 1954 (`rng.poisson(lambda)` for debris) and lines 1976 and 1981 (spot-ignition draws). `rollDebris` is called at line 794 only when `mountainOn(env)` holds, not under the ember option. A grep of that file finds no embers flag guarding these draws. Stage 3b's slice is "the grid and spread step" (Stage 3 detail), so an exact stream port is needed even with embers off. The plan names only the ember model as the source of the stream risk.
- Already covered?: no. Section 10 item 1 names only the ember model, and the decision is taken before the 3b dependency map that is meant to decide the slice.
- Severity: should-fix
- Confidence: high
- Suggested change: Have 3b list every consumer of the shared stream in the spread step and the ember model, then take the exact-port decision on that list.

### R1.2 The tight agreement bar rests on a test that does not exercise the ember model's own math
- Where: Section 10 item 1: "So last-bit math differences are not the risk. The risk is the ember model's random stream and its draw order." The tight column then expects "a difference about 0".
- Evidence: The stated test perturbed wind and temperature by 1e-15 over 8 runs. The ember model's own decisions use `Math.exp` and `Math.pow` (`src/embers/EmberModel.ts` lines 455, 560, 601, 612, 667, 956; 33 `Math.exp/pow/log/sin/cos/sqrt` calls in total). The breach test in the spread model (line 1504) compares a draw with a computed probability. A last-bit change in one such comparison flips one draw, and every later draw in the stream shifts. The plan's own 3a data show that changing the seed moves 20 to 50 % of ever-burning cells with embers on. Section 3 said exp, pow and sin last-bit differences would change the hashes. Section 10 reverses that on the strength of the 8-run input perturbation.
- Already covered?: partly. Section 10 gives the 8-run test, but that test does not show that the ember math and the draw comparisons stay in step, which the 1 % bar depends on.
- Severity: should-fix
- Confidence: medium. The flip mechanism is my inference; I did not run it.
- Suggested change: Before the tight column is adopted, run a targeted check: perturb the ember model's `exp` and `pow` by a few ulp and count how many embers and arrival times change over one fixed-seed run. Make the tight column conditional on that result.

### R1.3 The Gate 1 stop rule rests on numbers the plan itself calls indicative, with no quiet-machine run before it
- Where: Stage table, Stage 1 gate: "All-core C# is under 1.5× the TypeScript on desktop, or under 2.0× on the phone". Rule 3: "Container numbers are desktop-class and noisy (4 shared cores, 16 GB) and are labelled *indicative*."
- Evidence: Section 2 says the machine is "4 cores, 16 GB, shared with every agent". Section 10 still lists "timings on a quiet machine" as not run. Gate 1 can end the project ("Gate 1 fails ... Stop", Section 7), yet no step produces quiet-machine desktop numbers before the gate is decided. The threshold wording is also ambiguous: "under 1.5×" should read as "speed-up below 1.5×" if it means stop.
- Already covered?: partly. Rule 3 labels the numbers, but nothing ties a stop decision to a quiet run, so the label does not stop a noisy result from ending the project.
- Severity: should-fix
- Confidence: high
- Suggested change: Require the Gate 1 desktop run to be repeated with other agents idle (under the flock, with the load recorded) before the gate is decided, and write the threshold as "C# speed-up over TypeScript below 1.5×".

### R1.4 Owner phone results are inside the gates but missing from the order, and there is no fallback
- Where: Section 4, "**Order.** ... Gate 1 and Gate 2 are decided together from K1 and T2. If both pass, P3b, then ..." Section 5: "The MAUI Android build in this container is not guaranteed ... If it fails, the agents write exact build instructions and the owner builds."
- Evidence: The Gate 1 phone threshold (2.0×) and all of Gate 2 need the owner's phone (Rule 3: "Phone numbers come only from a phone"). The order has no wait point for phone data and no deadline or default if the owner does not reply or the APK build fails. Rule 6 pauses the run only at a failed gate, so a gate that cannot be decided is neither a pass nor a fail, and the plan does not say what happens to it.
- Already covered?: no. Section 5 lists what the owner must do but not when the run waits or what it does if the owner never answers.
- Severity: should-fix
- Confidence: high
- Suggested change: Add a "waiting for phone" state to the order with its own deadline. Say whether P3b and P3c-e may start before the phone numbers arrive, and what the run does if they do not arrive.

### R1.5 The port size has no stated scope, and the test figure is larger than the solver directories it seems to describe
- Where: Section 7, "the port of the rest of the solver (about 25,000 lines and 15,000 lines of tests by line count)".
- Evidence: Non-test `.ts` lines in `src/fire`, `src/embers`, `src/atmosphere`, `src/fuel`, `src/core` and `src/terrain` total 27,586. Test lines in those same directories total 12,868. A figure of 15,000 test lines for "the rest" is therefore larger than all solver tests in those directories. Either the count includes other directories, such as `src/ui` or `src/sim`, or the figure is wrong. The plan does not say which, and does not subtract the stage 3 slice. Across all of `src/` the counts are 121,506 non-test and 79,856 test lines.
- Already covered?: no. The figure is given with no directory list or counting method.
- Severity: should-fix. The owner decides cost from this figure.
- Confidence: medium. The scope may be defined in a place I did not check.
- Suggested change: Name the directories and the count command, and state the figure after the slice is subtracted.

### R1.6 The order text still schedules P3a after Revision 2 has merged it
- Where: Section 4, "**Order.** S0 first. Then K1 and P3a in parallel with T2 (three agents)."
- Evidence: Section 10 says P3a was merged (as `095caf9`) and delivered 41 fixture folders. `prototypes/dotnet-b/reports/3a-reference.md` line 28 gives the 41 folders. The order line is not updated, and Section 3's bars differ from Section 10's table without a marker showing which governs.
- Already covered?: partly. Section 10 says the change, but the order line still reads as pending.
- Severity: nitpick
- Confidence: high
- Suggested change: Mark P3a as done in the order line, and mark Section 3's bars as replaced by Section 10.

Totals: 6 findings (must-fix 0, should-fix 5, nitpick 1)
Checked and found correct:
- The RNG the plan wants to port is mulberry32 with integer state. `src/core/rng.ts` and `FastRng` in `src/embers/sampling.ts` are the same algorithm, so an exact port is feasible in principle. R1.1 and R1.2 concern scope and proof, not possibility.
- The named files exist with the stated sizes: `FireSpreadModel.ts` 1,991 lines, `EmberModel.ts` 2,271, `atmosphere/solver.ts` 880, `levelSet.ts` present, `e2e/desktop-real.spec.ts`, `desktop/throttle.ts`, `prototypes/dotnet-b/SKILLS.md`.
- `tsconfig.json` `include` lists `src`, `tests`, `e2e`, `desktop` and some root config files, and not `prototypes/`, so Rule 1's claim that the TypeScript gate is unaffected holds for tsconfig.
- The Stage 3a reference (41 folders, the Katoomba 3 km scenario with a 310 m ignition line, seed 11) matches `prototypes/dotnet-b/reports/3a-reference.md`. The 33 MB APK budget matches `docs/plans/0.9.0/CONTRACT-0.9.0.md` (D37).
- The Stage 4 test tools named exist: `desktop/throttle.ts`, `desktop/link.mjs`, `e2e/host-browser.spec.ts` (contains hostile-name checks), `e2e/desktop-cross-origin.spec.ts`.
Could not check:
- The Section 2 environment facts (`builds.dotnet.microsoft.com` answering 200, `dotnetcli.azureedge.net` not, Java present, the refused install script). These depend on the container proxy, which is outside the pack.
- The Section 9 claims about the dotnet/skills content (Microsoft OpenJDK only, `maui-android` and `android` as the Linux workloads). The skills clone is not in the pack.
- Rule 1's claim that the Vitest config excludes `prototypes/`. The snapshot has no vitest or vite config at its root, only `tsconfig.json`. The artifact at claude.ai/artifact/VsrSVEJaknFbyWuQh7Svx9 is not available to me.
Verdict: Fix first
