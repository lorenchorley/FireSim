#!/bin/bash
# Runs the repo's own tap-target and layout audits against the S1 prototype, one URL per candidate and level.
# Run from the repo root with the prototype applied and a dev server on $BASE (default http://localhost:4301): bash docs/plans/spikes/S1-timeline-signal/tools/audits.sh
BASE=${BASE:-http://localhost:4301}
LOG=${LOG:-./s1-out/audits.log}
mkdir -p $(dirname $LOG)
: > $LOG
for vp in "412 915" "844 390"; do
  set -- $vp; W=$1; H=$2
  for spec in "none:ok" "t1:behind" "t1:waiting" "t2:behind" "t2:waiting" "t3:behind" "t3:waiting"; do
    v=${spec%%:*}; l=${spec##*:}
    if [ "$v" = none ]; then url="$BASE/?mock=1"; else url="$BASE/?mock=1&pace=$v&paceLevel=$l"; fi
    echo "=== tap-targets $v $l ${W}x${H}" >> $LOG
    nice -n 8 node scripts/audit-tap-targets.mjs "$url" --click accept-notice,site-katoomba,build --wait sim --width $W --height $H >> $LOG 2>&1
    echo "exit $?" >> $LOG
  done
done
for spec in "none" "t1" "t2" "t3"; do
  if [ "$spec" = none ]; then url="$BASE"; else url="$BASE/?mock=1&pace=$spec&paceLevel=waiting#"; fi
  echo "=== layout-budget $spec" >> $LOG
  nice -n 8 node scripts/layout-budget.mjs --url "$url" >> $LOG 2>&1
  echo "exit $?" >> $LOG
done
echo ALLDONE >> $LOG
