#!/usr/bin/env python3
"""T1.4b: Mono WebAssembly AOT under Node against the TypeScript in the same Node (V8 12.4), for the fast tier's kernels.

  python3 -I wasm-merge.py FIXTURES_DIR OUT.json            reads tsw-<fx>-{1,2}.json (bench.mjs, the A and the last A of A B B A) and wasm-<fx>-{1,2}.json (wasm-bench.mjs, the two Bs)
                                                           writes OUT.json and prints the Markdown table

Per kernel, fixture and form: ratio = median over the two wasm runs of (wasm median) divided by median over the two TypeScript runs of (TypeScript median): above 1 means WebAssembly is slower
(the bar of Gate 1W, on the whole step, is 1.25). "reinit net" subtracts the restore (the same copy in both languages) from both. The projection of the whole fast-tier step weights the ratios
with the shares of reports/1-profile.md (evaluate = stage 1 + stage 2): new step time = (1 - shares) + sum share * ratio, the other phases taken as equal in both engines (not measured).
"""
import json
import statistics
import sys

fix, out = sys.argv[1], sys.argv[2]
SHARES = {'k6f-900': (3.0, 2.9, 8.4), 'k6f-late': (13.6, 10.1, 9.2)}
res = {'method': 'median of the two runs of each side (A B B A: TypeScript, WebAssembly, WebAssembly, TypeScript; every run a fresh process; 1,000 single operations after a 1.5 s warm-up)', 'fixtures': {}}
lines = []
FORM = {0: 'scalar', 1: 'vector128'}  # wasm-bench.mjs spreads BenchOp's own numeric 'form' over its label; read both


def load(kind, fx, n):
    return json.load(open(f'{fix}/{kind}-{fx}-{n}.json'))


def med(runs, kernel, form=None):
    v = []
    for r in runs:
        for c in r['cases']:
            if c['kernel'] == kernel and (form is None or FORM.get(c.get('form'), c.get('form')) == form):
                v.append(c['medianMs'])
    return statistics.median(v), min(v), max(v), len(v)


for fx in ('k6f-900', 'k6f-late'):
    ts = [load('tsw', fx, 1), load('tsw', fx, 2)]
    ws = [load('wasm', fx, 1), load('wasm', fx, 2)]
    d = {'node': ts[0]['node'], 'v8': ts[0]['v8'], 'wasmRuntime': ws[0]['runtime'], 'loadavgAtStart': {'ts': [r['loadavg'] for r in ts], 'wasm': [r['loadavg'] for r in ws]}, 'kernels': {}}
    lines.append(f'\n#### {fx}\n\n| kernel | TypeScript ms (2 runs: min to max) | Mono AOT scalar | ratio | Mono AOT Vector128 | ratio |\n|---|---:|---:|---:|---:|---:|')
    restore_ts = med(ts, 'restore')[0]
    restore_w = med(ws, 'restore', 'scalar')[0]
    rows = {}
    for k in ('evalStage1', 'evalStage2', 'reinit', 'restore', 'pyro'):
        t, tlo, thi, _ = med(ts, k)
        s, slo, shi, _ = med(ws, k, 'scalar')
        row = {'tsMs': t, 'tsMinMs': tlo, 'tsMaxMs': thi, 'scalarMs': s, 'scalarMinMs': slo, 'scalarMaxMs': shi, 'scalarRatio': s / t}
        if k != 'restore':
            v, vlo, vhi, _ = med(ws, k, 'vector128')
            row.update({'vectorMs': v, 'vectorMinMs': vlo, 'vectorMaxMs': vhi, 'vectorRatio': v / t})
        d['kernels'][k] = row
        rows[k] = row
        lines.append(f"| {k} | {t:.4f} ({tlo:.4f} to {thi:.4f}) | {s:.4f} ({slo:.4f} to {shi:.4f}) | {s / t:.2f} | " + (f"{row['vectorMs']:.4f} ({row['vectorMinMs']:.4f} to {row['vectorMaxMs']:.4f}) | {row['vectorRatio']:.2f} |" if k != 'restore' else ' | |'))
    # evaluate = stage 1 + stage 2, reinit net of the restore
    ev = {f: (rows['evalStage1'][f + 'Ms'] + rows['evalStage2'][f + 'Ms']) / (rows['evalStage1']['tsMs'] + rows['evalStage2']['tsMs']) for f in ('scalar', 'vector')}
    rn = {'scalar': (rows['reinit']['scalarMs'] - restore_w) / (rows['reinit']['tsMs'] - restore_ts), 'vector': (rows['reinit']['vectorMs'] - restore_w) / (rows['reinit']['tsMs'] - restore_ts)}
    py = {'scalar': rows['pyro']['scalarRatio'], 'vector': rows['pyro']['vectorRatio']}
    se, sr, sp = SHARES[fx]
    d['ratios'] = {'evaluate': ev, 'reinitNet': rn, 'pyro': py}
    d['projectedStepTimeRatio'] = {}
    lines.append(f'\nWhole-step projection (shares {se} / {sr} / {sp} % of the step loop, everything else taken as equal in both engines):\n')
    for f in ('scalar', 'vector'):
        r = (100 - se - sr - sp) / 100 + (se * ev[f] + sr * rn[f] + sp * py[f]) / 100
        d['projectedStepTimeRatio'][f] = r
        lines.append(f'* all three kernels in Mono AOT {f}: evaluate {ev[f]:.2f}, reinit (net) {rn[f]:.2f}, pyrogenic {py[f]:.2f} of the TypeScript; step time {r:.3f} of the TypeScript (bar 1.25)')
    res['fixtures'][fx] = d
json.dump(res, open(out, 'w'), indent=1)
print('\n'.join(lines))
