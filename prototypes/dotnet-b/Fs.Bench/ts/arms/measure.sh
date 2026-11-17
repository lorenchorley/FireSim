#!/usr/bin/env bash
# T1.5 (a)-(c): the timed campaign that made reports/1-ts-arms.md: three rounds of [Node arms, A B B A Node/Chromium, Chromium pool], then the spin study, each STEP under its own
# `flock /tmp/firesim-heavy.lock` (a hold of at most about ten minutes; another builder shares the lock). run-arms.sh, the inner script, never takes the lock.
#   source prototypes/dotnet-b/env.sh                                    (not needed for this card: no dotnet)
#   bash prototypes/dotnet-b/Fs.Bench/ts/air/regen.sh  FIX/air           fixtures (once)
#   bash prototypes/dotnet-b/Fs.Bench/ts/fast/regen.sh FIX/fast
#   bash prototypes/dotnet-b/Fs.Bench/ts/arms/run-arms.sh build FIX RES
#   flock /tmp/firesim-heavy.lock bash prototypes/dotnet-b/Fs.Bench/ts/arms/run-arms.sh verify FIX RES       the hash checks (not timed)
#   bash prototypes/dotnet-b/Fs.Bench/ts/arms/measure.sh FIX RES         this file (do not edit the sources while it runs)
#   node prototypes/dotnet-b/Fs.Bench/ts/arms/make-report.mjs RES prototypes/dotnet-b/reports/1-ts-arms.json COMMIT RES/conditions.json
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fix="${1:?fixtures}"; res="${2:?results}"
mkdir -p "$res"
cond="$res/conditions.log"
: > "$cond"
run() { # step round
  echo "$1 r$2 before: $(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$cond"
  flock /tmp/firesim-heavy.lock bash "$here/run-arms.sh" "$1" "$fix" "$res" "$2" >> "$res/measure.log" 2>&1
  echo "$1 r$2 after:  $(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$cond"
}
for r in 1 2 3; do
  run node $r
  run abba $r
  run chromium $r
done
run spin 1
echo "done; conditions in $cond; now make-report.mjs"
