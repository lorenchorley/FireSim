using System.Runtime.CompilerServices;
using System.Runtime.Intrinsics;
using Fs.Kernel.Air;

namespace Fs.Kernel.LevelSet;

/// <summary>The numbers of <c>SPREAD_PARAMS.levelSet</c> (src/fire/spread/params.ts) that the kernels read. <c>BandCells</c>, <c>FarCells</c>, <c>SweepIterations</c> and <c>ReinitEvery</c> are whole numbers in the app (8, 9, 2, 10); here they are ints so that no float-to-integer conversion is needed.</summary>
public sealed record LevelSetParams(
    double Nu = 0.2, double CflSafety = 0.9, double CflGuard = 1.0001, double RosMaxMs = 6, int BandCells = 8, int FarCells = 9, double LazyPrepareCells = 4,
    int ReinitEvery = 10, bool BurntExtension = true, double BurntExtensionMaxExtraCells = 2, int SweepIterations = 2, double NormalEps = 1e-6);

/// <summary>Callbacks from the core into the fire model (<c>LevelSetHooks</c>): the owner fills the speed coefficients of a cell, and receives arrivals.</summary>
public interface ILevelSetHooks
{
    /// <summary>Stage-1 request for the speed coefficients of band cell k. The hook must set <c>PrepStamp[k] = Stamp</c>. It may draw random numbers, so the core calls it in band order, always on the calling thread.</summary>
    void EnsureSpeed(int k);
    void OnArrival(int k, double tA, double r, double nx, double ny);
}

sealed class NoLevelSetHooks : ILevelSetHooks
{
    public void EnsureSpeed(int k) { }
    public void OnArrival(int k, double tA, double r, double nx, double ny) { }
}

/// <summary>How the speed-coefficient request is issued inside <c>Evaluate</c>: inline at the TypeScript's position (the literal form), or not at all (the parallel and vector forms ask first, in a serial pass).</summary>
interface IHookMode { static abstract bool Inline { get; } }
readonly struct InlineHooks : IHookMode { public static bool Inline => true; }
readonly struct NoHooks : IHookMode { public static bool Inline => false; }

/// <summary>How the distance array of <c>reinit</c> is stored: float32 as in the TypeScript, or double (a test instrument that exposes the double the sweeps computed before a float32 store rounds it).</summary>
interface IDistWord<T> where T : unmanaged
{
    static abstract double Load(T[] a, int i);
    static abstract void Store(T[] a, int i, double v);
}

/// <summary>The per-cell update of a fast sweep given its two smaller neighbour distances: a seam for the operand-order mutation test (Fs.Tests/LevelSetKernelTests); the kernel uses <see cref="LiteralUpdate"/>.</summary>
public interface IDistUpdate
{
    static abstract double Update(double aa, double bb, double h, double h2);
}

/// <summary>The TypeScript's update, operation for operation.</summary>
public readonly struct LiteralUpdate : IDistUpdate
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static double Update(double aa, double bb, double h, double h2)
    {
        double diff = aa - bb;
        if (diff >= h || diff <= -h) return (aa < bb ? aa : bb) + h;
        return 0.5 * (aa + bb + Math.Sqrt(h2 - diff * diff));
    }
}

readonly struct F32Dist : IDistWord<float>
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Load(float[] a, int i) => F32Word.Load(a, i);
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static void Store(float[] a, int i, double v) => a[i] = (float)v;
}

readonly struct F64Dist : IDistWord<double>
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Load(double[] a, int i) => a[i];
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static void Store(double[] a, int i, double v) => a[i] = v;
}

/// <summary>The arithmetic of <c>evaluate</c> that an operand-order slip could change, as a seam for the mutation tests (Fs.Tests/LevelSetKernelTests): the kernel uses <see cref="LiteralEval"/> (the TypeScript's expressions, operation for operation); a test passes a mutated copy to <see cref="LevelSetCore.EvaluateWith{TM}"/>. Static abstract members of a struct type argument are specialised by the JIT: no cost in the real path.</summary>
public interface IEvalOps
{
    /// <summary><c>c / cn</c>: the normalisation of the front normal.</summary>
    static abstract double Normal(double c, double cn);
    /// <summary><c>R = sC * cosp + sqrt(a2 * c2 + (s2 > 0 ? b2 * s2 : 0))</c>.</summary>
    static abstract double Speed(double sc, double cosp, double a2, double c2, double b2, double s2);
    /// <summary>The CFL candidate <c>R * (|nx| + |ny| + 4 nu) / dx</c> (written <c>R * (...) * inv</c>).</summary>
    static abstract double Cfl(double r, double nxv, double nyv, double nu4, double inv);
    /// <summary>The squared upwind gradient: the four one-sided terms added in the order dmx, dpx, dmy, dpy.</summary>
    static abstract double G2(double dmx, double dpx, double dmy, double dpy);
    /// <summary><c>(pl + pr + pd + pu - 4 p) * inv2</c>.</summary>
    static abstract double Lap(double pl, double pr, double pd, double pu, double p, double inv2);
    /// <summary><c>nuH * R * lap</c>.</summary>
    static abstract double Visc(double nuH, double r, double lap);
    /// <summary><c>-R * sqrt(g2) + visc</c>.</summary>
    static abstract double Tend(double r, double g2, double visc);
}

/// <summary>The TypeScript's expressions, in its operation order.</summary>
public readonly struct LiteralEval : IEvalOps
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Normal(double c, double cn) => c / cn;
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Speed(double sc, double cosp, double a2, double c2, double b2, double s2) => sc * cosp + Math.Sqrt(a2 * c2 + (s2 > 0 ? b2 * s2 : 0));
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Cfl(double r, double nxv, double nyv, double nu4, double inv) => r * ((nxv < 0 ? -nxv : nxv) + (nyv < 0 ? -nyv : nyv) + nu4) * inv;
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static double G2(double dmx, double dpx, double dmy, double dpy)
    {
        double g2 = 0;
        if (dmx > 0) g2 += dmx * dmx;
        if (dpx < 0) g2 += dpx * dpx;
        if (dmy > 0) g2 += dmy * dmy;
        if (dpy < 0) g2 += dpy * dpy;
        return g2;
    }
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Lap(double pl, double pr, double pd, double pu, double p, double inv2) => (pl + pr + pd + pu - 4 * p) * inv2;
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Visc(double nuH, double r, double lap) => nuH * r * lap;
    [MethodImpl(MethodImplOptions.AggressiveInlining)] public static double Tend(double r, double g2, double visc) => -r * Math.Sqrt(g2) + visc;
}

/// <summary>
/// C# port of <c>LevelSetCore</c> (src/fire/spread/levelSet.ts), the kernels of the fast tier's fire phase: <see cref="Evaluate"/> (the tendency of every band
/// cell, 3.0 % of a 30-minute fast-tier step and 13.6 % at four hours: T1.1) and <see cref="Reinit"/> (fast-sweeping re-distancing, 2.9 % and 10.1 %), plus the
/// Heun sub-step (<see cref="Advance"/>, <see cref="StepFixed"/>, <see cref="Bound"/>) that calls them. Nothing here needs <c>FsMath</c>: only + - * / and
/// <c>sqrt</c>, so the results are the TypeScript's own bits. Each kernel has three forms, selected by <see cref="KernelExec"/>: scalar (a literal port), element-wise
/// <c>Vector128&lt;double&gt;</c>, and fixed chunks run by <c>Parallel.For</c>; all give identical bits.
///
/// <b>What can run in parallel, and what cannot.</b>
/// <list type="bullet">
/// <item><b>Evaluate</b>: band cell a reads only the field <c>src</c> (never written here), its own and its neighbours' phi, and its own speed coefficients; it writes only
/// <c>out[a]</c>, <c>r1[a]</c>, <c>n1x[a]</c>, <c>n1y[a]</c>. So the band positions are independent and are cut into chunks of <see cref="EvalChunk"/> (a constant). The one
/// reduction, <c>maxC</c> (the CFL maximum), is combined from per-chunk maxima in chunk order (a max of non-NaN values, so the order cannot matter; it is fixed anyway).
/// <b>The lazy speed request is the exception</b>: in stage 1 the TypeScript calls <c>hooks.ensureSpeed(k)</c> in the middle of the loop, and the fire model's hook draws random
/// numbers (<c>breachDraw</c>) and fills cell k's coefficients. The parallel and vector forms therefore first run a <b>serial pass in band order</b> that makes exactly the same
/// decisions and calls the hook (so the draw order is the TypeScript's), then evaluate in parallel. This gives the TypeScript's bits provided the hook writes only cell k's own
/// coefficients (the fire model's <c>prepareCell</c> does: it writes sA2, sB2, sC, sEx, sEy, sVls and prepStamp at k, and reads other cells only in arrays that Evaluate does not read).</item>
/// <item><b>Reinit</b> has a dependency structure. (1) the bounding box of the band, a min/max over band cells: exact in any order, run serially (the band is small). (2) the
/// crossing test and the initial distance of every box cell: each cell reads only phi, so rows are independent (parallel by row chunks). (3) <b>the fast sweeps are Gauss-Seidel</b>:
/// in one ordering a cell reads its two neighbours behind it in the sweep direction (already updated in this sweep) and its two ahead (not yet updated), so the order of updates
/// is part of the result and the four orderings and the iterations follow each other. Within one ordering, however, the cells of one anti-diagonal do not read each other, so
/// a <b>blocked wavefront</b> (square tiles, the tiles of one tile-anti-diagonal in parallel, each tile swept in the TypeScript's order inside) updates every cell with the same
/// neighbour values as the serial sweep: bit-identical. It is used only when the box has at least <see cref="MinParallelBox"/> cells (a rule about the data). (4) the write-back and band rebuild:
/// each row is independent, but the band list is in row-major order, so a count per chunk, a prefix sum in chunk order, then a parallel fill give the same list.
/// The vector form vectorises (2) (two cells per vector with unaligned neighbour loads); the sweeps are dependency chains and stay scalar.</item>
/// </list>
/// Float32 storage and where the TypeScript widens: the speed coefficients and <c>dist</c> are float32 and read into double locals; <c>r1</c>, <c>n1x</c>, <c>n1y</c>, <c>dist</c> store a rounded double;
/// <c>phi</c>, <c>phiS</c> and the tendencies are Float64, so the double is visible in them.
/// </summary>
public sealed class LevelSetCore
{
    /// <summary>Band positions per parallel chunk of <see cref="Evaluate"/>. Fixed.</summary>
    public const int EvalChunk = 256;
    /// <summary>Box rows per parallel chunk of reinit's row phases. Fixed.</summary>
    public const int RowsPerChunk = 8;
    /// <summary>Edge of a wavefront tile (cells). Fixed.</summary>
    public const int Tile = 32;

    public readonly int Nx, Ny, N;
    public readonly double H;
    public readonly double[] Phi, PhiS;
    public readonly float[] SA2, SB2, SC, SEx, SEy, SVls, SJun, SBurnt, STx, STy;
    public readonly int[] PrepStamp;
    public int Stamp = 1;
    public readonly int[] Band;
    public int BandCount;
    public readonly byte[] InBand, Touched;
    public int SubCount;
    public double LastBound = double.PositiveInfinity;
    public bool Lazy = true;
    public ILevelSetHooks Hooks = new NoLevelSetHooks();
    public readonly LevelSetParams P;

    /// <summary>Evaluate runs serially below this many band cells (a rule about the data; 0 forces the chunked form, as the tests do).</summary>
    public int MinParallelBand = 1024;
    /// <summary>Reinit's sweeps run serially below this many box cells; the other reinit phases below a quarter of it (0 forces the parallel forms).</summary>
    public int MinParallelBox = 16384;

    readonly byte[] _edge;
    double[] _tend1, _tend2;
    float[] _r1, _n1x, _n1y;
    int[] _arrA;
    double[] _arrP0, _arrPn;
    /// <summary>Distance array of reinit (float32 as in the TypeScript) and its double twin (<see cref="ReinitWide"/>).</summary>
    public readonly float[] Dist;
    double[]? _distWide;
    public readonly byte[] Fixed;

    // per-call state of the chunked forms
    double[] _src = [];
    double[]? _out;
    bool _stage1, _vec;
    double[] _chunkMax = [];
    readonly Action<int> _evalChunk, _rowStep1Chunk, _rowCountChunk, _rowFillChunk, _tileChunk;
    // reinit state
    int _i0, _i1, _j0, _j1;
    int[] _chunkCount = [];
    int _sweepO, _tilesI;
    int[] _diagTiles = [];
    int _diagLen;

    public LevelSetCore(int nx, int ny, double cellSize, LevelSetParams? p = null)
    {
        P = p ?? new LevelSetParams();
        Nx = nx; Ny = ny; N = nx * ny; H = cellSize;
        int n = N;
        double far = P.FarCells * cellSize;
        Phi = new double[n]; Array.Fill(Phi, far);
        PhiS = new double[n]; Array.Fill(PhiS, far);
        SA2 = new float[n]; SB2 = new float[n]; SC = new float[n]; SEx = new float[n]; SEy = new float[n]; Array.Fill(SEy, 1f);
        SVls = new float[n]; SJun = new float[n]; Array.Fill(SJun, 1f); SBurnt = new float[n]; STx = new float[n]; STy = new float[n];
        PrepStamp = new int[n];
        Band = new int[n];
        InBand = new byte[n];
        Touched = new byte[n];
        _edge = new byte[n];
        for (int j = 0; j < ny; j++)
            for (int i = 0; i < nx; i++)
                if (i == 0 || j == 0 || i == nx - 1 || j == ny - 1) _edge[j * nx + i] = 1;
        int cap = Math.Min(n, 1024);
        _tend1 = new double[cap]; _tend2 = new double[cap]; _r1 = new float[cap]; _n1x = new float[cap]; _n1y = new float[cap];
        _arrA = new int[cap]; _arrP0 = new double[cap]; _arrPn = new double[cap];
        Dist = new float[n];
        Fixed = new byte[n];
        _evalChunk = EvalChunkBody;
        _rowStep1Chunk = RowStep1Chunk;
        _rowCountChunk = RowCountChunk;
        _rowFillChunk = RowFillChunk;
        _tileChunk = TileChunk;
    }

    /// <summary>phi outside the band (m).</summary>
    public double Far => P.FarCells * H;

    /// <summary>Per-band-position outputs of the last stage-1 evaluation (tests read them; length is at least <see cref="BandCount"/>).</summary>
    public double[] Tend1 => _tend1;
    public double[] Tend2 => _tend2;
    public float[] R1 => _r1;
    public float[] N1x => _n1x;
    public float[] N1y => _n1y;

    // ------------------------------------------------------------------------------------------------------------------------------------------
    // evaluate
    // ------------------------------------------------------------------------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static double W(float[] a, int i) => F32Word.Load(a, i);

    /// <summary>
    /// Evaluate the tendency of every band cell on field <paramref name="src"/> into <paramref name="out"/> (indexed by band position); stage 1 also stores the normal speed and
    /// normal, issues lazy speed requests and returns max R (|n_x| + |n_y| + 4 nu) / dx. <c>out = null</c> only computes that maximum (no lazy requests).
    /// </summary>
    public double Evaluate(double[] src, double[]? @out, bool stage1, KernelExec exec)
    {
        EnsureScratch();
        int count = BandCount;
        bool lazy = stage1 && Lazy && @out is not null;
        if (!exec.Vector && exec.Threads < 2) return EvalRange<InlineHooks, LiteralEval>(0, count, src, @out, stage1, lazy);
        // the chunked and vector forms: ask for the speeds first (serial, band order), then compute with no hook in the loop
        if (lazy) RequestSpeeds(src);
        if (exec.Threads < 2 || count < MinParallelBand || count <= EvalChunk)
            return exec.Vector ? EvalRangeVec(0, count, src, @out, stage1) : EvalRange<NoHooks, LiteralEval>(0, count, src, @out, stage1, false);
        int chunks = (count + EvalChunk - 1) / EvalChunk;
        if (_chunkMax.Length < chunks) _chunkMax = new double[chunks];
        _src = src; _out = @out; _stage1 = stage1; _vec = exec.Vector;
        KernelPar.Chunks(chunks, exec.Threads, _evalChunk);
        _src = []; _out = null;
        double maxC = 0;
        for (int c = 0; c < chunks; c++) if (_chunkMax[c] > maxC) maxC = _chunkMax[c]; // chunk order
        return maxC;
    }

    /// <summary>Serial scalar evaluation with another arithmetic (<see cref="IEvalOps"/>), hooks inline: only for the mutation test.</summary>
    public double EvaluateWith<TM>(double[] src, double[]? @out, bool stage1) where TM : struct, IEvalOps
    {
        EnsureScratch();
        return EvalRange<InlineHooks, TM>(0, BandCount, src, @out, stage1, stage1 && Lazy && @out is not null);
    }

    void EvalChunkBody(int c)
    {
        int a0 = c * EvalChunk, a1 = Math.Min(BandCount, a0 + EvalChunk);
        _chunkMax[c] = _vec ? EvalRangeVec(a0, a1, _src, _out, _stage1) : EvalRange<NoHooks, LiteralEval>(a0, a1, _src, _out, _stage1, false);
    }

    /// <summary>The serial pass of the chunked forms: for each band position in order, the TypeScript's decision whether to call <c>ensureSpeed(k)</c>, and the call.</summary>
    void RequestSpeeds(double[] src)
    {
        int nx = Nx, ny = Ny;
        bool ext = P.BurntExtension;
        double lazyH = P.LazyPrepareCells * H;
        int stamp = Stamp;
        var hooks = Hooks;
        int count = BandCount;
        for (int a = 0; a < count; a++)
        {
            int k = Band[a];
            double p = src[k];
            bool burntExt = ext && !(p > 0);
            if (burntExt && W(SBurnt, k) > 0) continue;
            double pl, pr, pd, pu;
            if (_edge[k] == 0)
            {
                pl = src[k - 1]; pr = src[k + 1]; pd = src[k - nx]; pu = src[k + nx];
            }
            else
            {
                int i = k % nx;
                int j = (k - i) / nx;
                bool hasL = i > 0, hasR = i < nx - 1, hasD = j > 0, hasU = j < ny - 1;
                pl = hasL ? src[k - 1] : hasR ? 2 * p - src[k + 1] : p;
                pr = hasR ? src[k + 1] : hasL ? 2 * p - src[k - 1] : p;
                pd = hasD ? src[k - nx] : hasU ? 2 * p - src[k + nx] : p;
                pu = hasU ? src[k + nx] : hasD ? 2 * p - src[k - nx] : p;
            }
            if (PrepStamp[k] != stamp)
            {
                if (p > 0)
                {
                    double m = pl < pr ? pl : pr;
                    if (pd < m) m = pd;
                    if (pu < m) m = pu;
                    if (m <= lazyH) hooks.EnsureSpeed(k);
                }
                else if (PrepStamp[k] == 0) hooks.EnsureSpeed(k);
            }
        }
    }

    /// <summary>The literal port of the loop of <c>evaluate</c> over band positions [a0, a1). Returns the maximum of this range.</summary>
    double EvalRange<THook, TM>(int a0, int a1, double[] src, double[]? @out, bool stage1, bool lazy) where THook : struct, IHookMode where TM : struct, IEvalOps
    {
        int nx = Nx;
        bool ext = P.BurntExtension;
        double h = H;
        double inv = 1 / h;
        double half = 0.5 * inv;
        double inv2 = inv * inv;
        double nu = P.Nu;
        double nuH = nu * h;
        double nu4 = 4 * nu;
        double eps = P.NormalEps;
        double rMax = P.RosMaxMs;
        double lazyH = P.LazyPrepareCells * h;
        int stamp = Stamp;
        var hooks = Hooks;
        float[] r1 = _r1, n1x = _n1x, n1y = _n1y;
        int[] band = Band;
        byte[] edge = _edge;
        double maxC = 0;
        for (int a = a0; a < a1; a++)
        {
            int k = band[a];
            double p = src[k];
            bool burntExt = ext && !(p > 0);
            if (burntExt)
            {
                double sb = W(SBurnt, k);
                if (sb > 0)
                {
                    // Burnt-side extension phi_t = -R_arrival: an ODE, unconditionally stable, outside the CFL bound.
                    if (@out is not null) @out[a] = -sb;
                    if (stage1)
                    {
                        r1[a] = 0;
                        n1x[a] = SEx[k];
                        n1y[a] = SEy[k];
                    }
                    continue;
                }
            }
            double pl, pr, pd, pu;
            if (edge[k] == 0)
            {
                pl = src[k - 1]; pr = src[k + 1]; pd = src[k - nx]; pu = src[k + nx];
            }
            else
            {
                int i = k % nx;
                int j = (k - i) / nx;
                bool hasL = i > 0, hasR = i < nx - 1, hasD = j > 0, hasU = j < Ny - 1;
                pl = hasL ? src[k - 1] : hasR ? 2 * p - src[k + 1] : p;
                pr = hasR ? src[k + 1] : hasL ? 2 * p - src[k - 1] : p;
                pd = hasD ? src[k - nx] : hasU ? 2 * p - src[k + nx] : p;
                pu = hasU ? src[k + nx] : hasD ? 2 * p - src[k - nx] : p;
            }
            if (THook.Inline && lazy && PrepStamp[k] != stamp)
            {
                if (p > 0)
                {
                    double m = pl < pr ? pl : pr;
                    if (pd < m) m = pd;
                    if (pu < m) m = pu;
                    if (m <= lazyH) hooks.EnsureSpeed(k);
                }
                else if (PrepStamp[k] == 0) hooks.EnsureSpeed(k);
            }
            double a2 = W(SA2, k);
            double b2 = W(SB2, k);
            double vr = W(SVls, k);
            if (a2 == 0 && b2 == 0 && vr == 0)
            {
                if (@out is not null) @out[a] = 0;
                if (stage1)
                {
                    r1[a] = 0;
                    n1x[a] = SEx[k];
                    n1y[a] = SEy[k];
                }
                continue;
            }
            // Normal from central differences (fallback e); in an active VLS zone (vr > 0) from the one-sided differences.
            double cx, cy;
            if (vr > 0)
            {
                double dmx0 = (p - pl) * inv;
                double dpx0 = (pr - p) * inv;
                double dmy0 = (p - pd) * inv;
                double dpy0 = (pu - p) * inv;
                cx = dmx0 > 0 && dmx0 >= -dpx0 ? dmx0 : dpx0 < 0 ? dpx0 : 0;
                cy = dmy0 > 0 && dmy0 >= -dpy0 ? dmy0 : dpy0 < 0 ? dpy0 : 0;
            }
            else
            {
                cx = (pr - pl) * half;
                cy = (pu - pd) * half;
            }
            double cn = Math.Sqrt(cx * cx + cy * cy);
            double ex = W(SEx, k);
            double ey = W(SEy, k);
            double nxv, nyv;
            if (cn > eps)
            {
                nxv = TM.Normal(cx, cn);
                nyv = TM.Normal(cy, cn);
            }
            else
            {
                nxv = ex;
                nyv = ey;
            }
            double cosp = nxv * ex + nyv * ey;
            double c2 = cosp * cosp;
            double s2 = 1 - c2;
            double R = TM.Speed(W(SC, k), cosp, a2, c2, b2, s2);
            if (vr > 0)
            {
                // VLS is an absolute lateral rate (D23): the support function of the convex hull of the ellipse and the segment +-R_VLS t.
                double tt = nxv * W(STx, k) + nyv * W(STy, k);
                double rv = vr * (tt < 0 ? -tt : tt);
                if (rv > R) R = rv;
            }
            R *= W(SJun, k);
            if (R > rMax) R = rMax;
            if (burntExt)
            {
                // Burnt cell not reached by the front (ignition): unit-slope extension at its own normal speed.
                if (@out is not null) @out[a] = -R;
                if (stage1)
                {
                    r1[a] = (float)R;
                    n1x[a] = (float)nxv;
                    n1y[a] = (float)nyv;
                }
                continue;
            }
            if (stage1)
            {
                double c = TM.Cfl(R, nxv, nyv, nu4, inv);
                if (c > maxC) maxC = c;
            }
            if (@out is null) continue;
            // Upwind |grad phi| (Sethian, outward motion).
            double dmx = (p - pl) * inv;
            double dpx = (pr - p) * inv;
            double dmy = (p - pd) * inv;
            double dpy = (pu - p) * inv;
            double g2 = TM.G2(dmx, dpx, dmy, dpy);
            double lap = TM.Lap(pl, pr, pd, pu, p, inv2);
            @out[a] = TM.Tend(R, g2, lap < 0 ? TM.Visc(nuH, R, lap) : 0);
            if (stage1)
            {
                r1[a] = (float)R;
                n1x[a] = (float)nxv;
                n1y[a] = (float)nyv;
            }
        }
        return maxC;
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------
    // evaluate, element-wise Vector128<double>: two band cells per vector
    // ------------------------------------------------------------------------------------------------------------------------------------------

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> Neg(Vector128<double> v) => Vector128.Xor(v, Vector128.Create(-0.0));

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> Sel(Vector128<double> m, Vector128<double> a, Vector128<double> b) => Vector128.ConditionalSelect(m, a, b);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> G(double[] a, int i, int j) => Vector128.Create(a[i], a[j]);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    static Vector128<double> GF(float[] a, int i, int j) => F32Word.Gather2(a, i, j);

    /// <summary>
    /// The loop of <c>evaluate</c> over band positions [a0, a1) with two cells per <c>Vector128&lt;double&gt;</c> where both are interior cells with a moving speed (a burnt
    /// extension cell with a stored arrival speed, an edge cell and a cell with no coefficients take the scalar path, one cell at a time, in band order). Every per-lane
    /// branch of the scalar body is a lane mask; comparisons with NaN are false in both. No hook is called (the caller has made the requests).
    /// </summary>
    double EvalRangeVec(int a0, int a1, double[] src, double[]? @out, bool stage1)
    {
        int nx = Nx;
        bool ext = P.BurntExtension;
        double h = H;
        double inv = 1 / h;
        double half = 0.5 * inv;
        double inv2 = inv * inv;
        double nu = P.Nu;
        double nuH = nu * h;
        double nu4 = 4 * nu;
        var vzero = Vector128<double>.Zero;
        var vone = Vector128.Create(1.0);
        var vinv = Vector128.Create(inv);
        var vhalf = Vector128.Create(half);
        var vinv2 = Vector128.Create(inv2);
        var vnuH = Vector128.Create(nuH);
        var vnu4 = Vector128.Create(nu4);
        var veps = Vector128.Create(P.NormalEps);
        var vrMax = Vector128.Create(P.RosMaxMs);
        var vfour = Vector128.Create(4.0);
        int[] band = Band;
        byte[] edge = _edge;
        double maxC = 0;
        int a = a0;
        while (a < a1)
        {
            if (a + 1 < a1)
            {
                int k0 = band[a], k1 = band[a + 1];
                if ((edge[k0] | edge[k1]) == 0 && IsMoving(k0, src, ext) && IsMoving(k1, src, ext))
                {
                    Pair(a, k0, k1, src, @out, stage1, ext, nx, ref maxC, vzero, vone, vinv, vhalf, vinv2, vnuH, vnu4, veps, vrMax, vfour);
                    a += 2;
                    continue;
                }
            }
            double m = EvalRange<NoHooks, LiteralEval>(a, a + 1, src, @out, stage1, false);
            if (m > maxC) maxC = m;
            a++;
        }
        return maxC;
    }

    // a cell the scalar body would carry past the two `continue` shortcuts before the speed: not (burnt with a stored arrival speed), and not all-zero coefficients
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    bool IsMoving(int k, double[] src, bool ext)
    {
        double p = src[k];
        if (ext && !(p > 0) && W(SBurnt, k) > 0) return false;
        return !(W(SA2, k) == 0 && W(SB2, k) == 0 && W(SVls, k) == 0);
    }

    void Pair(int a, int k0, int k1, double[] src, double[]? @out, bool stage1, bool ext, int nx, ref double maxC,
        Vector128<double> vzero, Vector128<double> vone, Vector128<double> vinv, Vector128<double> vhalf, Vector128<double> vinv2, Vector128<double> vnuH, Vector128<double> vnu4,
        Vector128<double> veps, Vector128<double> vrMax, Vector128<double> vfour)
    {
        Vector128<double> p = G(src, k0, k1);
        Vector128<double> burntExt = ext ? Vector128.OnesComplement(Vector128.GreaterThan(p, vzero)) : vzero; // all-ones lanes where `ext && !(p > 0)`
        Vector128<double> pl = G(src, k0 - 1, k1 - 1), pr = G(src, k0 + 1, k1 + 1), pd = G(src, k0 - nx, k1 - nx), pu = G(src, k0 + nx, k1 + nx);
        Vector128<double> a2 = GF(SA2, k0, k1), b2 = GF(SB2, k0, k1), vr = GF(SVls, k0, k1);
        Vector128<double> vrPos = Vector128.GreaterThan(vr, vzero);
        Vector128<double> dmx = (p - pl) * vinv, dpx = (pr - p) * vinv, dmy = (p - pd) * vinv, dpy = (pu - p) * vinv;
        // normal: one-sided where vr > 0, central otherwise
        Vector128<double> cxV = Sel(Vector128.GreaterThan(dmx, vzero) & Vector128.GreaterThanOrEqual(dmx, Neg(dpx)), dmx, Sel(Vector128.LessThan(dpx, vzero), dpx, vzero));
        Vector128<double> cyV = Sel(Vector128.GreaterThan(dmy, vzero) & Vector128.GreaterThanOrEqual(dmy, Neg(dpy)), dmy, Sel(Vector128.LessThan(dpy, vzero), dpy, vzero));
        Vector128<double> cx = Sel(vrPos, cxV, (pr - pl) * vhalf);
        Vector128<double> cy = Sel(vrPos, cyV, (pu - pd) * vhalf);
        Vector128<double> cn = Vector128.Sqrt(cx * cx + cy * cy);
        Vector128<double> ex = GF(SEx, k0, k1), ey = GF(SEy, k0, k1);
        Vector128<double> useN = Vector128.GreaterThan(cn, veps);
        Vector128<double> nxv = Sel(useN, cx / cn, ex), nyv = Sel(useN, cy / cn, ey);
        Vector128<double> cosp = nxv * ex + nyv * ey;
        Vector128<double> c2 = cosp * cosp;
        Vector128<double> s2 = vone - c2;
        Vector128<double> R = GF(SC, k0, k1) * cosp + Vector128.Sqrt(a2 * c2 + Sel(Vector128.GreaterThan(s2, vzero), b2 * s2, vzero));
        Vector128<double> tt = nxv * GF(STx, k0, k1) + nyv * GF(STy, k0, k1);
        Vector128<double> rv = vr * Sel(Vector128.LessThan(tt, vzero), Neg(tt), tt);
        R = Sel(vrPos & Vector128.GreaterThan(rv, R), rv, R);
        R *= GF(SJun, k0, k1);
        R = Sel(Vector128.GreaterThan(R, vrMax), vrMax, R);
        if (stage1)
        {
            // the CFL maximum is over the lanes that are not burnt-extension cells, in lane order
            Vector128<double> c = R * (Sel(Vector128.LessThan(nxv, vzero), Neg(nxv), nxv) + Sel(Vector128.LessThan(nyv, vzero), Neg(nyv), nyv) + vnu4) * vinv;
            if (burntExt.AsInt64().GetElement(0) == 0 && c.GetElement(0) > maxC) maxC = c.GetElement(0);
            if (burntExt.AsInt64().GetElement(1) == 0 && c.GetElement(1) > maxC) maxC = c.GetElement(1);
        }
        if (@out is not null)
        {
            Vector128<double> g2 = vzero;
            g2 += Sel(Vector128.GreaterThan(dmx, vzero), dmx * dmx, vzero);
            g2 += Sel(Vector128.LessThan(dpx, vzero), dpx * dpx, vzero);
            g2 += Sel(Vector128.GreaterThan(dmy, vzero), dmy * dmy, vzero);
            g2 += Sel(Vector128.LessThan(dpy, vzero), dpy * dpy, vzero);
            Vector128<double> lap = (pl + pr + pd + pu - vfour * p) * vinv2;
            Vector128<double> upwind = Neg(R) * Vector128.Sqrt(g2) + Sel(Vector128.LessThan(lap, vzero), vnuH * R * lap, vzero);
            Vector128<double> o = Sel(burntExt, Neg(R), upwind);
            @out[a] = o.GetElement(0);
            @out[a + 1] = o.GetElement(1);
        }
        if (stage1)
        {
            _r1[a] = (float)R.GetElement(0); _r1[a + 1] = (float)R.GetElement(1);
            _n1x[a] = (float)nxv.GetElement(0); _n1x[a + 1] = (float)nxv.GetElement(1);
            _n1y[a] = (float)nyv.GetElement(0); _n1y[a + 1] = (float)nyv.GetElement(1);
        }
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------
    // the Heun sub-step
    // ------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>Grow the per-band scratch to the band size (amortised; never shrinks).</summary>
    void EnsureScratch()
    {
        int need = BandCount;
        if (_tend1.Length >= need) return;
        int cap = Math.Min(N, Math.Max(need, _tend1.Length + (_tend1.Length + 1) / 2)); // ceil(1.5 * length) without a float-to-integer conversion
        Array.Resize(ref _tend1, cap); Array.Resize(ref _tend2, cap);
        Array.Resize(ref _r1, cap); Array.Resize(ref _n1x, cap); Array.Resize(ref _n1y, cap);
        Array.Resize(ref _arrA, cap); Array.Resize(ref _arrP0, cap); Array.Resize(ref _arrPn, cap);
    }

    /// <summary>The CFL bound (s) at the current phi and speeds (infinity with no moving band cell); no side effects.</summary>
    public double Bound(KernelExec exec)
    {
        EnsureScratch();
        double c = Evaluate(Phi, null, true, exec);
        return c > 0 ? P.CflSafety / c : double.PositiveInfinity;
    }

    /// <summary>One sub-step starting at time t with dt = min(dtMax, bound); returns the dt used.</summary>
    public double Advance(double t, double dtMax, KernelExec exec)
    {
        EnsureScratch();
        double c = Evaluate(Phi, _tend1, true, exec);
        double bound = c > 0 ? P.CflSafety / c : double.PositiveInfinity;
        LastBound = bound;
        double dt = dtMax < bound ? dtMax : bound;
        Apply(t, dt, exec);
        return dt;
    }

    /// <summary>One sub-step of exactly dt (s); throws when dt exceeds the CFL bound by more than the guard.</summary>
    public void StepFixed(double t, double dt, KernelExec exec)
    {
        EnsureScratch();
        double c = Evaluate(Phi, _tend1, true, exec);
        double bound = c > 0 ? P.CflSafety / c : double.PositiveInfinity;
        LastBound = bound;
        if (dt > P.CflGuard * bound) throw new ArgumentOutOfRangeException(nameof(dt), "level-set sub-step exceeds the CFL bound");
        Apply(t, dt, exec);
    }

    void Apply(double t, double dt, KernelExec exec)
    {
        int count = BandCount;
        if (count == 0 || !(dt > 0)) return;
        for (int a = 0; a < count; a++)
        {
            int k = Band[a];
            PhiS[k] = Phi[k] + dt * _tend1[a];
        }
        Evaluate(PhiS, _tend2, false, exec);
        int nArr = 0;
        for (int a = 0; a < count; a++)
        {
            int k = Band[a];
            double p0 = Phi[k];
            double pn = 0.5 * (p0 + PhiS[k] + dt * _tend2[a]);
            if (pn > p0) pn = p0;
            Phi[k] = pn;
            PhiS[k] = pn;
            if (p0 > 0 && pn <= 0)
            {
                _arrA[nArr] = a;
                _arrP0[nArr] = p0;
                _arrPn[nArr] = pn;
                nArr++;
            }
        }
        for (int q = 0; q < nArr; q++)
        {
            int a = _arrA[q];
            double p0 = _arrP0[q];
            double tA = t + dt * p0 / (p0 - _arrPn[q]);
            SBurnt[Band[a]] = _r1[a];
            Hooks.OnArrival(Band[a], tA, _r1[a], _n1x[a], _n1y[a]);
        }
        SubCount++;
        if (SubCount % P.ReinitEvery == 0) Reinit(exec);
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------
    // reinit
    // ------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>Fast-sweeping re-distancing of the band, with the float32 distance array of the TypeScript.</summary>
    public void Reinit(KernelExec exec) => ReinitCore<float, F32Dist, LiteralUpdate>(Dist, exec);

    /// <summary>The same with the distance array in double (<see cref="DistWide"/>): a test instrument, not a form. The TypeScript run with its <c>dist</c> replaced by a Float64Array gives the same doubles; comparing them exposes a changed operation order that the float32 store would hide.</summary>
    public void ReinitWide(KernelExec exec) => ReinitCore<double, F64Dist, LiteralUpdate>(_distWide ??= new double[N], exec);

    /// <summary>Reinit with another sweep update (serial sweeps), float32 or double distances: only for the mutation test.</summary>
    public void ReinitWith<TU>(bool wide) where TU : struct, IDistUpdate
    {
        if (wide) ReinitCore<double, F64Dist, TU>(_distWide ??= new double[N], KernelExec.Scalar);
        else ReinitCore<float, F32Dist, TU>(Dist, KernelExec.Scalar);
    }

    /// <summary>The bounding box (inclusive cell indices) that the last reinit used.</summary>
    public (int I0, int I1, int J0, int J1) Box => (_i0, _i1, _j0, _j1);

    public double[] DistWide => _distWide ??= new double[N];

    void ReinitCore<TW, TD, TU>(TW[] dist, KernelExec exec) where TW : unmanaged where TD : struct, IDistWord<TW> where TU : struct, IDistUpdate
    {
        int count = BandCount;
        if (count == 0) return;
        int nx = Nx, ny = Ny;
        int i0 = nx, i1 = -1, j0 = ny, j1 = -1;
        for (int a = 0; a < count; a++)
        {
            int k = Band[a];
            int i = k % nx;
            int j = (k - i) / nx;
            if (i < i0) i0 = i;
            if (i > i1) i1 = i;
            if (j < j0) j0 = j;
            if (j > j1) j1 = j;
            InBand[k] = 0;
        }
        int grow = P.FarCells + 1;
        i0 = Math.Max(0, i0 - grow);
        j0 = Math.Max(0, j0 - grow);
        i1 = Math.Min(nx - 1, i1 + grow);
        j1 = Math.Min(ny - 1, j1 + grow);
        _i0 = i0; _i1 = i1; _j0 = j0; _j1 = j1;
        int rows = j1 - j0 + 1;
        long boxCells = (long)rows * (i1 - i0 + 1);
        bool par = exec.Threads >= 2 && boxCells >= MinParallelBox / 4 && rows >= 2;
        int rowChunks = (rows + RowsPerChunk - 1) / RowsPerChunk;
        // 1. crossing cells keep their current |phi| as fixed data
        _vec = exec.Vector;
        _wide = typeof(TW) == typeof(double);
        if (_wide) { _dist64 = (double[])(object)dist; _dist32 = null; } else { _dist32 = (float[])(object)dist; _dist64 = null; }
        if (par) KernelPar.Chunks(rowChunks, exec.Threads, _rowStep1Chunk);
        else Step1Rows<TW, TD>(dist, j0, j1, exec.Vector);
        // 2. sweeps
        SweepAll<TW, TD, TU>(dist, exec, boxCells);
        // 3. write back and rebuild the band (row-major order = sorted)
        if (!par)
        {
            BandCount = WriteBackRows<TW, TD>(dist, j0, j1, 0);
            _dist32 = null; _dist64 = null;
            return;
        }
        if (_chunkCount.Length < rowChunks) _chunkCount = new int[rowChunks];
        KernelPar.Chunks(rowChunks, exec.Threads, _rowCountChunk);
        int total = 0;
        for (int c = 0; c < rowChunks; c++) { int n = _chunkCount[c]; _chunkCount[c] = total; total += n; } // exclusive prefix sum in chunk order
        KernelPar.Chunks(rowChunks, exec.Threads, _rowFillChunk);
        _dist32 = null; _dist64 = null;
        BandCount = total;
    }

    float[]? _dist32;
    double[]? _dist64;
    bool _wide;

    void RowStep1Chunk(int c)
    {
        int ja = _j0 + c * RowsPerChunk, jb = Math.Min(_j1, ja + RowsPerChunk - 1);
        if (_wide) Step1Rows<double, F64Dist>(_dist64!, ja, jb, _vec);
        else Step1Rows<float, F32Dist>(_dist32!, ja, jb, _vec);
    }

    // step 1 over box rows [ja, jb] (inclusive)
    void Step1Rows<TW, TD>(TW[] dist, int ja, int jb, bool vec) where TW : unmanaged where TD : struct, IDistWord<TW>
    {
        int nx = Nx, ny = Ny;
        int i0 = _i0, i1 = _i1;
        double far = Far;
        double[] phi = Phi;
        for (int j = ja; j <= jb; j++)
        {
            int i = i0;
            if (vec)
            {
                // interior cells of the row (i > 0, i < nx - 1, j > 0, j < ny - 1): two cells per vector; the neighbours are unaligned loads
                if (j > 0 && j < ny - 1)
                {
                    var zero = Vector128<double>.Zero;
                    for (; i + 1 <= i1 && i > 0 && i + 1 < nx - 1; i += 2)
                    {
                        int k = j * nx + i;
                        Vector128<double> p = Vector128.Create(phi, k);
                        Vector128<double> negV = Vector128.OnesComplement(Vector128.GreaterThan(p, zero));
                        Vector128<double> nl = Vector128.OnesComplement(Vector128.GreaterThan(Vector128.Create(phi, k - 1), zero));
                        Vector128<double> nr = Vector128.OnesComplement(Vector128.GreaterThan(Vector128.Create(phi, k + 1), zero));
                        Vector128<double> nd = Vector128.OnesComplement(Vector128.GreaterThan(Vector128.Create(phi, k - nx), zero));
                        Vector128<double> nu = Vector128.OnesComplement(Vector128.GreaterThan(Vector128.Create(phi, k + nx), zero));
                        // cross = any neighbour's sign differs from this cell's
                        Vector128<double> cross = Vector128.Xor(nl, negV) | Vector128.Xor(nr, negV) | Vector128.Xor(nd, negV) | Vector128.Xor(nu, negV);
                        for (int lane = 0; lane < 2; lane++)
                        {
                            double pv = p.GetElement(lane);
                            if (cross.AsInt64().GetElement(lane) != 0)
                            {
                                Fixed[k + lane] = 1;
                                TD.Store(dist, k + lane, negV.AsInt64().GetElement(lane) != 0 ? -pv : pv);
                            }
                            else
                            {
                                Fixed[k + lane] = 0;
                                TD.Store(dist, k + lane, far);
                            }
                        }
                    }
                }
            }
            for (; i <= i1; i++)
            {
                int k = j * nx + i;
                double p = phi[k];
                bool neg = !(p > 0);
                bool cross =
                    (i > 0 && !(phi[k - 1] > 0) != neg) ||
                    (i < nx - 1 && !(phi[k + 1] > 0) != neg) ||
                    (j > 0 && !(phi[k - nx] > 0) != neg) ||
                    (j < ny - 1 && !(phi[k + nx] > 0) != neg);
                if (cross)
                {
                    Fixed[k] = 1;
                    TD.Store(dist, k, neg ? -p : p);
                }
                else
                {
                    Fixed[k] = 0;
                    TD.Store(dist, k, far);
                }
            }
        }
    }

    void SweepAll<TW, TD, TU>(TW[] dist, KernelExec exec, long boxCells) where TW : unmanaged where TD : struct, IDistWord<TW> where TU : struct, IDistUpdate
    {
        int its = P.SweepIterations;
        bool wave = exec.Threads >= 2 && boxCells >= MinParallelBox;
        int i0 = _i0, i1 = _i1, j0 = _j0, j1 = _j1;
        int nTi = (i1 - i0 + Tile) / Tile, nTj = (j1 - j0 + Tile) / Tile;
        _tilesI = nTi;
        _sweepWide = typeof(TW) == typeof(double);
        if (wave && _diagTiles.Length < nTi * nTj) _diagTiles = new int[nTi * nTj];
        for (int it = 0; it < its; it++)
        {
            for (int o = 0; o < 4; o++)
            {
                if (!wave) { SweepRect<TW, TD, TU>(dist, o, i0, i1, j0, j1); continue; }
                _sweepO = o;
                // blocked wavefront: tile (ti, tj) in sweep space depends on (ti - 1, tj) and (ti, tj - 1); the tiles of one anti-diagonal are independent
                for (int d = 0; d <= nTi + nTj - 2; d++)
                {
                    int n = 0;
                    for (int tj = Math.Max(0, d - nTi + 1); tj <= Math.Min(nTj - 1, d); tj++)
                    {
                        int ti = d - tj;
                        _diagTiles[n++] = tj * nTi + ti; // sweep-space tile indices; mapped to the grid in TileChunk
                    }
                    _diagLen = n;
                    KernelPar.Chunks(n, exec.Threads, _tileChunk);
                }
            }
        }
    }

    bool _sweepWide;

    void TileChunk(int c)
    {
        int idx = _diagTiles[c];
        int nTi = _tilesI;
        int tj = idx / nTi, ti = idx % nTi;
        int o = _sweepO;
        int i0 = _i0, i1 = _i1, j0 = _j0, j1 = _j1;
        int nTj = (j1 - j0 + Tile) / Tile;
        // sweep-space to grid-space tile index: a descending ordering visits the tiles from the high end
        int gi = (o & 1) != 0 ? nTi - 1 - ti : ti;
        int gj = (o & 2) != 0 ? nTj - 1 - tj : tj;
        int ia = i0 + gi * Tile, ib = Math.Min(i1, ia + Tile - 1);
        int ja = j0 + gj * Tile, jb = Math.Min(j1, ja + Tile - 1);
        if (_sweepWide) SweepRect<double, F64Dist, LiteralUpdate>(_dist64!, o, ia, ib, ja, jb);
        else SweepRect<float, F32Dist, LiteralUpdate>(_dist32!, o, ia, ib, ja, jb);
    }

    /// <summary>One ordering's sweep over the rectangle [ia, ib] x [ja, jb] in the TypeScript's order (the neighbour tests use the box, not the rectangle).</summary>
    void SweepRect<TW, TD, TU>(TW[] dist, int o, int ia, int ib, int ja, int jb) where TW : unmanaged where TD : struct, IDistWord<TW> where TU : struct, IDistUpdate
    {
        int nx = Nx;
        int i0 = _i0, i1 = _i1, j0 = _j0, j1 = _j1;
        double h = H;
        double h2 = 2 * h * h;
        int iStart = (o & 1) != 0 ? ib : ia;
        int iEnd = (o & 1) != 0 ? ia - 1 : ib + 1;
        int di = (o & 1) != 0 ? -1 : 1;
        int jStart = (o & 2) != 0 ? jb : ja;
        int jEnd = (o & 2) != 0 ? ja - 1 : jb + 1;
        int dj = (o & 2) != 0 ? -1 : 1;
        byte[] fixedA = Fixed;
        for (int j = jStart; j != jEnd; j += dj)
        {
            int row = j * nx;
            for (int i = iStart; i != iEnd; i += di)
            {
                int k = row + i;
                if (fixedA[k] != 0) continue;
                double l = i > i0 ? TD.Load(dist, k - 1) : double.PositiveInfinity;
                double r = i < i1 ? TD.Load(dist, k + 1) : double.PositiveInfinity;
                double d = j > j0 ? TD.Load(dist, k - nx) : double.PositiveInfinity;
                double u = j < j1 ? TD.Load(dist, k + nx) : double.PositiveInfinity;
                double aa = l < r ? l : r;
                double bb = d < u ? d : u;
                double dn = TU.Update(aa, bb, h, h2);
                if (dn < TD.Load(dist, k)) TD.Store(dist, k, dn);
            }
        }
    }

    // the write-back of one box row: returns the band position after it
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    int WriteRow<TW, TD>(TW[] dist, int j, int nb) where TW : unmanaged where TD : struct, IDistWord<TW>
    {
        int nx = Nx;
        double h = H;
        double far = Far;
        double bandMax = P.BandCells * h;
        bool ext = P.BurntExtension;
        double extraH = P.BurntExtensionMaxExtraCells * h;
        for (int i = _i0; i <= _i1; i++)
        {
            int k = j * nx + i;
            bool neg = !(Phi[k] > 0);
            double d = TD.Load(dist, k);
            double v;
            if (d <= bandMax)
            {
                if (Fixed[k] == 1)
                {
                    // Crossing cells keep their exact phi; a burnt one at most `extra` cells deeper than dx.
                    v = Phi[k];
                    if (neg && ext && W(SBurnt, k) > 0 && v < -(h + extraH)) v = -(h + extraH);
                }
                else if (!neg) v = d;
                else if (ext && W(SBurnt, k) > 0)
                {
                    // The deeper of the arrival extension and the true distance, at most 2 cells deeper than the distance.
                    double lo = -(d + extraH);
                    double pk = Phi[k] < -d ? Phi[k] : -d;
                    v = pk < lo ? lo : pk;
                }
                else v = -d;
                Band[nb++] = k;
                InBand[k] = 1;
                Touched[k] = 1;
            }
            else v = neg ? -far : far;
            Phi[k] = v;
            PhiS[k] = v;
        }
        return nb;
    }

    int WriteBackRows<TW, TD>(TW[] dist, int ja, int jb, int nb) where TW : unmanaged where TD : struct, IDistWord<TW>
    {
        for (int j = ja; j <= jb; j++) nb = WriteRow<TW, TD>(dist, j, nb);
        return nb;
    }

    void RowCountChunk(int c)
    {
        int ja = _j0 + c * RowsPerChunk, jb = Math.Min(_j1, ja + RowsPerChunk - 1);
        double bandMax = P.BandCells * H;
        int n = 0;
        if (!_wide)
        {
            float[] d32 = _dist32!;
            for (int j = ja; j <= jb; j++)
                for (int i = _i0; i <= _i1; i++)
                    if (F32Dist.Load(d32, j * Nx + i) <= bandMax) n++;
        }
        else
        {
            double[] d64 = _dist64!;
            for (int j = ja; j <= jb; j++)
                for (int i = _i0; i <= _i1; i++)
                    if (d64[j * Nx + i] <= bandMax) n++;
        }
        _chunkCount[c] = n;
    }

    void RowFillChunk(int c)
    {
        int ja = _j0 + c * RowsPerChunk, jb = Math.Min(_j1, ja + RowsPerChunk - 1);
        if (!_wide) WriteBackRows<float, F32Dist>(_dist32!, ja, jb, _chunkCount[c]);
        else WriteBackRows<double, F64Dist>(_dist64!, ja, jb, _chunkCount[c]);
    }
}
