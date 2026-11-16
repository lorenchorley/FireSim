#!/usr/bin/env bash
# Shows, in a throwaway copy, that the solver rules break the build (plan T0.4 "done when"), and that the exemptions and the non-solver projects hold:
#   1. a bad file in Fs.Kernel (a solver project): Math.Exp and a double-to-int cast       -> the build FAILS with RS0030 and FS0001
#   1b. (T0.4b) a bad file with one line per new ban: Fma.MultiplyAdd, AdvSimd.FusedMultiplyAdd, AdvSimd.Arm64.FusedMultiplyAdd, Vector128.FusedMultiplyAdd,
#       double.FusedMultiplyAdd, Convert.ToInt32(double), Convert.ToInt64(float), Convert.ChangeType, int.CreateTruncating, byte.CreateSaturating,
#       T.CreateChecked (generic math)                                                      -> the build FAILS, with RS0030 for every one of them
#   2. the same code (1 and 1b) in FsMath.cs and FsConv.cs (exempt by file name)            -> the build PASSES
#   3. the same code in Fs.Kernel/Pyrogenic/ (the "not a gate kernel" folder)               -> the build PASSES
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
# a file holding both bodies, as classes named $1 and $1T04b
emit() { echo "$usings"; echo "$body" | sed "s/CLASS/$1/"; echo "$body2" | sed "s/CLASS2/${1}T04b/"; }
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

echo; echo "=== 2. the same code in FsMath.cs and FsConv.cs (exempt by file name; expect SUCCESS) ==="
emit FsMath > "$tmp/Fs.Kernel/FsMath.cs"
emit FsConv > "$tmp/Fs.Kernel/FsConv.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'Build succeeded' || { echo "UNEXPECTED: 2 did not succeed"; status=1; }
rm "$tmp/Fs.Kernel/FsMath.cs" "$tmp/Fs.Kernel/FsConv.cs"

echo; echo "=== 3. the same code in Fs.Kernel/Pyrogenic/ (the not-a-gate-kernel folder; expect SUCCESS) ==="
emit Salvage > "$tmp/Fs.Kernel/Pyrogenic/Salvage.cs"
out="$(build Fs.Kernel/Fs.Kernel.csproj)"; echo "$out"
echo "$out" | grep -q 'Build succeeded' || { echo "UNEXPECTED: 3 did not succeed"; status=1; }
rm "$tmp/Fs.Kernel/Pyrogenic/Salvage.cs"

echo; echo "=== 4. the same code in Fs.Other (not a solver project; expect SUCCESS) ==="
emit Other > "$tmp/Fs.Other/Other.cs"
out="$(build Fs.Other/Fs.Other.csproj)"; echo "$out"
echo "$out" | grep -q 'Build succeeded' || { echo "UNEXPECTED: 4 did not succeed"; status=1; }

echo; [ $status = 0 ] && echo "demo OK: every case behaved as the plan says" || echo "demo FAILED"
exit $status
