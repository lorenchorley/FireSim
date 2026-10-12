#!/bin/sh
# Re-run study 01 from the start (or from a later step). Usage:  START=2 scripts/run_all.sh [python]
#   Step 1 needs inputs/photo.jpg, the model downloads and about five minutes of CPU.
#   Steps 2 to 6 need only data/ (step 3 keeps the committed invented-detail offsets when the photo is missing).
#   Step 7 needs the playwright package and a Chromium (set CHROMIUM_PATH if playwright has none of its own).
set -e
cd "$(dirname "$0")"
PY="${1:-python3}"
START="${START:-1}"
i=0
for step in step1_depth step2_compare_models step3_build_mesh step4_export step5_evaluate step6_viewer step7_figures; do
  i=$((i + 1))
  [ "$i" -lt "$START" ] && continue
  echo "== $step"
  "$PY" "$step.py"
done
