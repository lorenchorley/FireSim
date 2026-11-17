using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Intrinsics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Fs.Kernel;
using Fs.Kernel.LevelSet;

namespace Fs.Bench;

/// <summary>
/// T1.4b: the thread curve (a stopwatch loop, medians over single operations) and the merge of BenchmarkDotNet's full JSON with the Node harness's JSON into
/// <c>reports/1-fast-kernels.json</c> and the Markdown tables of the report.
///   Fs.Bench fast-threads OUT.json                                    thread counts 1, 2, 4, 8 on both fixtures, default and forced thresholds
///   Fs.Bench fast-merge BDN.json[,BDN2.json...] TS_900_RUNS TS_LATE_RUNS OUT.json [CONDITIONS.json] [THREADS.json]   (TS_*_RUNS: comma-separated Node result files, one per run)
/// </summary>
public static class FastMerge
{
    // T1.1 (reports/1-profile.md, katoomba6-fast, CPU profile, share of the step loop): self time of the functions this card ports. 1,800 s run for the 900 s window, the 4 h run for the late one.
    static readonly Dictionary<string, (double Evaluate, double Reinit, double Pyro, string Label)> Shares = new()
    {
        ["k6f-900"] = (3.0, 2.9, 8.4, "the 1,800 s profile's shares (the fire has burnt 664 cells; the 900 s frame stands in for it)"),
        ["k6f-late"] = (13.6, 10.1, 9.2, "the 4 h profile's shares (8,110 cells burnt; the 14,100 s frame)"),
    };
    static readonly string[] Forms = ["Scalar", "Vector", "Parallel4", "ParallelVector4"];
    static readonly string[] KernelOrder = ["evalStage1", "evalStage2", "reinit", "restore", "pyro"];

    static string Fx(string f) => f == "k6f-900" ? "katoomba6-fast-4h at 900 s (200x200 fire cells; band 1,606; reinit box 103 x 91)" : "katoomba6-fast-4h at 14,100 s (band 9,690; reinit box 151 x 200)";

    // ───────────────────────────── the x64 aggregate hash (to compare with the WebAssembly run) ─────────────────────────────

    /// <summary>Runs every case and variant of a fixture on the four forms of the WebAssembly driver (scalar, vector, parallel x4, parallel x4 + vector) on this machine and prints the aggregate hash that wasm-run.mjs prints.</summary>
    public static int Aggregate(string[] args)
    {
        var data = FastBenchData.Load(args[0]);
        var forms = new[] { KernelExec.Scalar, KernelExec.Vec, KernelExec.Par(4), KernelExec.ParVec(4) };
        var result = new JsonArray();
        foreach (KernelExec e in forms)
        {
            var got = Fs.Tests.FastCaseRunner.RunAll(data, data.Header, e);
            string all = string.Concat(got.Select(kv => kv.Key + "=" + kv.Value + ";"));
            string h = Fs.Tests.FastCaseRunner.Hash(Encoding.UTF8.GetBytes(all));
            Console.WriteLine($"{args[0]} [{e}]: {got.Count} hashes, aggregate {h}");
            result.Add(new JsonObject { ["form"] = e.ToString(), ["hashes"] = got.Count, ["aggregateHash"] = h });
        }
        if (args.Length > 1) File.WriteAllText(args[1], result.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }

    // ───────────────────────────── thread curve ─────────────────────────────

    public static int Threads(string[] args)
    {
        var results = new JsonArray();
        var md = new StringBuilder();
        foreach (string fixture in new[] { "k6f-900", "k6f-late" })
            foreach (bool forced in new[] { false, true })
            {
                var o = FastOpsFactory.Create(fixture);
                if (forced) { o.Ls1.MinParallelBand = 0; o.Ls2.MinParallelBand = 0; o.Ls3.MinParallelBox = 0; o.Ls3.MinParallelBand = 0; }
                var kernels = new (string Name, Func<KernelExec, double> Run)[]
                {
                    ("evalStage1", e => o.Eval1(e)), ("evalStage2", e => o.Eval2(e)), ("reinit", e => o.Reinit(e)), ("pyro", e => o.Solve(e)),
                };
                md.AppendLine($"\n{Fx(fixture)}, thresholds {(forced ? "forced to 0 (chunked and wavefront forms always)" : "default (evaluate 1,024 band cells, sweeps 16,384 box cells)")}: median ms of one operation, stopwatch, 400 operations after a 400 ms warm-up (`Parallel.For` with MaxDegreeOfParallelism = t; t = 1 runs the chunks inline)\n");
                md.AppendLine("| kernel | scalar | vector128 | par t=1 | par t=2 | par t=4 | par t=8 | parvec t=1 | parvec t=2 | parvec t=4 | parvec t=8 |");
                md.AppendLine("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
                foreach (var (name, run) in kernels)
                {
                    var cells = new List<(string Form, double Median)>();
                    foreach (var (form, exec) in new[] { ("scalar", KernelExec.Scalar), ("vector128", KernelExec.Vec) }.Concat(new[] { 1, 2, 4, 8 }.Select(t => ($"par{t}", KernelExec.Par(t)))).Concat(new[] { 1, 2, 4, 8 }.Select(t => ($"parvec{t}", KernelExec.ParVec(t)))))
                        cells.Add((form, Median(() => run(exec))));
                    md.AppendLine($"| {name} | " + string.Join(" | ", cells.Select(c => c.Median.ToString("F4", CultureInfo.InvariantCulture))) + " |");
                    foreach (var c in cells) results.Add(new JsonObject { ["fixture"] = fixture, ["thresholds"] = forced ? "forced" : "default", ["kernel"] = name, ["form"] = c.Form, ["medianMs"] = c.Median });
                }
            }
        File.WriteAllText(args[0], new JsonObject { ["when"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture), ["cores"] = Environment.ProcessorCount, ["method"] = "stopwatch, 400 single operations after 400 ms warm-up, median", ["cells"] = results }.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine(md.ToString());
        return 0;
    }

    /// <summary>A scratch probe for the developer (not part of any result): reinit with the float32 and the double distance array, evaluate, on both fixtures, scalar.</summary>
    public static int Diag(string[] args)
    {
        foreach (string fixture in new[] { "k6f-900", "k6f-late" })
        {
            var o = FastOpsFactory.Create(fixture);
            Console.WriteLine($"{fixture}: reinit float32 dist {Median(() => o.Reinit(KernelExec.Scalar)):F4} ms; reinit double dist {Median(() => { o.Restore(); o.Ls3.ReinitWide(KernelExec.Scalar); return o.Ls3.BandCount; }):F4} ms; restore {Median(() => o.Restore()):F4} ms; evalStage1 {Median(() => o.Eval1(KernelExec.Scalar)):F4} ms; evalStage1 vector {Median(() => o.Eval1(KernelExec.Vec)):F4} ms; evalStage2 {Median(() => o.Eval2(KernelExec.Scalar)):F4} ms");
        }
        return 0;
    }

    static double Median(Func<double> op)
    {
        double sink = 0;
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 400) sink += op();
        var ms = new double[400];
        for (int i = 0; i < ms.Length; i++)
        {
            long t0 = Stopwatch.GetTimestamp();
            sink += op();
            ms[i] = Stopwatch.GetElapsedTime(t0).TotalMilliseconds;
        }
        Array.Sort(ms);
        if (double.IsNaN(sink)) Console.Error.WriteLine("(sink NaN)");
        return ms[ms.Length / 2];
    }

    // ───────────────────────────── merge ─────────────────────────────

    sealed record Row(string Fixture, string Kernel, string Impl, string Form, int N, double Median, double Mean, double Sd, double P95, double Min, double Max, long Alloc, double? SpreadLo, double? SpreadHi);

    static string MethodKernel(string method) => method.Split('_')[0] switch
    {
        "EvalStage1" => "evalStage1", "EvalStage2" => "evalStage2", "Reinit" => "reinit", "Restore" => "restore", "Pyro" => "pyro", var x => x,
    };

    public static int Run(string[] args)
    {
        if (args.Length < 4) { Console.Error.WriteLine("usage: fast-merge BDN.json[,BDN2.json...] TS_900_RUNS TS_LATE_RUNS OUT.json [CONDITIONS.json] [THREADS.json]"); return 2; }
        // BenchmarkDotNet ran in several sessions (by kernel, each under the heavy-work lock for at most about 15 minutes): args[0] is a comma-separated list of the full JSON reports
        string[] bdnFiles = args[0].Split(',');
        var bdn = JsonNode.Parse(File.ReadAllText(bdnFiles[0]))!;
        foreach (string more in bdnFiles.Skip(1))
            foreach (var b in JsonNode.Parse(File.ReadAllText(more))!["Benchmarks"]!.AsArray().ToList()) bdn["Benchmarks"]!.AsArray().Add(b!.DeepClone());
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
        var sizes = new JsonObject();
        foreach (var (fixture, list) in new[] { ("k6f-900", args[1]), ("k6f-late", args[2]) })
        {
            var runs = list.Split(',').Select(f => JsonNode.Parse(File.ReadAllText(f))!).ToList();
            tsFirst ??= runs[0];
            sizes[fixture] = new JsonObject { ["bandCount"] = runs[0]["bandCount"]!.DeepClone(), ["stage1HookCells"] = runs[0]["hookCells"]!.DeepClone() };
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
        double CsRestore(string fx) => M(fx, "restore", "Scalar");

        var runsJson = new JsonArray();
        var md = new StringBuilder();
        foreach (string fx in new[] { "k6f-900", "k6f-late" })
        {
            md.AppendLine($"\n### {Fx(fx)}\n");
            md.AppendLine("| operation | TypeScript median ms (3 runs: min to max) | C# scalar | C# vector128 | C# parallel x4 | C# parallel x4 + vector128 |");
            md.AppendLine("|---|---:|---:|---:|---:|---:|");
            foreach (string k in KernelOrder)
            {
                var ts = rows.First(r => r.Fixture == fx && r.Kernel == k && r.Impl == "ts");
                if (k == "restore")
                {
                    md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| restore (alone: phi 320 KB, band, bandCount) | {ts.Median:F4} ({ts.SpreadLo:F4} to {ts.SpreadHi:F4}) | {M(fx, k, "Scalar"):F4} ({ts.Median / M(fx, k, "Scalar"):F2}x) | | | |"));
                    continue;
                }
                string Cell(string form) { double m = M(fx, k, form); return string.Create(CultureInfo.InvariantCulture, $"{m:F4} ({ts.Median / m:F2}x)"); }
                md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| {k}{(k == "reinit" ? " (with the restore)" : "")} | {ts.Median:F4} ({ts.SpreadLo:F4} to {ts.SpreadHi:F4}) | {Cell("Scalar")} | {Cell("Vector")} | {Cell("Parallel4")} | {Cell("ParallelVector4")} |"));
                if (k == "reinit")
                {
                    double tsNet = ts.Median - M(fx, "restore", "TypeScript");
                    string Net(string form) { double m = M(fx, k, form) - CsRestore(fx); return string.Create(CultureInfo.InvariantCulture, $"{m:F4} ({tsNet / m:F2}x)"); }
                    md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| reinit net of the restore | {tsNet:F4} | {Net("Scalar")} | {Net("Vector")} | {Net("Parallel4")} | {Net("ParallelVector4")} |"));
                }
            }
        }
        foreach (var r in rows)
        {
            double tsMed = M(r.Fixture, r.Kernel, "TypeScript");
            runsJson.Add(new JsonObject
            {
                ["name"] = $"fast {r.Kernel} {r.Form} [{r.Fixture}]", ["impl"] = r.Impl == "ts" ? "ts" : "cs-" + r.Form.ToLowerInvariant(), ["runtime"] = r.Impl == "ts" ? "v8-node" : "coreclr",
                ["threads"] = r.Form.EndsWith('4') ? 4 : 1, ["case"] = r.Fixture, ["kernel"] = r.Kernel, ["n"] = r.N, ["medianMs"] = r.Median, ["meanMs"] = r.Mean, ["stdDevMs"] = r.Sd, ["p95Ms"] = r.P95,
                ["minMs"] = r.Min, ["maxMs"] = r.Max, ["allocatedBytesPerOp"] = r.Impl == "ts" ? null : (JsonNode)r.Alloc, ["speedupVsTs"] = tsMed / r.Median,
                ["notes"] = r.Impl == "ts" ? $"original src kernels under Node, one thread; median of the three runs' medians, runs' medians {r.SpreadLo:F4} to {r.SpreadHi:F4} ms" : "BenchmarkDotNet 0.16.0-preview.2, default job, out of process; median over iterations of the per-operation time",
            });
        }

        // Amdahl: Gate 1 asks for the whole fast-tier step; these three kernels are the shares of reports/1-profile.md, everything else is taken as no faster.
        var proj = new JsonArray();
        var ceilings = new JsonObject();
        foreach (string fx in new[] { "k6f-900", "k6f-late" })
        {
            var (shEval, shReinit, shPyro, label) = Shares[fx];
            double shareSum = shEval + shReinit + shPyro, ceiling = 100 / (100 - shareSum);
            ceilings[fx] = new JsonObject { ["sharePercent"] = shareSum, ["ceiling"] = ceiling };
            md.AppendLine($"\n### Projection of the whole fast-tier step, {Fx(fx)}\n\nT1.1 shares: evaluate {shEval} %, reinit {shReinit} %, pyrogenic solve {shPyro} % of the step loop ({label}); every other phase taken as no faster.\n");
            md.AppendLine("| form (all three kernels in this form) | evaluate | reinit (net of restore) | pyrogenic | new share of the old step | projected step speedup |");
            md.AppendLine("|---|---:|---:|---:|---:|---:|");
            foreach (string form in Forms.Append("best of each"))
            {
                double Sp(string kernel, Func<string, double> csTime, Func<double> tsTime)
                {
                    if (form != "best of each") return tsTime() / csTime(form);
                    return Forms.Max(f => tsTime() / csTime(f));
                }
                double ev = Sp("evaluate", f => M(fx, "evalStage1", f) + M(fx, "evalStage2", f), () => M(fx, "evalStage1", "TypeScript") + M(fx, "evalStage2", "TypeScript"));
                double re = Sp("reinit", f => M(fx, "reinit", f) - CsRestore(fx), () => M(fx, "reinit", "TypeScript") - M(fx, "restore", "TypeScript"));
                double py = Sp("pyro", f => M(fx, "pyro", f), () => M(fx, "pyro", "TypeScript"));
                double newShare = 100 - shareSum + shEval / ev + shReinit / re + shPyro / py;
                double total = 100 / newShare;
                md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| {form} | {ev:F2}x | {re:F2}x | {py:F2}x | {newShare:F1} % | **{total:F3}x** |"));
                proj.Add(new JsonObject { ["fixture"] = fx, ["form"] = form, ["kernelSpeedups"] = new JsonObject { ["evaluate"] = ev, ["reinitNet"] = re, ["pyrogenic"] = py }, ["newShareOfOldStepPercent"] = newShare, ["projectedStepSpeedup"] = total });
            }
            md.AppendLine(string.Create(CultureInfo.InvariantCulture, $"\nThe three kernels are {shareSum:F1} % of the step; if they took no time at all the step would be {ceiling:F3}x faster (Amdahl ceiling). Gate 1's bar for the fast tier is 1.2x."));
        }

        var best900 = proj.First(p => p!["fixture"]!.GetValue<string>() == "k6f-900" && p["form"]!.GetValue<string>() == "best of each")!["projectedStepSpeedup"]!.GetValue<double>();
        var bestLate = proj.First(p => p!["fixture"]!.GetValue<string>() == "k6f-late" && p["form"]!.GetValue<string>() == "best of each")!["projectedStepSpeedup"]!.GetValue<double>();
        var root = new JsonObject
        {
            ["stage"] = "1-fast-kernels",
            ["when"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
            ["machine"] = new JsonObject
            {
                ["label"] = "container", ["cpu"] = tsFirst!["cpu"]!.DeepClone(), ["cores"] = Environment.ProcessorCount, ["os"] = RuntimeInformation.OSDescription, ["runtime"] = RuntimeInformation.FrameworkDescription,
                ["vector128Accelerated"] = Vector128.IsHardwareAccelerated, ["vector256Accelerated"] = Vector256.IsHardwareAccelerated, ["vector512Accelerated"] = Vector512.IsHardwareAccelerated,
                ["node"] = tsFirst["node"]!.DeepClone(), ["v8"] = tsFirst["v8"]!.DeepClone(), ["bdnVersion"] = bdn["HostEnvironmentInfo"]!["BenchmarkDotNetVersion"]!.DeepClone(), ["bdnHost"] = bdn["HostEnvironmentInfo"]!.DeepClone(),
            },
            ["indicative"] = true,
            ["kernels"] = "LevelSetCore.evaluate and reinit (src/fire/spread/levelSet.ts) and PyrogenicPotential.solve (src/atmosphere/pyrogenic.ts) on real frames of katoomba6-fast-4h at 900 s and 14,100 s (Fs.Bench/ts/fast/capture.ts)",
            ["frameSizes"] = sizes,
            ["runs"] = runsJson,
            ["projection"] = new JsonObject { ["basis"] = "reports/1-profile.md shares (fast tier: 1,800 s run evaluate 3.0, reinit 2.9, pyrogenic 8.4 %; 4 h run 13.6, 10.1, 9.2 % of the katoomba6-fast step loop); every other phase taken as no faster", ["amdahl"] = ceilings, ["byForm"] = proj },
            ["gate"] = new JsonObject
            {
                ["bar"] = "Gate 1, fast tier: projected whole-step gain >= 1.2x over the best TypeScript arm (its faithful random draw order caps it near 1.3x on 4 cores)",
                ["measured"] = string.Create(CultureInfo.InvariantCulture, $"projection {best900:F3}x at the 30-minute shares and {bestLate:F3}x at the 4 h shares with the best form of each of the three kernels (Amdahl ceilings {ceilings["k6f-900"]!["ceiling"]!.GetValue<double>():F3}x and {ceilings["k6f-late"]!["ceiling"]!.GetValue<double>():F3}x); assumes the rest of the step is no faster"),
                ["result"] = "not run",
                ["why"] = "a kernel-only projection on the container's shared cores, against one TypeScript thread; the embers (24 % at 30 minutes) stay serial in the faithful draw order; the whole-step measurement is T6.4 / T6.6",
            },
            ["notRun"] = new JsonArray("arm64 execution (the android-arm64 build only proves the library compiles; it needs the phone, round 1)", "phone and browser timings", "the other fast-tier phases (embers, wind for the fire, moisture, picture, detectors)"),
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
