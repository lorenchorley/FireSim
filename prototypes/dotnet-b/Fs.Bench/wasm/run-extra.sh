#!/bin/bash
# T1.6a: the reference runs added after run-all.sh (report section 5): TypeScript alone (a fresh process / worker that never loads WebAssembly), 3 runs per engine, and a
# second AOT suite per engine (a repeat of the A B B A measurement, minutes later). One step per heavy-lock hold, like run-all.sh.
#   bash prototypes/dotnet-b/Fs.Bench/wasm/run-extra.sh $S        (after the same setup as run-all.sh; results in $S/results/)
set -uo pipefail
S="$1"
R="$S/results"
W="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export FS_KERNELS_OUT="$S"
mkdir -p "$R"
step() {
  local name="$1"; shift
  echo "$(date +%T) begin $name  uptime:$(uptime | sed 's/.*load average//')" | tee -a "$R/loads.txt"
  flock /tmp/firesim-heavy.lock "$@" > "$R/$name.log" 2>&1 || echo "FAILED $name" | tee -a "$R/loads.txt"
  echo "$(date +%T) end   $name  uptime:$(uptime | sed 's/.*load average//')" | tee -a "$R/loads.txt"
}
fw="$S/aot/wwwroot/_framework"
for i in 1 2 3; do
  for e in node chromium; do
    step "tsalone-$e-$i" node "$W/speed-run.mjs" "$e" "$fw" "$R/tsalone-$e-$i.json" "$e-tsalone" --mode tsalone
  done
done
for e in node chromium; do
  step "suite-$e-aot-rep2" node "$W/speed-run.mjs" "$e" "$fw" "$R/suite-$e-aot-rep2.json" "$e-aot-rep2" --mode suite --build aot
done
