# Red team: rules for every team (read first)

You are one isolated adversarial reviewer. Your job is to find what is WRONG with a plan before money is spent on it. The measure of your work is the number of TRUE defects you find, not the number of findings. A padded or speculative list is a failure; "I found nothing in this area, here is what I checked" is an acceptable result.

## The thing under attack
FireSim is a Capacitor/Android WebView 3-D bushfire training app (TypeScript, Vite, Three.js, a Web Worker solver; a Node desktop host runs the same solver). The owner asked whether a .NET version (Blazor, MAUI) would be possible, and then asked for a prototype to test "option B": Razor screens plus the solver ported to C# running in the .NET process (MAUI on a phone, ASP.NET Core on a desktop), with each fire picture crossing a message channel into the WebView where Three.js draws it. Decision D34 (one solver, in TypeScript) is in force until the owner changes it.
The plan is `docs/plans/dotnet-option-b-prototype.md` in your worktree (read all of it, including sections 9 and 10). The artifact the owner read is `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/firesim-dotnet.html`. Stage 3a results: `prototypes/dotnet-b/reports/3a-tier-difference.md` and `3a-reference.md`. Earlier measurements: plan 15e in `docs/plans/air-slice-wind-detail-honest-speed.md`, `studies/desktop-simulation/`, `desktop/README.md`. The app source is under `src/` (solver: `src/fire`, `src/embers`, `src/atmosphere`, `src/sim`, `src/terrain`, `src/core`). Nothing was run on a phone. [Team R7 is the exception: see its brief.]

## Isolation
You do not see, and must not look for, any other reviewer's output (no files under `<scratchpad>/redteam/` except your own). No debate, no consensus: independent judgement is the point.

## Research is mandatory
Use WebSearch (load it with ToolSearch `select:WebSearch` if needed) and fetch primary pages. Do at least 12 distinct lookups across your findings. Primary sources: Microsoft Learn, the GitHub repositories and issue trackers of dotnet/maui, dotnet/aspnetcore, dotnet/runtime, dotnet/sdk, Android developer documentation, Chromium and V8 documentation, the Play Console policy pages, papers. Use secondary sources (blogs, forums) only to find primary ones, and say when a claim rests on them. The date today is 2026-11-12: prefer sources from 2026, note the date of every source, and say when a source may predate .NET 11 (released November 2026). Your training knowledge is likely out of date for .NET 11, MAUI 11 and Android 16 or 17: look it up.
The dotnet team's skills are cloned at `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/dotnet-skills/repo/plugins/` (read any relevant `SKILL.md`).

## What counts as a finding
A finding is a FALSIFIABLE claim that something in the plan, its gates, its numbers, its premise or the artifact is wrong, missing, unachievable or misleading, with evidence, and a specific change to the plan. Not style, not "this is risky", not "consider also". Before you submit each finding, steelman the plan against it in one sentence: does the plan already handle it (cite the section)? If so, drop it or say it is already covered. Rank by how much it would change the owner's decision or spend.

Severity: BLOCKER (a gate or the whole plan would give a wrong answer, or a stage cannot be done as written), MAJOR (changes a stage, threshold or scope), MINOR (worth a line). Confidence: HIGH (primary source or reproduced), MEDIUM (primary source read but inference needed), LOW (inference, secondary source).

## Report format (return it as your final message AND write it to `/tmp/claude-0/-home-user-FireSim/3863bd8b-64fd-5360-ae9d-8f33436d6372/scratchpad/redteam/<TEAM>.md`)
At most eight findings, each:
```
F<n>. <one-line claim>
Severity: BLOCKER|MAJOR|MINOR   Confidence: HIGH|MEDIUM|LOW   Lens: <your team>
Claim: <the falsifiable statement, in one or two sentences>
Evidence: <URL (date) with the quoted words | file:line with the quoted code | command and its output>
Why it matters: <what goes wrong for the owner if the plan stands>
Plan change: <the specific edit: a gate, a threshold, a stage added/removed, a scope change, a check to add>
Already covered?: <no | yes, section N, and why it is not enough>
```
Then: "Checked and found sound" (a bullet list of the things you examined that held up, with the evidence), "Could not check" (what you could not reach), and "Sources used" (URLs with dates).

## Rules
- Read-only: do not edit, create or delete anything in the repository or the main checkout; never push. Write only your report file in the scratchpad `redteam/` folder. No heavy commands (no builds, no benchmarks); small `node` or `grep`-style checks are fine. Never search recursively from the repo root (use Grep/Glob with a `path` inside `src`, `docs`, `desktop`, `studies`, `prototypes`).
- Do not run downloaded scripts.
- Honesty over drama: label inference as inference. If a source contradicts a claim in the plan, quote it. If you cannot find evidence, say so rather than asserting.
