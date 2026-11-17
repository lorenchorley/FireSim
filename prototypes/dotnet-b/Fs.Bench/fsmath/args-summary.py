#!/usr/bin/env python3
"""T1.3: summarises the solver arguments recorded by record-args.mjs (one or more OUT dirs).
    python3 -I Fs.Bench/fsmath/args-summary.py DIR [DIR...]
Prints, per function: calls seen, the minimum and maximum of each argument, the share of zero / negative / NaN / infinite arguments, and the exponent
range holding 98 % of the calls (floor(log2 |arg|), zeros and non-finite ones left out)."""
import json
import sys

tot = {}
for d in sys.argv[1:]:
    st = json.load(open(f'{d}/stats.json'))['stats']
    for fn, v in st.items():
        if not v.get('total'):
            continue
        t = tot.setdefault(fn, {'total': 0, 'min': None, 'max': None, 'zero': None, 'neg': None, 'nan': 0, 'inf': 0, 'hist': None, 'arity': v.get('arity', 1), 'starStar': 0, 'threeArg': 0})
        t['total'] += v['total']
        t['starStar'] += v.get('starStar') or 0
        t['threeArg'] += v.get('threeArg') or 0
        if 'min' not in v:
            continue
        t['nan'] += v['nan']
        t['inf'] += v['inf']
        for k in range(t['arity']):
            if t['min'] is None:
                t['min'] = [None] * t['arity']; t['max'] = [None] * t['arity']; t['zero'] = [0] * t['arity']; t['neg'] = [0] * t['arity']; t['hist'] = [dict() for _ in range(t['arity'])]
            t['min'][k] = v['min'][k] if t['min'][k] is None else min(t['min'][k], v['min'][k])
            t['max'][k] = v['max'][k] if t['max'][k] is None else max(t['max'][k], v['max'][k])
            t['zero'][k] += v['zero'][k]
            t['neg'][k] += v['negative'][k]
            for e, c in v['log2Hist'][k].items():
                t['hist'][k][int(e)] = t['hist'][k].get(int(e), 0) + c
for fn, t in tot.items():
    if fn == 'pow2':
        print(f"{fn:6} total {t['total']}  (`**` with exponent 2: x * x in the port)")
        continue
    print(f"{fn:6} total {t['total']:>9}" + (f"  (of which `**`: {t['starStar']})" if t['starStar'] else '') + (f"  three-argument calls: {t['threeArg']}" if t['threeArg'] else ''))
    if t['min'] is None:
        continue
    for k in range(t['arity']):
        h = {e: c for e, c in t['hist'][k].items() if e > -9000}
        n = sum(h.values())
        cum = 0
        lo = hi = None
        keys = sorted(h)
        # exponent window holding the middle 98 %
        for e in keys:
            cum += h[e]
            if lo is None and cum >= 0.01 * n:
                lo = e
            if hi is None and cum >= 0.99 * n:
                hi = e
        print(f"       arg{k}: min {t['min'][k]:.6g}  max {t['max'][k]:.6g}  zero {t['zero'][k]}  negative {t['neg'][k]}  log2|x| 1%..99%: {lo}..{hi}")
    print(f"       NaN {t['nan']}  infinite {t['inf']}")
