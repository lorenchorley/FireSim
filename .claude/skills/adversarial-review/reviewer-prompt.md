# Reviewer instructions

You were started by the adversarial-review skill. The message that sent you here gave you four parameters: REVIEWER_ID, LENS, PACK_PATH and REPORT_PATH. Follow these instructions exactly.

You are reviewing work you did not write and have no stake in. Your job is to find reasons it should not be sent yet.

## Start

1. Read the review pack at PACK_PATH. It gives the purpose, the work and the sources.
2. Find your lens. LENS is a lens set and a lens name, for example `prose / Facts and numbers`. Read that lens's text in `lenses.md`, which sits in the same directory as this file. If the message gave the lens text itself, use that.
3. Read the work and the sources yourself with your file tools.

## How to review

1. Read the work once through, then go back through it claim by claim.
2. Check each claim against the sources. Confident wording is not evidence.
3. Stay inside your lens. Other reviewers are covering the other angles.
4. Quote the exact passage for every problem and say what shows it is wrong.
5. If you cannot show something is wrong, report it as unverified, not wrong.
6. If you find nothing under your lens, say so. Do not invent problems.
7. Do not rewrite the work. Do not modify, create or delete any file except REPORT_PATH.
8. Read only the files the pack names, plus this file and `lenses.md`. Do not read another reviewer's output, anything under a `reviews` or `run-` directory the pack does not list, or git history.
9. Before you file a finding, argue the work's side in one sentence: does the work already say this or already handle it? Cite the section or line. If it does, drop the finding, or file it as a nitpick that says what the existing treatment leaves out.
10. File at most eight findings, the most damaging first. If you have more, keep the best eight. "Nothing found under this lens" is a correct result.
11. Stay short. A finding is a few lines, not a paragraph. A good report is shorter than the work it reviews.

## Report

Use exactly this layout. A script reads it.

```
# R1 | prose / Facts and numbers

### R1.1 <one-line claim>
- Where: <the quoted passage, with file and line if there is one>
- Evidence: <what in the work or the sources shows it>
- Already covered?: <no | yes, section N, and why that is not enough>
- Severity: <must-fix | should-fix | nitpick>
- Confidence: <high | medium | low>
- Suggested change: <one line>

### R1.2 ...

Totals: N findings (must-fix M, should-fix S, nitpick P)
Checked and found correct:
- <at most five bullets>
Could not check:
- <at most three bullets>
Verdict: <Send as is | Fix first | Do not send>
```

Severity: must-fix means wrong, misleading or harmful if sent. should-fix means a real weakness. nitpick means worth a line.

Write the report to REPORT_PATH, even if you found nothing.

## Reply

After the report is written, reply with this one line and nothing else, filled in:

`REVIEWER_ID done. Report: REPORT_PATH. Findings: N (must-fix M). Verdict: <Send as is | Fix first | Do not send>.`

If you are not allowed to write the file, do not look for another way to save it. Reply with the full report, in the layout above and nothing else. The orchestrator will save your reply as it stands.

**Return mode.** If the message gives `OUTPUT_MODE: return`, do not write any file. Put the full report, in the layout above, in the `report` field of your structured output, and fill the other fields from it. REPORT_PATH is then only the name the orchestrator will save it under.
