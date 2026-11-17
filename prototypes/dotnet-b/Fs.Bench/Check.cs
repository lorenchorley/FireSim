using System.Runtime.InteropServices;
using System.Runtime.Intrinsics;
using Fs.Kernel;

namespace Fs.Bench;

/// <summary>Correctness: C# against the captured TypeScript outputs, and every C# form against the scalar form (bit for bit, on 1, 2, 4 and 8 threads).</summary>
public static class Check
{
    public sealed record CaseCheck(
        string Case, double SimTimeS,
        double PsiMaxAbs, double PsiMaxRel, int PsiNotBitEqual, int PsiLen,
        double UpMaxAbs, double VpMaxAbs, int UpNotBitEqual, int VpNotBitEqual, int UpLen, long UpMaxUlp, long VpMaxUlp,
        double PsiScale, double UpScale,
        Dictionary<string, bool> SerialModesBitEqualScalar, Dictionary<int, bool> ParallelBitEqualScalar, int ParallelRepeats);

    /// <summary>The serial modes this machine can run.</summary>
    public static IEnumerable<SimdMode> AvailableModes()
    {
        yield return SimdMode.Scalar;
        yield return SimdMode.V128; // also without hardware acceleration (then software Vector128, which must give the same bits)
    }

    public static List<CaseCheck> Run(KernelFixture f, Action<string> log, int repeats = 5)
    {
        var all = new List<CaseCheck>();
        foreach (var c in f.Cases)
        {
            var k = new PyrogenicKernel(f.FireNx, f.FireNy, f.CellSizeM, f.PyroK, f.PyroMax);
            k.SolveScalar(c.Q);
            var refPsi = (double[])k.Psi.Clone();
            var refUp = (float[])k.Up.Clone();
            var refVp = (float[])k.Vp.Clone();

            var modes = new Dictionary<string, bool>();
            foreach (var m in AvailableModes())
            {
                var km = new PyrogenicKernel(f.FireNx, f.FireNy, f.CellSizeM, f.PyroK, f.PyroMax);
                km.Solve(c.Q, m);
                modes[m.ToString()] = Same(km, refPsi, refUp, refVp);
            }

            var par = new Dictionary<int, bool>();
            var kr = new PyrogenicKernel(f.FireNx, f.FireNy, f.CellSizeM, f.PyroK, f.PyroMax);
            foreach (int threads in new[] { 1, 2, 4, 8 })
            {
                bool ok = true;
                for (int r = 0; r < repeats; r++)
                {
                    var kp = (r % 2 == 0) ? kr : new PyrogenicKernel(f.FireNx, f.FireNy, f.CellSizeM, f.PyroK, f.PyroMax); // a reused and a fresh instance
                    kp.SolveParallel(c.Q, threads);
                    ok &= Same(kp, refPsi, refUp, refVp);
                }
                par[threads] = ok;
            }

            double psiMaxAbs = 0, psiScale = 0, upScale = 0, upMaxAbs = 0, vpMaxAbs = 0;
            int psiNe = 0, upNe = 0, vpNe = 0;
            long upUlp = 0, vpUlp = 0;
            for (int i = 0; i < c.Psi.Length; i++)
            {
                psiScale = Math.Max(psiScale, Math.Abs(c.Psi[i]));
                psiMaxAbs = Math.Max(psiMaxAbs, Math.Abs(refPsi[i] - c.Psi[i]));
                if (BitConverter.DoubleToInt64Bits(refPsi[i]) != BitConverter.DoubleToInt64Bits(c.Psi[i])) psiNe++;
            }
            double psiMaxRel = psiScale > 0 ? psiMaxAbs / psiScale : 0;
            for (int i = 0; i < c.Up.Length; i++)
            {
                upScale = Math.Max(upScale, Math.Max(Math.Abs(c.Up[i]), Math.Abs(c.Vp[i])));
                upMaxAbs = Math.Max(upMaxAbs, Math.Abs((double)refUp[i] - c.Up[i]));
                vpMaxAbs = Math.Max(vpMaxAbs, Math.Abs((double)refVp[i] - c.Vp[i]));
                if (BitConverter.SingleToInt32Bits(refUp[i]) != BitConverter.SingleToInt32Bits(c.Up[i])) { upNe++; upUlp = Math.Max(upUlp, Ulps(refUp[i], c.Up[i])); }
                if (BitConverter.SingleToInt32Bits(refVp[i]) != BitConverter.SingleToInt32Bits(c.Vp[i])) { vpNe++; vpUlp = Math.Max(vpUlp, Ulps(refVp[i], c.Vp[i])); }
            }
            var cc = new CaseCheck(c.Name, c.SimTimeS, psiMaxAbs, psiMaxRel, psiNe, c.Psi.Length, upMaxAbs, vpMaxAbs, upNe, vpNe, c.Up.Length, upUlp, vpUlp, psiScale, upScale, modes, par, repeats);
            all.Add(cc);
            log($"{c.Name} (t={c.SimTimeS} s, {c.NonZeroSourceCells} source cells): scalar C# vs TypeScript capture: psi max|diff| {psiMaxAbs:E2} (scale {psiScale:E2}, rel {psiMaxRel:E2}, {psiNe}/{cc.PsiLen} not bit-equal); " +
                $"u_p max|diff| {upMaxAbs:E2}, v_p {vpMaxAbs:E2} (scale {upScale:E2} m/s; {upNe}/{cc.UpLen} and {vpNe}/{cc.UpLen} not bit-equal, max {upUlp}/{vpUlp} float32 ulp)");
            log("   serial modes == scalar bitwise: " + string.Join(", ", modes.Select(p => $"{p.Key} {p.Value}")) + $"; parallel (Vector128, x{repeats} each, reused and fresh instances): " + string.Join(", ", par.Select(p => $"{p.Key} threads {p.Value}")));
        }
        return all;
    }

    public static bool Same(PyrogenicKernel k, double[] psi, float[] up, float[] vp) =>
        MemoryMarshal.AsBytes<double>(k.Psi).SequenceEqual(MemoryMarshal.AsBytes<double>(psi)) &&
        MemoryMarshal.AsBytes<float>(k.Up).SequenceEqual(MemoryMarshal.AsBytes<float>(up)) &&
        MemoryMarshal.AsBytes<float>(k.Vp).SequenceEqual(MemoryMarshal.AsBytes<float>(vp));

    static long Ulps(float a, float b)
    {
        static long Ord(float x) { int i = BitConverter.SingleToInt32Bits(x); return i < 0 ? int.MinValue - (long)i : i; }
        return Math.Abs(Ord(a) - Ord(b));
    }
}
