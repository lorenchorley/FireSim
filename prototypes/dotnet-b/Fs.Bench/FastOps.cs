using System.Text.Json;
using Fs.Kernel;
using Fs.Kernel.LevelSet;
using Fs.Tests;

namespace Fs.Bench;

/// <summary>
/// The operations timed (T1.4b), built from one fixture (a folder of Fs.Bench/ts/fast/capture.ts, or the arrays that the WebAssembly driver stored): <c>Eval1</c> (<c>evaluate(phi, out, true)</c>
/// with the replay hook; the prepStamp of the cells the real hook was asked about is put back before each call), <c>Eval2</c> (<c>evaluate(phiS, out, false)</c>), <c>Reinit</c> (phi, band and
/// bandCount restored before each call, a copy: the same in the TypeScript), <c>Restore</c> alone, and <c>Solve</c> (the pyrogenic <c>solve</c> on a persistent instance). The same operations as
/// Fs.Bench/ts/fast/bench.ts. This file has no BenchmarkDotNet in it: Fs.Wasm compiles it too, for the WebAssembly timing.
/// </summary>
public sealed class FastOps
{
    public readonly LevelSetCore Ls1, Ls2, Ls3;
    public readonly PyrogenicKernel Pyro;
    readonly int[] _hookCells, _prepBefore, _band0;
    readonly double[] _out1, _out2, _phi0;
    readonly float[] _q;
    readonly int _count3;

    public FastOps(IFastData data, JsonElement header)
    {
        FastCaseRunner.Meta meta = FastCaseRunner.ReadMeta(header.GetProperty("meta"));
        JsonElement[] cases = header.GetProperty("cases").EnumerateArray().ToArray();
        JsonElement Find(string kind, string? mode) => cases.First(c => c.GetProperty("kind").GetString() == kind && (mode is null || c.GetProperty("mode").GetString() == mode));
        JsonElement e1 = Find("evaluate", "e1"), e2 = Find("evaluate", "e2"), ri = Find("reinit", null), py = Find("pyro", null);
        var (ls1, hooks1) = FastCaseRunner.BuildLs(data, meta, e1, "plain");
        hooks1.Log = false;
        Ls1 = ls1;
        _hookCells = hooks1.HookCells;
        int[] prep = data.I32(e1.GetProperty("arrays").GetProperty("prepStamp").GetString()!);
        _prepBefore = _hookCells.Select(k => prep[k]).ToArray();
        _out1 = new double[ls1.BandCount];
        var (ls2, h2) = FastCaseRunner.BuildLs(data, meta, e2, "plain");
        h2.Log = false;
        Ls2 = ls2;
        _out2 = new double[ls2.BandCount];
        var (ls3, h3) = FastCaseRunner.BuildLs(data, meta, ri, "plain");
        h3.Log = false;
        Ls3 = ls3;
        _phi0 = (double[])ls3.Phi.Clone();
        _count3 = ls3.BandCount;
        _band0 = ls3.Band.AsSpan(0, _count3).ToArray();
        Pyro = FastCaseRunner.NewPyro(meta, py);
        _q = data.F32(py.GetProperty("q").GetString()!);
    }

    public double Eval1(KernelExec e)
    {
        for (int i = 0; i < _hookCells.Length; i++) Ls1.PrepStamp[_hookCells[i]] = _prepBefore[i];
        return Ls1.Evaluate(Ls1.Phi, _out1, true, e);
    }

    public double Eval2(KernelExec e) => Ls2.Evaluate(Ls2.PhiS, _out2, false, e);

    public int Restore()
    {
        Array.Copy(_phi0, Ls3.Phi, _phi0.Length);
        Array.Copy(_band0, Ls3.Band, _count3);
        Ls3.BandCount = _count3;
        return Ls3.BandCount;
    }

    public int Reinit(KernelExec e)
    {
        Restore();
        Ls3.Reinit(e);
        return Ls3.BandCount;
    }

    public float Solve(KernelExec e)
    {
        Pyro.Solve(_q, e);
        return Pyro.Up[1];
    }

    public (int Band, int Hooks, int ReinitBand, (int I0, int I1, int J0, int J1) Box) Sizes()
    {
        Restore();
        Ls3.Reinit(KernelExec.Scalar);
        var box = Ls3.Box;
        Restore();
        return (Ls1.BandCount, _hookCells.Length, _count3, box);
    }

    /// <summary>One operation by name ("evalStage1", "evalStage2", "reinit", "restore", "pyro") on a form.</summary>
    public double Run(string op, KernelExec e) => op switch
    {
        "evalStage1" => Eval1(e),
        "evalStage2" => Eval2(e),
        "reinit" => Reinit(e),
        "restore" => Restore(),
        "pyro" => Solve(e),
        _ => throw new ArgumentException("unknown operation " + op),
    };
}
