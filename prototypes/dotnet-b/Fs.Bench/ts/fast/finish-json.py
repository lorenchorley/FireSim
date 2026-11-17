#!/usr/bin/env python3
"""T1.4b: the last step of reports/1-fast-kernels.json. `Fs.Bench fast-merge` wrote the BenchmarkDotNet and Node numbers and the projection; this adds what other tools measured:
the Mono WebAssembly AOT timings under Node (wasm-merge.py), the mutation checks (the FS_FAST_NOTES file that the tests append to), the build, the tests and the scan.

  python3 -I finish-json.py REPORT.json WASM_MERGED.json FIXTURES_DIR NOTES.txt COMMIT TESTS_PASSED
"""
import json
import re
import statistics
import sys

report, wasm_merged, fix, notes, commit, tests = sys.argv[1:7]
j = json.load(open(report))
w = json.load(open(wasm_merged))
j['build'] = {'configuration': 'Release', 'commit': commit}

# WebAssembly: runs (per kernel, fixture, form: median of the two Mono AOT runs) and the TypeScript of the same A B B A
for fx, d in w['fixtures'].items():
    for k, row in d['kernels'].items():
        j['runs'].append({'name': f'fast {k} mono-aot scalar [{fx}]', 'impl': 'cs-wasm-scalar', 'runtime': 'mono-wasm-aot', 'threads': 1, 'case': fx, 'kernel': k, 'n': 2000, 'medianMs': row['scalarMs'], 'minMs': row['scalarMinMs'], 'maxMs': row['scalarMaxMs'],
                          'p95Ms': row['scalarMaxMs'], 'ratioToTsSameEngine': row['scalarRatio'],
                          'notes': 'Mono WebAssembly AOT under Node 22 (V8 12.4), one thread; median of the two runs of an A B B A (TypeScript, WebAssembly, WebAssembly, TypeScript; fresh processes), each 1,000 single operations after a 1.5 s warm-up; p95Ms here is the larger run median, not a percentile'})
        if 'vectorMs' in row:
            j['runs'].append({'name': f'fast {k} mono-aot vector128 [{fx}]', 'impl': 'cs-wasm-vector', 'runtime': 'mono-wasm-aot', 'threads': 1, 'case': fx, 'kernel': k, 'n': 2000, 'medianMs': row['vectorMs'], 'minMs': row['vectorMinMs'], 'maxMs': row['vectorMaxMs'],
                              'p95Ms': row['vectorMaxMs'], 'ratioToTsSameEngine': row['vectorRatio'], 'notes': 'as the scalar line, Vector128 form'})
        j['runs'].append({'name': f'fast {k} typescript abba [{fx}]', 'impl': 'ts', 'runtime': 'v8-node', 'threads': 1, 'case': fx, 'kernel': k, 'n': 2000, 'medianMs': row['tsMs'], 'minMs': row['tsMinMs'], 'maxMs': row['tsMaxMs'], 'p95Ms': row['tsMaxMs'],
                          'notes': 'the TypeScript of the Mono AOT A B B A (two fresh processes); p95Ms here is the larger run median, not a percentile'})
j['wasmNode'] = w

# mutation checks, as the tests recorded them
mut = []
for line in open(notes):
    line = line.strip()
    m = re.match(r'(evaluate|pyrogenic) mutant (\w+): differs on (\d+) of (\d+) real (frames|fields), in outputs \[(.*)\]', line)
    if m:
        mut.append({'kernel': m.group(1), 'mutant': m.group(2), 'caught': int(m.group(3)), 'of': int(m.group(4)), 'outputs': [x for x in m.group(6).split(',') if x]})
    m = re.match(r're-associated sweep sum on (\d+) real reinit frames: caught by the double distance in (\d+), by the float32 distance in (\d+)', line)
    if m:
        mut.append({'kernel': 'reinit', 'mutant': 'sweep-sum-reassociated', 'frames': int(m.group(1)), 'caughtByDoubleDistance': int(m.group(2)), 'caughtByFloat32Distance': int(m.group(3))})
    m = re.match(r'pyrogenic lerp mutant, ([\w-]+): u differs as a double in (\d+) of (\d+) fire cells, after the float32 store in (\d+)', line)
    if m:
        mut.append({'kernel': 'pyrogenic', 'mutant': 'lerp-detail', 'fixture': m.group(1), 'doubleDiffers': int(m.group(2)), 'cells': int(m.group(3)), 'float32Differs': int(m.group(4))})
j['mutationChecks'] = mut
j['tests'] = {'fsTestsPassed': int(tests), 'note': 'dotnet test --project Fs.Tests -c Release; includes the child-process runs (AVX2, AVX-512, hardware intrinsics, tiering, PGO and OSR off), the 9-form bit-equality tests on the real frames and the mutation tests'}
j['notRun'] = list(dict.fromkeys(j['notRun'] + [
    'WebAssembly timing in Chromium and in the phone WebView (T1.6b; only Node 22 here)',
    'the fire model hook (prepareCell) is not ported: the evaluate benchmark answers the lazy speed requests with the coefficients the real hook wrote (recorded)',
    'CoreMathSharp as the default FsMath: the pyrogenic sine tables would then differ from Node 22 in the last bit and need the test-only shim; with the default (fdlibm) the tables equal Node 22 exactly',
]))
json.dump(j, open(report, 'w'), indent=1)
print('ok', len(j['runs']), 'runs', len(mut), 'mutation rows')
