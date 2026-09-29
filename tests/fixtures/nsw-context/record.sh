#!/usr/bin/env bash
# Records the fixtures of src/data/nswContext.test.ts: real ArcGIS REST responses for a 2 km x 2 km box in Blackheath
# (Blue Mountains, NSW), fetched with the same requests src/data/nswContext.ts makes (see src/data/nswContextCore.ts).
# For every layer: <layer>.ids.json  (returnIdsOnly response) and <layer>.features.json (all those objects, with the
# object-id field added to outFields so the test's fake server can serve any subset of ids).
# Usage: tests/fixtures/nsw-context/record.sh   (needs curl and jq; set HTTPS_PROXY if your network needs it)
# Data: (c) Spatial Services NSW and (c) State of NSW and Department of Planning, Housing and Infrastructure, CC BY 4.0.
set -euo pipefail
cd "$(dirname "$0")"
BBOX="150.2738,-33.6437,150.2954,-33.6257" # west,south,east,north (Blackheath village and the bush around it)
SS=https://portal.spatial.nsw.gov.au/server/rest/services
PLAN=https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer

# name | layer url | outFields | where | maxAllowableOffset | object-id field
layers=(
  "roads|$SS/NSW_Transport_Theme/FeatureServer/5|roadnamebase,roadnametype,roadnamesuffix,functionhierarchy,surface,roadontype,operationalstatus|operationalstatus=1|0.00002|objectid"
  "fireTrails|$SS/NSW_Transport_Theme/FeatureServer/9|objectid|1=1|0.00002|objectid"
  "homes|$SS/NSW_Geocoded_Addressing_Theme/FeatureServer/1|rid|1=1|0|rid"
  "zones|$PLAN/19|SYM_CODE,LAY_CLASS,LGA_NAME|1=1|0.00005|OBJECTID"
  "places|$SS/NSW_Features_of_Interest_Category/FeatureServer/1|generalname,placetype|1=1|0|objectid"
  "suburbs|$SS/NSW_Administrative_Boundaries_Theme/FeatureServer/2|suburbname|1=1|0.0005|rid"
)
for spec in "${layers[@]}"; do
  IFS='|' read -r name url fields where offset oid <<<"$spec"
  curl -sS -m 90 -X POST "$url/query" \
    --data-urlencode "geometry=$BBOX" -d geometryType=esriGeometryEnvelope -d inSR=4326 -d spatialRel=esriSpatialRelIntersects \
    --data-urlencode "where=$where" -d returnIdsOnly=true -d f=json >"$name.ids.json"
  ids=$(jq -r '.objectIds // [] | map(tostring) | join(" ")' "$name.ids.json")
  if [ -z "$ids" ]; then echo '{"features":[]}' >"$name.features.json"; continue; fi
  of="$fields"; case ",$fields," in *",$oid,"*) ;; *) of="$fields,$oid" ;; esac
  echo '{"features":[]}' >"$name.features.json"
  idarr=($ids)
  for ((i = 0; i < ${#idarr[@]}; i += 400)); do
    chunk=$(IFS=,; echo "${idarr[*]:i:400}")
    curl -sS -m 90 -X POST "$url/query" -d "objectIds=$chunk" --data-urlencode "outFields=$of" -d returnGeometry=true -d outSR=4326 \
      -d "maxAllowableOffset=$offset" -d geometryPrecision=5 -d f=json >part.tmp
    jq -c -s '{features: (.[0].features + .[1].features)}' "$name.features.json" part.tmp >merged.tmp
    mv merged.tmp "$name.features.json"
  done
  rm -f part.tmp
  echo "$name: ${#idarr[@]} objects, $(wc -c <"$name.features.json") bytes"
done
