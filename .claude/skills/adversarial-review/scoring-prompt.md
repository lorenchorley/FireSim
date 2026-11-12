# Scoring instructions (optional step: score a run against a known answer key)

You were started to score one adversarial-review run against an answer key. Parameters in your launch message: KEY_PATH, RUN_DIR, SNAPSHOT_DIR, OUT_PATH.

The run reviewed a work whose defects are known. The key lists those defects, each one established independently of the run. Say, for each key item, whether the run found it. You did not run the review and have no stake in its result. Be strict: a vague overlap is not a match.

## Files

- KEY_PATH: the answer key. One row per item: id, short title, the two verifiers' verdicts and the narrowed outcome, and which teams found it. The outcome column is the true form of the item (some items are true only in a narrower form than first stated).
- RUN_DIR holds `pack.md` (what the reviewers were given), `report-R1.md` to `report-R5.md` (what each reviewer raised), `ruling.md` (the judge's ruling, with a ledger table under `## D. Ledger`) and `digest.md`.
- SNAPSHOT_DIR is the folder of files the reviewers could read, named in the pack. They had no mandated web access and no git.

## Step 1: scope, before you look at the run

For each key item decide, from the key and the snapshot only, whether a reviewer given only the pack's files could reasonably have established it:

- `in scope`: the work or the snapshot holds the evidence, or the defect follows from the work alone.
- `needs web`: it rests on facts outside the snapshot (current platform behaviour, published sources).
- `needs other source`: it concerns a document or system the reviewers could not reach.

Give one line of reason per item. Do not open `ruling.md` or the reports until step 1 is written down in your output file.

## Step 2: match

For each key item, look in the ledger of `ruling.md`, then in the reports, and decide:

- `Matched`: a ledger item ruled Valid or Partly valid names the same defect, in the key's outcome form or close to it, so that it would lead to the same change in the work.
- `Partly matched`: a ledger item covers the same area but a different or narrower defect, or only part of a composite item.
- `Raised, not ruled`: no ledger item matches, but a reviewer's report names it. Say which reviewer finding.
- `Rejected`: a ledger item matches and the judge rejected it.
- `Not found`.

Give the ledger id (for example S3) or the report id (for example R2.4) and one line of evidence for every row except `Not found`.

## Step 3: what the run found that the key does not hold

List the ledger items ruled Valid or Partly valid that match no key item. One line each. Do not judge whether they are true. They are unverified extras.

## Output

Write to OUT_PATH, in this order:

1. A table: `| Key id | Scope | Scope reason | Result | Run id | Evidence |`, one row per key item.
2. Counts, in this exact form, one per line:
   - `in scope: N`, `needs web: N`, `needs other source: N`
   - `Matched: N (of which in scope: N)`, `Partly matched: N (in scope: N)`, `Raised, not ruled: N (in scope: N)`, `Rejected: N (in scope: N)`, `Not found: N (in scope: N)`
   - `Recall strict, all items: Matched / total`
   - `Recall strict, in-scope items: Matched in scope / in scope`
   - `Recall lenient, in-scope items: (Matched + Partly) in scope / in scope`
   - `Reviewer-level recall, in-scope items: (Matched + Partly + Raised not ruled + Rejected) in scope / in scope`
3. The list from step 3.

You may run read-only commands. Do not modify any file except OUT_PATH.

## Reply

Reply with the counts block only, nothing else. If writing OUT_PATH is refused, do not look for another way to save it: reply with the full output (the table, the counts and the list) instead.
