#!/bin/bash
# Resumable matrix loop of T3.1b/T3.1c: one chunk of floors-run.mjs per hold of the heavy lock (about 13 minutes), then the lock is released for 20 s so that
# another builder's timed run can take it, repeat until nothing is pending or a job fails.
#   WORK=<scratch dir> bash floors-loop.sh KINDS [floors-run args, e.g. --glimpse --noembers]
#   KINDS = ref,chrome,chromeinit,noise (any subset; the Chromium arms need the refs of their cells)
# The store is $WORK/store, the run folders and the reference folders $WORK/work; builds go to prototypes/dotnet-b/fixtures/ (git-ignored).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
: "${WORK:?set WORK to a scratch directory}"
B=$repo/prototypes/dotnet-b/fixtures
export FS_BUILD_DIR=${FS_BUILD_DIR:-$B/.build-floors-clean} FS_BUILD_DIR_NOISE=${FS_BUILD_DIR_NOISE:-$B/.build-floors-noise} FS_SOLVER_OUT=${FS_SOLVER_OUT:-$B/.build-floors-browser} FS_REPO_ROOT=$repo
KINDS=$1; shift
cd "$repo"
while true; do
  pend=$(node prototypes/dotnet-b/ts-export/floors-run.mjs --store "$WORK/store" --work "$WORK/work" --kinds "$KINDS" "$@" --list | head -1)
  echo "$(date +%T) $pend"
  case "$pend" in *", 0 pending"*) echo "all done"; break;; esac
  flock /tmp/firesim-heavy.lock node prototypes/dotnet-b/ts-export/floors-run.mjs --store "$WORK/store" --work "$WORK/work" --kinds "$KINDS" --budget 780 "$@" || { echo "chunk failed"; exit 1; }
  sleep 20
done
