#!/usr/bin/env bash
# Shows, in a throwaway copy, that the solver rules break the build (plan T0.4 "done when"), and that the exemptions and the non-solver projects hold:
#   1. a bad file in Fs.Kernel (a solver project): Math.Exp and a double-to-int cast       -> the build FAILS with RS0030 and FS0001
#   1b. (T0.4b) a bad file with one line per new ban: Fma.MultiplyAdd, AdvSimd.FusedMultiplyAdd, AdvSimd.Arm64.FusedMultiplyAdd, Vector128.FusedMultiplyAdd,
#       double.FusedMultiplyAdd, Convert.ToInt32(double), Convert.ToInt64(float), Convert.ChangeType, int.CreateTruncating, byte.CreateSaturating,
#       T.CreateChecked (generic math)                                                      -> the build FAILS, with RS0030 for every one of them
#   1c. (T0.4c) a bad file with one line per new ban: Sse.Reciprocal, Sse.ReciprocalSqrt, Avx512F.Reciprocal14, AdvSimd.ReciprocalEstimate, Avx2.IsSupported, Sve.IsSupported,
#       PackedSimd.Add (the namespaces X86, Arm, Wasm), Vector128/256/512.ConvertToInt32/Int64/UInt32/UInt64, double.ConvertToInteger, decimal.ToInt32   -> the build FAILS with RS0030 for every one of them
#   1d. (T0.4c) a bad file with one cast per new FS0001 rule: (int)Half, (long)decimal, (double)decimal, (float)decimal, (Int128)double   -> the build FAILS with FS0001 for each
#   2. the same code (1, 1b, 1c and 1d) in FsMath.cs and FsConv.cs (exempt by file name)            -> the build PASSES
#   3. (T1.4b) the same code in Fs.Kernel/Pyrogenic/ (until T1.4b the "not a gate kernel" folder, exempt by path): it is a solver folder like any other now
#      -> the build FAILS with RS0030 and FS0001, and with RS0030 for every symbol of 1b and 1c and FS0001 for every cast of 1d
#   4. the same code in a project that is not a solver project                              -> the build PASSES
# Run (from anywhere):   bash prototypes/dotnet-b/Fs.Analyzers/tools/demo-bad-solver.sh        Needs `source prototypes/dotnet-b/env.sh` first.
# Nothing in the repository is touched: the copy lives in a fresh mktemp directory and is deleted at the end (set KEEP=1 to keep it).
set -u
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap '[ "${KEEP:-0}" = 1 ] && echo "kept $tmp" || rm -rf "$tmp"' EXIT

mkdir -p "$tmp/Fs.Kernel/Pyrogenic" "$tmp/Fs.Other"
cp "$root/Directory.Build.props" "$root/.editorconfig" "$root/global.json" "$root/BannedSymbols.txt" "$tmp/"
mkdir "$tmp/Fs.Analyzers"
cp "$root/Fs.Analyzers/Fs.Analyzers.csproj" "$root/Fs.Analyzers/FloatToIntegerCastAnalyzer.cs" "$root/Fs.Analyzers/Solver.props" "$tmp/Fs.Analyzers/"
cat > "$tmp/Fs.Kernel/Fs.Kernel.csproj" <<'XML'
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net11.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>
XML
cat > "$tmp/Fs.Other/Fs.Other.csproj" <<'XML'
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net11.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>
XML
body='static class CLASS { public static int F(double x) { return (int)x + (int)Math.Exp(x); } public static double G(double x) => Math.Round(x) + Math.Sin(x) + Math.Sqrt(x); }'
usings='using System.Numerics; using System.Runtime.Intrinsics; using System.Runtime.Intrinsics.X86; using System.Runtime.Intrinsics.Arm;'
# one line per T0.4b ban, each in its own method so that every diagnostic is reported (the symbols the demo expects are in expected_t04b)
body2='static class CLASS2 {
  public static Vector128<double> A(Vector128<double> v) => Fma.MultiplyAdd(v, v, v);
  public static Vector128<float> B(Vector128<float> v) => AdvSimd.FusedMultiplyAdd(v, v, v);
  public static Vector128<double> C(Vector128<double> v) => AdvSimd.Arm64.FusedMultiplyAdd(v, v, v);
  public static Vector128<float> D(Vector128<float> v) => Vector128.FusedMultiplyAdd(v, v, v);
  public static double E(double x) => double.FusedMultiplyAdd(x, x, x);
  public static int F(double x) => Convert.ToInt32(x);
  public static long G(float x) => Convert.ToInt64(x);
  public static object H(object o) => Convert.ChangeType(o, typeof(int));
  public static int I(double x) => int.CreateTruncating(x);
  public static byte J(double x) => byte.CreateSaturating(x);
  public static T K<T>(double x) where T : INumberBase<T> => T.CreateChecked(x);
}'
expected_t04b=("Fma.MultiplyAdd" "AdvSimd.FusedMultiplyAdd" "AdvSimd.Arm64.FusedMultiplyAdd" "Vector128.FusedMultiplyAdd" "double.FusedMultiplyAdd"
  "Convert.ToInt32(double)" "Convert.ToInt64(float)" "Convert.ChangeType(object?, Type)" "int.CreateTruncating" "byte.CreateSaturating" "INumberBase<TSelf>.CreateChecked")
# T0.4c: one line per banned namespace and per Vector.ConvertTo family (RS0030), and one cast per new FS0001 rule
# Sve is evaluation-only: SYSLIB5003 is a compile error unless suppressed (the ban holds either way)
usings3='#pragma warning disable SYSLIB5003
using System.Runtime.Intrinsics.Wasm;'
body3='static class CLASS3 {
  public static Vector128<float> A(Vector128<float> v) => Sse.Reciprocal(v);
  public static Vector128<float> B(Vector128<float> v) => Sse.ReciprocalSqrt(v);
  public static Vector512<double> C(Vector512<double> v) => Avx512F.Reciprocal14(v);
  public static Vector128<float> D(Vector128<float> v) => AdvSimd.ReciprocalEstimate(v);
  public static bool E() => Avx2.IsSupported;
  public static bool F() => Sve.IsSupported;
  public static Vector128<int> G(Vector128<int> v) => PackedSimd.Add(v, v);
  public static Vector128<int> H(Vector128<float> v) => Vector128.ConvertToInt32(v);
  public static Vector128<long> I(Vector128<double> v) => Vector128.ConvertToInt64(v);
  public static Vector256<uint> J(Vector256<float> v) => Vector256.ConvertToUInt32(v);
  public static Vector512<ulong> K(Vector512<double> v) => Vector512.ConvertToUInt64(v);
  public static int L(double d) => double.ConvertToInteger<int>(d);
  public static int M(decimal m) => decimal.ToInt32(m);
}'
# the namespace ban reports the namespace ('System.Runtime.Intrinsics.X86') once per use; lines A to G of body3 are the seven uses, the rest name their member
expected_t04c=("System.Runtime.Intrinsics.X86" "System.Runtime.Intrinsics.Arm" "System.Runtime.Intrinsics.Wasm" "Vector128.ConvertToInt32(" "Vector128.ConvertToInt64(" "Vector256.ConvertToUInt32(" "Vector512.ConvertToUInt64(" "double.ConvertToInteger<" "decimal.ToInt32(")
body4='static class CLASS4 {
  public static int A(Half h) => (int)h;
  public static long B(decimal m) => (long)m;
  public static double C(decimal m) => (double)m;
  public static float D(decimal m) => (float)m;
  public static Int128 E(double d) => (Int128)d;
}'
expected_t04c_casts=("from 'Half' to 'int'" "from 'decimal' to 'long'" "from 'decimal' to 'double'" "from 'decimal' to 'float'" "from 'double' to 'Int128'")
# a file holding all the bodies, as classes named $1, $1T04b, $1T04c and $1T04cCasts
emit() { echo "$usings"; echo "$usings3"; echo "$body" | sed "s/CLASS/$1/"; echo "$body2" | sed "s/CLASS2/${1}T04b/"; echo "$body3" | sed "s/CLASS3/${1}T04c/"; echo "$body4" | sed "s/CLASS4/${1}T04cCasts/"; }
echo 'static class Fine { public static double F(double x) => Math.Sqrt(Math.Abs(x)) + Math.Floor(x) + Math.Max(x, 1.0); }' > "$tmp/Fs.Kernel/Fine.cs"
status=0
build() { ( cd "$tmp" && dotnet build "$1" -nologo -v:q 2>&1 | grep -E 'error|Build succeeded|Warn|FAILED' | sed "s|$tmp/||; s|\[$tmp/.*||" | sort -u ); }

echo "=== 1. Fs.Kernel/Bad.cs (a solver project; expect FAILURE with RS0030 and FS0001) ==="
echo "$body" | sed 's/CLASS/Bad/' > "$tmp/Fs.Kernel/Bad.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'error RS0030' && echo "$out" | grep -q 'error FS0001' && echo "$out" | grep -q 'Build FAILED' || { echo "UNEXPECTED: 1 did not fail with both diagnostics"; status=1; }
rm "$tmp/Fs.Kernel/Bad.cs"

echo; echo "=== 1b. Fs.Kernel/BadT04b.cs: one line per new ban (T0.4b; expect FAILURE with RS0030 for each of the ${#expected_t04b[@]}) ==="
{ echo "$usings"; echo "$body2" | sed 's/CLASS2/BadT04b/'; } > "$tmp/Fs.Kernel/BadT04b.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'Build FAILED' || { echo "UNEXPECTED: 1b did not fail"; status=1; }
for sym in "${expected_t04b[@]}"; do
  echo "$out" | grep 'error RS0030' | grep -qF "The symbol '$sym" || { echo "UNEXPECTED: 1b: no RS0030 for $sym"; status=1; }
done
echo "$out" | grep -q 'error FS0001' && { echo "UNEXPECTED: 1b: FS0001 in a file without a cast"; status=1; }
rm "$tmp/Fs.Kernel/BadT04b.cs"

echo; echo "=== 1c. Fs.Kernel/BadT04c.cs: one line per new ban (T0.4c; expect FAILURE with RS0030 for each of the ${#expected_t04c[@]}) ==="
{ echo "$usings"; echo "$usings3"; echo "$body3" | sed 's/CLASS3/BadT04c/'; } > "$tmp/Fs.Kernel/BadT04c.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'Build FAILED' || { echo "UNEXPECTED: 1c did not fail"; status=1; }
for sym in "${expected_t04c[@]}"; do
  echo "$out" | grep 'error RS0030' | grep -qF "The symbol '$sym" || { echo "UNEXPECTED: 1c: no RS0030 for $sym"; status=1; }
done
# each of the seven namespace lines (A to G, lines 5 to 11 of the file) must fail on its own
for ln in 5 6 7 8 9 10 11; do
  echo "$out" | grep 'error RS0030' | grep -qF "BadT04c.cs($ln," || { echo "UNEXPECTED: 1c: no RS0030 on line $ln"; status=1; }
done
echo "$out" | grep -q 'error FS0001' && { echo "UNEXPECTED: 1c: FS0001 in a file without a cast"; status=1; }
rm "$tmp/Fs.Kernel/BadT04c.cs"

echo; echo "=== 1d. Fs.Kernel/BadT04cCasts.cs: one cast per new FS0001 rule (T0.4c; expect FAILURE with FS0001 for each of the ${#expected_t04c_casts[@]}) ==="
{ echo "$usings"; echo "$body4" | sed 's/CLASS4/BadT04cCasts/'; } > "$tmp/Fs.Kernel/BadT04cCasts.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'Build FAILED' || { echo "UNEXPECTED: 1d did not fail"; status=1; }
for sym in "${expected_t04c_casts[@]}"; do
  echo "$out" | grep 'error FS0001' | grep -qF "$sym" || { echo "UNEXPECTED: 1d: no FS0001 for $sym"; status=1; }
done
echo "$out" | grep -q 'error RS0030' && { echo "UNEXPECTED: 1d: RS0030 in a file without a banned call"; status=1; }
rm "$tmp/Fs.Kernel/BadT04cCasts.cs"

echo; echo "=== 2. the same code in FsMath.cs and FsConv.cs (exempt by file name; expect SUCCESS) ==="
emit FsMath > "$tmp/Fs.Kernel/FsMath.cs"
emit FsConv > "$tmp/Fs.Kernel/FsConv.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'Build succeeded' || { echo "UNEXPECTED: 2 did not succeed"; status=1; }
rm "$tmp/Fs.Kernel/FsMath.cs" "$tmp/Fs.Kernel/FsConv.cs"

echo; echo "=== 3. the same code in Fs.Kernel/Pyrogenic/ (exempt until T1.4b; expect FAILURE: no folder of a solver project is exempt any more) ==="
emit Salvage > "$tmp/Fs.Kernel/Pyrogenic/Salvage.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'Build FAILED' || { echo "UNEXPECTED: 3 did not fail (the Pyrogenic exemption is gone)"; status=1; }
echo "$out" | grep 'error RS0030' | grep -q 'Pyrogenic/Salvage.cs' || { echo "UNEXPECTED: 3: no RS0030 in Pyrogenic/Salvage.cs"; status=1; }
echo "$out" | grep 'error FS0001' | grep -q 'Pyrogenic/Salvage.cs' || { echo "UNEXPECTED: 3: no FS0001 in Pyrogenic/Salvage.cs"; status=1; }
for sym in "${expected_t04b[@]}" "${expected_t04c[@]}"; do
  echo "$out" | grep 'error RS0030' | grep 'Pyrogenic/Salvage.cs' | grep -qF "The symbol '$sym" || { echo "UNEXPECTED: 3: no RS0030 for $sym in Pyrogenic/"; status=1; }
done
for sym in "${expected_t04c_casts[@]}"; do
  echo "$out" | grep 'error FS0001' | grep 'Pyrogenic/Salvage.cs' | grep -qF "$sym" || { echo "UNEXPECTED: 3: no FS0001 for $sym in Pyrogenic/"; status=1; }
done
rm "$tmp/Fs.Kernel/Pyrogenic/Salvage.cs"

echo; echo "=== 4. the same code in Fs.Other (not a solver project; expect SUCCESS) ==="
emit Other > "$tmp/Fs.Other/Other.cs"
out="$(build Fs.Other/Fs.Other.csproj)"; echo "$out"
echo "$out" | grep -q 'Build succeeded' || { echo "UNEXPECTED: 4 did not succeed"; status=1; }

echo; [ $status = 0 ] && echo "demo OK: every case behaved as the plan says" || echo "demo FAILED"
exit $status
