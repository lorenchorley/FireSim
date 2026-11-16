using System.Runtime.CompilerServices;
using System.Runtime.Intrinsics;

namespace Fs.Kernel.Air;

/// <summary>
/// The standard tier's air kernels (card T1.4a): <c>EllipticSolver.relax / gradient / divergence</c> (src/atmosphere/solver.ts) and <c>dynamics.advect</c>
/// (src/atmosphere/dynamics.ts) in C#, each three ways: scalar (a literal port in the TypeScript's operation order), element-wise <c>Vector128&lt;double&gt;</c>
/// (two lanes), and fixed chunks run by <c>Parallel.For</c>. None of the four kernels has a reduction, so there is nothing to combine: every output element
/// is written by exactly one chunk and its value does not depend on which thread ran it or on how many threads there were (the card's "combined in chunk
/// order" is vacuous here; the chunk boundaries are constants of the kernel, never a function of the thread count).
/// </summary>
/// <param name="Vector">use the <c>Vector128</c> bodies (bit-identical to the scalar ones).</param>
/// <param name="Threads">0 or 1: run the chunks on the calling thread; more: <c>Parallel.For</c> with that <c>MaxDegreeOfParallelism</c>.</param>
public readonly record struct AirExec(bool Vector, int Threads)
{
    public static readonly AirExec Scalar = new(false, 0);
    public static readonly AirExec Vec = new(true, 0);
    public static AirExec Par(int threads) => new(false, threads);
    public static AirExec ParVec(int threads) => new(true, threads);
}

/// <summary>Multigrid level (plain data, as the TypeScript's <c>Level</c>): float32 storage, the V-cycle is a preconditioner.</summary>
public sealed class AirLevel
{
    public int Nx, Ny, Nz, Plane, N;
    public float[] Cx = [], Cy = [], Cz = [], B = [], X = [], TInv = [], TC = [];

    public AirLevel() { }

    public AirLevel(int nx, int ny, int nz)
    {
        Nx = nx; Ny = ny; Nz = nz; Plane = nx * ny; N = Plane * nz;
        Cx = new float[(nx + 1) * ny * nz];
        Cy = new float[nx * (ny + 1) * nz];
        Cz = new float[Plane * (nz + 1)];
        B = new float[N]; X = new float[N]; TInv = new float[N]; TC = new float[N];
    }

    /// <summary>A level that shares the constant coefficient arrays and has its own B and X.</summary>
    public AirLevel WithBX(float[] b, float[] x) => new() { Nx = Nx, Ny = Ny, Nz = Nz, Plane = Plane, N = N, Cx = Cx, Cy = Cy, Cz = Cz, TInv = TInv, TC = TC, B = b, X = x };
}

/// <summary>The grid fields the kernels read (<c>AtmosGrid</c> of src/atmosphere/grid.ts). Layouts: centres (k*ny+j)*nx+i, u-faces (k*ny+j)*(nx+1)+i, v-faces (k*(ny+1)+j)*nx+i, w-faces (m*ny+j)*nx+i.</summary>
public sealed class AirGrid
{
    public readonly int Nx, Ny, Nz, Plane, N, NU, NV, NW;
    public readonly double Dx, Hp;
    public readonly double[] Dzeta, DzetaW, J, Ju, Jv, Zsx, Zsy;
    /// <summary>Metric factor (1 - zetaF[m]/H') per w-face level, as the solver's constructor computes it (nz + 1 entries).</summary>
    public readonly double[] Fzeta;

    public AirGrid(int nx, int ny, int nz, double dx, double hp, double[] dzeta, double[] dzetaW, double[] j, double[] ju, double[] jv, double[] zsx, double[] zsy, double[] fzeta)
    {
        Nx = nx; Ny = ny; Nz = nz; Plane = nx * ny; N = Plane * nz;
        NU = (nx + 1) * ny * nz; NV = nx * (ny + 1) * nz; NW = Plane * (nz + 1);
        Dx = dx; Hp = hp;
        Dzeta = dzeta; DzetaW = dzetaW; J = j; Ju = ju; Jv = jv; Zsx = zsx; Zsy = zsy; Fzeta = fzeta;
    }
}

/// <summary>Which boundary faces are active (Dirichlet): <c>BoundaryMasks</c> of src/atmosphere/solver.ts.</summary>
public sealed class AirMasks(byte[] activeU, byte[] activeV, bool topActive)
{
    public byte[] ActiveU = activeU;
    public byte[] ActiveV = activeV;
    public bool TopActive = topActive;
}

/// <summary>Reads an array element as a double: the float32 widening of plan 10.4 (one-lane <c>WidenLower</c>, no false dependency on x64) or the identity.</summary>
public interface IAirWord<T> where T : unmanaged
{
    static abstract double Load(T[] a, int i);
    /// <summary>Elements i and i+1 as two lanes.</summary>
    static abstract Vector128<double> Load2(T[] a, int i);
    /// <summary>Elements i and j as two lanes (a gather of two).</summary>
    static abstract Vector128<double> Gather2(T[] a, int i, int j);
}

public readonly struct F32Word : IAirWord<float>
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static double Load(float[] a, int i) => Vector128.WidenLower(Vector128.CreateScalarUnsafe(a[i])).ToScalar();

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vector128<double> Load2(float[] a, int i)
    {
        _ = a[i + 1]; // one bounds check for the pair
        return Vector128.WidenLower(Vector64.LoadUnsafe(ref a[i]).ToVector128Unsafe());
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vector128<double> Gather2(float[] a, int i, int j) => Vector128.WidenLower(Vector128.Create(a[i], a[j], 0f, 0f));
}

public readonly struct F64Word : IAirWord<double>
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static double Load(double[] a, int i) => a[i];

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vector128<double> Load2(double[] a, int i) => Vector128.Create(a, i);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vector128<double> Gather2(double[] a, int i, int j) => Vector128.Create(a[i], a[j]);
}

static class AirPar
{
    static readonly ParallelOptions[] Options = new ParallelOptions[65];

    static ParallelOptions For(int threads)
    {
        threads = Math.Clamp(threads, 2, 64);
        return Options[threads] ??= new ParallelOptions { MaxDegreeOfParallelism = threads };
    }

    /// <summary>Runs chunks 0..chunks-1: in order on this thread when <paramref name="threads"/> is under 2, otherwise dynamically assigned by <c>Parallel.For</c>. The caller makes every chunk write its own output elements only.</summary>
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

/// <summary>JavaScript's <c>x | 0</c> for the one case the kernels need, without a float-to-integer cast (plan 10.4).</summary>
static class AirTrunc
{
    const double TwoPow52 = 4503599627370496.0;

    /// <summary>x | 0 for 0 &lt;= x &lt; 2^31, and 0 for NaN (as JavaScript). -0 gives 0. Callers have clamped x to [0, n]; a negative x is not meaningful here and gives 0 too.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static int NonNegative(double x)
    {
        if (!(x >= 0)) return 0;
        // floor(x) + 2^52 is exact for 0 <= x < 2^52 and holds floor(x) in the low bits of the pattern
        return (int)(BitConverter.DoubleToInt64Bits(Math.Floor(x) + TwoPow52) & 0xFFFFFFFFL);
    }

    /// <summary>The two lanes of a vector whose lanes are non-negative integral doubles below 2^31, as ints (low bits of floor + 2^52).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vector128<long> Bits(Vector128<double> integral) => Vector128.BitwiseAnd((integral + Vector128.Create(TwoPow52)).AsInt64(), Vector128.Create(0xFFFFFFFFL));
}
