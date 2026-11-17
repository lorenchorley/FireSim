#!/usr/bin/env bash
# Re-derives the slice JSONs of reports/3-slice-map.md. From the repository root. Needs node_modules/typescript (or TS_PATH=<dir of the typescript package>).
# Output folder: $1 (default $FIRESIM_SCRATCH/T3.3). Cuts = what the report lists as "left out", each a regex on "file:Name".
set -euo pipefail
OUT="${1:-${FIRESIM_SCRATCH:?source prototypes/dotnet-b/env.sh first}/T3.3}"; mkdir -p "$OUT"
S=prototypes/dotnet-b/reports/3-slice-map/slice.mjs
CUT='src/sim/simulation\.ts:Simulation\.(makeSnapshot|emitSnapshot|coalesceNow|emitRunEnd|engineInfo|makeStats|makeCheckpoint|restore|view|windKnown|memoryReport|checkpointBytes|switchTier|noteTierSwitch|autoTuneDecide|signedSlopeFlow|atmModuleMs|addPerf|setSnapshotInterval|rebuildFuel|afterFuelChange|windChanged|refreshWx|rebindWind|setWindEdits|wholeMinute|applyOption|fireSubCount)$'
CUT="$CUT"',src/sim/simulation\.ts:(typedBytes|sparseHeat|decimateView|down2|down3|windKey|lap|mark)$'
CUT="$CUT"',src/sim/stats\.ts:(?!frontRos),src/sim/records\.ts:(activeEdits|fuelSequence|sameSequence)'
CUT="$CUT"',src/embers/EmberModel\.ts:EmberModel\.(stats|overlays|peekLanding|particles|checkpoint|restore)$,src/fuel/moisture/model\.ts:MoistureModel\.breakdown$'
CF='^src/(explain/|sim/perfStats|sim/engineInfo|sim/fireWindPublish|core/datasets|scenario/windDirection|scenario/openMeteo|fuel/edits|fuel/polygon|embers/stats|fire/spread/attribution)'
node $S --out "$OUT/slice-union.json" --cut "$CUT" --cut-file "$CF" --list > "$OUT/slice-union.txt"
node $S --out "$OUT/slice-fast.json"  --cut "$CUT" --cut-file "$CF|^src/atmosphere/atmosphere\.ts"
node $S --out "$OUT/slice-std.json"   --cut "$CUT" --cut-file "$CF|^src/atmosphere/diagnosticWind\.ts"
node $S --out "$OUT/slice-all.json"   --list > "$OUT/slice-all.txt"      # no cuts at all: the over-approximated closure of Simulation's constructor, spinUp and advance
tail -1 "$OUT/slice-union.txt" "$OUT/slice-all.txt"
