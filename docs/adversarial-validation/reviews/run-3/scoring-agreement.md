# Agreement between the two independent scorings of run 3

scoring.md is the first scorer's table and is the one the report reads. scoring-2.md is the second scorer's, made with the first moved out of its reach. Both used the same instructions (scoring-prompt.md), the same key and the same model and effort. The comparison below is exact match of the Result column per key item.

```
items 35 35
result exact agreement: 31 / 35
found-or-not agreement (matched or partly = found): 33 / 35
scope agreement: 35 / 35
disagreements (id: scorer 1 -> scorer 2, run ids):
  G-7: [in scope] not found (-) -> [in scope] partly matched (S2 (R1.3, R3.3))
  N-1: [in scope] matched (O9) -> [in scope] partly matched (O9 (R1.2); X6 rejected the strong form)
  P-8: [in scope] partly matched (S3) -> [in scope] matched (S3 (R1.4, R5.4))
  S-5: [in scope] not found (-) -> [in scope] partly matched (S7 (R3.1))
```

Reading: the scope calls agree on all 35 items and the found-or-not call on 33. The strict figure (Matched only) is 7 of 28 in scope for both scorers. The lenient figure (Matched plus Partly) is 14 of 28 for the first and 16 of 28 for the second, so the honest range is 14 to 16 of 28. Four items differ, all borderline: G-7 and S-5 (not found against partly matched), N-1 (matched against partly matched) and P-8 (partly matched against matched).
