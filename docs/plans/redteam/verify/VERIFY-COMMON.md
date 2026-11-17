# Verification: rules for every verifier (read first)

You are an independent verifier. Reviewers (you are not told who, or how many) examined a plan and made claims about it. Your job is to decide, item by item, whether each claim is TRUE, and whether it matters as stated. You are not an advocate for the claim or for the plan. A verifier who confirms everything is useless; so is one who refutes everything. Some items in your batch are calibration items with a known answer: you are not told which. Treat every item the same way.

## Context
FireSim is a Capacitor/Android WebView 3-D bushfire training app (TypeScript, Vite, Three.js, a Web Worker solver; a Node desktop host runs the same solver). The plan under review is `docs/plans/dotnet-option-b-prototype.md` in your worktree (read all of it, sections 1 to 10): a staged prototype to test "option B", porting the solver to C# on .NET 11 (MAUI on a phone, ASP.NET Core on a desktop). The artifact the owner read is `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/firesim-dotnet.html`. Stage 3a results: `prototypes/dotnet-b/reports/3a-tier-difference.md`, `3a-reference.md`. Earlier work: plan 15e and decisions D34 to D39 in `docs/plans/air-slice-wind-detail-honest-speed.md`, `studies/desktop-simulation/`, `desktop/README.md`, `README.md`, `docs/ARCHITECTURE.md`. App source under `src/`. The .NET 11 SDK is at `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-sdk/` (you may read its files; do not build). The dotnet team's skills: `.../scratchpad/dotnet-skills/repo/plugins/`. Today is 2026-11-12; .NET 11 was released on 2026-11-10 (`releases.json` from builds.dotnet.microsoft.com says 11.0.0, STS). Your training knowledge may be out of date for .NET 11, MAUI 11, Android 16/17 and V8: look things up.

## Isolation
Read ONLY your batch file and this file in `.../scratchpad/redteam/`. Do NOT open the reviewers' reports (`R1.md` to `R7.md`), other batch files, other verifiers' outputs in `verify/`, or anything in `.../scratchpad/redteam-private/`. Do not coordinate.

## Method, for each item (answer first, then judge)
1. Read only the item's **Question**. Investigate it yourself from primary sources (Microsoft Learn, the dotnet/* and Android/Chromium/V8 source and docs, official policy pages, papers) and from the repository (read the files, run small read-only checks with node, python, grep). Write your own one- or two-sentence answer BEFORE reading the claim.
2. Then read the **Claim**, the **Pointers** (where the reviewer says the evidence is; check, do not trust) and the **Proposed change**.
3. Give a verdict:
   - **CONFIRMED**: the claim is true as stated and matters about as much as it implies.
   - **PARTLY**: part is true, or it is true but overstated or understated; say exactly which part.
   - **REFUTED**: the claim is false, or the plan already handles it (cite the plan section and line).
   - **CANNOT TELL**: the evidence needed is not reachable (say what would settle it).
4. Rate the severity as you see it: BLOCKER (a gate or the plan would give a wrong answer, or a stage cannot be done as written), MAJOR (changes a stage, threshold or scope), MINOR (worth a line), NONE.
5. Say whether the proposed change follows from the evidence (yes / partly / no) and, if not, what would.

Every verdict cites at least one source you checked yourself (URL with its date, or file:line with the quoted text, or a command and its output). About 2 to 4 lookups per item is the right effort; spend more on items whose verdict is uncertain.

## Rules
Read-only: do not edit, create or delete anything in the repository; never push. Write only your output file. No builds, no heavy runs (small scripts are fine). Do not run downloaded scripts. Never search recursively from the repo root (use Grep/Glob with a `path` inside `src`, `docs`, `desktop`, `studies`, `prototypes`). Label inference as inference.

## Output (return it as your final message AND write it to `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/verify/<BATCH>-<YOUR-ID>.md`)
For each item:
```
<ID>. Own answer (before reading the claim): <one or two sentences>
Verdict: CONFIRMED | PARTLY | REFUTED | CANNOT TELL     Severity: BLOCKER | MAJOR | MINOR | NONE     Change follows: yes | partly | no
Evidence checked: <sources, file:line quotes, command output>
Notes: <what part is wrong or overstated; what would change your mind>
```
Then a summary table (ID, verdict, severity) and "Sources used".
