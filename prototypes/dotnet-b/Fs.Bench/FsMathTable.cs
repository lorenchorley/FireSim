using Fs.Kernel;

namespace Fs.Bench;

/// <summary>
/// The fifteen functions of T1.3 and the four things that can compute them: the managed fdlibm port, CoreMathSharp, the platform's <c>System.Math</c> (for
/// context only; Fs.Bench is not a solver project), and FsMath's default dispatcher. Names are those of JavaScript's Math.
/// </summary>
public static class FsMathTable
{
    public static readonly string[] Names = ["exp", "log", "pow", "sin", "cos", "tan", "atan", "atan2", "acos", "asin", "sinh", "cbrt", "log2", "log10", "hypot"];
    public static readonly string[] Impls = ["fdlibm", "cms", "platform"];

    public static int Arity(string fn) => fn is "pow" or "atan2" or "hypot" ? 2 : 1;

    public static Func<double, double> F1(string impl, string fn) => (impl, fn) switch
    {
        ("fdlibm", "exp") => FsMath.FdLibm.Exp,
        ("fdlibm", "log") => FsMath.FdLibm.Log,
        ("fdlibm", "sin") => FsMath.FdLibm.Sin,
        ("fdlibm", "cos") => FsMath.FdLibm.Cos,
        ("fdlibm", "tan") => FsMath.FdLibm.Tan,
        ("fdlibm", "atan") => FsMath.FdLibm.Atan,
        ("fdlibm", "acos") => FsMath.FdLibm.Acos,
        ("fdlibm", "asin") => FsMath.FdLibm.Asin,
        ("fdlibm", "sinh") => FsMath.FdLibm.Sinh,
        ("fdlibm", "cbrt") => FsMath.FdLibm.Cbrt,
        ("fdlibm", "log2") => FsMath.FdLibm.Log2,
        ("fdlibm", "log10") => FsMath.FdLibm.Log10,
        ("cms", "exp") => FsMath.CoreMath.Exp,
        ("cms", "log") => FsMath.CoreMath.Log,
        ("cms", "sin") => FsMath.CoreMath.Sin,
        ("cms", "cos") => FsMath.CoreMath.Cos,
        ("cms", "tan") => FsMath.CoreMath.Tan,
        ("cms", "atan") => FsMath.CoreMath.Atan,
        ("cms", "acos") => FsMath.CoreMath.Acos,
        ("cms", "asin") => FsMath.CoreMath.Asin,
        ("cms", "sinh") => FsMath.CoreMath.Sinh,
        ("cms", "cbrt") => FsMath.CoreMath.Cbrt,
        ("cms", "log2") => FsMath.CoreMath.Log2,
        ("cms", "log10") => FsMath.CoreMath.Log10,
        ("platform", "exp") => Math.Exp,
        ("platform", "log") => Math.Log,
        ("platform", "sin") => Math.Sin,
        ("platform", "cos") => Math.Cos,
        ("platform", "tan") => Math.Tan,
        ("platform", "atan") => Math.Atan,
        ("platform", "acos") => Math.Acos,
        ("platform", "asin") => Math.Asin,
        ("platform", "sinh") => Math.Sinh,
        ("platform", "cbrt") => Math.Cbrt,
        ("platform", "log2") => Math.Log2,
        ("platform", "log10") => Math.Log10,
        _ => throw new ArgumentException($"no one-argument {impl}/{fn}"),
    };

    public static Func<double, double, double> F2(string impl, string fn) => (impl, fn) switch
    {
        ("fdlibm", "pow") => FsMath.FdLibm.Pow,
        ("fdlibm", "atan2") => FsMath.FdLibm.Atan2,
        ("cms", "pow") => FsMath.CoreMath.Pow,
        ("cms", "atan2") => FsMath.CoreMath.Atan2,
        ("platform", "pow") => Math.Pow,
        ("platform", "atan2") => Math.Atan2,
        // the platform has no Math.Hypot: double.Hypot is CoreLib's own managed algorithm (not libm), listed for context
        ("platform", "hypot") => double.Hypot,
        ("fdlibm" or "cms", "hypot") => FsMath.Hypot,
        _ => throw new ArgumentException($"no two-argument {impl}/{fn}"),
    };

    /// <summary>Evaluates <paramref name="fn"/> over <paramref name="input"/> (n values, or n pairs interleaved) into <paramref name="output"/>.</summary>
    public static void Eval(string impl, string fn, ReadOnlySpan<double> input, Span<double> output)
    {
        if (Arity(fn) == 1)
        {
            var f = F1(impl, fn);
            for (int i = 0; i < output.Length; i++) output[i] = f(input[i]);
        }
        else
        {
            var f = F2(impl, fn);
            for (int i = 0; i < output.Length; i++) output[i] = f(input[2 * i], input[2 * i + 1]);
        }
    }
}
