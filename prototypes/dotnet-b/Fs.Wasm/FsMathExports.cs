using System.Runtime.InteropServices;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using Fs.Kernel;

namespace Fs.Wasm;

/// <summary>
/// T1.3: the FsMath functions as WebAssembly entry points. JavaScript passes the input as bytes (one copy each way) and reads the results as raw float64 bits, so the same input file can be run under Node and in Chromium and compared with the x64 output.
/// T1.6a adds the frozen kernels to this class's neighbours; keep this one small.
/// </summary>
[SupportedOSPlatform("browser")]
public static partial class FsMathExports
{
    /// <summary>The function names, in the order of the numeric id used below (the order of Fs.Bench/fsmath/js-math.mjs FNS).</summary>
    public static readonly string[] Names = ["exp", "log", "pow", "sin", "cos", "tan", "atan", "atan2", "acos", "asin", "sinh", "cbrt", "log2", "log10", "hypot"];

    private static readonly string[] ImplNames = ["fdlibm", "cms"];

    /// <summary>
    /// Evaluates function <paramref name="fn"/> (index into <see cref="Names"/>) with implementation <paramref name="impl"/> (0 = FdLibm, 1 = CoreMathSharp) over
    /// <paramref name="n"/> calls. <paramref name="x"/> holds the raw little-endian float64 bits of the n inputs (2n numbers for pow, atan2 and hypot, interleaved pairs);
    /// the result is the raw bits of the n results. Bytes cross the boundary because JavaScript cannot build the MemoryView a Span parameter needs, and bytes are exact.
    /// </summary>
    [JSExport]
    public static byte[] Eval(int impl, int fn, byte[] x, int n)
    {
        var y = new double[n];
        FsMathLoops.Get(ImplNames[impl], Names[fn])(MemoryMarshal.Cast<byte, double>(x.AsSpan()), y, n);
        return MemoryMarshal.AsBytes(y.AsSpan()).ToArray();
    }

    private static double[] s_x = [], s_y = [];

    /// <summary>Keeps the first n calls' inputs (raw float64 bits, as in <see cref="Eval"/>) inside WebAssembly, for <see cref="Run"/> (timing without moving data on every call).</summary>
    [JSExport]
    public static void Load(byte[] x, int n)
    {
        s_x = MemoryMarshal.Cast<byte, double>(x.AsSpan()).ToArray();
        s_y = new double[n];
    }

    /// <summary>Evaluates function fn with implementation impl over the first n calls of the data kept by <see cref="Load"/>; returns the last result (so the loop is observable).</summary>
    [JSExport]
    public static double Run(int impl, int fn, int n)
    {
        FsMathLoops.Get(ImplNames[impl], Names[fn])(s_x, s_y, n);
        return s_y[n - 1];
    }

    /// <summary>What the runtime reports about itself, as one line (runtime, whether code is compiled at run time or ahead of time, whether Vector128 is accelerated; the X86, Arm and Wasm intrinsics namespaces are banned in solver projects, so no FMA or PackedSimd probe).</summary>
    [JSExport]
    public static string Info() =>
        $"{RuntimeInformation.FrameworkDescription}; rid {RuntimeInformation.RuntimeIdentifier}; dynamicCode {System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeCompiled}; " +
        $"vector128 {System.Runtime.Intrinsics.Vector128.IsHardwareAccelerated}";
}
