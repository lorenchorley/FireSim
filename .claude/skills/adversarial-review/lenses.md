# Lens sets

Each lens has a name for `{LENS_NAME}` and text for `{LENS_TEXT}`. Pick the set that matches the work. Use the lenses the user named if they gave any. For mixed work, take the five lenses that cover the most distinct risk, and never use two that would produce the same findings.

To add a lens, write a short name and one to three sentences that say what to check and what to look for. Keep it narrow so reviewers do not overlap.

## Prose: documents, proposals, emails, announcements, analyses

**Facts and numbers**
Check every number, date, name, quote and citation. Recompute totals and percentages. Confirm each cited source says what the work says it does.

**Source fidelity**
Find places where the work contradicts its sources, contradicts itself, or claims more than the evidence supports. Flag unsupported claims and overstated certainty.

**Gaps and omissions**
Find what the reader needs and does not get: missing figures, unstated assumptions, absent caveats, and the obvious questions the work leaves unanswered.

**Argument and logic**
Attack the reasoning. Find leaps, circular logic, weak comparisons, and the strongest objection a skeptical reader would raise.

**Audience and risk**
Read as the least charitable person who will see this: a customer, an executive, a lawyer, a competitor. Find what would confuse them, mislead them, or expose the sender to legal, privacy or commitment risk.

## Code: diffs, modules, scripts

**Correctness**
Trace what the code actually does on realistic and edge-case inputs. Look for logic errors, off-by-one mistakes, wrong assumptions about input shape, ordering and concurrency problems, and behavior that differs from what the change claims to do.

**Security and data safety**
Look for injection, missing authorization checks, leaked secrets, unsafe deserialization, unvalidated input at trust boundaries, and any path that can lose or corrupt data.

**Failure handling**
Look at what happens when things go wrong: errors, timeouts, partial failure, retries, resource cleanup, and failures that would be silent or impossible to diagnose.

**Tests and regressions**
Work out what else this change could break. Find behavior that is untested, and tests that would still pass if the code were wrong.

**Fit and maintainability**
Check the change against the conventions, helpers and APIs already in the surrounding code. Find needless complexity, duplicated logic, misleading names, and anything the next maintainer will trip over.

## Plans: designs, specs, migration plans, decisions

**Feasibility**
Check whether the plan can be done as written. Look at dependencies, ordering, capacity, and unknowns that the plan states as if they were facts.

**Missing requirements**
Find requirements, stakeholders and constraints that the plan does not address or quietly assumes away.

**Failure modes and rollback**
Find what can go wrong, how the team would notice, and how they would undo the change. Flag steps that cannot be reversed.

**Alternatives**
Identify the strongest alternative the plan does not consider, and test whether the plan's case against it holds.

**Cost and commitment**
Find hidden costs, sequencing risk, and the commitments the plan creates that will be hard to leave later.

## Plans, extended (experimental)

Three lenses added after run 3 was scored against the benchmark answer key. About half of the key items the run missed were claims the plan makes about the existing repository, and the `plans` set above has no lens for them. They stay out of the default run until the benchmark shows they lift recall without adding noise. Each names what is out of its scope, so the lenses do not overlap.

**Claims against the repo**
List every factual statement the plan makes about the existing code, documentation, defaults, sizes, versions and test status. Check each against the files in the sources and quote the file and line. File a finding when the source says something different, or when the plan relies on something the sources do not support. For each finding, state the failing case: what the source says, and what the plan does as a result. Out of scope: whether the design is good, and facts that need the web (list those under "Could not check").

**Measurement method**
For every gate, benchmark or test the plan defines, work out what could make its result mean something other than what the plan claims: a wrong baseline, hardware or build, too few samples, a single site or seed, a setting the app does not use by default, warm-up, thermal state. Describe the concrete run that gives a misleading pass or a misleading fail. Out of scope: whether the thresholds are the right size, and cost.

**Operations and security parity**
Compare the plan's new runtime, build or delivery path with what the existing app already guarantees: security guards and their tests, signing and install rules, saved data, background and kill behaviour, offline rules, release checks. Find each guarantee that the new path drops or weakens without saying so, and name the existing file that holds it. Out of scope: performance and schedule.
