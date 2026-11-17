using Fs.Kernel.Air;

namespace Fs.Kernel;

/// <summary>
/// How a fast-tier kernel (card T1.4b: <see cref="LevelSet.LevelSetCore"/> and <see cref="PyrogenicKernel"/>) is run; the same shape as T1.4a's
/// <see cref="AirExec"/>. Every form gives the same bits.
/// </summary>
/// <param name="Vector">use the element-wise <c>Vector128</c> bodies (bit-identical to the scalar ones).</param>
/// <param name="Threads">0 or 1: run the chunks on the calling thread, in order; more: <c>Parallel.For</c> with that <c>MaxDegreeOfParallelism</c>.</param>
public readonly record struct KernelExec(bool Vector, int Threads)
{
    public static readonly KernelExec Scalar = new(false, 0);
    public static readonly KernelExec Vec = new(true, 0);
    public static KernelExec Par(int threads) => new(false, threads);
    public static KernelExec ParVec(int threads) => new(true, threads);
}

/// <summary>
/// Runs the fixed chunks of a kernel: in order on this thread, or dynamically assigned by <c>Parallel.For</c>. The caller makes every chunk write its own
/// output elements only, or its own chunk-indexed partial result (combined afterwards in chunk order), so the result never depends on which thread ran a chunk.
/// </summary>
static class KernelPar
{
    static readonly ParallelOptions[] Options = new ParallelOptions[65];

    static ParallelOptions For(int threads)
    {
        threads = Math.Clamp(threads, 2, 64);
        return Options[threads] ??= new ParallelOptions { MaxDegreeOfParallelism = threads };
    }

    public static void Chunks(int chunks, int threads, Action<int> body)
    {
        if (threads < 2 || chunks < 2)
        {
            for (int c = 0; c < chunks; c++) body(c);
            return;
        }
        Parallel.For(0, chunks, For(threads), body);
    }
}
