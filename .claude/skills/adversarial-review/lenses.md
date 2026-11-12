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
