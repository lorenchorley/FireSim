# Review of the option B red-team session, and what carries over (revision 1)

Date: 2026-11-12. Written by the session that built `.claude/skills/adversarial-review/`. Evidence tags: **[V]** I checked it against the raw files, **[R]** reported by the other session and not rechecked, **[D]** my own derivation.

## 1. What was reviewed, and how

The other session is "3D fire simulation mobile app" (`session_016zPE7K49ycKieo7wJdrBFN`, branch `claude/3d-fire-simulation-app-xoy1o6` of this repository). It was readable through the session tools, so no share link was needed. Everything below comes from files committed on that branch, plus the session's own compaction summary.

**Read in full:** `docs/plans/redteam/PROCESS-REPORT.md`, `teams/COMMON.md`, `verify/VERIFY-COMMON.md`, `MERGED-KEY.md`, section 4.2 and 4.3 of `docs/plans/dotnet-option-b-redteam.md`, the headers of `BRIEFS.md` and the blind team's brief.

**Not read:** the raw transcript, the seven team reports (about 200 kB), the ten verifier outputs (about 196 kB), and the plan itself beyond its history. I did not check any technical finding about .NET, MAUI or the solver. I cannot say whether the 35 findings are right, only how the process was run and reported.

**Standing caveat.** The process report was written by the same session that wrote the plan, ran the review and did the synthesis. The report says so, and lists its own errors.

## 2. What the session did

A three-stage review of a staged prototype plan (porting a TypeScript solver to C# on .NET 11):

1. **Stage A.** Seven isolated red teams, each a different lens (platform, method, port fidelity, status quo, security and operations, pre-mortem, and a blind team that never saw the plan). Each had to do at least 12 web lookups and file at most eight findings in a fixed format. 55 findings.
2. **Stage B.** The findings were merged into 35 claims, anonymised, batched by topic, mixed with two planted control claims per batch, and checked by ten verifiers: one Sonnet and one Opus per batch, told to answer each question from sources before reading the claim.
3. **Stage C.** The orchestrator tallied the verdicts, revised the plan, corrected an artifact and committed every report unedited.

Result as reported: none of the 35 refuted, 18 confirmed by both verifiers, 8 by one and "partly" by the other, 9 "partly" by both. The headline finding, raised by four teams: the plan never asked what the owner wants .NET for, and nobody measured the current app on the owner's phone. About 3.8 M sub-agent tokens and 56 minutes.

## 3. What I checked

| Claim in the report | Result |
|---|---|
| 55 findings; 35 canonical items; unique items per team (R1 2, R2 1, R3 1, R4 2, R5 6, R6 0, R7 0) | **[V]** matches the findings counts and `MERGED-KEY.md` |
| Tokens 1.93 M + 1.80 M + 0.07 M = 3.80 M; 108k per item and 146k per standing item | **[V]** arithmetic holds against the appendix |
| 18 both-confirmed, 8 confirmed-and-partly, 9 partly-and-partly | **[V]** counted from the table in section 4.3 |
| Of the four four-team items only one was both-confirmed; of the twelve single-team items, eight | **[V]** G-7 alone; P-3, N-10, T-2, T-9, S-1, S-2, S-4, S-5. The arithmetic is right, the reading is weaker (section 4, point 6) |
| Teams filed 8 blockers, three remain | **[V]** G-5, G-9 and N-9. All three are the Opus verifier's rating (section 4, point 4) |
| Opus at xhigh used about 1.6 times the tokens and 2.2 times the time of Sonnet at medium | **[V]** from the appendix pairs: mean token ratio 1.65, total time 55.8 against 25.9 minutes |
| "I set no effort on any agent" | **[V]** `BRIEFS.md` records `effort=None` for all 17 agent calls. The effort actually observed (Sonnet xhigh then medium, Opus medium then xhigh) is **[R]** |
| Agents ran "each in its own git worktree" | **[V]** `BRIEFS.md` records `isolation=worktree` for all 17 calls. So the parameter is accepted. Whether it isolates anything beyond the repository is **[R]**, and the report says it does not isolate the shared scratchpad |
| The controls were always the same two claims | **[V]** report 6.2 and the key file. So "20 of 20 correct" is two distinct claims judged by ten verifiers each, not twenty calibration items |

## 4. Weaknesses in the session's own conclusions

1. **The calibration figure is smaller than it looks.** Two distinct claims, one refutable by opening a single file. The report admits the controls were easy, but the headline "20/20" still stands in the results section.
2. **"None refuted" cannot separate good findings from agreeable verifiers.** The better evidence of discrimination is the corrections made inside claims: the ember share 25.6 % corrected to 12.8 %, a reversed origin, the Mono claim, a result that did not reproduce **[R]**. "Answer first" was not enforced, and three Opus verifiers said so **[R]**.
3. **The blind team's value is real but narrow.** One plan, the same model families, the same web. Convergence can come from shared priors. The blind team produced no unique canonical item, and its isolation was self-attested ("it stated that it opened none of the forbidden files"). It supports "the briefs did not manufacture the agreement", not "the findings are true".
4. **The effort confound reaches severity.** All three surviving blockers came from the Opus verifier, which ran at xhigh. "Opus was stricter" and "xhigh was stricter" cannot be separated.
5. **No recall was measured.** Every figure describes findings that were made. Nothing says how many true defects the seven teams missed. The report lists recall as a metric to record and then did not record it.
6. **Two lessons rest on small numbers.** The "composite claims verify worse" reading (1 of 4 against 8 of 12) is confounded with breadth: the four-team items are the broad headline claims. The "lighter version for about 40 % of the cost" is the author's judgement, and the report says it was not measured.
7. **The tie rule had a hole, filled by the author.** Nine "partly and partly" items were decided as "stands, narrowed" by the plan's author, after seeing the results. Disclosed.
8. **The revision is unreviewed.** Section 11 of the plan is new text no one independent has attacked. Disclosed.

**What is strong.** Files as state, so a mid-run context compaction lost nothing. An unedited record. An evidence-first finding format that let verifiers re-run things instead of arguing. Verifiers who ran experiments and settled disputes by reproduction. A candid list of its own errors, including its own research step being thin.

## 5. What carries over

Strength of evidence is for the lesson as it applies to my work, not for the other session's whole result.

| # | Carry over | Evidence | Answers | Cost and risk |
|---|---|---|---|---|
| 1 | **Reviewer format: a cap of eight findings, ranked, "no finding is acceptable", and an "Already covered?" field that cites the section.** Their `COMMON.md` has all three. | Mine: three of the five rejections in run 2 (X1, X4, X5) were "the work already says this". Reports totalled about 45,000 characters, and one reviewer filed 13 findings, four of them nitpicks **[D]** | Context cost (my option A); fewer rejected findings | One edit to `reviewer-prompt.md`. Risk: a cap can hide a ninth real finding. Keep "no finding" legal, and let the judge ask for more |
| 2 | **Judge: add a "Partly valid" verdict that states the narrowed claim, split compound items, and keep each reviewer's distinct fix direction.** | 17 of 35 claims were narrowed **[R]**. Their merge lost distinct remedies, and recovered one team's only by rereading its plan **[R]**. My judge's categories have no "true but narrower" | Judge quality | Two lines in `judge-prompt.md`. The composite-claim evidence is weak (section 4, point 6), so this is a cheap precaution, not a proven gain |
| 3 | **Judge: run the check when a claim is checkable, and say what was run.** | Disputed items were settled by two independent re-runs, not by reasoning **[R]** | Judge quality | One line. More judge tokens on some runs |
| 4 | **Isolation audit from the transcripts, in step 5.** A script lists every file a reviewer's tool calls touched and flags other reviewers' reports and the ruling. | I ran it on runs 1 and 2: no reviewer's tool calls name another reviewer's report, so isolation held **[V]**. The other session had four leaks (three teams read build-agent output, one read the design document) **[R]** | My ruling item S5 (barriers nothing enforces) | Cheap. It detects, it does not prevent, and it reads harness-internal transcript files, the same dependency that made me hesitate over option B |
| 5 | **Answer-first by two messages to the same agent** (questions first, claims after, with `SendMessage`). | Their single batch file held both, so the rule was by instruction only **[R]** | S5, and the "blind derivation" step in the assessment | I have not tested `SendMessage` here. Test on one small agent before relying on it |
| 6 | **Per-run yield figures in `run.md`:** findings per lens that survive, findings unique to one lens, reviewer must-fix against judge must-fix, tokens per ruled item. | My runs: reviewers rated 6 findings must-fix across both runs, the judge kept 2 **[V]**. Theirs: 8 blockers became 3 **[R]**. Same direction | S4 (cost), lens choice | The judge's ledger already has the merged ids, so most of it is a script |
| 7 | **Use their plan as the first test case with known answers**, in place of planted defects, for the plan-against-mission use case. The plan before the review is at commit `853f333` (06:10), before the red-team design commit `05795ff` (06:15). The answer key is the 35 verified items plus the "found sound" list. | The key was verified by two verifiers per item **[R]**. A plan with real defects beats invented ones | S8 (seeded set has no planter or key) and the assessment's baseline step | A run is about 0.7 M tokens. The key is incomplete (recall is against what they found, not against all defects). Export the plan to a clean folder without `.git`, so the findings in later commits cannot be read. The repository at that commit is 111 MB, so export only the plan and the files it cites |
| 8 | **Plausible controls drawn from real errors.** Their verifiers caught real wrong statements (a reversed origin, a wrong ember share). Those make better planted claims than two easy ones. | **[R]** | S8, and calibrating the judge | The judge receives them as one extra pseudo-report. My rule 4 forbids editing reports, not adding a control file, but this is a decision for you |
| 9 | **Lens candidates for the Plans set:** *Premise and status quo* (is this the right question, what does the owner want, what is the cheapest experiment that could end it), *Method* (would the plan's own test stop a bad idea and pass a good one), *Operations and provenance*. And a **blind reviewer** who sees only the mission. | Their headline finding came from the status-quo lens, and the blind team reached it too. Operations gave the most unique items (6 of 12) **[R]**. The pre-mortem gave none **[R]** | S10, and the use case "was the mission interpreted correctly" | Selectable lenses, not replacements. Unique-item counts reward domain lenses (platform, port), so only the transferable ones are listed. One plan only |
| 10 | **Workflow-script orchestration.** Their lesson 12: deterministic fan-out, schema-checked outputs, results stay out of the orchestrator's context. | Their orchestrator read every report in full, "which fed the compaction" **[R]**. Mine grew 39,631 tokens in run 2 **[V]**. My run-2 ruling already listed the Workflow tool as optional (O12) | My context problem, without the transcript extraction I was unsure about | The Workflow tool needs your explicit opt-in ("use a workflow"). Unbuilt and untested here |
| 11 | **Pin model and effort and record the effort actually observed.** | Their confound is the worked example of why. My skill already passes both and I checked them from the transcripts | S1 (a test that cannot separate design from spend) | Already done. Add to the section 6.5 test design: arms must match in model and effort, or vary one |
| 12 | **A rule for how much review to buy.** Their frame: a review must cost less than it can save, and by their own judgement theirs was heavier than needed. | **[R]**. Cost per ruled item: mine about 23k tokens (0.70 M for 31 items), theirs about 108k (3.80 M for 35). Not comparable: their verifiers ran experiments, mine mostly read | S4 (no cost mechanism) | A line in the skill's "Cost and fit" |
| 13 | **Checkers need checking.** Their citation checker wrongly called a real PDF "the wrong document", and the author caught it by opening the file. | **[R]** | Step 6 of the skill | When a verification agent contradicts the source I expect, open it or ask a second agent before acting |

## 6. A worked example: the overlap signal on their data

My assessment (section 6.4) proposes capture-recapture as one stopping signal. Their merged key gives real data for it. Counting how many teams raised each of the 35 items: 12 items were raised by one team, 11 by two, 8 by three, 4 by four, none by five to seven **[V]**.

The Chao1 lower bound for unseen items is f1² / (2·f2) = 144 / 22, about 6.5, or 5.5 with the bias correction. That gives about 40 to 41.5 items in total, so the seven teams found roughly 84 to 86 % of what this kind of search could reach **[D]**.

Treat it as a demonstration, not a result:

- **The teams are not exchangeable.** Six of the twelve single-team items came from one lens (security and operations). Singletons concentrated in one lens suggest unseen items live in lenses nobody used, so the true total is higher. Capture-recapture fits repeated samples of the same lens better than different lenses. This is concrete support for ruling item O7.
- **Item counts depend on how the orchestrator merged.** A coarser merge raises the multiplicity.
- **There is no external check.** Without planted or known defects, nothing says whether 84 % is right.

## 7. Not carried over

- **Seven teams and ten verifiers.** About 3.8 M tokens. The author's own view is that a lighter version would have found most of what mattered.
- **Their controls as designed.** Two easy claims reused in every batch.
- **Git worktrees for isolation of read-only reviewers.** They isolate the repository and not the scratch space, and my reviewers do not edit anything. The parameter is accepted (section 3), which does resolve the "cannot verify" note in run 2 about its existence.
- **Their cited papers, until fetched.** The report found one claim unsourced ("most of the gain comes from voting") and another only partly supported, after the design had used them. None of their citations enters my assessment unless I fetch it myself.

## 8. Open leads

- **Why their agents could write report files and mine could not.** Their briefs asked for the report as the final message and as a file in the scratchpad; those files exist. In my run 2 the harness refused the same kind of write. I do not know what differs (the prompt, the permission mode, or something transient). I did not try to get around the refusal, and I will not test it by renaming files.
- **Whether `SendMessage` can drive the two-message pattern here.** Untested.
- **Whether my skill finds what their teams found.** Item 7 above is the way to learn that.

## 9. Suggested order, if you want to proceed

1. Items 1 to 3 and 6 as one small edit of the skill (reviewer format, judge verdicts, yield figures). They need no new capability.
2. Item 7 as run 3: the skill on their pre-review plan, scored against their key. It gives the first real recall figure and a baseline for the assessment.
3. Items 4 and 5 as a short test of the audit script and of `SendMessage`.
4. Items 9 and 10 only on your say-so: new lenses change the skill's scope, and the Workflow tool needs your opt-in.
