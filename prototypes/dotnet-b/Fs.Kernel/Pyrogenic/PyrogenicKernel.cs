using System.Numerics.Tensors;
using System.Runtime.InteropServices;
using System.Runtime.Intrinsics;

namespace Fs.Kernel;

/// <summary>How the dense row accumulations are computed. Every mode gives bit-identical results (see the class remarks).</summary>
public enum SimdMode
{
    /// <summary>The literal port: one axpy loop per (row, coefficient), plain scalar code.</summary>
    Scalar,
    /// <summary>System.Numerics.Tensors: TensorPrimitives.Multiply then Add per (row, coefficient) (the framework-API candidate; two passes, a scratch row).</summary>
    Tensor,
    /// <summary>Explicit Vector128&lt;double&gt;, partial sums held in registers across all rows. The only width a phone (ARM64 NEON) accelerates.</summary>
    V128,
    /// <summary>Explicit Vector256&lt;double&gt; (AVX2 on x64). Needs Vector256.IsHardwareAccelerated.</summary>
    V256,
    /// <summary>V256 where accelerated, else V128 where accelerated, else Scalar.</summary>
    Auto,
}

/// <summary>
/// C# port of <c>PyrogenicPotential.solve</c> (src/atmosphere/pyrogenic.ts): the fast tier's fire-induced wind. The fire heat flux q (kW/m2, float32,
/// fire grid) is summed onto the grid coarsened by 2, the Poisson problem -lap(psi) = k q (psi = 0 on the boundary) is solved exactly with a
/// separable discrete sine transform written as dense matrix products ("axpy" row updates), and u_p = grad(psi) is interpolated back to the
/// fire grid and capped at pyroMax. Storage is float32 (q in, u_p / v_p out), arithmetic is double (psi, the work arrays), as in the TypeScript.
///
/// The scalar contract (what every faster form must reproduce bit for bit): each output element of a row accumulation is
/// 0 + c_i0 * x_i0 + c_i1 * x_i1 + ... over the contributing rows i in ascending order, each product and each sum rounded to double separately
/// (no fused multiply-add: the JIT does not contract a*b+c and the vector code multiplies and adds with separate operators, as V8 does not either).
///
/// Forms: SolveScalar (literal port), SolveTensor, SolveVector128, SolveVector256, SolveVector (Auto), and SolveParallel (Auto inside Parallel.For
/// over a FIXED decomposition: rows are cut into chunks of ChunkRows rows whatever the thread count, every output row is produced by exactly one chunk
/// with the same operation order and there is no cross-chunk reduction, so the result cannot depend on the number of threads or on which thread ran a chunk).
/// </summary>
public sealed class PyrogenicKernel
{
    /// <summary>Rows per parallel chunk. Fixed: it never depends on the thread count.</summary>
    public const int ChunkRows = 4;

    public readonly int FireNx, FireNy, Nx, Ny;
    public readonly double H;
    readonly double _k, _cap;
    readonly double[] _sx, _sy, _sxT, _invNx, _invNy, _lamX, _lamY;
    /// <summary>Potential on the coarse grid (m2/s) and u_p, v_p on the fire grid (m/s).</summary>
    public readonly double[] Psi;
    public readonly float[] Up, Vp;
    readonly double[] _tmp, _q, _gx, _gy;
    readonly byte[] _rowHas;
    readonly bool[] _chunkAny;

    // per-call state (read by the phases; set at the start of a solve; one solve at a time per instance)
    float[] _src = Array.Empty<float>();
    SimdMode _mode;
    readonly int _chunksCoarse, _chunksFire;
    ParallelOptions _opt = new() { MaxDegreeOfParallelism = 1 };
    // phase delegates, created once (no allocation per solve)
    readonly Action<int> _dFirst, _dY, _dInvY, _dInvX, _dGrad, _dFire;

    [ThreadStatic] static double[]? s_scratch;

    public PyrogenicKernel(int fireNx, int fireNy, double cellSize, double pyroK = 6e-4, double pyroMax = 5)
    {
        FireNx = fireNx;
        FireNy = fireNy;
        Nx = (fireNx + 1) / 2; // ceil(nx / 2)
        Ny = (fireNy + 1) / 2;
        H = 2 * cellSize;
        _k = pyroK;
        _cap = pyroMax;
        (_sx, _invNx, _lamX) = BuildDst(Nx);
        if (Ny == Nx) (_sy, _invNy, _lamY) = (_sx, _invNx, _lamX);
        else (_sy, _invNy, _lamY) = BuildDst(Ny);
        _sxT = new double[Nx * Nx];
        for (int p = 0; p < Nx; p++)
            for (int i = 0; i < Nx; i++) _sxT[i * Nx + p] = _sx[p * Nx + i];
        int nc = Nx * Ny;
        Psi = new double[nc];
        _tmp = new double[nc];
        _q = new double[nc];
        _gx = new double[nc];
        _gy = new double[nc];
        Up = new float[fireNx * fireNy];
        Vp = new float[fireNx * fireNy];
        _rowHas = new byte[Ny];
        _chunksCoarse = (Ny + ChunkRows - 1) / ChunkRows;
        _chunksFire = (FireNy + ChunkRows - 1) / ChunkRows;
        _chunkAny = new bool[_chunksCoarse];
        _dFirst = c => { int r0 = c * ChunkRows, r1 = Math.Min(Ny, r0 + ChunkRows); Coarsen(r0, r1, c); ForwardX(r0, r1); };
        _dY = c => TransformYScale(c * ChunkRows, Math.Min(Ny, (c + 1) * ChunkRows));
        _dInvY = c => InverseY(c * ChunkRows, Math.Min(Ny, (c + 1) * ChunkRows));
        _dInvX = c => InverseX(c * ChunkRows, Math.Min(Ny, (c + 1) * ChunkRows));
        _dGrad = c => Gradient(c * ChunkRows, Math.Min(Ny, (c + 1) * ChunkRows));
        _dFire = c => ToFire(c * ChunkRows, Math.Min(FireNy, (c + 1) * ChunkRows));
    }

    static (double[] s, double[] invNorm, double[] lam) BuildDst(int n)
    {
        var s = new double[n * n];
        var inv = new double[n];
        var lam = new double[n];
        for (int p = 0; p < n; p++)
        {
            for (int i = 0; i < n; i++) s[p * n + i] = Math.Sin(Math.PI * (p + 1) * (i + 0.5) / n);
            inv[p] = p == n - 1 ? 1.0 / n : 2.0 / n;
            double sn = Math.Sin(Math.PI * (p + 1) / (2.0 * n));
            lam[p] = 4 * (sn * sn);
        }
        return (s, inv, lam);
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------
    // Entry points
    // ------------------------------------------------------------------------------------------------------------------------------------------

    /// <summary>The mode Auto resolves to on this machine.</summary>
    public static SimdMode ResolveAuto() => Vector256.IsHardwareAccelerated ? SimdMode.V256 : Vector128.IsHardwareAccelerated ? SimdMode.V128 : SimdMode.Scalar;

    public void SolveScalar(float[] q) => Run(q, SimdMode.Scalar, 0);
    public void SolveTensor(float[] q) => Run(q, SimdMode.Tensor, 0);
    public void SolveVector128(float[] q) => Run(q, SimdMode.V128, 0);
    public void SolveVector256(float[] q) => Run(q, SimdMode.V256, 0);
    public void SolveVector(float[] q) => Run(q, SimdMode.Auto, 0);
    public void Solve(float[] q, SimdMode mode) => Run(q, mode, 0);

    /// <param name="threads">maximum degree of parallelism (1 = Parallel.For on the calling thread only); the result is the same for every value.</param>
    public void SolveParallel(float[] q, int threads, SimdMode mode = SimdMode.Auto) => Run(q, mode, Math.Max(1, threads));

    void Run(float[] qFire, SimdMode mode, int threads)
    {
        if (qFire.Length != FireNx * FireNy) throw new ArgumentException("q has the wrong length");
        if (mode == SimdMode.V256 && !Vector256.IsHardwareAccelerated) throw new NotSupportedException("Vector256 is not hardware accelerated here");
        if (mode == SimdMode.V128 && !Vector128.IsHardwareAccelerated) throw new NotSupportedException("Vector128 is not hardware accelerated here");
        _src = qFire;
        _mode = mode == SimdMode.Auto ? ResolveAuto() : mode;
        Array.Clear(_chunkAny);
        if (threads == 0)
        {
            // serial: straight-line phases over the whole row range, no delegates, no allocation
            Coarsen(0, Ny, 0);
            ForwardX(0, Ny);
            if (!AnySource()) { ClearOutputs(); return; }
            TransformYScale(0, Ny);
            InverseY(0, Ny);
            InverseX(0, Ny);
            Gradient(0, Ny);
            ToFire(0, FireNy);
            return;
        }
        if (_opt.MaxDegreeOfParallelism != threads) _opt = new ParallelOptions { MaxDegreeOfParallelism = threads };
        // 1+2. coarsen and forward x transform of the same coarse rows (row J of the transform needs only row J of the coarse source: one phase, one barrier)
        Parallel.For(0, _chunksCoarse, _opt, _dFirst);
        if (!AnySource()) { ClearOutputs(); return; }
        Parallel.For(0, _chunksCoarse, _opt, _dY);     // 3. y transform and division by the eigenvalues (output rows qy)
        Parallel.For(0, _chunksCoarse, _opt, _dInvY);  // 4. inverse y transform (reads Psi, writes tmp)
        Parallel.For(0, _chunksCoarse, _opt, _dInvX);  // 5. inverse x transform (reads tmp, writes Psi)
        Parallel.For(0, _chunksCoarse, _opt, _dGrad);  // 6. gradient on the coarse grid
        Parallel.For(0, _chunksFire, _opt, _dFire);    //    bilinear to the fire grid with the cap
    }

    bool AnySource()
    {
        bool any = false;
        foreach (bool b in _chunkAny) any |= b;
        return any;
    }

    // nothing burning: the TypeScript returns zero fields (what the transform computed is discarded)
    void ClearOutputs()
    {
        Array.Clear(Psi);
        Array.Clear(Up);
        Array.Clear(Vp);
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------
    // The phases, each a function of a row range [r0, r1)
    // ------------------------------------------------------------------------------------------------------------------------------------------

    // each coarse cell is the sum of <= 4 fire cells added in the TypeScript's order (fire row 2J: columns 2I, 2I+1; then row 2J+1), times k / cell count
    void Coarsen(int J0, int J1, int chunk)
    {
        float[] qFire = _src;
        bool any = false;
        for (int J = J0; J < J1; J++)
        {
            int cy = Math.Min(2, FireNy - 2 * J);
            for (int I = 0; I < Nx; I++)
            {
                int cx = Math.Min(2, FireNx - 2 * I);
                double s = 0;
                for (int dj = 0; dj < 2; dj++)
                {
                    int j = 2 * J + dj;
                    if (j >= FireNy) break;
                    for (int di = 0; di < 2; di++)
                    {
                        int i = 2 * I + di;
                        if (i >= FireNx) break;
                        double v = qFire[j * FireNx + i];
                        if (v > 0) { s += v; any = true; }
                    }
                }
                _q[J * Nx + I] = _k * s / (cx * cy);
            }
        }
        if (any) _chunkAny[chunk] = true;
    }

    // t[J][:] = sum_i q[J][i] * SxT[i][:] (skipping zero entries, i ascending), then * invNorm_x; rows with no source are 0
    void ForwardX(int J0, int J1)
    {
        for (int J = J0; J < J1; J++)
        {
            int r = J * Nx;
            var trow = _tmp.AsSpan(r, Nx);
            byte has = 0;
            for (int i = 0; i < Nx; i++) if (_q[r + i] != 0) { has = 1; break; }
            _rowHas[J] = has;
            AccumRows(trow, _q, r, 1, Nx, _sxT, Nx, null, skipZero: true);
            if (has != 0) for (int p = 0; p < trow.Length; p++) trow[p] = trow[p] * _invNx[p];
        }
    }

    // psi[qy][:] = sum_{J with source} Sy[qy][J] * t[J][:] (J ascending), then (psi * (invNorm_y[qy] h^2)) / (lamX[p] + lamY[qy])
    void TransformYScale(int r0, int r1)
    {
        for (int qy = r0; qy < r1; qy++)
        {
            var prow = Psi.AsSpan(qy * Nx, Nx);
            AccumRows(prow, _sy, qy * Ny, 1, Ny, _tmp, Nx, _rowHas, skipZero: false);
            double f = _invNy[qy] * H * H;
            double lamY = _lamY[qy];
            for (int p = 0; p < prow.Length; p++) prow[p] = (prow[p] * f) / (_lamX[p] + lamY);
        }
    }

    // t[J][:] = sum_{qy ascending} Sy[qy][J] * psi_hat[qy][:]  (the TypeScript loops qy outermost; each element still sums over qy in ascending order)
    // Reads Psi (psi_hat), writes _tmp; InverseX then overwrites Psi from _tmp: separate phases with a barrier between.
    void InverseY(int r0, int r1)
    {
        for (int J = r0; J < r1; J++) AccumRows(_tmp.AsSpan(J * Nx, Nx), _sy, J, Ny, Ny, Psi, Nx, null, skipZero: false);
    }

    // psi[J][:] = sum_p t[J][p] * Sx[p][:]  (p ascending)
    void InverseX(int r0, int r1)
    {
        for (int J = r0; J < r1; J++) AccumRows(Psi.AsSpan(J * Nx, Nx), _tmp, J * Nx, 1, Nx, _sx, Nx, null, skipZero: false);
    }

    // central differences of psi with ghost value -psi beyond the boundary
    void Gradient(int J0, int J1)
    {
        double twoH = 2 * H;
        for (int J = J0; J < J1; J++)
        {
            for (int I = 0; I < Nx; I++)
            {
                int c = J * Nx + I;
                double w = I > 0 ? Psi[c - 1] : -Psi[c];
                double e = I < Nx - 1 ? Psi[c + 1] : -Psi[c];
                double s = J > 0 ? Psi[c - Nx] : -Psi[c];
                double n = J < Ny - 1 ? Psi[c + Nx] : -Psi[c];
                _gx[c] = (e - w) / twoH;
                _gy[c] = (n - s) / twoH;
            }
        }
    }

    // bilinear from the coarse gradient to the fire cell centres, capped
    void ToFire(int j0, int j1)
    {
        for (int j = j0; j < j1; j++)
        {
            double fy = Math.Min(Math.Max((j + 0.5) / 2 - 0.5, 0), Ny - 1);
            int J0 = Math.Min((int)Math.Floor(fy), Math.Max(0, Ny - 2));
            double ty = fy - J0;
            for (int i = 0; i < FireNx; i++)
            {
                double fx = Math.Min(Math.Max((i + 0.5) / 2 - 0.5, 0), Nx - 1);
                int I0 = Math.Min((int)Math.Floor(fx), Math.Max(0, Nx - 2));
                double tx = fx - I0;
                int c = J0 * Nx + I0;
                int c1 = Nx > 1 ? c + 1 : c;
                int c2 = Ny > 1 ? c + Nx : c;
                int c3 = Nx > 1 && Ny > 1 ? c + Nx + 1 : c;
                double u = (_gx[c] * (1 - tx) + _gx[c1] * tx) * (1 - ty) + (_gx[c2] * (1 - tx) + _gx[c3] * tx) * ty;
                double v = (_gy[c] * (1 - tx) + _gy[c1] * tx) * (1 - ty) + (_gy[c2] * (1 - tx) + _gy[c3] * tx) * ty;
                double sp = Math.Sqrt(u * u + v * v);
                if (sp > _cap)
                {
                    u *= _cap / sp;
                    v *= _cap / sp;
                }
                int k = j * FireNx + i;
                Up[k] = (float)u;
                Vp[k] = (float)v;
            }
        }
    }

    // ------------------------------------------------------------------------------------------------------------------------------------------
    // The row accumulation: y[p] = sum over rows i (ascending) of coef[cs + i*cstride] * x[i*xstride + p], p in [0, y.Length),
    // skipping rows whose mask byte is 0 (mask given) or whose coefficient is 0 (skipZero). y is overwritten (its old contents never matter).
    // ------------------------------------------------------------------------------------------------------------------------------------------

    void AccumRows(Span<double> y, double[] coef, int cs, int cstride, int count, double[] x, int xstride, byte[]? mask, bool skipZero)
    {
        // validated once per call: every offset the width-specific code forms is inside the arrays (count rows, y.Length columns)
        int n = y.Length;
        if (count > 0 && (cs < 0 || cs + (count - 1) * cstride >= coef.Length || (count - 1) * xstride + n > x.Length || (mask != null && mask.Length < count)))
            throw new ArgumentOutOfRangeException(nameof(count));
        switch (_mode)
        {
            case SimdMode.V256:
                if (Vector256.IsHardwareAccelerated && n >= Vector256<double>.Count) { Accum256(y, coef, cs, cstride, count, x, xstride, mask, skipZero); return; }
                break;
            case SimdMode.V128:
                if (Vector128.IsHardwareAccelerated && n >= Vector128<double>.Count) { Accum128(y, coef, cs, cstride, count, x, xstride, mask, skipZero); return; }
                break;
            case SimdMode.Tensor:
                AccumTensor(y, coef, cs, cstride, count, x, xstride, mask, skipZero);
                return;
        }
        AccumAxpy(y, coef, cs, cstride, count, x, xstride, mask, skipZero);
    }

    // the literal port (and the small-input / no-SIMD fallback): clear, then one axpy per contributing row
    static void AccumAxpy(Span<double> y, double[] coef, int cs, int cstride, int count, double[] x, int xstride, byte[]? mask, bool skipZero)
    {
        y.Clear();
        for (int i = 0; i < count; i++)
        {
            if (mask != null && mask[i] == 0) continue;
            double c = coef[cs + i * cstride];
            if (skipZero && c == 0) continue;
            var xr = x.AsSpan(i * xstride, y.Length);
            for (int p = 0; p < y.Length; p++) y[p] = y[p] + c * xr[p];
        }
    }

    // framework API: TensorPrimitives.Multiply (x * c into a scratch row) then Add (y += scratch). Contract-preserving (IEEE multiply, then IEEE add).
    static void AccumTensor(Span<double> y, double[] coef, int cs, int cstride, int count, double[] x, int xstride, byte[]? mask, bool skipZero)
    {
        y.Clear();
        var tmp = (s_scratch is { } sc && sc.Length >= y.Length ? sc : s_scratch = new double[Math.Max(256, y.Length)]).AsSpan(0, y.Length);
        for (int i = 0; i < count; i++)
        {
            if (mask != null && mask[i] == 0) continue;
            double c = coef[cs + i * cstride];
            if (skipZero && c == 0) continue;
            TensorPrimitives.Multiply(x.AsSpan(i * xstride, y.Length), c, tmp);
            TensorPrimitives.Add(y, tmp, y);
        }
    }

    // Vector256: partial sums in registers across all rows. Blocks of 4 vectors, then single vectors, then the tail by recomputing the LAST full vector
    // (idempotent: an output lane depends only on x and coef, never on y's old contents, so the overlapped lanes get the same bits twice).
    static void Accum256(Span<double> y, double[] coef, int cs, int cstride, int count, double[] x, int xstride, byte[]? mask, bool skipZero)
    {
        const int W = 4; // Vector256<double>.Count
        int n = y.Length;
        ref double xr = ref MemoryMarshal.GetArrayDataReference(x);
        ref double yr = ref MemoryMarshal.GetReference(y);
        int p = 0;
        for (; p + 4 * W <= n; p += 4 * W)
        {
            Vector256<double> a0 = Vector256<double>.Zero, a1 = a0, a2 = a0, a3 = a0;
            for (int i = 0; i < count; i++)
            {
                if (mask != null && mask[i] == 0) continue;
                double c = coef[cs + i * cstride];
                if (skipZero && c == 0) continue;
                var vc = Vector256.Create(c);
                nuint o = (nuint)(i * xstride + p);
                a0 += vc * Vector256.LoadUnsafe(ref xr, o);
                a1 += vc * Vector256.LoadUnsafe(ref xr, o + W);
                a2 += vc * Vector256.LoadUnsafe(ref xr, o + 2 * W);
                a3 += vc * Vector256.LoadUnsafe(ref xr, o + 3 * W);
            }
            a0.StoreUnsafe(ref yr, (nuint)p);
            a1.StoreUnsafe(ref yr, (nuint)(p + W));
            a2.StoreUnsafe(ref yr, (nuint)(p + 2 * W));
            a3.StoreUnsafe(ref yr, (nuint)(p + 3 * W));
        }
        for (; p + W <= n; p += W) One256(ref yr, ref xr, p, coef, cs, cstride, count, xstride, mask, skipZero);
        if (p < n) One256(ref yr, ref xr, n - W, coef, cs, cstride, count, xstride, mask, skipZero);
    }

    static void One256(ref double yr, ref double xr, int p, double[] coef, int cs, int cstride, int count, int xstride, byte[]? mask, bool skipZero)
    {
        Vector256<double> a = Vector256<double>.Zero;
        for (int i = 0; i < count; i++)
        {
            if (mask != null && mask[i] == 0) continue;
            double c = coef[cs + i * cstride];
            if (skipZero && c == 0) continue;
            a += Vector256.Create(c) * Vector256.LoadUnsafe(ref xr, (nuint)(i * xstride + p));
        }
        a.StoreUnsafe(ref yr, (nuint)p);
    }

    static void Accum128(Span<double> y, double[] coef, int cs, int cstride, int count, double[] x, int xstride, byte[]? mask, bool skipZero)
    {
        const int W = 2; // Vector128<double>.Count
        int n = y.Length;
        ref double xr = ref MemoryMarshal.GetArrayDataReference(x);
        ref double yr = ref MemoryMarshal.GetReference(y);
        int p = 0;
        for (; p + 4 * W <= n; p += 4 * W)
        {
            Vector128<double> a0 = Vector128<double>.Zero, a1 = a0, a2 = a0, a3 = a0;
            for (int i = 0; i < count; i++)
            {
                if (mask != null && mask[i] == 0) continue;
                double c = coef[cs + i * cstride];
                if (skipZero && c == 0) continue;
                var vc = Vector128.Create(c);
                nuint o = (nuint)(i * xstride + p);
                a0 += vc * Vector128.LoadUnsafe(ref xr, o);
                a1 += vc * Vector128.LoadUnsafe(ref xr, o + W);
                a2 += vc * Vector128.LoadUnsafe(ref xr, o + 2 * W);
                a3 += vc * Vector128.LoadUnsafe(ref xr, o + 3 * W);
            }
            a0.StoreUnsafe(ref yr, (nuint)p);
            a1.StoreUnsafe(ref yr, (nuint)(p + W));
            a2.StoreUnsafe(ref yr, (nuint)(p + 2 * W));
            a3.StoreUnsafe(ref yr, (nuint)(p + 3 * W));
        }
        for (; p + W <= n; p += W) One128(ref yr, ref xr, p, coef, cs, cstride, count, xstride, mask, skipZero);
        if (p < n) One128(ref yr, ref xr, n - W, coef, cs, cstride, count, xstride, mask, skipZero);
    }

    static void One128(ref double yr, ref double xr, int p, double[] coef, int cs, int cstride, int count, int xstride, byte[]? mask, bool skipZero)
    {
        Vector128<double> a = Vector128<double>.Zero;
        for (int i = 0; i < count; i++)
        {
            if (mask != null && mask[i] == 0) continue;
            double c = coef[cs + i * cstride];
            if (skipZero && c == 0) continue;
            a += Vector128.Create(c) * Vector128.LoadUnsafe(ref xr, (nuint)(i * xstride + p));
        }
        a.StoreUnsafe(ref yr, (nuint)p);
    }
}
