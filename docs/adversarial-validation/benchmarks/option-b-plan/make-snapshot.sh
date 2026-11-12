#!/usr/bin/env bash
# Rebuild the benchmark snapshot: the option B prototype plan as it stood before its red team, with the
# repository files it cites, without git history or media. Usage: make-snapshot.sh <empty target dir>
# Needs the commit below. It sits on branch claude/3d-fire-simulation-app-xoy1o6 of lorenchorley/FireSim:
#   git fetch origin claude/3d-fire-simulation-app-xoy1o6
set -euo pipefail
target="${1:?usage: make-snapshot.sh <empty target dir>}"
commit=853f333   # 2026-11-12 06:10, before the red-team design commit 05795ff
mkdir -p "$target/snapshot"
git archive "$commit" README.md package.json tsconfig.json src docs studies desktop prototypes e2e scripts tests \
  | tar -x -C "$target/snapshot" --exclude='*.png' --exclude='*.jpg' --exclude='*.jpeg' --exclude='*.gif' \
      --exclude='*.mp4' --exclude='*.webm' --exclude='*.webp' --exclude='*.glb' --exclude='*.bin' --exclude='*.zip'
echo "snapshot: $target/snapshot ($(find "$target/snapshot" -type f | wc -l) files)"
echo "plan:     $target/snapshot/docs/plans/dotnet-option-b-prototype.md"
