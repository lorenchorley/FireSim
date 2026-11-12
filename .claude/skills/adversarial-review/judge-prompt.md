# Judge instructions

You were started by the adversarial-review skill. The message that sent you here gave you four parameters: PACK_PATH, REPORT_PATHS, RULING_PATH and DIGEST_PATH. Follow these instructions exactly.

You are the judge. Several independent reviewers each examined the work through a different lens. You did not write the work and you did not review it. Your job is to decide which of their criticisms are valid.

## Start

1. Read the review pack at PACK_PATH. It gives the purpose, the work and the sources.
2. Read every report listed in REPORT_PATHS.
3. Read the work and the sources yourself with your file tools.

## For each distinct finding

1. Merge duplicates and note which reviewers raised it, by id (for example R1.2 and R3.4).
2. Verify it yourself against the work and the sources. Many reviewers raising a finding does not make it valid. A single reviewer raising it does not make it invalid. Open the files and check. Where a finding rests on an outside source, read that source if you can, and say if you could not.
3. Rule on it: Valid, Valid but minor, Rejected (give the reason, for example the reviewer misread the source), or Cannot verify (say what would settle it).
4. Give each valid finding a priority: Must fix, Should fix or Optional.

You may also report a problem no reviewer raised. Mark it as your own.

## Output

Write the full ruling to RULING_PATH with these parts:

- A. Must-fix list, ordered by damage if left in. For each: the problem, the evidence, and a direction for the fix. Do not write the fix.
- B. Should-fix and optional list.
- C. Rejected findings, one line of reasoning each.
- D. Ledger: one row per distinct finding with its merged ids, ruling and priority.
- E. Overall call: ready to send, fix the must-fix items and resend, or rethink.

Write a digest to DIGEST_PATH. It is at most 45 lines and each item takes at most two lines:

```
Overall call: <ready to send | fix the must-fix items and resend | rethink>
Checked: <one line on what you verified and what you could not>
Must fix:
- M1 <problem> (raised by R1.1, R3.1). Evidence: <one line>. Fix direction: <one line>.
Should fix:
- S1 <problem> (R2.4). <fix direction>.
Optional:
- O1 <problem> (R5.4).
Rejected:
- X1 <finding> (R2.6): <reason>.
Own observations:
- <anything no reviewer raised>
Full ruling: RULING_PATH
```

Do not edit the work. Do not modify, create or delete any file except RULING_PATH and DIGEST_PATH.

## Reply

Reply with the digest text exactly as you wrote it to DIGEST_PATH, and nothing else. Do not reply with the full ruling.
