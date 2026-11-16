#!/bin/bash
# T1.6a second table: V8's own Math (js-math.mjs / chromium-ref.mjs) against the FsMath functions as Mono WebAssembly (wasm-run.mjs ... ns), same engine, A B B A, ROUNDS rounds,
# 65,536 calls x 15 repeats per function (the T1.3 method), each run its own process. Writes OUT/{engine}-{build}-r{N}-{js|wasm}-{1|2}.json. Merge with fsmath-merge.mjs.
#   flock /tmp/firesim-heavy.lock bash fsmath-abba.sh INPUTS_DIR AOT_FRAMEWORK_DIR INTERP_FRAMEWORK_DIR OUT_DIR [ROUNDS=3]
# INPUTS_DIR: node Fs.Bench/fsmath/gen-inputs.mjs INPUTS_DIR 65536 (the T1.3 generator; the first 65,536 calls of its 10^6 are the same draws).
set -euo pipefail
IN="$1"; AOT="$2"; INT="$3"; OUT="$4"; ROUNDS="${5:-3}"
F="$(cd "$(dirname "${BASH_SOURCE[0]}")/../fsmath" && pwd)"
mkdir -p "$OUT"
js() { # engine outfile
  if [ "$1" = node ]; then node "$F/js-math.mjs" ns "$IN" "$2" 65536 15 >/dev/null; else node "$F/chromium-ref.mjs" ns "$IN" "$2" 65536 15 >/dev/null; fi
}
wasm() { # engine framework build outfile
  node "$F/wasm-run.mjs" "$1" "$2" ns "$IN" "$4" "wasm-$3-$1" 65536 15 >/dev/null
}
for r in $(seq 1 "$ROUNDS"); do
  for eng in node chromium; do
    for build in aot interp; do
      fw="$AOT"; [ "$build" = interp ] && fw="$INT"
      echo "round $r $eng $build: $(date +%T) load $(cut -d' ' -f1 /proc/loadavg)"
      js "$eng" "$OUT/$eng-$build-r$r-js-1.json"
      wasm "$eng" "$fw" "$build" "$OUT/$eng-$build-r$r-wasm-1.json"
      wasm "$eng" "$fw" "$build" "$OUT/$eng-$build-r$r-wasm-2.json"
      js "$eng" "$OUT/$eng-$build-r$r-js-2.json"
    done
  done
done
echo "done $(date +%T) load $(cut -d' ' -f1 /proc/loadavg)"
