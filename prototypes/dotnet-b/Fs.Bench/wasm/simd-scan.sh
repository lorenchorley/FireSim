#!/bin/bash
# T1.6a: does a published dotnet.native.wasm contain WebAssembly SIMD (v128) instructions? Disassembles with llvm-objdump from the wasm-tools workload's Emscripten pack
# (already installed, see TOOLCHAIN.md) and counts instructions whose mnemonic is a SIMD one (v128.*, i8x16.*, i16x8.*, i32x4.*, i64x2.*, f32x4.*, f64x2.*), in total and
# inside the functions that belong to the speed-test kernels (by name, if the name section survived).
#   bash simd-scan.sh PATH/dotnet.native.wasm [OUT_DIR]       (not heavy, but reads and writes about 100 MB of text: output goes to OUT_DIR, default $TMPDIR)
set -euo pipefail
W="$1"; OUT="${2:-${TMPDIR:-/tmp}}"
OBJDUMP="$(ls -d "${FIRESIM_DOTNET_ROOT:?source env.sh first}"/packs/Microsoft.NET.Runtime.Emscripten.*.Sdk.linux-x64/*/tools/bin | head -1)/llvm-objdump"
mkdir -p "$OUT"
"$OBJDUMP" -d "$W" > "$OUT/dis.txt" 2> "$OUT/dis.err" || true
echo "disassembly lines: $(wc -l < "$OUT/dis.txt")"
grep -E -c '^\s+[0-9a-f]+:\s+([0-9a-f]{2} )+\s+(v128|i8x16|i16x8|i32x4|i64x2|f32x4|f64x2)\.' "$OUT/dis.txt" | sed 's/^/SIMD instructions, whole module: /'
grep -E -o '^\s+[0-9a-f]+:\s+([0-9a-f]{2} )+\s+(v128|i8x16|i16x8|i32x4|i64x2|f32x4|f64x2)\.[a-z0-9_.]+' "$OUT/dis.txt" | sed -E 's/.*\s//' | sort | uniq -c | sort -rn | head -25
