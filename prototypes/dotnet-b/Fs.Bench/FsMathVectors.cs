namespace Fs.Bench;

/// <summary>
/// T1.3: CoreMathSharp's vendored functions against the test vectors of its own repository (CoreMathSharp.Tests/Binary64/{fn}.txt at the pinned commit): each line holds the
/// bits of the input (two for pow and atan2), then the bits of the result that CORE-MATH's own C code (cr_exp, cr_sin, ...) gave. An independent reference, made by the
/// original C implementation, not by mpmath.
///   dotnet run -c Release --project Fs.Bench -- fsmath-vectors VECTOR_DIR
/// </summary>
public static class FsMathVectors
{
    public static int Run(string[] args)
    {
        string dir = args[0];
        int failures = 0;
        foreach (string fn in FsMathTable.Names)
        {
            if (fn == "hypot") continue; // V8's algorithm, not CORE-MATH's hypot
            string path = Path.Combine(dir, fn + ".txt");
            if (!File.Exists(path)) { Console.WriteLine($"{fn,-6} no vector file"); continue; }
            int arity = FsMathTable.Arity(fn), n = 0, bad = 0;
            string first = "";
            foreach (string line in File.ReadLines(path))
            {
                var p = line.Split('\t');
                if (p.Length != arity + 1) continue;
                double x = BitConverter.UInt64BitsToDouble(Convert.ToUInt64(p[0], 16));
                double y = arity == 2 ? BitConverter.UInt64BitsToDouble(Convert.ToUInt64(p[1], 16)) : 0;
                ulong want = Convert.ToUInt64(p[arity], 16);
                // the vector files list atan2 as (x, y), the C function as atan2(y, x)
                double got = arity == 1 ? FsMathTable.F1("cms", fn)(x) : fn == "atan2" ? FsMathTable.F2("cms", fn)(y, x) : FsMathTable.F2("cms", fn)(x, y);
                double wantD = BitConverter.UInt64BitsToDouble(want);
                n++;
                if (!(double.IsNaN(got) && double.IsNaN(wantD)) && BitConverter.DoubleToUInt64Bits(got) != want)
                {
                    if (bad++ < 6) first += $"{(first.Length == 0 ? "" : "; ")}{fn}({x:R}{(arity == 2 ? $", {y:R}" : "")}) = {got:R}, vector {wantD:R}";
                }
            }
            failures += bad;
            Console.WriteLine($"{fn,-6} {n,6} vectors, {bad} differ {first}");
        }
        return failures == 0 ? 0 : 1;
    }
}
