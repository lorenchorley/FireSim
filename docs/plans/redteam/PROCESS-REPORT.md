# How the red team of the option B plan was run: a process report (2026-11-12)

This is an account of the adversarial review run on the option B prototype plan: what was built, what each agent did and why, how the work was structured, what it found, what worked, what did not, and what I would change. It is written for the owner and for anyone who wants to reuse the process on another plan. The results themselves are in section 4 of `docs/plans/dotnet-option-b-redteam.md`; the plan changes are in section 11 of `docs/plans/dotnet-option-b-prototype.md`; every report, brief and verdict is kept unedited in this folder.

"I" is the orchestrator: the main session, which also wrote the plan under attack.

## 1. Summary

**What was asked.** "Build an adversarial set of agents to try to break this plan, make sure they do research … research how to do this effectively before starting your design." Then: a detailed report on the process.

**What was built.** A three-stage review:
1. **Stage A.** Seven isolated red teams, each with a different lens, each doing its own web research. Six attacked the plan. One designed its own plan without seeing ours.
2. **Stage B.** Their 55 findings were merged into 35 anonymised claims, mixed with planted true and false control claims, and checked by ten verifiers. Each batch had one Sonnet and one Opus verifier, told to form their own answer from sources before reading each claim.
3. **Stage C.** I tallied the verdicts, compared the blind plan with ours, revised the plan, corrected the artifact and committed the record.

**What it found.** None of the 35 findings was refuted.
- Both verifiers confirmed 18 of them.
- 8 were confirmed by one verifier and judged "partly" by the other.
- 9 were judged "partly" by both: true in a narrower form than stated.

The most decision-relevant finding was raised independently by four teams. The plan never asked what the owner wants .NET for, and never checked whether today's app is too slow on the owner's phone. One measurement on the phone with the current app could end the whole prototype before any porting. Other findings that change the plan:
- Gate 1 compared all-core C# with one-thread TypeScript, which threads alone could pass.
- The phone half of Gate 1 had no TypeScript number to divide by.
- The phone numbers would have come from Debug builds.
- The "in-app Kestrel" server cannot be built on Android.
- "The page needs no change" is false, because the page uses Capacitor's native plugins.
- The C# host had no rule to be as strict as the Node host.
- The APKs on the owner's phone can only be updated with a key that exists in one container.
- One of my own earlier statements, "last-bit maths turned out not to matter (tested)", rested on a test that never reached the solver.

**The three lessons I would pass on.**
1. **Isolation and a blind team are worth their cost.** The blind team, which never saw the plan, arrived at most of the important gaps on its own. That is the best evidence available here that the other teams were not just echoing the hypotheses in their briefs.
2. **Verification earns its keep by narrowing, not by voting.** No finding was thrown out, but the verifiers narrowed 17 of the 35 and caught three errors that came from my own briefs. They also produced new evidence: they re-ran experiments, measured costs and checked signatures.
3. **Several controls I designed were weaker than they looked.** The planted controls were too easy. "Answer first" was not enforced. The tie rule had a hole. Reasoning effort differed between the two model families by accident. Section 9 gives the fixes.

## 2. The context, and why it shaped the design

- **What was under attack.**
  - A staged prototype plan, about to be built by Sonnet agents, for porting FireSim's TypeScript solver to C#: MAUI on a phone, ASP.NET Core on a desktop.
  - An HTML artifact that the owner had read.
  - The premise behind both: that such a port is worth testing.
- **Decision D34** (one solver, in TypeScript) was in force. The plan said it would stay in force until the owner changed it.
- **Who decides.** One owner, who reads on a phone, can sideload APKs and paste numbers back, and does not run code. Phone feedback in this project has been rare: phone check-lists 5 and 6 are not done, and releases 0.3.0 to 0.8.0 are "not seen on a phone".
- **The environment.**
  - One cloud container: 4 shared cores, 16 GB, no `/dev/kvm` (so no Android emulator), a fixed disk allowance.
  - A proxy that lets through Microsoft, NuGet, Google and GitHub.
  - Several agents may run at once and share the scratchpad.
- **A conflict of interest.** I wrote the plan, and I designed and ran its review. The design had to make it hard for me to steer the outcome. Hence the isolation, the anonymisation, the independent verifiers, and keeping the raw reports unedited.
- **Budget.** The owner uses a weekly agent budget. The plan itself expected 10 to 12 agent runs. A review that cost as much as the plan would need to save at least that much.

## 3. Timeline (UTC, 2026-11-12)

| Time | Event |
|---|---|
| 06:13:18 | The owner asks for the adversarial agents |
| 06:13:28 to 06:13:30 | Four web searches in parallel on how to do this well (section 4) |
| 06:15:14 | Design document written (`docs/plans/dotnet-option-b-redteam.md`, sections 1 to 3) |
| 06:15:38 | Shared rules for the teams written (`teams/COMMON.md`); design committed as `05795ff` |
| 06:15:51 to 06:16:37 | Seven red teams launched, in the background, each in its own git worktree |
| 06:21:51 | R4 (status quo) returns, after 5.6 min |
| 06:24:08 | R2 (method) returns, after 8.2 min |
| 06:27:13 | R7 (blind) returns, after 10.6 min |
| 06:29:49 | R6 (pre-mortem) returns, after 13.3 min |
| 06:30:14 | The owner switches the session to Opus 5.5 and asks for this report |
| 06:31:37 | R1 (platform) returns, after 15.8 min. Its disk finding leads me to clean the container (section 6.1) |
| 06:34:04 | R5 (security and operations) returns, after 17.7 min |
| 06:43:59 | R3 (port fidelity) returns, after 27.9 min |
| 06:44 to 06:49 | Merge: 55 findings into 35 items, five batches, two controls per batch, the private key, the verifier rules |
| 06:49:09 to 06:49:41 | Ten verifiers launched |
| 06:52 to 07:06 | Verifiers return: P-S first (3.0 min), N-O last (17.0 min) |
| about 07:00 | My own context is compacted mid-stage B. The work continues from files (section 8) |
| 07:01 | One agent checks the citations behind the design (section 4) |
| 07:00 to 07:09 | Plan revision 3 drafted while the last verifier ran; artifact version 3 published; tally completed; record committed as `e75f123` at 07:09 |

From the request to verified results took 53 minutes. Stage A took 28 minutes, held up by the slowest team, and stage B 17 minutes, likewise.

## 4. The research step, and how good it was

The owner asked for research before design. I ran four web searches at once:
1. multi-agent LLM debate, adversarial critics, sycophancy and the limits of self-critique;
2. pre-mortem and prospective hindsight (Klein; Mitchell, Russo and Pennington);
3. how to run a red team on a technical plan, assumptions and falsification;
4. LLM-as-judge: several critics, verification steps, false positives.

From the results I took six principles. Each changed something in the design (section 5):
- debate breeds conformity, so isolate the teams;
- the gain comes from voting, not discussion, so settle findings by independent verification;
- identity bias, so anonymise;
- a premortem raises the number of reasons, not their quality, so require evidence;
- red-teaming doctrine works on assumptions and ends in actions, so add an assumptions register and require a plan change per finding;
- judges from one family share blind spots, so use two families, answer first, a tie rule and planted calibration items.

**How good the research was.** Honestly, thin.
- Four searches in about two minutes, and I designed from search summaries without opening a single source.
- Afterwards I had one agent fetch each citation, and checked one result myself:
  - **The debate paper** (*The Cost of Consensus*, arXiv 2605.00914) supports conformity, lower accuracy and a token cost of 2.1 to 3.4 times. It does **not** say that most of debate's gain comes from majority voting. I had attributed that claim to it from a search summary, so the claim is unsourced in this design.
  - **The conformity and identity-bias papers** (arXiv 2609.18998 and 2510.07517) support what I said. The identity-bias paper tests anonymisation directly.
  - **The premortem source** (a course-notes page, now at corporate.jcx.au) supports "about 30 % more reasons". It also says the quality of the reasons was not assessed, which I had noted.
  - **The multi-judge paper** (arXiv 2609.12002) partly supports me. Its calibration needs no labels, and it reports no false-pass rates.
  - **One practitioner blog link** now redirects to an unrelated product page.
  - **The UK Ministry of Defence Red Teaming Handbook** (3rd edition, June 2021) supports the assumptions check. Its "assumptions review" asks, for each assumption, how valid it is and how confident we are, then rates each one. The checking agent reported this PDF as "the wrong document". I opened the file: it is the handbook, so the checker was wrong. Checkers need checking too.

The design survived the check: none of its choices rested only on the unsourced claim. But a design that cites research should have read the research. Next time I would open the primary sources first, and give the method itself a quick red-team before spending on it.

## 5. The design

| Principle | Mechanism | Why |
|---|---|---|
| Independent judgement | Seven teams, no shared output, no debate round; each in its own git worktree; told not to look for other reports | Debate breeds conformity, and independent samples are what make agreement meaningful |
| Different failure modes need different eyes | One lens per team: platform, method, port fidelity, status quo, security and operations, pre-mortem, blind | One reviewer misses whole classes of defect. Each lens had starting points, not limits |
| Guard against anchoring on my plan | R7 never saw the plan: it designed its own, and its gaps against ours count as findings | A blind design is the only control for "the teams agreed because the briefs led them" |
| Evidence over opinion | A fixed finding format: a falsifiable claim, evidence (URL with date and quote, file:line, or command output), the plan change, a steelman ("already covered?"), severity and confidence. At most eight findings; "no finding" is acceptable | Makes findings checkable, and stops padding |
| Research, as the owner asked | At least 12 distinct lookups per team; primary sources first; secondary sources only to find primary ones; dates on everything; .NET 11 and Android facts looked up, not remembered | The models' training predates .NET 11 GA (2026-11-10) |
| Assumptions, not just defects | R6 built an assumptions register (criticality, evidence status, cheapest test) | Red-teaming doctrine; many plan failures are unexamined assumptions |
| Settle findings by verification | Two verifiers per finding, one Sonnet and one Opus; anonymised (no team, no lens); grouped by topic | Two families have fewer shared blind spots; anonymity removes identity bias |
| Verifiers think before they judge | For each item, investigate the question from sources and write an answer before reading the claim | Reduces agreement with whatever the claim says |
| Calibrate the verifiers | In every batch, one planted true claim and one planted false one, unlabelled. A verifier that confirms the false one is discounted | Detects a rubber stamp |
| No silent tie-breaking by the author | A finding stands if both verifiers confirm, or one confirms and one says partly. Splits are reported, not decided by me | The orchestrator wrote the plan |
| Keep the record | Every report and verdict kept unedited; corrections live in the verifier outputs and the results section | Lets anyone audit the synthesis |

**Models and effort.**
- **Sonnet** went to the lenses that are mostly evidence gathering and checking: platform facts, numerics and source reading, operations, and the long pre-mortem list.
- **Opus** went to the lenses that are mostly judgement: the measurement method, steelmanning the status quo, and designing a plan from scratch.
- **The verifiers** were one of each per batch, so that every finding was judged by two families.

I did not set reasoning effort. The Agent tool's rule is to set it only when the user asks, so each agent inherited a default. Section 9 shows that this became a confound.

## 6. The agents, one by one

The briefs are verbatim in `BRIEFS.md`. Every red team also read `teams/COMMON.md`, and every verifier read `verify/VERIFY-COMMON.md`. Times and tokens are as reported by the harness. "Lookups" means web searches plus pages fetched.

### 6.1 Stage A: the red teams

**R1, platform** (Sonnet; effort observed: xhigh; 15.8 min; 340k tokens; 16 searches, 41 fetches, 35 shell commands)

- **Why this lens.** The plan rested on .NET 11, MAUI, BlazorWebView, HybridWebView and Android facts that were weeks old and outside the models' training.
- **Brief.** It started from: 16 KB pages, how a `byte[]` crosses into the WebView, origins, whether the container can build an APK, the artifact's Blazor and Photino claims, and the three transports.
- **What it did.**
  - Read the shipped 11.0.0 assemblies and NuGet packs in the container: `readelf` on the Android native libraries, `strings` on the MAUI DLLs.
  - Read the dotnet/maui and dotnet/aspnetcore sources and the Android documentation.
  - Found that the container's disk was nearly full (259 to 578 MB free). I then deleted old scratch folders, a tarball and a stale worktree, freeing 8 GB. That was a real operational catch: I had not been watching disk.
- **Findings.** 7: one blocker, four major, two minor.
- **Unique items.**
  - **T-2:** no ASP.NET Core runtime for Android, so no in-app Kestrel.
  - **T-9:** Photino.Blazor targets .NET 8 and 9 only.
- **Verified.** 4 of its 8 canonical items were confirmed by both verifiers.
- **Errors.** It read BlazorWebView's origin as `0.0.0.0`; the default is `0.0.0.1`. It also read output from the stopped build agents in the shared scratchpad (an isolation leak).

**R2, method** (Opus; medium; 8.2 min; 163k; 9 searches, 5 fetches)

- **Why this lens.** A plan with gates is only as good as its ability to stop a bad idea and pass a good one.
- **Brief.** It started from: baselines, Amdahl, thresholds, phone measurement, the Gate 2 rates, the 3a agreement bars, seed 11, and the gates' logic as a whole.
- **What it did.** Read the plan, the 3a reports, the 15e study and the speed test, and did the arithmetic.
- **Findings.** 8: two blockers, six major.
- **Unique item. N-6:** seed 11 tests no ember ignition.
- **Contributions.** It named the cheapest experiment (the owner runs the speed test) as part of P-1, and its findings fed G-1, G-2, G-4, G-5, G-6, G-7 and G-10. 5 of its 11 items were confirmed by both verifiers.
- **Errors.** Its brief, which I wrote, quoted a Gate 2 rate ("6.5 MB at 2/s") that is not in the plan. It also listed revision 2's last-bit claim as "sound", which other teams showed to be untested.

**R3, port fidelity** (Sonnet; xhigh; 27.9 min, the slowest; 401k; 8 searches, 11 fetches, 99 shell commands)

- **Why this lens.** A port that cannot match the original cannot be judged against it.
- **Brief.** Read the solver and attack:
  - the 1e-15 evidence;
  - cross-platform maths;
  - random streams and their order;
  - JavaScript habits that do not exist in C#;
  - the size of the port.

  The brief contained a false premise of mine: that V8 computes Math functions the same way on every device.
- **What it did.** Most of its time went on experiments.
  - Wrote noise-injection tools (`r3-tools/`) that add libm-sized ±1 ulp noise per call to the TypeScript solver, at the measured V8-against-glibc mismatch rates, and ran them to 3600 s.
  - Decoded every snapshot and showed that the 1e-15 perturbation never reached the fire or air arrays.
  - Walked the import closure: 37,727 lines.
  - Corrected my premise: V8 15 forwards to LLVM libc.
- **Findings.** 6: four major, two minor.
- **Unique item. N-10:** tier `auto` against the thread-count rule.
- **Its central finding (N-1)** overturned my revision 2. Both verifiers re-ran its tools and largely reproduced it, then narrowed it: the effect stays inside the bars.
- **Errors.**
  - Its "9 of 10 identical at 1800 s" did not reproduce: both verifiers got 7.
  - Its "Mono removed" came from secondary sources and is wrong for the GA packs.
  - It read build-agent output in the shared scratchpad.

**R4, status quo** (Opus; medium; 5.6 min, the fastest; 152k; 12 searches, 3 fetches)

- **Why this lens.** The most expensive mistake is a well-run project that should not exist.
- **Brief.** Steelman not doing B:
  - the evidence behind 2 to 2.6 times;
  - cheaper routes (workers, WebAssembly, WebGPU, packaging);
  - what the owner actually asked;
  - the full cost;
  - D34's history.
- **What it did.** Read D34 to D39 and the 15e study, and searched for 2026 evidence on WebView shared memory: androidx.webkit 1.18.0, 2026-10-21.
- **Findings.** 8: one blocker, six major, one minor.
- **Unique items.**
  - **P-3:** "all pass" would reopen D34 with no criteria.
  - **P-6:** cheaper routes inside D34 are not compared.
- **Its premise and two-solver findings** (P-1, P-5) became the centre of revision 3. 3 of its 8 items were confirmed by both verifiers.

**R5, security and operations** (Sonnet; xhigh; 17.7 min; 397k; 16 searches, 24 fetches, 25 file reads)

- **Why this lens.** Every other lens looks at whether B works. This one looks at what goes wrong when it is shipped and run, and at the prototype's own process.
- **Brief.** It started from:
  - the loopback socket on a phone;
  - the host's hardening;
  - store policy;
  - saved-data continuity;
  - lifecycle;
  - toolchain provenance.
- **What it did.**
  - Compared the Node host's guards with ASP.NET Core's defaults.
  - Checked both installed APKs' signatures against the container's keystore.
  - Read the Android cached-apps freezer documentation and the Local Mess research.
  - Checked the SDK hash.
- **Findings.** 8: one blocker, six major, one minor.
- **Unique items.** It had the most unique items of any team, six:
  - **S-1:** host parity;
  - **S-2:** loopback on a phone;
  - **S-4:** lifecycle;
  - **S-5:** the signing key;
  - **S-7:** toolchain provenance;
  - **S-8:** overstatements.

  8 of its 14 items were confirmed by both verifiers.
- **The signing-key finding** matters beyond this plan: both APKs on the owner's phone can only be updated with a key that exists only in this container.
- **Error.** It read build-agent output in the shared scratchpad.

**R6, pre-mortem and assumptions** (Sonnet; xhigh; 13.3 min; 274k; 12 searches, 12 fetches)

- **Why this lens.** Prospective hindsight surfaces more failure reasons, and the assumptions register is standard red-team practice.
- **Brief.** It is May 2027 and the effort failed or was regretted. Give the twelve most plausible causes, each tied to evidence, plus a full assumptions register with the ten weakest critical assumptions as findings.
- **Findings.** 10. The brief's "ten" overrode COMMON's cap of eight, an inconsistency I introduced.
- **Unique items.** None. All 16 of its canonical items were also raised by other teams. 7 were confirmed by both verifiers.

  That fits the research: a premortem raises the number of reasons, not their novelty. Its value here was corroboration and the register, which lists the assumptions with the weakest evidence, such as "the owner's phone is representative" and "the container can build Android". It did not add unique defects.
- **Error.** It opened the first lines of this review's design document (an isolation leak).

**R7, blind** (Opus; medium; 10.6 min; 204k; 10 searches, 14 fetches)

- **Why this lens.** To test whether the lens teams were anchored by my plan and my briefs, and to find what a fresh engineer would do differently.
- **Brief.** Not shown the plan, the design document, the prototype folder or the artifact. Given only the situation and the question: design the cheapest prototype plan, list the ten likeliest failures, say what to check first.
- **What it did.**
  - Reproduced the app's frozen speed-test kernel checksum in JavaScript, and showed that single-precision maths, as a naive C# port would do it, changes 26,874 of 40,500 cells.
  - Wrote a full four-stage plan. It stated that it opened none of the forbidden files.
- **Findings.** 8: three blockers, five major.
- **Unique canonical items.** None. Its findings merged into P-1, P-5, G-2, G-7, N-1, N-2, N-4, N-9 and T-1, and 5 of its 9 items were confirmed by both verifiers.
- **Where its value lay.** Independent convergence, plus three ideas no other team had:
  - bit-identity as the correctness gate, by porting V8's fdlibm into C#;
  - running the C# kernels as Blazor WebAssembly to price the "two solvers" answer;
  - measuring the port rate and freezing the solver during the slice.

  The merge did not keep these as separate items, a loss I describe in section 9. I recovered them by reading its plan during synthesis.
- **Error.** It said .NET 11 had no release announcement. It was released on 2026-11-10.

### 6.2 The merge (orchestrator)

I read all seven reports and grouped the 55 findings by the defect they describe, giving 35 canonical items. For each item I wrote a neutral *question*, so that a verifier could answer it before seeing any claim. Below the question went the *claim* in one or two sentences, the *pointers* (where the evidence is said to be) and the *proposed change*. Team names, lenses and confidence ratings were removed.

The items went into five batches by topic, not by team, so that the batch itself does not reveal the source:
- P, premise and decision: 6 items plus 2 controls;
- G, gates 1 and 2: 8 plus 2;
- N, numerics, gate 3 and size: 8 plus 2;
- T, platform and transports: 7 plus 2;
- S, security and operations: 6 plus 2.

The controls were always the same two claims, placed under neutral IDs:
- **CTRL-T:** "the minimum Android API for .NET MAUI 11 is 24". True.
- **CTRL-F:** "the simulation draws its random numbers from Math.random(), so the sequence cannot be reproduced". False: it is a seeded mulberry32.

The mapping from IDs to teams and the control key went into a private file the verifiers were told not to read, now `MERGED-KEY.md`. The merge took about five minutes, plus the reading time while the reports came in.

### 6.3 Stage B: the verifiers

Ten verifiers, one Sonnet ("S") and one Opus ("O") per batch. All had the same brief: read the rules and your batch, write to your file.

| Verifier | Model, effort observed | Time | Tokens | Lookups | Shell | Notable work |
|---|---|---|---|---|---|---|
| P-S | Sonnet, medium | 3.0 min | 122k | 5 | 13 | Rated P-6 partly: WebGPU in WebView unconfirmed; the 15c figures are cost multiples, not speed |
| P-O | Opus, xhigh | 9.0 min | 167k | 12 | 25 | Inferred from the 2.35 times phone-to-desktop ratio that the Detail tier may run below 60x on the phone, which narrows the premise finding; recounted the UI and e2e lines |
| G-S | Sonnet, medium | 4.0 min | 141k | 4 | 18 | Corrected the ember share to 12.8 % (G-6) |
| G-O | Opus, xhigh | 8.6 min | 207k | 7 | 39 | Showed a Debug APK keeps its assemblies out of the APK, so a sideloaded one may not start (G-9); computed the faithful serial cap at about 1.3 times; caught the "6.5 MB at 2/s" rate as absent from the plan |
| N-S | Sonnet, medium | 9.3 min | 170k | 7 | 35 | Re-ran the noise injection; showed all libm noise stays inside the bars |
| N-O | Opus, xhigh | 17.0 min | 258k | 14 | 57 | Re-ran the noise injection with 10 seeds and decoded every snapshot; computed power for an equivalence test; mapped bionic's libm sources; reproduced the 37,727-line closure; showed stage 4 would fail by construction |
| T-S | Sonnet, medium | 4.3 min | 120k | 15 | 21 | Confirmed the five-route and Kestrel findings |
| T-O | Opus, xhigh | 10.2 min | 235k | 13 | 61 | Measured `atob` decode at 90 to 130 ms per 16 MB; found `HttpListener` with WebSocket support in the Android runtime pack; caught the reversed BlazorWebView origin; noted a localhost origin is possible with `WebViewAssetLoader` |
| S-S | Sonnet, medium | 5.3 min | 132k | 11 | 24 | Checked both APKs' certificates against the keystore |
| S-O | Opus, xhigh | 11.0 min | 252k | 15 | 41 | Counted the Node host's guards (about 26) against those the named specs cover (about 8); found the GA packs still map `UseMonoRuntime=true` to MonoVM; noted a fixed loopback port can be squatted |

**What the verifiers did that a vote cannot do.** They produced new evidence: re-runs, measurements, signature checks, a search through the installed SDK. They also corrected numbers inside the claims, and found three errors that came from me:
- a Gate 2 rate that is not in the plan, which I had put in R2's brief and in batch G;
- a false premise about V8 in R3's brief;
- the "tested" claim in the artifact.

**Afterwards**, one more agent (web-fetch, 66k tokens, 44 s) checked the citations behind the design (section 4).

### 6.4 Stage C: synthesis (orchestrator)

- Tallied the verdicts under the tie rule, and recorded where the rule had no answer.
- Checked one disputed fact myself. The installed .NET for Android and MAUI 11.0.0 targets still honour `UseMonoRuntime=true`. That supports S-O against R2, R3 and S-S.
- Compared R7's plan with ours.
- Wrote plan revision 3 (section 11, about 200 lines). Each change cites the finding IDs it answers, and the statements found wrong are listed in a table.
- Published artifact version 3 with seven corrections.
- Committed all reports, briefs, batches, the key and the verifier outputs unedited.

## 7. How the workflow was structured

```
             owner's request
                   │
           research (4 searches) ──► design doc + COMMON rules (committed)
                   │
   ┌───────┬───────┼───────┬───────┬───────┬───────┐      Stage A: isolated, parallel,
   R1      R2      R3      R4      R5      R6      R7      background, one worktree each,
 platform method  port  status-quo ops  premortem blind    ≥12 lookups, ≤8 findings
   └───────┴───────┴───────┼───────┴───────┴───────┘
                           │  (barrier: the merge needs all reports)
                 merge 55 → 35, anonymise, batch by topic,
                 plant 2 controls per batch, private key
                           │
      ┌──────────┬─────────┼──────────┬──────────┐          Stage B: two verifiers per batch,
      P          G         N          T          S          one per model family,
    S   O      S   O     S   O      S   O      S   O        answer first, then judge
      └──────────┴─────────┼──────────┴──────────┘
                           │  (barrier: the tally needs both verdicts)
          tally (tie rule) · controls · blind comparison
                           │
       plan revision 3 · artifact v3 · record committed      Stage C
```

**Barriers.** There were two, and both were justified:
- The merge needs every report to remove duplicates.
- The tally needs both verdicts for each item.

The cost of the first was real. Six teams were back by 06:34, but R3's experiments ran until 06:44.

**State lived in files, not in my context.** That covered the rules, briefs, reports, key, batches and verdicts. When my context was compacted in the middle of stage B, nothing was lost: the remaining work was driven from those files.

**Parallelism.** Seven, then ten, agents ran at once on a 4-core container. Heavy commands went through a shared lock file. The agents spent most of their time waiting on the web and the model, so the cores were not the limit.

**Permissions.** Every agent was read-only on the repository and wrote one file in the scratchpad. None pushed, built or ran a downloaded script.

## 8. Results in brief

The full table is in section 4 of the method document.

- **Verdicts.**
  - 35 findings. 26 stand under the tie rule (18 confirmed by both verifiers, 8 confirmed by one and partly by the other).
  - 9 are partly true by both verifiers' judgement, and stand in narrowed form.
  - None refuted. Two of the four raised by four teams were narrowed by both verifiers.
- **Agreement and calibration.**
  - The two families agreed on the verdict for 27 of 35 items and on the severity for 26.
  - Controls: 20 of 20 judgements correct.
- **What changed in the plan.**
  - A new stage 0: three questions for the owner, a speed test of today's app on the phone, the signing key, and a build precondition.
  - Gate 1 rebuilt: the whole step against the best TypeScript arm, kernels that must match bit for bit and across thread counts, and one Release APK running both engines in A B B A order with thermal logging.
  - Gate 2 rebuilt: five routes, rates derived from the phone, measured under load, target SDK recorded.
  - Gate 3: seeds 12 to 14, horizons up to 4 h, an `FsMath` routing point, porting conventions, and the "about 0" claim withdrawn.
  - Stage 4: a shell-only variant, a Capacitor parity table, a host-parity rule, loopback hardening, lifecycle tests, and a reduced scope.
  - Stage 5: the origin result stated in advance and a migration designed.
  - Section 7's outcomes replaced. "All pass" no longer reopens D34 by itself.
- **Corrected in the artifact.**
  - the last-bit maths sentence;
  - "run to run", which should be "seed to seed";
  - Photino.Blazor;
  - the APK size;
  - the Node host "retired";
  - picture sizes;
  - Blazor WebAssembly threads.
- **Found sound**, so the plan should not change on these points: the API 24 floor, CoreCLR as the default runtime, 16 KB page alignment, the same-tier yardstick, the portable random generator, 3a's determinism, the SDK hash, WebView debugging parity.
- **Not settled.**
  - whether a faster solver changes anything the user sees (stage 0b decides);
  - Mono's support status in .NET 11;
  - whether 127.0.0.1 counts as local network on Android 17;
  - WebGPU and shared memory in Android WebView.

**What it cost.**
- About 3.80 M sub-agent tokens: 1.93 M for the red teams, 1.80 M for the verifiers, 0.07 M for the citation check.
- About 108k tokens per canonical finding, or 146k per finding that stands under the tie rule.
- 56 minutes of wall time from the request to the commit. That is about the size of the prototype's own stage 0 to 1 spend.
- If stage 0 ends the prototype, as the blind team expected, the review will have saved most of the 10 to 12 agent runs the plan budgeted, and the owner's phone time.

## 9. What worked, and what did not

### Worked

- **The blind team.** R7 converged on the core gaps with no plan and no hints: the premise, the phone baseline, Amdahl, binary bridges, two solvers and the port size. That is the strongest evidence that the lens teams' agreement was not manufactured by their briefs. It also proposed three ideas no lens team did.
- **Lens diversity.** Every lens except the pre-mortem and the blind team contributed at least one unique canonical item. R5 alone found the whole security and operations batch. R1 alone found that Kestrel cannot run on Android. R4 alone found the missing D34 criteria and the untested cheaper routes.
- **Evidence-first findings.** Because each finding named its file and line, its URL or its command, the verifiers could re-run things instead of arguing. Two independent re-runs of R3's noise injection settled N-1 in a way no amount of reasoning would have.
- **Verification by narrowing.** The verifiers did not rubber-stamp. They narrowed 17 of 35 claims. They corrected:
  - the ember share;
  - BlazorWebView's origin;
  - a disk figure;
  - the Mono claim;
  - the test-line count;
  - a noise result that did not reproduce.

  They also added evidence nobody had: the `atob` cost, `HttpListener`, the Fast Deployment trap, the serial cap of about 1.3 times.
- **Two families.** Where the families disagreed (8 verdicts, 9 severities), the disagreement pointed at real ambiguity: the phone status quo in G-1, the stage 4 scope in N-9, the Mono question in S-8.
- **"Checked and found sound" sections.** These gave a positive record, which kept the revision from overcorrecting things that were right.
- **Side benefits.** The red team found two environment problems that matter beyond this plan: the disk was nearly full, and the signing key exists in one place only.
- **Files as state.** They survived a context compaction of the orchestrator mid-stage.

### Did not work, or worked less well than it looked

1. **The controls were too easy.** All 20 control judgements were right, but the false control could be refuted by opening one file. They show the verifiers were not rubber stamps; they do not show the verifiers could catch a *plausible* falsehood. The real evidence of discrimination came from the errors caught inside findings.
2. **"Answer first" was not enforced.** Each batch file held the questions and the claims together. Three Opus verifiers said so themselves. They said they investigated first, but nothing made them.
3. **The tie rule had a hole.** "Partly and partly" was not defined, and 9 of 35 items landed there. I decided them as "stands, narrowed", which is a judgement by the plan's author: exactly what the rule was meant to avoid.
4. **Reasoning effort was an uncontrolled variable.** I set no effort, and the agents inherited different defaults.
   - The Sonnet red teams ran at xhigh and the Opus red teams at medium.
   - The Sonnet verifiers ran at medium and the Opus verifiers at xhigh.
   - My inference is that the defaults followed the main session's model at launch time. The owner switched the session from Sonnet to Opus between the two stages.

   So "Opus was stricter on 5 items" cannot be separated from "xhigh was stricter".
5. **The briefs carried my errors and my hypotheses.**
   - R3's brief stated a false fact about V8, which R3 corrected.
   - R2's brief and batch G quoted a rate not in the plan.
   - Most briefs listed my suspicions as starting points. That is efficient but invites confirmation. Only the blind team guards against it.
6. **Isolation leaked.** Git worktrees isolate the repository, not the shared scratchpad.
   - Three teams read output from the stopped build agents.
   - One team read the top of this review's design document.
   - No team read another team's report, so the core isolation held.
7. **The merge lost remedies.** Merging by defect folded R7's distinct remedies (fdlibm bit-identity, the WebAssembly arm, the port rate) into items whose proposed change was someone else's. I recovered them by rereading R7's plan, but a merge should keep every distinct remedy.
8. **Composite claims verify worse.** Merging several teams' versions of a finding produced long claims with more places to be wrong. Of the four four-team items, both verifiers confirmed only one. Of the twelve single-team items, both confirmed eight.
9. **Severity was inflated at the source.** The teams filed 8 blockers. After verification only three items carry a blocker rating, each from one verifier.
10. **The research step was shallow** (section 4). Four search summaries in two minutes.
11. **The orchestrator's context took the load.** I read every report and every verdict in full, which fed the compaction.
12. **The orchestrator did not monitor the environment.** Disk ran low under parallel agents until a red team noticed.
13. **The revision itself was not red-teamed.** Section 11 is new text that nobody independent has attacked.

## 10. What I would do differently

1. **Enforce answer-first mechanically.** Send each verifier only the questions, collect its answers, then send the claims in a second message to the same agent. In Claude Code that is a SendMessage to the same agent ID, or two `agent()` calls in a workflow.
2. **Pin model and effort for every agent**, and keep effort equal across the two families, in agent definitions written for the review. Record the effort that was actually observed.
3. **Make the controls plausible, and calibrate the teams too.**
   - Plant false claims of the same kind as real findings. For example, "BlazorWebView's default origin is `0.0.0.0`" (a team actually asserted this) or "the 0.8.0 APK is 33 MB".
   - Plant a few known defects in a copy of the plan, to measure red-team *recall*, not only verifier precision.
4. **Write the full tie-rule matrix before starting:** C/C, C/P, P/P, C/R, P/R, R/R, and any CANNOT TELL. Add a third verifier for any split, and a rule for disagreements about severity.
5. **Keep claims atomic.**
   - Split each finding into one-fact claims for verification, and keep each team's proposed change as its own item.
   - Merge only in the synthesis, with the source IDs kept.
   - Ask teams for structured output (a JSON schema), so the merge can be done mechanically or by a separate agent, not in the orchestrator's context.
6. **Neutral, checked briefs.** Phrase starting points as questions, not facts. Have a separate agent check each brief's factual statements before launch.
7. **Real isolation.** One scratch directory per team, readable only by it. Move other agents' outputs out of reach, and record in each report what the team read.
8. **Research first, properly.** Open the primary sources behind the method before designing. Spend ten minutes, not two.
9. **Watch resources.** Check disk and load before launching parallel agents, and set a stop condition.
10. **Have someone other than the plan's author do the synthesis, or audit it.** At least, have a separate agent check that every plan change maps to a verified finding and that nothing verified was dropped.
11. **Close the loop.** Run a smaller second round on the revision (one blind reader and one method reviewer), and stop when a round finds nothing new.
12. **Use a workflow script for the pipeline.** Schema-validated outputs, deterministic fan-out, resume after interruption, and verifiers that start on a batch as soon as its items exist. I used individual agent calls by hand. That worked, but it put the bookkeeping in my head and my context.

## 11. Was it adapted well to the context?

**Mostly yes, and in places it was heavier than it needed to be.**

What fitted:
- **The phone.** The owner can only act through a phone and rarely sends numbers back. The review's most important output is therefore a cheap first step for the owner, and the review weighted heavily towards that (P-1, P-8, G-5, G-7).
- **Facts newer than training.** .NET 11 was two days old. Making research mandatory, preferring primary sources and recording dates was right. Several "facts" in the plan and the briefs were wrong or out of date, and the research found them.
- **The conflict of interest.** Isolation, anonymisation, external verifiers and an unedited record kept my influence visible.
- **Cost against stakes.** The review cost roughly what one or two prototype stages would. If stage 0 ends the prototype, it pays for itself several times over.

What did not fit as well:
- **Seven teams were more than the plan needed** (my judgement, not measured).
  - The pre-mortem team added no unique canonical item.
  - The status quo, method and blind teams overlapped heavily on the premise.

  A lighter version would have found most of what mattered for about 40 % of the cost:
  - **Teams:** blind; method and status quo; platform and operations.
  - **Verification:** one verifier per finding, with a second, from the other family, only for disputed or blocker items.
- **The most important question should have been asked before any of it.** The red team's headline is "ask the owner what .NET is for, and measure today's app on the phone". I could have asked that before writing the plan. A review of the *question* would have been cheaper than a review of the plan.
- **Ten verifiers for 35 claims** was more than enough. The two families agreed on 77 % of verdicts, and where they differed the difference was one step, never a refutation.

## 12. Generalising the process

### A recipe

0. **Frame it.**
   - Name the target (plan, artifact, premise), the decision it feeds, who decides, the budget, and who wrote the target.
   - Ask whether the *question* itself has been checked with the decision-maker.
1. **Research the method.** Open the primary sources, and write down what each one changes in the design.
2. **Design the teams.**
   - 3 to 7 isolated lenses, chosen from the failure modes of this kind of plan: platform and feasibility, measurement method, fidelity or correctness, status quo or opportunity cost, security and operations, pre-mortem with an assumptions register.
   - Always one blind team that never sees the plan.
   - Pin model and effort.
   - Write neutral briefs and have their facts checked.
   - Require a structured finding: falsifiable claim, evidence, plan change, steelman, severity, confidence. Cap the number of findings, and let "no finding" count.
3. **Collect and merge.**
   - Turn findings into atomic claims, each with a neutral question.
   - Anonymise, and batch by topic.
   - Plant plausible controls, and a few known defects for recall.
   - Keep the key private.
4. **Verify.**
   - Two verifiers from different families with equal effort.
   - Answer-first enforced by two messages.
   - A full tie-rule matrix, decided before starting.
   - A third verifier for splits.
   - Verifiers may run small experiments.
5. **Synthesise.**
   - Tally, unresolved items, found-sound items, the blind comparison.
   - Revise, with each change citing its finding IDs.
   - Correct every public statement found wrong.
   - Keep the raw record.
   - Have the synthesis audited by someone other than the target's author.
6. **Close the loop.** A light second round on the revision. Later, track which findings actually changed decisions.

### Templates

The rules files in this folder can be reused almost as they are:
- `teams/COMMON.md` is the red-team rules and finding format.
- `verify/VERIFY-COMMON.md` is the verifier rules and output format.
- `verify/BATCH-*.md` shows the question, claim, pointers and change layout.

Change two things:
- split each batch into a questions file and a claims file;
- add the full tie-rule matrix.

### Metrics worth recording

- **Per team:** findings, unique canonical items, survival rate under verification, tokens and time.
- **Per verifier:** control accuracy (with *plausible* controls), agreement with the other family, corrections made, new evidence produced.
- **Per review:** precision (findings that stand) and recall (planted defects found); cost per finding that stands; findings that changed a decision; errors traced back to the briefs.

### Cost model from this run

| Role | Tokens | Time |
|---|---|---|
| Red team | 150k to 400k | 6 to 28 min |
| Verifier, per batch of 8 to 10 items | 120k to 260k | 3 to 17 min |
| Merge and synthesis | Orchestrator time and context, about 15 to 25 min | |

In general:
- Teams that run experiments, like R3 here, take the longest and set the barrier.
- Opus at xhigh used about 1.6 times the tokens and 2.2 times the time of Sonnet at medium on the same batch.

### Pitfalls checklist

- Briefs that state the author's hypotheses as facts.
- One file holding both the question and the claim.
- Easy controls.
- An undefined "both partly".
- Inherited effort.
- A shared scratch space.
- Merging away distinct remedies.
- Composite claims.
- Severity taken at face value.
- Citing research from search summaries.
- No resource watch.
- Synthesis by the target's author with no audit.
- The revision never reviewed.

## Appendix: per-agent numbers

| Agent | Model | Effort (observed) | Minutes | Tokens | Searches | Fetches | Shell | Findings | Unique canonical items | Items confirmed by both verifiers |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 platform | Sonnet | xhigh | 15.8 | 340k | 16 | 41 | 35 | 7 | 2 | 4 of 8 |
| R2 method | Opus | medium | 8.2 | 163k | 9 | 5 | 22 | 8 | 1 | 5 of 11 |
| R3 port | Sonnet | xhigh | 27.9 | 401k | 8 | 11 | 99 | 6 | 1 | 3 of 8 |
| R4 status quo | Opus | medium | 5.6 | 152k | 12 | 3 | 14 | 8 | 2 | 3 of 8 |
| R5 operations | Sonnet | xhigh | 17.7 | 397k | 16 | 24 | 18 | 8 | 6 | 8 of 14 |
| R6 pre-mortem | Sonnet | xhigh | 13.3 | 274k | 12 | 12 | 25 | 10 | 0 | 7 of 16 |
| R7 blind | Opus | medium | 10.6 | 204k | 10 | 14 | 27 | 8 | 0 | 5 of 9 |
| P-S / P-O | Sonnet / Opus | medium / xhigh | 3.0 / 9.0 | 122k / 167k | 2 / 6 | 3 / 6 | 13 / 25 | 8 items | | |
| G-S / G-O | Sonnet / Opus | medium / xhigh | 4.0 / 8.6 | 141k / 207k | 0 / 2 | 4 / 5 | 18 / 39 | 10 items | | |
| N-S / N-O | Sonnet / Opus | medium / xhigh | 9.3 / 17.0 | 170k / 258k | 1 / 3 | 6 / 11 | 35 / 57 | 10 items | | |
| T-S / T-O | Sonnet / Opus | medium / xhigh | 4.3 / 10.2 | 120k / 235k | 1 / 1 | 14 / 12 | 21 / 61 | 9 items | | |
| S-S / S-O | Sonnet / Opus | medium / xhigh | 5.3 / 11.0 | 132k / 252k | 1 / 3 | 10 / 12 | 24 / 41 | 8 items | | |
| Citation check | (web-fetch agent) | default | 0.7 | 66k | 0 | 7 | 0 | 7 sources | | |

"Items" counts the canonical items a team's findings fed into (a team can feed several items, and an item can come from several teams). The tokens are sub-agent totals as reported by the harness. The orchestrator's own usage is not included.
