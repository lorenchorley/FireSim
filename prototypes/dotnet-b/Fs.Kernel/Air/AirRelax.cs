using System.Runtime.CompilerServices;
using System.Runtime.Intrinsics;

namespace Fs.Kernel.Air;

/// <summary>
/// <c>EllipticSolver.relax</c> (src/atmosphere/solver.ts): zebra z-line Gauss-Seidel sweeps with pre-factorised Thomas coefficients on the float32 multigrid
/// level. Every float32 read is widened to double, the arithmetic is double, and the only float32 roundings are the two stores into <c>x</c> (as the typed array
/// does), exactly where the TypeScript's are.
///
/// <b>Dependency structure and what may run in parallel.</b> A pass relaxes the z-lines of one colour (<c>(i + j) &amp; 1 == colour</c>). The west, east, south
/// and north neighbours of a line belong to the other colour, which this pass neither writes nor reads as anything but input; the only value a line reads that
/// the pass has written is its own earlier k (the forward elimination writes the intermediate values into x, the back substitution completes them), and a line
/// reads only its own column. So the lines of one colour are independent: a pass is a red-black (checkerboard) Gauss-Seidel, which is exactly what the
/// TypeScript sweeps plane by plane, and the lines of one pass may be done in any order, on any thread, and give the TypeScript's bits. The two passes of a
/// sweep, and the sweeps, are not independent (each reads what the last wrote) and keep the TypeScript's order, with a barrier (the end of one
/// <c>Parallel.For</c>) between passes. The k direction of a line (the Thomas recurrence) is serial. So the parallel unit is a block of rows <see cref="RowsPerChunk"/>
/// rows high, all k, forward then back for its lines; chunk boundaries do not depend on the thread count, and no two chunks write the same element.
///
/// <b>Vector form.</b> Two lines of the same colour in one row (i and i + 2) are the two lanes. Their neighbours are at stride two in memory, so every operand is
/// a two-element gather (<see cref="F32Word.Gather2"/>); only the arithmetic is wide. Row ends (a line at i = 0 or i = nx - 1, which lacks a neighbour) are
/// scalar.
/// </summary>
public sealed class AirRelax
{
    /// <summary>Rows of lines per parallel chunk. A constant: the chunking must not depend on the thread count.</summary>
    public const int RowsPerChunk = 2;
    /// <summary>Levels with fewer cells are never run in parallel (the fork/join costs more than the work); a function of the level only. Tests set it to 0 to force the parallel path on small grids.</summary>
    public int MinParallelCells { get; init; } = 8192;

    readonly Action<int> _chunk;
    AirLevel _l = null!;
    int _colour;
    bool _vec;

    public AirRelax() => _chunk = Chunk;

    /// <summary>Relaxes <paramref name="l"/> in place: <paramref name="sweeps"/> sweeps of two colour passes; <paramref name="reverse"/> swaps the colour order.</summary>
    public void Run(AirLevel l, int sweeps, bool reverse, AirExec exec)
    {
        bool parallel = exec.Threads >= 2 && l.N >= MinParallelCells;
        for (int s = 0; s < sweeps; s++)
        {
            for (int pass = 0; pass < 2; pass++)
            {
                int colour = reverse ? 1 - pass : pass;
                if (!parallel)
                {
                    PassRows(l, colour, 0, l.Ny, exec.Vector);
                    continue;
                }
                _l = l; _colour = colour; _vec = exec.Vector;
                AirPar.Chunks((l.Ny + RowsPerChunk - 1) / RowsPerChunk, exec.Threads, _chunk);
            }
        }
        _l = null!;
    }

    void Chunk(int c)
    {
        int j0 = c * RowsPerChunk;
        PassRows(_l, _colour, j0, Math.Min(_l.Ny, j0 + RowsPerChunk), _vec);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static double W(float[] f, int i) => F32Word.Load(f, i);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> G(float[] f, int a) => F32Word.Gather2(f, a, a + 2);

    /// <summary>One pass over the lines of <paramref name="colour"/> in rows [j0, j1): the forward elimination up the column, then the back substitution down it.</summary>
    static void PassRows(AirLevel l, int colour, int j0, int j1, bool vec)
    {
        int nx = l.Nx, nz = l.Nz, plane = l.Plane;
        int nx1 = nx + 1, ny = l.Ny;
        int strideU = ny * nx1, strideV = (ny + 1) * nx, nxm = nx - 1;
        float[] cx = l.Cx, cy = l.Cy, cz = l.Cz, b = l.B, x = l.X, tInv = l.TInv, tC = l.TC;
        for (int k = 0; k < nz; k++)
        {
            int o = k * plane, ou = k * strideU, ov = k * strideV;
            bool hasD = k > 0;
            for (int j = j0; j < j1; j++)
            {
                bool hasS = j > 0, hasN = j < ny - 1;
                int row = o + j * nx, fuRow = ou + j * nx1, fvRow = ov + j * nx;
                int i = (j + colour) & 1;
                if (vec)
                {
                    if (i == 0 && nx > 0)
                    {
                        Cell(cx, cy, cz, b, x, tInv, 0, row, fuRow, fvRow, nx, nxm, plane, hasS, hasN, hasD);
                        i = 2;
                    }
                    for (; i + 2 < nxm; i += 4)
                    {
                        int idx = row + i;
                        Vector128<double> rhs = G(b, idx);
                        rhs += G(cx, fuRow + i) * G(x, idx - 1);
                        rhs += G(cx, fuRow + i + 1) * G(x, idx + 1);
                        if (hasS) rhs += G(cy, fvRow + i) * G(x, idx - nx);
                        if (hasN) rhs += G(cy, fvRow + i + nx) * G(x, idx + nx);
                        if (hasD) rhs += G(cz, idx) * G(x, idx - plane);
                        Vector128<double> r = rhs * G(tInv, idx);
                        x[idx] = (float)r.GetElement(0);
                        x[idx + 2] = (float)r.GetElement(1);
                    }
                }
                for (; i < nx; i += 2)
                    Cell(cx, cy, cz, b, x, tInv, i, row, fuRow, fvRow, nx, nxm, plane, hasS, hasN, hasD);
            }
        }
        for (int k = nz - 2; k >= 0; k--)
        {
            int o = k * plane;
            for (int j = j0; j < j1; j++)
            {
                int row = o + j * nx;
                int i = (j + colour) & 1;
                if (vec)
                {
                    for (; i + 2 < nx; i += 4)
                    {
                        int idx = row + i;
                        Vector128<double> r = G(x, idx) + G(tC, idx) * G(x, idx + plane);
                        x[idx] = (float)r.GetElement(0);
                        x[idx + 2] = (float)r.GetElement(1);
                    }
                }
                for (; i < nx; i += 2)
                {
                    int idx = row + i;
                    x[idx] = (float)(W(x, idx) + W(tC, idx) * W(x, idx + plane));
                }
            }
        }
    }

    /// <summary>The literal line update of the forward elimination (the TypeScript's loop body), for the scalar form and the vector form's row ends.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static void Cell(float[] cx, float[] cy, float[] cz, float[] b, float[] x, float[] tInv, int i, int row, int fuRow, int fvRow, int nx, int nxm, int plane, bool hasS, bool hasN, bool hasD)
    {
        int idx = row + i;
        double rhs = W(b, idx);
        if (i > 0) rhs += W(cx, fuRow + i) * W(x, idx - 1);
        if (i < nxm) rhs += W(cx, fuRow + i + 1) * W(x, idx + 1);
        if (hasS) rhs += W(cy, fvRow + i) * W(x, idx - nx);
        if (hasN) rhs += W(cy, fvRow + i + nx) * W(x, idx + nx);
        if (hasD) rhs += W(cz, idx) * W(x, idx - plane);
        x[idx] = (float)(rhs * W(tInv, idx));
    }
}
