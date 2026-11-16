#!/bin/bash
# T1.6a: every timed run of the report, one step per heavy-lock hold (so other builders wait at most one step). From the repository root, after
#   source prototypes/dotnet-b/env.sh; S=$FIRESIM_SCRATCH/T1.6a
#   flock /tmp/firesim-heavy.lock dotnet publish prototypes/dotnet-b/Fs.Wasm -c Release -o $S/aot
#   rm -rf prototypes/dotnet-b/Fs.Wasm/obj prototypes/dotnet-b/Fs.Wasm/bin     (REQUIRED between the two publishes: the interpreter build must not reuse the AOT build's stripped assemblies)
#   flock /tmp/firesim-heavy.lock dotnet publish prototypes/dotnet-b/Fs.Wasm -c Release -p:RunAOTCompilation=false -o $S/interp
#   FS_KERNELS_OUT=$S npx vite build -c prototypes/dotnet-b/harness/vite.kernels.config.ts
#   node prototypes/dotnet-b/Fs.Bench/fsmath/gen-inputs.mjs $S/inputs 65536
#   bash prototypes/dotnet-b/Fs.Bench/wasm/run-all.sh $S            (BUILDS=interp to redo only one build; results in $S/results/*.json, load averages in $S/results/loads.txt)
set -uo pipefail
S="$1"
R="$S/results"
W="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export FS_KERNELS_OUT="$S"
mkdir -p "$R"
step() { # name command...
  local name="$1"; shift
  echo "$(date +%T) begin $name  uptime:$(uptime | sed 's/.*load average//')" | tee -a "$R/loads.txt"
  flock /tmp/firesim-heavy.lock "$@" > "$R/$name.log" 2>&1 || echo "FAILED $name" | tee -a "$R/loads.txt"
  echo "$(date +%T) end   $name  uptime:$(uptime | sed 's/.*load average//')" | tee -a "$R/loads.txt"
}
for b in ${BUILDS:-aot interp}; do
  for e in node chromium; do
    fw="$S/$b/wwwroot/_framework"
    step "suite-$e-$b" node "$W/speed-run.mjs" "$e" "$fw" "$R/suite-$e-$b.json" "$e-$b" --mode suite --build "$b"
    for i in 1 2 3 4 5; do
      step "startup-$e-$b-$i" node "$W/speed-run.mjs" "$e" "$fw" "$R/startup-$e-$b-$i.json" "$e-$b" --mode startup --build "$b"
    done
  done
done
for e in node chromium; do
  step "app-$e" node "$W/speed-run.mjs" "$e" "$S/aot/wwwroot/_framework" "$R/app-$e.json" "$e" --mode app --rounds 3
done
step fsmath bash "$W/fsmath-abba.sh" "$S/inputs" "$S/aot/wwwroot/_framework" "$S/interp/wwwroot/_framework" "$R/fsmath" 3
