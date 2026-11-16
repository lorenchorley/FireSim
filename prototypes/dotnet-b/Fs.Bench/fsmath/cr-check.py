#!/usr/bin/env python3
"""T1.3: how many results of each implementation are not the correctly rounded value, over a sample of an input set, against mpmath at 400 bits.
    python3 -I Fs.Bench/fsmath/cr-check.py SET_DIR OUT.json MPMATH_DIR [MAX_CALLS_PER_FUNCTION=20000] [fn,fn,...]
SET_DIR holds {fn}.in and the result files {fn}.fdlibm.f64, {fn}.cms.f64, {fn}.node22.f64 (Fs.Bench fsmath-run, js-math.mjs ref). Every k-th call is taken so that at most
MAX calls per function are checked (k = ceil(calls / MAX), no randomness). Calls whose arguments are not finite, or whose true result is NaN (outside the real domain),
are skipped: the edge tests of Fs.Tests cover them. A result counts as correct when its bits equal the correctly rounded value's (+0 and -0 differ). hypot is checked too
but it is V8's own algorithm in both implementations, not a libm function: its distance from the correct value is information, not a defect."""
import array
import importlib.util
import json
import os
import struct
import sys

here = os.path.dirname(os.path.abspath(__file__))
set_dir, out_json, mp_dir = sys.argv[1], sys.argv[2], sys.argv[3]
cap = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else 20000
sys.path.insert(0, mp_dir)
spec = importlib.util.spec_from_file_location('cr_reference', os.path.join(here, 'cr-reference.py'))
cr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cr)

FNS = ['exp', 'log', 'pow', 'sin', 'cos', 'tan', 'atan', 'atan2', 'acos', 'asin', 'sinh', 'cbrt', 'log2', 'log10', 'hypot']
ARITY = {'pow': 2, 'atan2': 2, 'hypot': 2}
fns = sys.argv[5].split(',') if len(sys.argv) > 5 and sys.argv[5] else FNS
IMPLS = ['fdlibm', 'cms', 'node22']


def load(p):
    a = array.array('d')
    a.frombytes(open(p, 'rb').read())
    return a


def ib(v):
    return struct.unpack('<q', struct.pack('<d', v))[0]


def ulp(a, b):
    if a == b and ib(a) == ib(b):
        return 0
    if a != a or b != b:
        return 1 << 62
    oa = ib(a) if ib(a) >= 0 else -(ib(a) & 0x7FFFFFFFFFFFFFFF)
    ob = ib(b) if ib(b) >= 0 else -(ib(b) & 0x7FFFFFFFFFFFFFFF)
    return max(abs(oa - ob), 1 if ib(a) != ib(b) else 0)


result = {}
for fn in fns:
    ar = ARITY.get(fn, 1)
    p = f'{set_dir}/{fn}.in'
    if not os.path.exists(p):
        continue
    x = load(p)
    n = len(x) // ar
    outs = {i: load(f'{set_dir}/{fn}.{i}.f64') for i in IMPLS if os.path.exists(f'{set_dir}/{fn}.{i}.f64')}
    k = max(1, -(-n // cap))
    checked = 0
    stats = {i: {'notCorrectlyRounded': 0, 'maxUlp': 0, 'nanVsNumber': 0, 'examples': [], 'worst': None} for i in outs}
    for c in range(0, n, k):
        a = [x[ar * c + j] for j in range(ar)]
        if not all(v - v == 0 for v in a):  # NaN or infinite argument
            continue
        try:
            y = cr.cr_double(fn, a)
        except (ValueError, ZeroDivisionError):
            continue
        if y != y:
            continue
        checked += 1
        for i, o in outs.items():
            u = ulp(o[c], y)
            if u:
                s = stats[i]
                s['notCorrectlyRounded'] += 1
                if u >= (1 << 62):
                    s['nanVsNumber'] += 1
                s['maxUlp'] = max(s['maxUlp'], u)
                if s['worst'] is None or u > s['worst']['ulp']:
                    s['worst'] = {'call': c, 'args': [repr(v) for v in a], 'got': repr(o[c]), 'correct': repr(y), 'ulp': u}
                if len(s['examples']) < 4:
                    s['examples'].append({'call': c, 'args': [repr(v) for v in a], 'got': repr(o[c]), 'correct': repr(y), 'ulp': u})
    result[fn] = {'callsInSet': n, 'stride': k, 'checked': checked, 'impls': stats}
    print(fn.ljust(6), 'checked', checked, '  '.join(f"{i}: {s['notCorrectlyRounded']} (max {s['maxUlp']} ulp)" for i, s in stats.items()), flush=True)
json.dump({'setDir': os.path.basename(set_dir.rstrip('/')), 'maxCallsPerFunction': cap, 'precisionBits': 400, 'result': result}, open(out_json, 'w'), indent=1)
