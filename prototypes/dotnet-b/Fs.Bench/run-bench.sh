#!/usr/bin/env bash
# Stage 1 desktop benchmark, whole thing under the heavy-work lock so nothing else heavy runs meanwhile.
#   flock /tmp/firesim-heavy.lock prototypes/dotnet-b/Fs.Bench/run-bench.sh SCRATCHPAD [REPEATS]
# Needs: the fixture (ts/capture.ts) in SCRATCHPAD/dotnet-fixtures/kernel, the .NET SDK in SCRATCHPAD/dotnet-sdk, node_modules reachable from the repo.
set -euo pipefail
SP="$1"
REPS="${2:-50}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export DOTNET_ROOT="$SP/dotnet-sdk" PATH="$SP/dotnet-sdk:$PATH" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
FIX="$SP/dotnet-fixtures/kernel"
echo "load average before: $(cat /proc/loadavg)"
node "$ROOT/prototypes/dotnet-b/Fs.Bench/ts/build.mjs" "$SP/dotnet-build/tsbench" "$ROOT/prototypes/dotnet-b/Fs.Bench/ts/bench.ts"
dotnet build "$ROOT/prototypes/dotnet-b/Fs.Bench/Fs.Bench.csproj" -c Release -v q --nologo
node "$SP/dotnet-build/tsbench/bench.mjs" "$FIX" "$SP/dotnet-build/ts-bench.json" "$REPS" 30
dotnet "$ROOT/prototypes/dotnet-b/Fs.Bench/bin/Release/net11.0/Fs.Bench.dll" bench "$FIX" "$SP/dotnet-build/ts-bench.json" "$ROOT/prototypes/dotnet-b/reports/1-kernel-results.json" "$REPS"
echo "load average after: $(cat /proc/loadavg)"
echo DONE
