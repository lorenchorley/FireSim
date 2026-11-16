using System.Runtime.InteropServices;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text.Json;
using Fs.Kernel.Air;

namespace Fs.Wasm;

/// <summary>
/// T1.4a: the standard tier's air kernels (Fs.Kernel/Air) as WebAssembly entry points. Arrays cross as <c>byte[]</c> (T1.3 found that a <c>Span&lt;double&gt;</c> parameter
/// rejects a JavaScript <c>Float64Array</c>): the driver stores every array of a fixture by name with <see cref="SetArray"/> (raw little-endian bytes, one copy), sets the
/// header (grid, levels, flags) with <see cref="SetHeader"/>, then runs the golden cases of Fs.Tests/golden/air-*.json one by one with <see cref="RunCase"/> on the form it
/// chooses, reads the outputs with <see cref="GetArray"/> and hashes them itself (canonical NaN, as the TypeScript harness and the C# tests do). Fs.Wasm has no threads,
/// so the parallel forms run their chunks on the one thread; what is being checked is that the bits are the same ones.
/// The case logic mirrors Fs.Tests/AirTestData.RunCase (the same recipe, the same kernels).
/// </summary>
[SupportedOSPlatform("browser")]
public static partial class AirExports
{
    static readonly Dictionary<string, byte[]> Store = [];
    static JsonDocument? s_header;

    [JSExport]
    public static void SetHeader(string json)
    {
        s_header?.Dispose();
        s_header = JsonDocument.Parse(json);
    }

    [JSExport]
    public static void SetArray(string name, byte[] bytes) => Store[name] = bytes;

    [JSExport]
    public static byte[] GetArray(string name) => Store[name];

    [JSExport]
    public static string Info() =>
        $"{RuntimeInformation.FrameworkDescription}; rid {RuntimeInformation.RuntimeIdentifier}; dynamicCode {System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeCompiled}; " +
        $"vector128 {System.Runtime.Intrinsics.Vector128.IsHardwareAccelerated}";

    static AirExec Form(int form) => form switch { 0 => AirExec.Scalar, 1 => AirExec.Vec, 2 => AirExec.Par(4), _ => AirExec.ParVec(4) };

    static double[] D(string n) => MemoryMarshal.Cast<byte, double>(Store[n].AsSpan()).ToArray();
    static float[] F(string n) => MemoryMarshal.Cast<byte, float>(Store[n].AsSpan()).ToArray();

    static void PoisonD(double[] a, int salt)
    {
        for (int i = salt; i < a.Length; i += 331) a[i] = double.NaN;
        for (int i = salt + 7; i < a.Length; i += 211) a[i] = -0.0;
    }

    static void PoisonF(float[] a, int salt)
    {
        for (int i = salt; i < a.Length; i += 331) a[i] = float.NaN;
        for (int i = salt + 7; i < a.Length; i += 211) a[i] = -0.0f;
    }

    static int? Salt(JsonElement i) => i.TryGetProperty("poison", out JsonElement s) && s.ValueKind == JsonValueKind.Number ? s.GetInt32() : null;

    static AirGrid Grid()
    {
        JsonElement g = s_header!.RootElement.GetProperty("grid");
        return new AirGrid(g.GetProperty("nx").GetInt32(), g.GetProperty("ny").GetInt32(), g.GetProperty("nz").GetInt32(), g.GetProperty("dx").GetDouble(), g.GetProperty("Hp").GetDouble(),
            D("grid.dzeta"), D("grid.dzetaW"), D("grid.J"), D("grid.Ju"), D("grid.Jv"), D("grid.zsx"), D("grid.zsy"), D("solver.fzeta"));
    }

    static void Put(string id, string role, double[] a) => Store[$"out.{id}.{role}"] = MemoryMarshal.AsBytes(a.AsSpan()).ToArray();
    static void Put(string id, string role, float[] a) => Store[$"out.{id}.{role}"] = MemoryMarshal.AsBytes(a.AsSpan()).ToArray();

    /// <summary>Runs one golden case (its JSON object, as in Fs.Tests/golden/air-*.json) on form 0 scalar, 1 Vector128, 2 Parallel.For x4, 3 Parallel.For x4 with the vector body. The outputs are kept as <c>out.&lt;id&gt;.&lt;role&gt;</c>; returns the roles, comma separated.</summary>
    [JSExport]
    public static string RunCase(string caseJson, int form)
    {
        AirExec exec = Form(form);
        using JsonDocument doc = JsonDocument.Parse(caseJson);
        JsonElement c = doc.RootElement;
        string id = c.GetProperty("id").GetString()!;
        string kernel = c.GetProperty("kernel").GetString()!;
        JsonElement p = c.GetProperty("params");
        var inputs = c.GetProperty("inputs").EnumerateArray().ToList();
        double[] Din(JsonElement i) { double[] a = D(i.GetProperty("array").GetString()!); if (Salt(i) is int s) PoisonD(a, s); return a; }
        float[] Fin(JsonElement i) { float[] a = F(i.GetProperty("array").GetString()!); if (Salt(i) is int s) PoisonF(a, s); return a; }
        AirGrid grid = Grid();
        JsonElement hdr = s_header!.RootElement;
        switch (kernel)
        {
            case "gradient":
            {
                bool top = p.GetProperty("topActive").GetBoolean();
                byte[] au, av;
                if (p.GetProperty("maskMode").GetString() == "real") { au = Store["masks.activeU"]; av = Store["masks.activeV"]; }
                else
                {
                    au = new byte[grid.NU]; av = new byte[grid.NV];
                    for (int f = 0; f < au.Length; f++) au[f] = (byte)(f % 3 == 0 ? 0 : 1);
                    for (int f = 0; f < av.Length; f++) av[f] = (byte)(f % 5 == 0 ? 0 : 1);
                }
                var ops = new AirOps(grid, new AirMasks(au, av, top));
                ops.Gradient(Din(inputs[0]), exec);
                Put(id, "gu", ops.Gu); Put(id, "gv", ops.Gv); Put(id, "gw", ops.Gw);
                return "gu,gv,gw";
            }
            case "divergence":
            {
                var ops = new AirOps(grid, new AirMasks(Store["masks.activeU"], Store["masks.activeV"], hdr.GetProperty("topActive").GetBoolean()));
                var o = new double[grid.N];
                double su = p.GetProperty("scaleU").GetDouble(), sw = p.GetProperty("scaleW").GetDouble();
                // float32 arrays have 4 bytes an element: the byte length tells which (u has nU elements)
                if (Store[inputs[0].GetProperty("array").GetString()!].Length == grid.NU * 4) ops.Divergence(Fin(inputs[0]), Fin(inputs[1]), Fin(inputs[2]), o, su, sw, exec);
                else ops.Divergence(Din(inputs[0]), Din(inputs[1]), Din(inputs[2]), o, su, sw, exec);
                Put(id, "out", o);
                return "out";
            }
            case "advect":
            {
                int nxF = p.GetProperty("nxF").GetInt32(), nyF = p.GetProperty("nyF").GetInt32(), nzF = p.GetProperty("nzF").GetInt32();
                bool dual = p.GetProperty("dual").GetBoolean();
                float[] dx = Fin(inputs[0]), dy = Fin(inputs[1]), dz = Fin(inputs[2]), src = Fin(inputs[3]);
                float[]? src2 = dual ? Fin(inputs[4]) : null;
                var dst = new float[nxF * nyF * nzF];
                float[]? dst2 = dual ? new float[dst.Length] : null;
                new AirAdvect(grid).Run(dx, dy, dz, src, dst, nxF, nyF, nzF, p.GetProperty("ox").GetDouble(), p.GetProperty("oy").GetDouble(), p.GetProperty("oz").GetDouble(), src2, dst2, exec);
                Put(id, "dst", dst);
                if (dual) { Put(id, "dst2", dst2!); return "dst,dst2"; }
                return "dst";
            }
            case "relax":
            {
                int l = p.GetProperty("level").GetInt32();
                JsonElement d = hdr.GetProperty("levels")[l];
                var lv = new AirLevel(d.GetProperty("nx").GetInt32(), d.GetProperty("ny").GetInt32(), d.GetProperty("nz").GetInt32())
                {
                    Cx = F($"level{l}.cx"), Cy = F($"level{l}.cy"), Cz = F($"level{l}.cz"), TInv = F($"level{l}.tInv"), TC = F($"level{l}.tC"),
                };
                float[] b = Fin(inputs[0]), x = Fin(inputs[1]);
                new AirRelax { MinParallelCells = 0 }.Run(lv.WithBX(b, x), p.GetProperty("sweeps").GetInt32(), p.GetProperty("reverse").GetBoolean(), exec);
                Put(id, "x", x);
                return "x";
            }
            default: throw new InvalidOperationException(kernel);
        }
    }
}
