using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Fs.Kernel;

namespace Fs.Tests;

/// <summary>What the tests below call: both managed implementations, by name, for every function (never the platform's Math).</summary>
internal static class Under
{
    public static readonly string[] Impls = ["fdlibm", "cms"];
    public static readonly string[] Names = ["exp", "log", "pow", "sin", "cos", "tan", "atan", "atan2", "acos", "asin", "sinh", "cbrt", "log2", "log10", "hypot"];
    public static int Arity(string fn) => fn is "pow" or "atan2" or "hypot" ? 2 : 1;

    public static Func<double, double> F1(string impl, string fn) => impl == "fdlibm"
        ? fn switch
        {
            "exp" => FsMath.FdLibm.Exp, "log" => FsMath.FdLibm.Log, "sin" => FsMath.FdLibm.Sin, "cos" => FsMath.FdLibm.Cos, "tan" => FsMath.FdLibm.Tan,
            "atan" => FsMath.FdLibm.Atan, "acos" => FsMath.FdLibm.Acos, "asin" => FsMath.FdLibm.Asin, "sinh" => FsMath.FdLibm.Sinh, "cbrt" => FsMath.FdLibm.Cbrt,
            "log2" => FsMath.FdLibm.Log2, "log10" => FsMath.FdLibm.Log10, _ => throw new ArgumentException(fn),
        }
        : fn switch
        {
            "exp" => FsMath.CoreMath.Exp, "log" => FsMath.CoreMath.Log, "sin" => FsMath.CoreMath.Sin, "cos" => FsMath.CoreMath.Cos, "tan" => FsMath.CoreMath.Tan,
            "atan" => FsMath.CoreMath.Atan, "acos" => FsMath.CoreMath.Acos, "asin" => FsMath.CoreMath.Asin, "sinh" => FsMath.CoreMath.Sinh, "cbrt" => FsMath.CoreMath.Cbrt,
            "log2" => FsMath.CoreMath.Log2, "log10" => FsMath.CoreMath.Log10, _ => throw new ArgumentException(fn),
        };

    public static Func<double, double, double> F2(string impl, string fn) => (impl, fn) switch
    {
        ("fdlibm", "pow") => FsMath.FdLibm.Pow,
        ("fdlibm", "atan2") => FsMath.FdLibm.Atan2,
        ("cms", "pow") => FsMath.CoreMath.Pow,
        ("cms", "atan2") => FsMath.CoreMath.Atan2,
        (_, "hypot") => FsMath.Hypot,
        _ => throw new ArgumentException($"{impl}/{fn}"),
    };

    public static double Call(string impl, string fn, double x, double y = 0) => Arity(fn) == 1 ? F1(impl, fn)(x) : F2(impl, fn)(x, y);

    public static long Bits(double d) => BitConverter.DoubleToInt64Bits(d);
    public static double FromHex(string h) => BitConverter.UInt64BitsToDouble(ulong.Parse(h, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
    public static bool SameBits(double a, double b) => (double.IsNaN(a) && double.IsNaN(b)) || Bits(a) == Bits(b);

    /// <summary>Distance in units in the last place (as ordered integers); long.MaxValue when exactly one is NaN.</summary>
    public static long Ulp(double a, double b)
    {
        if (double.IsNaN(a) && double.IsNaN(b)) return 0;
        if (double.IsNaN(a) || double.IsNaN(b)) return long.MaxValue;
        static long Ord(double d) { long v = Bits(d); return v < 0 ? -(v & long.MaxValue) : v; }
        return Math.Abs(Ord(a) - Ord(b));
    }
}

/// <summary>Edge cases of every function, for both managed implementations: signed zeros, infinities, NaN, exact cases, the quadrant table of atan2, JavaScript's pow.</summary>
[TestClass]
public sealed class FsMathEdgeTests
{
    private const double Inf = double.PositiveInfinity;
    private const double NaN = double.NaN;
    private const double Tiny = 5e-324; // the smallest subnormal

    private static void Is(string impl, string fn, double expected, double x, double y = 0)
    {
        double got = Under.Call(impl, fn, x, y);
        Assert.IsTrue(Under.SameBits(expected, got), $"{impl} {fn}({x:R}{(Under.Arity(fn) == 2 ? $", {y:R}" : "")}) = {got:R} (bits {Under.Bits(got):X16}), expected {expected:R} (bits {Under.Bits(expected):X16})");
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void ExpEdges(string impl)
    {
        Is(impl, "exp", 1.0, 0.0);
        Is(impl, "exp", 1.0, -0.0);
        Is(impl, "exp", Inf, Inf);
        Is(impl, "exp", 0.0, double.NegativeInfinity);
        Is(impl, "exp", NaN, NaN);
        Is(impl, "exp", Math.E, 1.0);          // V8 special-cases exp(1) to give the correctly rounded e
        Is(impl, "exp", 1.0 / Math.E, -1.0);   // 0.36787944117144233
        Is(impl, "exp", Inf, 710.0);           // overflow
        Is(impl, "exp", Inf, 1e308);
        Is(impl, "exp", 0.0, -746.0);          // underflow
        Is(impl, "exp", 0.0, -1e308);
        Is(impl, "exp", 1.0, Tiny);
        Is(impl, "exp", 1.0, 1e-300);
        Is(impl, "exp", 1.0, -1e-300);
        Is(impl, "exp", Tiny, -745.0);         // rounds to the smallest subnormal
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void LogEdges(string impl)
    {
        foreach (string fn in new[] { "log", "log2", "log10" })
        {
            Is(impl, fn, 0.0, 1.0);                  // log(1) = +0
            Is(impl, fn, double.NegativeInfinity, 0.0);
            Is(impl, fn, double.NegativeInfinity, -0.0);
            Is(impl, fn, NaN, -1.0);                 // negative argument
            Is(impl, fn, NaN, double.NegativeInfinity);
            Is(impl, fn, Inf, Inf);
            Is(impl, fn, NaN, NaN);
            Is(impl, fn, NaN, -Tiny);
        }
        Is(impl, "log", 1.0, Math.E);
        Is(impl, "log", 0.6931471805599453, 2.0);
        // log2 of every power of two is exact; log10 of 10^k is exact for k = 0..22 (as in V8)
        for (int k = -1074; k <= 1023; k++) Is(impl, "log2", k, Math.ScaleB(1.0, k));
        double p = 1.0;
        for (int k = 0; k <= 22; k++, p *= 10.0) Is(impl, "log10", k, p);
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void PowIsJavaScriptsPow(string impl)
    {
        // the table of ECMAScript's Number::exponentiate, where JavaScript differs from C99's pow
        Is(impl, "pow", NaN, 1.0, Inf);
        Is(impl, "pow", NaN, 1.0, double.NegativeInfinity);
        Is(impl, "pow", NaN, -1.0, Inf);
        Is(impl, "pow", NaN, -1.0, double.NegativeInfinity);
        Is(impl, "pow", NaN, 1.0, NaN);
        Is(impl, "pow", NaN, -1.0, NaN);
        Is(impl, "pow", NaN, NaN, 1.0);
        Is(impl, "pow", NaN, 2.0, NaN);
        // exponent +-0 is 1 for every base, NaN included
        foreach (double b in new[] { 0.0, -0.0, 1.0, -1.0, 2.0, -2.5, Inf, double.NegativeInfinity, NaN, Tiny, double.MaxValue })
        {
            Is(impl, "pow", 1.0, b, 0.0);
            Is(impl, "pow", 1.0, b, -0.0);
        }
        // zeros
        Is(impl, "pow", 0.0, 0.0, 5.0);
        Is(impl, "pow", -0.0, -0.0, 3.0);        // odd integer exponent keeps the sign
        Is(impl, "pow", 0.0, -0.0, 2.0);
        Is(impl, "pow", 0.0, -0.0, 0.5);
        Is(impl, "pow", Inf, 0.0, -1.0);
        Is(impl, "pow", double.NegativeInfinity, -0.0, -3.0);
        Is(impl, "pow", Inf, -0.0, -2.0);
        Is(impl, "pow", Inf, 0.0, double.NegativeInfinity);
        Is(impl, "pow", 0.0, 0.0, Inf);
        // infinities
        Is(impl, "pow", Inf, 2.0, Inf);
        Is(impl, "pow", 0.0, 2.0, double.NegativeInfinity);
        Is(impl, "pow", 0.0, 0.5, Inf);
        Is(impl, "pow", Inf, 0.5, double.NegativeInfinity);
        Is(impl, "pow", Inf, Inf, 2.0);
        Is(impl, "pow", double.NegativeInfinity, double.NegativeInfinity, 3.0);
        Is(impl, "pow", Inf, double.NegativeInfinity, 2.0);
        Is(impl, "pow", 0.0, Inf, -1.0);
        Is(impl, "pow", -0.0, double.NegativeInfinity, -3.0);
        // negative base
        Is(impl, "pow", -8.0, -2.0, 3.0);
        Is(impl, "pow", 4.0, -2.0, 2.0);
        Is(impl, "pow", NaN, -8.0, 1.0 / 3.0);   // non-integer exponent of a negative base
        Is(impl, "pow", NaN, -2.0, 0.5);
        Is(impl, "pow", 1.0, -1.0, 2.0);
        Is(impl, "pow", -1.0, -1.0, 3.0);
        // exact integer cases
        Is(impl, "pow", 1024.0, 2.0, 10.0);
        Is(impl, "pow", 27.0, 3.0, 3.0);
        Is(impl, "pow", 1e22, 10.0, 22.0);
        Is(impl, "pow", 0.5, 2.0, -1.0);
        Is(impl, "pow", Inf, 2.0, 1024.0);       // overflow
        Is(impl, "pow", Tiny, 2.0, -1074.0);
        Is(impl, "pow", 0.0, 2.0, -1075.0);      // underflow
        Is(impl, "pow", 9007199254740992.0, 2.0, 53.0);
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void PowSquareIsTheProductAndHalfIsSqrt(string impl)
    {
        // x ** 2 is x * x and x ** 0.5 is sqrt(x) in V8 (fdlibm special cases); CORE-MATH is correctly rounded, so it gives the same
        var rng = new Random(12345);
        var pow = Under.F2(impl, "pow");
        for (int i = 0; i < 20000; i++)
        {
            double x = (rng.NextDouble() - 0.3) * Math.Pow(10, rng.Next(-30, 30));
            Assert.IsTrue(Under.SameBits(x * x, pow(x, 2.0)), $"{impl} pow({x:R}, 2)");
            if (x >= 0) Assert.IsTrue(Under.SameBits(Math.Sqrt(x), pow(x, 0.5)), $"{impl} pow({x:R}, 0.5)");
        }
        Assert.IsTrue(Under.SameBits(Inf, pow(Inf, 0.5)));
        Assert.IsTrue(Under.SameBits(0.0, pow(0.0, 0.5)));
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void TrigEdges(string impl)
    {
        Is(impl, "sin", 0.0, 0.0);
        Is(impl, "sin", -0.0, -0.0);
        Is(impl, "cos", 1.0, 0.0);
        Is(impl, "cos", 1.0, -0.0);
        Is(impl, "tan", 0.0, 0.0);
        Is(impl, "tan", -0.0, -0.0);
        foreach (string fn in new[] { "sin", "cos", "tan" })
        {
            Is(impl, fn, NaN, Inf);
            Is(impl, fn, NaN, double.NegativeInfinity);
            Is(impl, fn, NaN, NaN);
        }
        Is(impl, "sin", 1.2246467991473532e-16, Math.PI);        // the double nearest pi is 1.22e-16 short of pi
        Is(impl, "cos", 6.123233995736766e-17, Math.PI / 2);
        Is(impl, "cos", -1.0, Math.PI);
        Is(impl, "sin", Tiny, Tiny);
        Is(impl, "sin", 1e-300, 1e-300);
        Is(impl, "cos", 1.0, 1e-300);
        Is(impl, "tan", 1e-300, 1e-300);
        Is(impl, "sin", 0.8414709848078965, 1.0);
        Is(impl, "cos", 0.5403023058681398, 1.0);
        Is(impl, "tan", 1.5574077246549023, 1.0);
        Is(impl, "sin", -0.8522008497671888, 1e22);              // huge arguments need the full-precision reduction
        Is(impl, "cos", 0.523214785395139, 1e22);
        Is(impl, "sin", -Under.F1(impl, "sin")(1e22), -1e22);    // odd function
        Is(impl, "cos", Under.F1(impl, "cos")(1e22), -1e22);     // even function
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void InverseTrigEdges(string impl)
    {
        Is(impl, "atan", Math.PI / 2, Inf);
        Is(impl, "atan", -Math.PI / 2, double.NegativeInfinity);
        Is(impl, "atan", 0.0, 0.0);
        Is(impl, "atan", -0.0, -0.0);
        Is(impl, "atan", NaN, NaN);
        Is(impl, "atan", Math.PI / 4, 1.0);
        Is(impl, "atan", Tiny, Tiny);
        Is(impl, "atan", 1e-300, 1e-300);
        Is(impl, "acos", 0.0, 1.0);
        Is(impl, "acos", Math.PI, -1.0);
        Is(impl, "acos", Math.PI / 2, 0.0);
        Is(impl, "acos", Math.PI / 2, -0.0);
        Is(impl, "acos", NaN, 1.0000000000000002);
        Is(impl, "acos", NaN, -1.0000000000000002);
        Is(impl, "acos", NaN, Inf);
        Is(impl, "acos", NaN, NaN);
        Is(impl, "asin", Math.PI / 2, 1.0);
        Is(impl, "asin", -Math.PI / 2, -1.0);
        Is(impl, "asin", 0.0, 0.0);
        Is(impl, "asin", -0.0, -0.0);
        Is(impl, "asin", NaN, 1.0000000000000002);
        Is(impl, "asin", NaN, double.NegativeInfinity);
        Is(impl, "asin", NaN, NaN);
        Is(impl, "asin", 1e-300, 1e-300);
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void Atan2QuadrantTable(string impl)
    {
        double pi = Math.PI, h = Math.PI / 2, q = Math.PI / 4, tq = 3 * (Math.PI / 4);
        // y = +-0
        Is(impl, "atan2", 0.0, 0.0, 0.0);
        Is(impl, "atan2", -0.0, -0.0, 0.0);
        Is(impl, "atan2", pi, 0.0, -0.0);
        Is(impl, "atan2", -pi, -0.0, -0.0);
        Is(impl, "atan2", 0.0, 0.0, 5.0);
        Is(impl, "atan2", -0.0, -0.0, 5.0);
        Is(impl, "atan2", pi, 0.0, -5.0);
        Is(impl, "atan2", -pi, -0.0, -5.0);
        // x = +-0
        Is(impl, "atan2", h, 5.0, 0.0);
        Is(impl, "atan2", h, 5.0, -0.0);
        Is(impl, "atan2", -h, -5.0, 0.0);
        Is(impl, "atan2", -h, -5.0, -0.0);
        // infinities
        Is(impl, "atan2", q, Inf, Inf);
        Is(impl, "atan2", -q, double.NegativeInfinity, Inf);
        Is(impl, "atan2", tq, Inf, double.NegativeInfinity);
        Is(impl, "atan2", -tq, double.NegativeInfinity, double.NegativeInfinity);
        Is(impl, "atan2", 0.0, 5.0, Inf);
        Is(impl, "atan2", -0.0, -5.0, Inf);
        Is(impl, "atan2", pi, 5.0, double.NegativeInfinity);
        Is(impl, "atan2", -pi, -5.0, double.NegativeInfinity);
        Is(impl, "atan2", h, Inf, 5.0);
        Is(impl, "atan2", -h, double.NegativeInfinity, -5.0);
        // the four quadrants
        Is(impl, "atan2", q, 1.0, 1.0);
        Is(impl, "atan2", tq, 1.0, -1.0);
        Is(impl, "atan2", -tq, -1.0, -1.0);
        Is(impl, "atan2", -q, -1.0, 1.0);
        // NaN
        Is(impl, "atan2", NaN, NaN, 1.0);
        Is(impl, "atan2", NaN, 1.0, NaN);
        Is(impl, "atan2", NaN, NaN, NaN);
        // |y / x| beyond 2^60 and below 2^-60
        Is(impl, "atan2", h, 1e300, 1e-300);
        Is(impl, "atan2", pi, 1e-300, -1e300);
        Is(impl, "atan2", -pi, -1e-300, -1e300);
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void SinhCbrtEdges(string impl)
    {
        Is(impl, "sinh", 0.0, 0.0);
        Is(impl, "sinh", -0.0, -0.0);
        Is(impl, "sinh", Inf, Inf);
        Is(impl, "sinh", double.NegativeInfinity, double.NegativeInfinity);
        Is(impl, "sinh", NaN, NaN);
        Is(impl, "sinh", Inf, 711.0);
        Is(impl, "sinh", double.NegativeInfinity, -711.0);
        Is(impl, "sinh", 1e-300, 1e-300);
        Is(impl, "sinh", Tiny, Tiny);
        Is(impl, "cbrt", 0.0, 0.0);
        Is(impl, "cbrt", -0.0, -0.0);
        Is(impl, "cbrt", Inf, Inf);
        Is(impl, "cbrt", double.NegativeInfinity, double.NegativeInfinity);
        Is(impl, "cbrt", NaN, NaN);
        Is(impl, "cbrt", 3.0, 27.0);
        Is(impl, "cbrt", -2.0, -8.0);
        Is(impl, "cbrt", 10.0, 1000.0);
        Is(impl, "cbrt", 1.0, 1.0);
        Is(impl, "cbrt", -1.0, -1.0);
        Is(impl, "cbrt", 1.7031839360032603e-108, Tiny);   // subnormal argument
    }

    [TestMethod]
    [DataRow("fdlibm")]
    [DataRow("cms")]
    public void HypotIsV8sHypot(string impl)
    {
        // same code in both; V8's Math.hypot special cases: any infinity wins over NaN, then NaN, then zeros
        Is(impl, "hypot", 5.0, 3.0, 4.0);
        Is(impl, "hypot", 5.0, -3.0, -4.0);
        Is(impl, "hypot", Inf, Inf, NaN);
        Is(impl, "hypot", Inf, NaN, double.NegativeInfinity);
        Is(impl, "hypot", NaN, NaN, 1.0);
        Is(impl, "hypot", NaN, 1.0, NaN);
        Is(impl, "hypot", 0.0, 0.0, -0.0);
        Is(impl, "hypot", 0.0, -0.0, -0.0);
        Is(impl, "hypot", 1.0, 1.0, 0.0);
        Is(impl, "hypot", 1.4142135623730951e308, 1e308, 1e308);     // no overflow: scaled by the largest
        Assert.IsTrue(double.IsFinite(FsMath.Hypot(double.MaxValue, double.MaxValue)) == false, "sqrt(2) * MaxValue overflows to Infinity");
        Is(impl, "hypot", 5.0, 0.0, 5.0);
        // three arguments
        Assert.AreEqual(3.0, FsMath.Hypot(1.0, 2.0, 2.0));
        Assert.AreEqual(Inf, FsMath.Hypot(NaN, 1.0, Inf));
        Assert.IsTrue(double.IsNaN(FsMath.Hypot(NaN, 1.0, 2.0)));
        Assert.AreEqual(0.0, FsMath.Hypot(0.0, -0.0, 0.0));
    }

    [TestMethod]
    [DoNotParallelize]
    public void DispatcherFollowsTheSelectedImplementation()
    {
        var before = FsMath.Implementation;
        try
        {
            foreach (var impl in new[] { FsMathImplementation.FdLibm, FsMathImplementation.CoreMathSharp })
            {
                FsMath.Implementation = impl;
                Assert.AreEqual(impl, FsMath.Implementation);
                string name = impl == FsMathImplementation.FdLibm ? "fdlibm" : "cms";
                var rng = new Random(7);
                for (int i = 0; i < 2000; i++)
                {
                    double x = (rng.NextDouble() - 0.5) * 20, y = (rng.NextDouble() + 0.1) * 5;
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "exp")(x), FsMath.Exp(x)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "sin")(x), FsMath.Sin(x)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "cos")(x), FsMath.Cos(x)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "tan")(x), FsMath.Tan(x)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "atan")(x), FsMath.Atan(x)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "cbrt")(x), FsMath.Cbrt(x)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "sinh")(x), FsMath.Sinh(x)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "log")(y), FsMath.Log(y)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "log2")(y), FsMath.Log2(y)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "log10")(y), FsMath.Log10(y)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "acos")(x / 10), FsMath.Acos(x / 10)));
                    Assert.IsTrue(Under.SameBits(Under.F1(name, "asin")(x / 10), FsMath.Asin(x / 10)));
                    Assert.IsTrue(Under.SameBits(Under.F2(name, "pow")(y, x), FsMath.Pow(y, x)));
                    Assert.IsTrue(Under.SameBits(Under.F2(name, "atan2")(x, y), FsMath.Atan2(x, y)));
                    Assert.IsTrue(Under.SameBits(Under.F2(name, "hypot")(x, y), FsMath.Hypot(x, y)));
                }
            }
        }
        finally { FsMath.Implementation = before; }
    }
}

/// <summary>
/// The committed golden file (golden/fsmath-node22.json, about 250 calls per function): the bits of Node 22's Math (V8 12.4) and the correctly rounded
/// results (mpmath at 400 bits, Fs.Bench/fsmath/cr-reference.py). FdLibm must give Node 22's bits (tolerance 0 ulp); CoreMathSharp must give the correctly
/// rounded bits (tolerance 0 ulp); and both must be close to the correctly rounded value.
/// </summary>
[TestClass]
public sealed class FsMathGoldenTests
{
    private sealed record Golden(string Fn, int Arity, int Calls, double[] X, double[] Node22, double[] Cr);

    private static readonly Lazy<Golden[]> Data = new(Load);

    private static Golden[] Load()
    {
        using var doc = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "golden", "fsmath-node22.json")));
        var list = new List<Golden>();
        foreach (var p in doc.RootElement.GetProperty("functions").EnumerateObject())
        {
            double[] Read(string name) => p.Value.GetProperty(name).EnumerateArray().Select(e => Under.FromHex(e.GetString()!)).ToArray();
            list.Add(new Golden(p.Name, p.Value.GetProperty("arity").GetInt32(), p.Value.GetProperty("calls").GetInt32(), Read("x"), Read("node22"), Read("cr")));
        }
        return list.ToArray();
    }

    public static IEnumerable<string> FunctionNames => Under.Names;

    private static (int mismatches, long maxUlp) Run(string impl, Golden g, double[] expected) => Run(impl, g, expected, out _);

    private static (int mismatches, long maxUlp) Run(string impl, Golden g, double[] expected, out string first)
    {
        int bad = 0; long max = 0;
        first = "";
        for (int i = 0; i < g.Calls; i++)
        {
            double got = g.Arity == 1 ? Under.F1(impl, g.Fn)(g.X[i]) : Under.F2(impl, g.Fn)(g.X[2 * i], g.X[2 * i + 1]);
            long u = Under.SameBits(expected[i], got) ? 0 : Math.Max(1, Under.Ulp(expected[i], got)); // +0 and -0 are one apart, not equal
            if (u != 0)
            {
                if (bad == 0) first = $"first: {g.Fn}({g.X[g.Arity * i]:R}{(g.Arity == 2 ? $", {g.X[2 * i + 1]:R}" : "")}) = {got:R} (bits {Under.Bits(got):X16}), expected {expected[i]:R} (bits {Under.Bits(expected[i]):X16})";
                bad++; max = Math.Max(max, u);
            }
        }
        return (bad, max);
    }

    [TestMethod]
    public void TheFileHasEveryFunction()
    {
        CollectionAssert.AreEquivalent(Under.Names, Data.Value.Select(g => g.Fn).ToArray());
        foreach (var g in Data.Value)
        {
            Assert.IsTrue(g.Calls >= 220, $"{g.Fn}: {g.Calls} calls");
            Assert.AreEqual(g.Calls * g.Arity, g.X.Length);
            Assert.AreEqual(g.Calls, g.Node22.Length);
            Assert.AreEqual(g.Calls, g.Cr.Length);
        }
    }

    [TestMethod]
    [DynamicData(nameof(FunctionNames))]
    public void FdLibmGivesNode22sBits(string fn)
    {
        var g = Data.Value.Single(d => d.Fn == fn);
        var (bad, max) = Run("fdlibm", g, g.Node22);
        Assert.AreEqual(0, bad, $"fdlibm {fn}: {bad} of {g.Calls} calls differ from Node 22 (largest distance {max} ulp); tolerance is 0 ulp");
    }

    [TestMethod]
    [DynamicData(nameof(FunctionNames))]
    public void CoreMathSharpIsCorrectlyRounded(string fn)
    {
        var g = Data.Value.Single(d => d.Fn == fn);
        if (fn == "hypot")
        {
            // Hypot is V8's algorithm in both implementations, which is not correctly rounded: its own check is the Node 22 bits
            var (b0, m0) = Run("cms", g, g.Node22);
            Assert.AreEqual(0, b0, $"hypot differs from Node 22 in {b0} calls (max {m0} ulp)");
            return;
        }
        var (bad, max) = Run("cms", g, g.Cr, out string first);
        Assert.AreEqual(0, bad, $"CoreMathSharp {fn}: {bad} of {g.Calls} calls are not the correctly rounded value (largest distance {max} ulp); tolerance is 0 ulp; {first}");
    }

    [TestMethod]
    [DynamicData(nameof(FunctionNames))]
    public void FdLibmIsWithinTwoUlpOfCorrectlyRounded(string fn)
    {
        var g = Data.Value.Single(d => d.Fn == fn);
        var (_, max) = Run("fdlibm", g, g.Cr, out string first);
        Assert.IsTrue(max <= 2, $"fdlibm {fn}: {max} ulp from the correctly rounded value; {first}");
    }
}

/// <summary>
/// FsMath.cs is exempt from the solver analyzers (it is where the maths is implemented), and so are the vendored CoreMathSharp sources. This reads both and fails on any
/// call of the platform's transcendental functions, FusedMultiplyAdd, TensorPrimitives or Vector&lt;T&gt;: that is what the analyzers would have said.
/// </summary>
[TestClass]
public sealed class FsMathSourceTests
{
    private static string KernelDir([System.Runtime.CompilerServices.CallerFilePath] string here = "") => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(here)!, "..", "Fs.Kernel"));

    private static readonly Regex Banned = new(
        @"\b(Math|MathF|double|float|Single|Double)\s*\.\s*(Exp|Exp2|Log|Log2|Log10|Pow|Sin|Cos|Tan|Asin|Acos|Atan|Atan2|Sinh|Cosh|Tanh|Asinh|Acosh|Atanh|Cbrt|Hypot|SinCos|FusedMultiplyAdd|Round|ScaleB|ILogB|IEEERemainder|ReciprocalEstimate|ReciprocalSqrtEstimate)\b|TensorPrimitives|\bVector<|\b[A-Za-z]+Native\s*\(",
        RegexOptions.Compiled);

    private static string StripComments(string src)
    {
        src = Regex.Replace(src, @"/\*.*?\*/", "", RegexOptions.Singleline);
        return Regex.Replace(src, @"//[^\n]*", "");
    }

    [TestMethod]
    public void FsMathAndTheVendoredSourcesCallNoPlatformMaths()
    {
        string dir = KernelDir();
        if (!Directory.Exists(dir)) Assert.Inconclusive($"{dir} not found (the tests run away from the source tree)");
        var files = new List<string> { Path.Combine(dir, "FsMath.cs") };
        files.AddRange(Directory.GetFiles(Path.Combine(dir, "ThirdParty"), "*.cs", SearchOption.AllDirectories));
        Assert.IsTrue(files.Count > 10);
        var hits = new List<string>();
        foreach (string f in files)
        {
            var m = Banned.Match(StripComments(File.ReadAllText(f)));
            if (m.Success) hits.Add($"{Path.GetFileName(f)}: {m.Value}");
        }
        Assert.AreEqual(0, hits.Count, "platform maths in the managed implementations: " + string.Join("; ", hits));
    }
}
