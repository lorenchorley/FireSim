#!/usr/bin/env bash
# Rebuilds the S2 trim experiments. Each patch in this folder is applied to a copy of the sources of the build commit and
# built the way the APK is built (vite build --mode capacitor), then the figures of scripts/check-bundle.mjs are printed.
# The patches are measurements, not proposals: they are crude (some break types or behaviour) and only show what each change
# is worth. Nothing in the repository is changed: the sources come from `git archive`, the builds go to the scratch folder.
#
#   docs/plans/spikes/S2-bundle/results/experiments/run.sh <scratch dir> [experiment ...]
#
# Experiments (default: all of them): baseline T1 T2 T3a T3b T4a T4b T5 T5a T5b T6 T7 T8 T9 safe safe+T5a safe+T4b safe+T3b all
#   T2 includes T1; "safe" = T1 + T2 + T6; the "safe+" rows add one more change; "all" = T1 + T2 + T3b + T4b + T5 + T6.
# Environment: COMMIT (default: the commit the note was measured on).
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
COMMIT=${COMMIT:-64c213354dbe85cd94abf324639af1fdd08b87ff}
SCRATCH=$(mkdir -p "${1:?usage: run.sh <scratch dir> [experiment ...]}" && cd "$1" && pwd)
shift || true

declare -A PATCHES=(
  [baseline]=""
  [T1]="T1-geotiff-decoders"
  [T2]="T1-geotiff-decoders T2-pako-to-fflate"
  [T3a]="T3a-sim-fallback-lazy"
  [T3b]="T3b-sim-fallback-removed"
  [T4a]="T4a-mocks-lazy"
  [T4b]="T4b-mocks-not-in-apk"
  [T5]="T5-lazy-model-card-and-datasets"
  [T5a]="T5a-lazy-model-card"
  [T5b]="T5b-lazy-datasets"
  [T6]="T6-fuel-barrel"
  [T7]="T7-scenario-barrel"
  [T8]="T8-object-freeze-pure"
  [T9]="T9-wind-arrows-and-debug-hook"
  [safe]="T1-geotiff-decoders T2-pako-to-fflate T6-fuel-barrel"
  [safe+T5a]="T1-geotiff-decoders T2-pako-to-fflate T6-fuel-barrel T5a-lazy-model-card"
  [safe+T4b]="T1-geotiff-decoders T2-pako-to-fflate T4b-mocks-not-in-apk T6-fuel-barrel"
  [safe+T3b]="T1-geotiff-decoders T2-pako-to-fflate T3b-sim-fallback-removed T6-fuel-barrel"
  [all]="T1-geotiff-decoders T2-pako-to-fflate T3b-sim-fallback-removed T4b-mocks-not-in-apk T5-lazy-model-card-and-datasets T6-fuel-barrel"
)
ORDER=(baseline T1 T2 T3a T3b T4a T4b T5 T5a T5b T6 T7 T8 T9 safe safe+T5a safe+T4b safe+T3b all)
if [ "$#" -gt 0 ]; then ORDER=("$@"); fi
# The baseline is always built first: the "vs baseline" columns need it.
if [ "${ORDER[0]}" != baseline ]; then ORDER=(baseline "${ORDER[@]}"); fi

SNAP="$SCRATCH/snap"
if [ ! -d "$SNAP/src" ]; then
  mkdir -p "$SNAP"
  git -C "$REPO" archive "$COMMIT" | tar -x -C "$SNAP"
fi

echo "| Experiment | All JS gzip kB | vs baseline | Entry gzip kB | vs baseline | All JS raw kB | Parsed at start-up, raw kB |"
echo "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
BASE_JS=""; BASE_ENTRY=""
for name in "${ORDER[@]}"; do
  W="$SCRATCH/exp/$name"
  rm -rf "$W"; mkdir -p "$W"
  cp -a "$SNAP/src" "$SNAP/index.html" "$SNAP/vite.config.ts" "$SNAP/package.json" "$SNAP/tsconfig.json" "$W/"
  ln -s "$REPO/node_modules" "$W/node_modules"
  mkdir "$W/public"
  for p in ${PATCHES[$name]}; do (cd "$W" && patch -p1 -s < "$HERE/$p.patch"); done
  (cd "$W" && nice -n 10 npx vite build --mode capacitor --outDir "$W/dist" --emptyOutDir > "$W/build.log" 2>&1) || { echo "| $name | build failed (see $W/build.log) | | | | | |"; continue; }
  out=$(node "$REPO/scripts/check-bundle.mjs" --dist "$W/dist" || true)
  entry=$(echo "$out" | awk '/entry gzip/ {print $(NF-2)}')
  js=$(echo "$out" | awk '/ js gzip/ {print $(NF-2)}')
  raw=$(echo "$out" | sed -n 's/.*(raw: js \([0-9]*\) kB.*/\1/p')
  # Same JS with source maps, to see which chunks load at start-up (the call sites come from the maps).
  (cd "$W" && nice -n 10 npx vite build --mode capacitor --sourcemap --outDir "$W/dist-map" --emptyOutDir > "$W/build-map.log" 2>&1) || true
  boot=$(node "$HERE/../../attribute.mjs" chunks --dist "$W/dist-map" 2>/dev/null | sed -n 's/.*start-up (phases 1 and 2): raw \([0-9.]*\) kB.*/\1/p')
  if [ "$name" = baseline ]; then BASE_JS=$js; BASE_ENTRY=$entry; fi
  dj=$(awk -v a="$js" -v b="${BASE_JS:-$js}" 'BEGIN { printf "%+.1f", a - b }')
  de=$(awk -v a="$entry" -v b="${BASE_ENTRY:-$entry}" 'BEGIN { printf "%+.1f", a - b }')
  echo "| $name | $js | $dj | $entry | $de | $raw | ${boot:-?} |"
done
