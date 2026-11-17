using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using Fs.Kernel.SpeedTest;

namespace Fs.Wasm;

/// <summary>
/// T1.6a: the two frozen speed-test kernels (Fs.Kernel/SpeedTest: K1 air stencil, K2 memory copy) as WebAssembly entry points, on the pattern of <see cref="FsMathExports"/>.
/// <see cref="Load"/> builds a kernel from the fixed seed INSIDE the WebAssembly heap (the data never crosses), <see cref="Run"/> runs n whole sweeps of it and returns a result
/// word (so the loop is observable and cannot be dropped), <see cref="Checksum"/> is the frozen FNV-1a (0x7d268009 after 3 sweeps of K1, 0x1e84aad9 after 2 of K2, on a fresh kernel).
/// <see cref="Call"/> is the end-to-end shape: a byte[] argument (copied into the heap by the marshaller) plus n sweeps. Numbers are ints because JSExport has no uint (JavaScript reads
/// them with <c>&gt;&gt;&gt; 0</c>).
/// </summary>
[SupportedOSPlatform("browser")]
public static partial class SpeedTestExports
{
    private static ISpeedKernel? s_kernel;

    private static readonly KernelPath[] Paths = [KernelPath.Scalar, KernelPath.Vector128, KernelPath.ScalarPlain];

    /// <summary>The bytes of the kernel's whole input state, what a caller would have to pass if the data did not stay resident: K1 five float32 arrays of 40,500 (a, u, v, w and b), K2 the 16 MiB source array.</summary>
    [JSExport]
    public static int InputBytes(int kernel) =>
        kernel == 0
            ? 5 * SpeedTestConstants.StencilNx * SpeedTestConstants.StencilNy * SpeedTestConstants.StencilNz * sizeof(float)
            : SpeedTestConstants.CopyFloats * sizeof(float);

    /// <summary>Builds a fresh kernel from the fixed seed: <paramref name="kernel"/> 0 = K1 stencil, 1 = K2 copy; <paramref name="path"/> 0 = Scalar (the contract), 1 = Vector128, 2 = ScalarPlain (K1 only). Returns its work per sweep (cell updates, bytes).</summary>
    [JSExport]
    public static int Load(int kernel, int path)
    {
        KernelPath p = Paths[path];
        s_kernel = kernel == 0 ? new StencilKernel(p) : new CopyKernel(p);
        return (int)s_kernel.Work;
    }

    /// <summary>Runs <paramref name="sweeps"/> whole sweeps (every part in order, then End) of the loaded kernel; returns a result word: the bit pattern of two floats of the state.</summary>
    [JSExport]
    public static int Run(int sweeps)
    {
        ISpeedKernel k = s_kernel ?? throw new InvalidOperationException("Load first");
        SpeedTest.Sweeps(k, sweeps);
        ReadOnlySpan<float> v = k.Values;
        return BitConverter.SingleToInt32Bits(v[0]) ^ BitConverter.SingleToInt32Bits(v[v.Length >> 1]);
    }

    /// <summary>The frozen checksum (FNV-1a over the 32-bit words) of the loaded kernel's current state. Costs a pass over the whole array: not for the timed loop.</summary>
    [JSExport]
    public static int Checksum() => (int)(s_kernel ?? throw new InvalidOperationException("Load first")).Checksum();

    /// <summary>End to end: the byte[] argument is copied into the WebAssembly heap by the marshaller (that copy is the cost being measured), then <paramref name="sweeps"/> sweeps of the loaded kernel run (0 = the call and the copy only).</summary>
    [JSExport]
    public static int Call(byte[] payload, int sweeps) =>
        (sweeps > 0 ? Run(sweeps) : 0) ^ payload[payload.Length - 1];

    /// <summary>The runtime's one-line self description (same as <see cref="FsMathExports.Info"/>).</summary>
    [JSExport]
    public static string Info() => FsMathExports.Info();
}
