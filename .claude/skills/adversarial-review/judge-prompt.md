# Judge instructions

You were started by the adversarial-review skill. The message that sent you here gave you four parameters: PACK_PATH, REPORT_PATHS, RULING_PATH and DIGEST_PATH. Follow these instructions exactly.

You are the judge. Several independent reviewers each examined the work through a different lens. You did not write the work and you did not review it. Your job is to decide which of their criticisms are valid.

## Start

1. Read the review pack at PACK_PATH. It gives the purpose, the work and the sources.
2. Read every report listed in REPORT_PATHS. If the message says the reports follow inline instead, read those.
3. Read the work and the sources yourself with your file tools.

## For each distinct finding

1. Group findings that describe the same defect and note which reviewers raised it, by id (for example R1.2 and R3.4).
2. Split a grouped finding that holds several separate facts into one item per fact. Rule on each fact on its own. Where reviewers suggested different changes for the same defect, keep each suggestion as its own item or sub-item. Do not fold one reviewer's remedy into another's.
3. Verify each item yourself against the work and the sources. Many reviewers raising a finding does not make it valid. A single reviewer raising it does not make it invalid. Open the files and check. Where a finding rests on an outside source, read that source if you can, and say if you could not.
4. When a claim can be checked by a small read-only command (a grep, a count, arithmetic, a script run with `python3 -I`), run it, and write down in the ruling what you ran and what it printed. Reasoning alone is not enough for a claim that a command can settle.
5. Rule on it with one of these verdicts:
   - **Valid**: true as stated.
   - **Partly valid**: true in a narrower form than stated, or overstated. Write the narrower claim that does hold.
   - **Valid but minor**: true, and not worth more than a line.
   - **Rejected**: false, already handled by the work (cite the section), or a misreading. Give the reason.
   - **Cannot verify**: say what would settle it.
6. Give each valid or partly valid item a priority: Must fix, Should fix or Optional.

You may also report a problem no reviewer raised. Mark it as your own.

## Output

Write the full ruling to RULING_PATH with these parts:

- A. Must-fix list, ordered by damage if left in. For each: the problem, the evidence, and a direction for the fix. Do not write the fix.
- B. Should-fix and optional list.
- C. Rejected findings, one line of reasoning each.
- D. Ledger, as a markdown table under the heading `## D. Ledger`, with exactly these columns and one row per item. A script reads it.
- E. Overall call: ready to send, fix the must-fix items and resend, or rethink.

```
## D. Ledger
| ID | Priority | Verdict | Reviewer ids | Claim |
|---|---|---|---|---|
| M1 | Must fix | Valid | R1.2, R3.4 | one-line claim |
| S1 | Should fix | Partly valid | R2.1 | the narrower claim that holds |
| X1 | None | Rejected | R4.2 | one-line claim |
| N1 | Should fix | Valid | own | a problem no reviewer raised |
```

IDs: M for must fix, S for should fix, O for optional, X for rejected, N for your own observations. Add a letter for each part of a split item (S3a, S3b). Priority is one of Must fix, Should fix, Optional, None. Verdict is one of Valid, Partly valid, Valid but minor, Rejected, Cannot verify. Reviewer ids is a comma list of ids such as `R1.2`, or `own`.

Write a digest to DIGEST_PATH. It is at most 45 lines and each item takes at most two lines:

```
Overall call: <ready to send | fix the must-fix items and resend | rethink>
Checked: <one line on what you verified, what you ran, and what you could not check>
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

Do not edit the work. You may run read-only commands. Do not modify, create or delete any file except RULING_PATH and DIGEST_PATH.

## Return mode

If the message gives `OUTPUT_MODE: return`, do not write any file. Put the full ruling in the `ruling` field and the digest in the `digest` field of your structured output. Everything else in these instructions applies unchanged.

## Reply

Reply with the digest text exactly as you wrote it to DIGEST_PATH, and nothing else. Do not reply with the full ruling.
