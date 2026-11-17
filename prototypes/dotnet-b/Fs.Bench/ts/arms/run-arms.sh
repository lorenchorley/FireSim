#!/usr/bin/env bash
# T1.5 (a)-(c): the driver of the TypeScript arms. LOCK-FREE inner entry point: it never takes /tmp/firesim-heavy.lock itself (a nested flock deadlocks everyone), so run the timed steps as
#     flock /tmp/firesim-heavy.lock bash prototypes/dotnet-b/Fs.Bench/ts/arms/run-arms.sh STEP FIXTURES RESULTS [ROUND]
# (`measure.sh` does that, one lock per step, no step longer than about ten minutes). From the repository root; node_modules must be reachable (npm ci or a link).
#   FIXTURES  holds air/fx-k3std, air/fx-k6high (Fs.Bench/ts/air/regen.sh) and fast/fx-k6f-900, fast/fx-k6f-late (fast/regen.sh); never committed
#   RESULTS   a scratch folder for the run files (one JSON per process)
# Steps:
#   build                  bundle the Node runner and worker (prototypes/dotnet-b/fixtures/.build-arms); the browser bundles are built by run-arms-browser.mjs on first use
#   verify                 every arm, every worker count, every problem: the output hashes against the golden hashes (a quick check; thresholds as the app's, then forced to chunk)
#   node ROUND             Node: arm (a) the app's kernels in one worker, arm (b) the pool on 1, 2, 4, 8 workers; single operations per sample (as T1.4's TypeScript timing)
#   abba ROUND             Node worker against Chromium worker, the app's kernels, batched samples (2 ms): Node, Chromium, Chromium, Node, per problem
#   chromium ROUND         Chromium (cross-origin isolated): the pool on 1, 2, 4, 8 workers, batched samples
#   spin                   spin-wait sensitivity of the pool (a few kernels, 2 and 4 workers, spin 0, 20, 200, 2000 microseconds) and 8 workers with and without spinning
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../../.." && pwd)"
pd="$root/prototypes/dotnet-b"
step="${1:?step}"; fix="${2:?fixtures}"; res="${3:?results}"; round="${4:-1}"
mkdir -p "$res"
cd "$root"
build="$pd/fixtures/.build-arms"
node_run() { node "$build/node-main.mjs" --fixtures "$fix" "$@"; }
chr_run() { node "$pd/harness/run-arms-browser.mjs" --fixtures "$fix" "$@"; }
problems="air:k3std air:k6high fast:k6f-900 fast:k6f-late"
tag() { echo "${1//:/_}"; }
log() { echo "$(date -u +%H:%M:%S) load $(cut -d' ' -f1-3 /proc/loadavg) $*"; }

case "$step" in
build)
  node "$pd/Fs.Bench/ts/build.mjs" "$build" "$here/node-main.ts" "$here/worker-node.ts"
  ;;
verify)
  for p in $problems; do
    for force in "" "--force"; do
      f="${force:+-forced}"
      node_run --arm app --mode verify --problem "$p" --out "$res/verify-node-app$f-$(tag $p).json"
      for n in 1 2 4 8; do node_run --arm pool --threads $n --mode verify --problem "$p" $force --out "$res/verify-node-pool$n$f-$(tag $p).json"; done
      chr_run --arm app --mode verify --problem "$p" --out "$res/verify-chromium-app$f-$(tag $p).json"
      for n in 1 2 4 8; do chr_run --arm pool --threads $n --mode verify --problem "$p" $force --out "$res/verify-chromium-pool$n$f-$(tag $p).json"; done
    done
  done
  ;;
node)
  for p in $problems; do
    log "node round $round $p"
    node_run --arm app --mode time --problem "$p" --out "$res/time-node-app-$(tag $p)-r$round.json"
    for n in 1 2 4 8; do node_run --arm pool --threads $n --mode time --problem "$p" --out "$res/time-node-pool$n-$(tag $p)-r$round.json"; done
  done
  ;;
abba)
  for p in $problems; do
    log "abba round $round $p"
    node_run --arm app --mode time --problem "$p" --min-sample-ms 2 --samples 500 --out "$res/abba-node-app-$(tag $p)-r$round-1.json"
    chr_run --arm app --mode time --problem "$p" --min-sample-ms 2 --samples 500 --out "$res/abba-chromium-app-$(tag $p)-r$round-1.json"
    chr_run --arm app --mode time --problem "$p" --min-sample-ms 2 --samples 500 --out "$res/abba-chromium-app-$(tag $p)-r$round-2.json"
    node_run --arm app --mode time --problem "$p" --min-sample-ms 2 --samples 500 --out "$res/abba-node-app-$(tag $p)-r$round-2.json"
  done
  ;;
chromium)
  for p in $problems; do
    log "chromium round $round $p"
    for n in 1 2 4 8; do chr_run --arm pool --threads $n --mode time --problem "$p" --out "$res/time-chromium-pool$n-$(tag $p)-r$round.json"; done
  done
  ;;
spin)
  log "spin sensitivity"
  for n in 2 4; do
    for sp in 0 20 200 2000; do
      node_run --arm pool --threads $n --mode time --problem air:k3std --only relax,gradient,advect --samples 400 --warm 800 --spin $sp --out "$res/spin-node-pool$n-s$sp-air_k3std.json"
      node_run --arm pool --threads $n --mode time --problem fast:k6f-late --only evalStage2,reinit,pyro --samples 400 --warm 800 --spin $sp --out "$res/spin-node-pool$n-s$sp-fast_k6f-late.json"
    done
  done
  for sp in 0 200; do
    node_run --arm pool --threads 8 --mode time --problem fast:k6f-late --only evalStage2,pyro --samples 100 --warm 400 --spin $sp --out "$res/spin-node-pool8-s$sp-fast_k6f-late.json"
  done
  ;;
*) echo "unknown step $step" >&2; exit 2 ;;
esac
log "step $step round $round done"
