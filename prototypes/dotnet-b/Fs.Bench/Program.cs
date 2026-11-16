using System.Numerics;
using System.Runtime.InteropServices;
using System.Runtime.Intrinsics;
using System.Text.Json;
using System.Text.Json.Nodes;
using BenchmarkDotNet.Running;
using Fs.Bench;
using Fs.Kernel;

// Stage 1 (K1). Subcommands (anything else goes to BenchmarkDotNet, e.g. --filter "*PyrogenicBench*" --job Short):
//   selftest                          every SIMD mode this process can run against the scalar contract (run it under DOTNET_EnableAVX2=0 / DOTNET_EnableHWIntrinsic=0 too)
//   check FIXTURE_DIR                 C# against the captured TypeScript outputs; modes and thread counts against scalar
//   phone [REPEATS]                   what a phone screen calls (PhoneBench.RunAsync), on the synthetic source
//   --filter "*SpeedTest*" --job Short --artifacts DIR   (T1.2) the frozen speed-test kernels under BenchmarkDotNet (needs BDN 0.16 for net11.0)
//   speedtest-merge STENCIL_BDN.json COPY_BDN.json TS.json OUT.json   (T1.2) BDN + Node results -> reports/1-speedtest-kernels.json
//   merge FIXTURE_DIR BDN.json TS.json OUT.json
//                                     the BenchmarkDotNet results + the Node results -> reports/1-kernel-results.json
switch (args.Length > 0 ? args[0] : "")
{
    case "selftest":
        return SelfTest.Run(Console.WriteLine);
    case "check":
        Check.Run(KernelFixture.Load(args[1]), Console.WriteLine);
        return 0;
    case "phone":
        Console.Write(PhoneBench.RunAsync(args.Length > 1 ? int.Parse(args[1]) : 30).GetAwaiter().GetResult());
        return 0;
    case "speedtest-merge":
        return SpeedTestMerge.Run(args[1..]);
    case "merge":
        return Merge(args[1], args[2], args[3], args[4]);
    case "fsmath-run": // T1.3: every FsMath candidate over fixed input files, outputs as raw float64 (FsMathRun)
        return FsMathRun.Run(args[1..]);
    case "fsmath-vectors": // T1.3: CoreMathSharp against the test vectors of its own repository (FsMathVectors)
        return FsMathVectors.Run(args[1..]);
    case "fsmath-ns": // T1.3: ns per call of every function and implementation, a stopwatch loop in this process (FsMathNs)
        return FsMathNs.Run(args[1..]);
    default:
        BenchmarkSwitcher.FromAssembly(typeof(PyrogenicBench).Assembly).Run(args);
        return 0;
}

static int Merge(string fixtureDir, string bdnJson, string tsJson, string outJson)
{
    var f = KernelFixture.Load(fixtureDir);
    var check = Check.Run(f, Console.WriteLine);
    var ts = JsonNode.Parse(File.ReadAllText(tsJson))!;
    var bdn = JsonNode.Parse(File.ReadAllText(bdnJson))!;
    var runs = new JsonArray();
    var tsMedian = new Dictionary<string, double>();
    foreach (var c in ts["cases"]!.AsArray())
    {
        string cn = c!["case"]!.GetValue<string>();
        tsMedian[cn] = c["medianMs"]!.GetValue<double>();
        runs.Add(new JsonObject
        {
            ["name"] = $"pyrogenic-solve ts [{cn}]", ["impl"] = "ts", ["threads"] = 1, ["case"] = cn, ["n"] = c["n"]!.GetValue<int>(),
            ["medianMs"] = c["medianMs"]!.GetValue<double>(), ["p95Ms"] = c["p95Ms"]!.GetValue<double>(), ["minMs"] = c["minMs"]!.GetValue<double>(), ["maxMs"] = c["maxMs"]!.GetValue<double>(),
            ["notes"] = $"original src/atmosphere/pyrogenic.ts under Node {ts["node"]} (V8 {ts["v8"]}); each repeat is ONE solve call timed on its own; sim time {c["simTimeS"]} s, {c["nonZeroSourceCells"]} source cells; {c["warmup"]} warm-up calls",
        });
    }
    var medianByKey = new Dictionary<(string, string), double>();
    var scalarMedian = new Dictionary<string, double>();
    foreach (var b in bdn["Benchmarks"]!.AsArray())
    {
        string method = b!["Method"]!.GetValue<string>();
        string cn = b["Parameters"]!.GetValue<string>().Split('=')[1];
        var st = b["Statistics"]!;
        double med = st["Median"]!.GetValue<double>() / 1e6;
        medianByKey[(cn, method)] = med;
        if (method == "Scalar") scalarMedian[cn] = med;
    }
    foreach (var b in bdn["Benchmarks"]!.AsArray())
    {
        string method = b!["Method"]!.GetValue<string>();
        string cn = b["Parameters"]!.GetValue<string>().Split('=')[1];
        var st = b["Statistics"]!;
        double med = st["Median"]!.GetValue<double>() / 1e6;
        int threads = method.StartsWith("Parallel") ? int.Parse(method["Parallel".Length..]) : 1;
        runs.Add(new JsonObject
        {
            ["name"] = $"pyrogenic-solve {method} [{cn}]", ["impl"] = method.StartsWith("Parallel") ? "cs-parallel" : "cs-" + method.ToLowerInvariant(), ["threads"] = threads, ["case"] = cn,
            ["n"] = st["N"]!.GetValue<int>(), ["medianMs"] = med, ["p95Ms"] = st["Percentiles"]?["P95"]?.GetValue<double>() / 1e6, ["minMs"] = st["Min"]!.GetValue<double>() / 1e6, ["maxMs"] = st["Max"]!.GetValue<double>() / 1e6,
            ["meanMs"] = st["Mean"]!.GetValue<double>() / 1e6, ["allocatedBytesPerOp"] = b["Memory"]?["BytesAllocatedPerOperation"]?.GetValue<long>(),
            ["speedupVsTsMedian"] = tsMedian[cn] / med, ["speedupVsCsScalarMedian"] = scalarMedian[cn] / med,
            ["notes"] = "BenchmarkDotNet: median over iterations of the per-operation time (an iteration is a batch of invocations); p95 and min/max are over iterations, not single calls",
        });
    }
    string rep = "case1";
    double Med(string m) => medianByKey[(rep, m)];
    double T(string m) => tsMedian[rep] / Med(m);
    double all = T("Parallel4");
    var root = new JsonObject
    {
        ["stage"] = "1-kernel",
        ["when"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
        ["machine"] = new JsonObject
        {
            ["label"] = "container", ["cpu"] = PhoneBench.CpuModel(), ["cores"] = Environment.ProcessorCount, ["os"] = RuntimeInformation.OSDescription,
            ["runtime"] = RuntimeInformation.FrameworkDescription, ["vector128Accelerated"] = Vector128.IsHardwareAccelerated, ["vector256Accelerated"] = Vector256.IsHardwareAccelerated,
            ["vector512Accelerated"] = Vector512.IsHardwareAccelerated, ["bdnHost"] = bdn["HostEnvironmentInfo"]?.DeepClone(),
        },
        ["indicative"] = true,
        ["kernel"] = "PyrogenicPotential.solve (src/atmosphere/pyrogenic.ts)",
        ["representativeCase"] = rep,
        ["runs"] = runs,
        ["correctness"] = JsonSerializer.SerializeToNode(check),
        ["speedups"] = new JsonObject
        {
            ["scalarVsTs"] = T("Scalar"), ["tensorPrimitivesVsTs"] = T("TensorPrimitives"), ["vector128VsTs"] = T("Vector128"), ["vector256VsTs"] = T("Vector256"),
            ["parallel1VsTs"] = T("Parallel1"), ["parallel2VsTs"] = T("Parallel2"), ["parallel4VsTs"] = T("Parallel4"), ["parallel8VsTs"] = T("Parallel8"),
        },
        ["gate"] = new JsonObject
        {
            ["bar"] = "all-core C# >= 1.5x TypeScript on desktop",
            ["measured"] = $"{all:F2}x ({Environment.ProcessorCount} threads, median, {rep})",
            ["result"] = all >= 1.5 ? "pass" : "stop",
            ["why"] = "kernel-only comparison on the container's shared cores; see reports/1-kernel.md for the Amdahl bound and what the phone part needs",
        },
    };
    File.WriteAllText(outJson, root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine($"gate: {all:F2}x all-core vs TypeScript -> {(all >= 1.5 ? "pass" : "stop")}; wrote {outJson}");
    return 0;
}
