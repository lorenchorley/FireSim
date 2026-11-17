using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Intrinsics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Fs.Kernel.Air;

namespace Fs.Bench;

/// <summary>
/// T1.4a: the thread curve (a stopwatch loop, medians over single operations) and the merge of BenchmarkDotNet's full JSON with the Node harness's JSON into
/// <c>reports/1-air-kernels.json</c> and the Markdown tables of the report.
///   Fs.Bench air-threads OUT.json                                    thread counts 1, 2, 4, 8 on both fixtures
///   Fs.Bench air-merge BDN.json TS_K3_RUNS TS_K6_RUNS OUT.json [CONDITIONS.json] [THREADS.json]   (TS_*_RUNS: comma-separated Node result files, one per run)
/// </summary>
public static class AirMerge
{
    // T1.1 (reports/1-profile.md, katoomba3-standard, 1,800 s, CPU profile, share of the step loop): self time of the functions this card ports.
    static readonly (string Kernel, string Label, double Share)[] Shares =
    [
        ("relax", "EllipticSolver.relax", 15.1), ("advect", "dynamics.advect", 9.3), ("divergenceF32", "EllipticSolver.divergence", 5.4), ("gradient", "EllipticSolver.gradient", 5.0),
    ];
    const double StandardStepAirShare = 63.5;
    static readonly string[] KernelOrder = ["relax", "gradient", "divergenceF32", "divergenceF64", "advect"];
    static readonly string[] Forms = ["Scalar", "Vector", "Parallel4", "ParallelVector4"];

    static string Fx(string f) => f == "fx-k3std" ? "katoomba3-standard 30x30x20 (the app's grid)" : "6 km high tier 60x60x24 (the largest air grid of any tier)";

    // ───────────────────────────── thread curve ─────────────────────────────

    public static int Threads(string[] args)
    {
        var results = new JsonArray();
        var md = new StringBuilder();
        foreach (string fixture in new[] { "fx-k3std", "fx-k6high" })
        {
            var fx = AirBenchFixture.Load(fixture);
            AirGrid g = fx.Grid;
            var ops = new AirOps(g, fx.Masks());
            var relax = new AirRelax();
            var adv = new AirAdvect(g);
            double[] phi = fx.F64("field.phi"), o = new double[g.N];
            float[] u = fx.F32("field.u"), v = fx.F32("field.v"), w = fx.F32("field.w"), th = fx.F32("field.th"), sm = fx.F32("field.sm"), dx = fx.F32("derived.Dx"), dy = fx.F32("derived.Dy"), dz = fx.F32("derived.Dz");
            float[] du = new float[(g.Nx + 1) * g.Ny * g.Nz], dv = new float[g.Nx * (g.Ny + 1) * g.Nz], dw = new float[g.Nx * g.Ny * (g.Nz + 1)], dth = new float[g.N], dsm = new float[g.N];
            var levels = Enumerable.Range(0, fx.Header.GetProperty("levels").GetArrayLength()).Select(fx.Level).ToArray();
            var rc = fx.Header.GetProperty("relaxCalls").EnumerateArray().ToArray();
            var calls = new (AirLevel L, float[] XIn, int S, bool R)[rc.Length];
            for (int i = 0; i < rc.Length; i++)
            {
                float[] xIn = fx.F32($"call{i}.x");
                calls[i] = (levels[rc[i].GetProperty("level").GetInt32()].WithBX(fx.F32($"call{i}.b"), new float[xIn.Length]), xIn, rc[i].GetProperty("sweeps").GetInt32(), rc[i].GetProperty("reverse").GetBoolean());
            }
            var kernels = new (string Name, Action<AirExec> Run)[]
            {
                ("relax", e => { foreach (var c in calls) { Array.Copy(c.XIn, c.L.X, c.XIn.Length); relax.Run(c.L, c.S, c.R, e); } }),
                ("gradient", e => ops.Gradient(phi, e)),
                ("divergenceF32", e => ops.Divergence(u, v, w, o, 1, 1, e)),
                ("advect", e =>
                {
                    adv.Run(dx, dy, dz, u, du, g.Nx + 1, g.Ny, g.Nz, 0.5, 0, 0, null, null, e);
                    adv.Run(dx, dy, dz, v, dv, g.Nx, g.Ny + 1, g.Nz, 0, 0.5, 0, null, null, e);
                    adv.Run(dx, dy, dz, w, dw, g.Nx, g.Ny, g.Nz + 1, 0, 0, 0.5, null, null, e);
                    adv.Run(dx, dy, dz, th, dth, g.Nx, g.Ny, g.Nz, 0, 0, 0, sm, dsm, e);
                }),
            };
            md.AppendLine($"\n{Fx(fixture)}: median ms of one operation, stopwatch, 400 operations after a 400 ms warm-up (`Parallel.For` with MaxDegreeOfParallelism = t; t = 1 runs the chunks inline)\n");
            md.AppendLine("| kernel | scalar | vector128 | par t=1 | par t=2 | par t=4 | par t=8 | parvec t=1 | parvec t=2 | parvec t=4 | parvec t=8 |");
            md.AppendLine("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
            foreach (var (name, run) in kernels)
            {
                var cells = new List<(string Form, double Median)>();
                foreach (var (form, exec) in new[] { ("scalar", AirExec.Scalar), ("vector128", AirExec.Vec) }.Concat(new[] { 1, 2, 4, 8 }.Select(t => ($"par{t}", AirExec.Par(t)))).Concat(new[] { 1, 2, 4, 8 }.Select(t => ($"parvec{t}", AirExec.ParVec(t)))))
                    cells.Add((form, Median(() => run(exec))));
                md.AppendLine($"| {name} | " + string.Join(" | ", cells.Select(c => c.Median.ToString("F4", CultureInfo.InvariantCulture))) + " |");
                foreach (var c in cells) results.Add(new JsonObject { ["fixture"] = fixture, ["kernel"] = name, ["form"] = c.Form, ["medianMs"] = c.Median });
            }
        }
        File.WriteAllText(args[0], new JsonObject { ["when"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture), ["cores"] = Environment.ProcessorCount, ["method"] = "stopwatch, 400 single operations after 400 ms warm-up, median", ["cells"] = results }.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(md.ToString());
        return 0;
    }

    static double Median(Action op)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 400) op();
        var ms = new double[400];
        for (int i = 0; i < ms.Length; i++)
        {
            long t0 = Stopwatch.GetTimestamp();
            op();
            ms[i] = Stopwatch.GetElapsedTime(t0).TotalMilliseconds;
        }
        Array.Sort(ms);
        return ms[ms.Length / 2];
    }

    // ───────────────────────────── merge ─────────────────────────────

    sealed record Row(string Fixture, string Kernel, string Impl, string Form, int N, double Median, double Mean, double Sd, double P95, double Min, double Max, long Alloc, double? SpreadLo, double? SpreadHi);

    static string MethodKernel(string method) => method.Split('_')[0] switch
    {
        "Relax" => "relax", "Gradient" => "gradient", "DivergenceF32" => "divergenceF32", "DivergenceF64" => "divergenceF64", "Advect" => "advect", var x => x,
    };

    public static int Run(string[] args)
    {
        if (args.Length < 4) { Console.Error.WriteLine("usage: air-merge BDN.json TS_K3_RUNS TS_K6_RUNS OUT.json [CONDITIONS.json] [THREADS.json]"); return 2; }
        var bdn = JsonNode.Parse(File.ReadAllText(args[0]))!;
        var rows = new List<Row>();
        foreach (var b in bdn["Benchmarks"]!.AsArray())
        {
            string method = b!["Method"]!.GetValue<string>();
            string fixture = b["Parameters"]!.GetValue<string>().Split('=')[1];
            var st = b["Statistics"]!;
            string form = method.Split('_')[1];
            rows.Add(new Row(fixture, MethodKernel(method), "csharp", form, st["N"]!.GetValue<int>(), st["Median"]!.GetValue<double>() / 1e6, st["Mean"]!.GetValue<double>() / 1e6,
                st["StandardDeviation"]!.GetValue<double>() / 1e6, st["Percentiles"]!["P95"]!.GetValue<double>() / 1e6, st["Min"]!.GetValue<double>() / 1e6, st["Max"]!.GetValue<double>() / 1e6,
                b["Memory"]?["BytesAllocatedPerOperation"]?.GetValue<long>() ?? -1, null, null));
        }
        JsonNode? tsFirst = null;
        var tsLoadavg = new JsonArray();
        foreach (var (fixture, list) in new[] { ("fx-k3std", args[1]), ("fx-k6high", args[2]) })
        {
            var runs = list.Split(',').Select(f => JsonNode.Parse(File.ReadAllText(f))!).ToList();
            tsFirst ??= runs[0];
            foreach (var r in runs) tsLoadavg.Add(new JsonObject { ["fixture"] = fixture, ["loadavgAtStart"] = r["loadavg"]!.DeepClone() });
            foreach (string kernel in KernelOrder)
            {
                var cs = runs.Select(r => r["cases"]!.AsArray().First(c => c!["kernel"]!.GetValue<string>() == kernel)!).ToList();
                var meds = cs.Select(c => c["medianMs"]!.GetValue<double>()).OrderBy(x => x).ToArray();
                var first = cs[Array.IndexOf(cs.Select(c => c["medianMs"]!.GetValue<double>()).ToArray(), meds[meds.Length / 2])]!;
                rows.Add(new Row(fixture, kernel, "ts", "TypeScript", first["n"]!.GetValue<int>(), meds[meds.Length / 2], first["meanMs"]!.GetValue<double>(), first["stdDevMs"]!.GetValue<double>(), first["p95Ms"]!.GetValue<double>(),
                    first["minMs"]!.GetValue<double>(), first["maxMs"]!.GetValue<double>(), 0, meds[0], meds[^1]));
            }
        }
        double M(string fx, string kernel, string form) => rows.First(r => r.Fixture == fx && r.Kernel == kernel && r.Form == form).Median;

        var runsJson = new JsonArray();
        var md = new StringBuilder();
        foreach (string fx in new[] { "fx-k3std", "fx-k6high" })
        {
            md.AppendLine($"\n### {Fx(fx)}\n");
            md.AppendLine("| kernel (one operation) | TypeScript median ms (3 runs: min to max) | C# scalar | C# vector128 | C# parallel x4 | C# parallel x4 + vector128 |");
            md.AppendLine("|---|---:|---:|---:|---:|---:|");
            foreach (string k in KernelOrder)
            {
                var ts = rows.First(r => r.Fixture == fx && r.Kernel == k && r.Impl == "ts");
                string Cell(string form) { double m = M(fx, k, form); return string.Create(CultureInfo.InvariantCulture, $"{m:F4} ({ts.Median / m:F2}x)"); }
                md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| {k} | {ts.Median:F4} ({ts.SpreadLo:F4} to {ts.SpreadHi:F4}) | {Cell("Scalar")} | {Cell("Vector")} | {Cell("Parallel4")} | {Cell("ParallelVector4")} |"));
            }
        }
        foreach (var r in rows)
        {
            double tsMed = M(r.Fixture, r.Kernel, "TypeScript");
            runsJson.Add(new JsonObject
            {
                ["name"] = $"air {r.Kernel} {r.Form} [{r.Fixture}]", ["impl"] = r.Impl == "ts" ? "ts" : "cs-" + r.Form.ToLowerInvariant(), ["runtime"] = r.Impl == "ts" ? "v8-node" : "coreclr",
                ["threads"] = r.Form.EndsWith('4') ? 4 : 1, ["case"] = r.Fixture, ["kernel"] = r.Kernel, ["n"] = r.N, ["medianMs"] = r.Median, ["meanMs"] = r.Mean, ["stdDevMs"] = r.Sd, ["p95Ms"] = r.P95,
                ["minMs"] = r.Min, ["maxMs"] = r.Max, ["allocatedBytesPerOp"] = r.Impl == "ts" ? null : (JsonNode)r.Alloc, ["speedupVsTs"] = tsMed / r.Median,
                ["notes"] = r.Impl == "ts" ? $"original src kernels under Node, one thread; median of the three runs' medians, runs' medians {r.SpreadLo:F4} to {r.SpreadHi:F4} ms" : "BenchmarkDotNet 0.16.0-preview.2, default job, out of process; median over iterations of the per-operation time",
            });
        }

        // Amdahl: Gate 1 asks for the whole standard-tier step; these four kernels are the shares of reports/1-profile.md, everything else is taken as no faster.
        var proj = new JsonArray();
        md.AppendLine("\n### Projection of the whole standard-tier step (Amdahl, katoomba3-standard shares of T1.1)\n");
        md.AppendLine("| form (all four kernels in this form) | relax | advect | divergence | gradient | new share of the old step | projected step speedup |");
        md.AppendLine("|---|---:|---:|---:|---:|---:|---:|");
        double shareSum = Shares.Sum(s => s.Share);
        foreach (string form in Forms.Append("best of each"))
        {
            double rest = 100 - shareSum, newShare = rest;
            var sp = new Dictionary<string, double>();
            foreach (var (k, _, share) in Shares)
            {
                double s = form == "best of each" ? Forms.Max(f => M("fx-k3std", k, "TypeScript") / M("fx-k3std", k, f)) : M("fx-k3std", k, "TypeScript") / M("fx-k3std", k, form);
                sp[k] = s;
                newShare += share / s;
            }
            double total = 100 / newShare;
            md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| {form} | {sp["relax"]:F2}x | {sp["advect"]:F2}x | {sp["divergenceF32"]:F2}x | {sp["gradient"]:F2}x | {newShare:F1} % | **{total:F2}x** |"));
            proj.Add(new JsonObject { ["form"] = form, ["kernelSpeedups"] = JsonSerializer.SerializeToNode(sp), ["newShareOfOldStepPercent"] = newShare, ["projectedStepSpeedup"] = total });
        }
        double ceiling = 100 / (100 - shareSum);
        md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"\nThe four kernels are {shareSum:F1} % of the step; if they took no time at all the step would be {ceiling:F2}x faster (Amdahl ceiling). Gate 1's bar for the standard tier is 1.5x."));

        var root = new JsonObject
        {
            ["stage"] = "1-air-kernels",
            ["when"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
            ["machine"] = new JsonObject
            {
                ["label"] = "container", ["cpu"] = tsFirst!["cpu"]!.DeepClone(), ["cores"] = Environment.ProcessorCount, ["os"] = RuntimeInformation.OSDescription, ["runtime"] = RuntimeInformation.FrameworkDescription,
                ["vector128Accelerated"] = Vector128.IsHardwareAccelerated, ["vector256Accelerated"] = Vector256.IsHardwareAccelerated, ["vector512Accelerated"] = Vector512.IsHardwareAccelerated,
                ["node"] = tsFirst["node"]!.DeepClone(), ["v8"] = tsFirst["v8"]!.DeepClone(), ["bdnVersion"] = bdn["HostEnvironmentInfo"]!["BenchmarkDotNetVersion"]!.DeepClone(), ["bdnHost"] = bdn["HostEnvironmentInfo"]!.DeepClone(),
            },
            ["indicative"] = true,
            ["kernels"] = "EllipticSolver.relax, gradient, divergence (src/atmosphere/solver.ts) and dynamics.advect (src/atmosphere/dynamics.ts) on the real state of the standard tier at 900 s (Fs.Bench/ts/air/capture.ts)",
            ["runs"] = runsJson,
            ["projection"] = new JsonObject { ["basis"] = "reports/1-profile.md shares (relax 15.1, advect 9.3, divergence 5.4, gradient 5.0 % of the katoomba3-standard step loop); every other phase taken as no faster", ["airShareOfStepPercent"] = StandardStepAirShare, ["fourKernelsSharePercent"] = shareSum, ["amdahlCeiling"] = ceiling, ["byForm"] = proj },
            ["gate"] = new JsonObject
            {
                ["bar"] = "Gate 1, standard tier: projected whole-step gain >= 1.5x over the best TypeScript arm",
                ["measured"] = string.Create(CultureInfo.InvariantCulture, $"projection {proj.Last()!["projectedStepSpeedup"]!.GetValue<double>():F2}x with the best form of each of the four kernels (they are {shareSum:F1} % of the step; ceiling {ceiling:F2}x); assumes the rest of the step is no faster"),
                ["result"] = "not run",
                ["why"] = "a kernel-only projection on the container's shared cores, against one TypeScript thread; the whole-step measurement is T6.4 / T6.6; browser threads need cross-origin isolation (plan 10.2)",
            },
            ["notRun"] = new JsonArray("arm64 execution (the android-arm64 build only proves the library compiles; it needs the phone, round 1)", "phone and browser timings", "the other air phases (diffuse, smagorinsky, displacements, collocate)"),
        };
        if (args.Length > 4 && File.Exists(args[4])) root["conditions"] = JsonNode.Parse(File.ReadAllText(args[4]));
        if (args.Length > 5 && File.Exists(args[5])) root["threadCurve"] = JsonNode.Parse(File.ReadAllText(args[5]));
        root["tsLoadavgAtStartOfEachRun"] = tsLoadavg;
        File.WriteAllText(args[3], root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(md.ToString());
        Console.WriteLine($"wrote {args[3]}");
        return 0;
    }
}
