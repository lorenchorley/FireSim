using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Intrinsics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Fs.Kernel.SpeedTest;

namespace Fs.Bench;

/// <summary>
/// T1.2: BenchmarkDotNet's "full" JSON for the two speed-test classes + the Node harness's JSON (ts/speedtest-bench.ts) -> the results file
/// (reports/RESULTS-SCHEMA.md, stage 1-speedtest-kernels) and a Markdown table on stdout.
///   Fs.Bench speedtest-merge STENCIL_BDN.json COPY_BDN.json TS.json OUT.json
/// </summary>
public static class SpeedTestMerge
{
    sealed record Row(string Kernel, string Impl, string Method, int N, double Median, double Mean, double StdDev, double P95, double Min, double Max, string Notes);

    public static int Run(string[] args)
    {
        if (args.Length != 4) { Console.Error.WriteLine("usage: speedtest-merge STENCIL_BDN.json COPY_BDN.json TS.json OUT.json"); return 2; }
        var stencil = JsonNode.Parse(File.ReadAllText(args[0]))!;
        var copy = JsonNode.Parse(File.ReadAllText(args[1]))!;
        var ts = JsonNode.Parse(File.ReadAllText(args[2]))!;

        var rows = new List<Row>();
        foreach (var (kernel, doc) in new[] { ("K1 stencil", stencil), ("K2 copy", copy) })
            foreach (var b in doc["Benchmarks"]!.AsArray())
            {
                string method = b!["Method"]!.GetValue<string>();
                var st = b["Statistics"]!;
                string impl = method switch
                {
                    "Scalar" => "csharp-scalar",
                    "ScalarPlainWidening" => "csharp-scalar-plain-widening",
                    "Vector128" => "csharp-vector128",
                    "MemmoveNotTheContract" => "csharp-memmove-not-contract",
                    _ => "csharp-" + method.ToLowerInvariant(),
                };
                string notes = method switch
                {
                    "Scalar" => "the contract: scalar loops, double arithmetic (BenchmarkDotNet, baseline)",
                    "ScalarPlainWidening" => "bit-identical literal port with (double)f[i] widenings (vcvtss2sd false dependency)",
                    "Vector128" => "element-wise Vector128, bit-identical to Scalar",
                    "MemmoveNotTheContract" => "Span.CopyTo: NOT the contract, the bandwidth ceiling",
                    _ => "",
                };
                rows.Add(new Row(kernel, impl, method, st["N"]!.GetValue<int>(), st["Median"]!.GetValue<double>() / 1e6, st["Mean"]!.GetValue<double>() / 1e6,
                    st["StandardDeviation"]!.GetValue<double>() / 1e6, st["Percentiles"]!["P95"]!.GetValue<double>() / 1e6, st["Min"]!.GetValue<double>() / 1e6,
                    st["Max"]!.GetValue<double>() / 1e6, notes));
            }
        foreach (var c in ts["cases"]!.AsArray())
        {
            string name = c!["name"]!.GetValue<string>();
            string kernel = name.StartsWith("stencil") ? "K1 stencil" : "K2 copy";
            rows.Add(new Row(kernel, "ts", "TypeScript", c["n"]!.GetValue<int>(), c["medianMs"]!.GetValue<double>(), c["meanMs"]!.GetValue<double>(), c["stdDevMs"]!.GetValue<double>(),
                c["p95Ms"]!.GetValue<double>(), c["minMs"]!.GetValue<double>(), c["maxMs"]!.GetValue<double>(),
                $"original src/ui/speedTestKernels.ts under Node {ts["node"]} (V8 {ts["v8"]}), one thread; one whole sweep a sample; {c["warmup"]} warm-up sweeps"));
        }

        double Work(string kernel) => kernel == "K1 stencil" ? 43.0 * 43 * 18 : 16.0 * 1024 * 1024;
        double Rate(Row r) => r.Kernel == "K1 stencil" ? Work(r.Kernel) / (r.Median / 1000) / 1e6 : Work(r.Kernel) / (r.Median / 1000) / 1e9;
        string Unit(string k) => k == "K1 stencil" ? "Mcells/s" : "GB/s";
        double Med(string k, string impl) => rows.First(r => r.Kernel == k && r.Impl == impl).Median;

        var runs = new JsonArray();
        foreach (var r in rows)
        {
            double tsMed = Med(r.Kernel, "ts");
            double scMed = Med(r.Kernel, "csharp-scalar");
            runs.Add(new JsonObject
            {
                ["name"] = $"{r.Kernel} sweep {r.Impl}", ["impl"] = r.Impl, ["kernel"] = r.Kernel, ["threads"] = 1, ["n"] = r.N,
                ["medianMs"] = r.Median, ["meanMs"] = r.Mean, ["stdDevMs"] = r.StdDev, ["p95Ms"] = r.P95, ["minMs"] = r.Min, ["maxMs"] = r.Max,
                ["rate"] = Rate(r), ["rateUnit"] = Unit(r.Kernel), ["speedupVsTs"] = tsMed / r.Median, ["speedupVsCsharpScalar"] = scMed / r.Median, ["notes"] = r.Notes,
            });
        }

        // the frozen checksums, recomputed now by the code that was benchmarked
        var k1 = new StencilKernel(KernelPath.Scalar); SpeedTest.Sweeps(k1, 3);
        var k2 = new CopyKernel(KernelPath.Scalar); SpeedTest.Sweeps(k2, 2);
        var k1v = new StencilKernel(KernelPath.Vector128); SpeedTest.Sweeps(k1v, 3);
        var k2v = new CopyKernel(KernelPath.Vector128); SpeedTest.Sweeps(k2v, 2);
        var tsChecks = ts["checksums"]!;
        bool ok = k1.Checksum() == SpeedTestConstants.FrozenStencilAfter3 && k2.Checksum() == SpeedTestConstants.FrozenCopyAfter2
                  && k1v.Checksum() == SpeedTestConstants.FrozenStencilAfter3 && k2v.Checksum() == SpeedTestConstants.FrozenCopyAfter2 && tsChecks["ok"]!.GetValue<bool>();

        var host = stencil["HostEnvironmentInfo"]!;
        var root = new JsonObject
        {
            ["stage"] = "1-speedtest-kernels",
            ["when"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
            ["machine"] = new JsonObject
            {
                ["label"] = "container", ["cpu"] = ts["cpu"]!.DeepClone(), ["cores"] = Environment.ProcessorCount, ["os"] = RuntimeInformation.OSDescription,
                ["runtime"] = RuntimeInformation.FrameworkDescription, ["vector128Accelerated"] = Vector128.IsHardwareAccelerated, ["vector256Accelerated"] = Vector256.IsHardwareAccelerated,
                ["vector512Accelerated"] = Vector512.IsHardwareAccelerated, ["node"] = ts["node"]!.DeepClone(), ["v8"] = ts["v8"]!.DeepClone(), ["bdnVersion"] = host["BenchmarkDotNetVersion"]!.DeepClone(),
                ["bdnHost"] = host.DeepClone(),
            },
            ["indicative"] = true,
            ["kernels"] = "src/ui/speedTestKernels.ts (SPEED_TEST_VERSION 1): K1 air stencil 45x45x20 (33,282 interior cell updates a sweep), K2 16 MiB copy in 8 parts; one operation = one whole sweep",
            ["runs"] = runs,
            ["correctness"] = new JsonObject
            {
                ["frozenStencilAfter3"] = $"0x{SpeedTestConstants.FrozenStencilAfter3:x8}", ["frozenCopyAfter2"] = $"0x{SpeedTestConstants.FrozenCopyAfter2:x8}",
                ["csharpScalar"] = new JsonObject { ["stencilAfter3"] = $"0x{k1.Checksum():x8}", ["copyAfter2"] = $"0x{k2.Checksum():x8}" },
                ["csharpVector128"] = new JsonObject { ["stencilAfter3"] = $"0x{k1v.Checksum():x8}", ["copyAfter2"] = $"0x{k2v.Checksum():x8}" },
                ["typescriptNode"] = new JsonObject { ["stencilAfter3"] = $"0x{tsChecks["stencilAfter3"]!.GetValue<uint>():x8}", ["copyAfter2"] = $"0x{tsChecks["copyAfter2"]!.GetValue<uint>():x8}" },
                ["allReproduced"] = ok,
            },
            ["gate"] = new JsonObject
            {
                ["bar"] = "none: T1.2 has no gate (the speed test's kernels are not the solver; Gate 1 and 1W are measured on the solver kernels)",
                ["measured"] = string.Join("; ", new[] { "K1 stencil", "K2 copy" }.Select(k => $"{k}: scalar {Med(k, "ts") / Med(k, "csharp-scalar"):F2}x, vector128 {Med(k, "ts") / Med(k, "csharp-vector128"):F2}x TypeScript")),
                ["result"] = "not run",
                ["why"] = "indicative container numbers only; no gate applies to this card",
            },
            ["notRun"] = new JsonArray("arm64 and WebAssembly paths (T1.6a measures WebAssembly and its checksum); no phone", "multi-threaded form (the TypeScript speed test is one worker thread, so none was written)"),
        };
        File.WriteAllText(args[3], root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

        var sb = new StringBuilder();
        foreach (string k in new[] { "K1 stencil", "K2 copy" })
        {
            sb.AppendLine($"\n{k} (one whole sweep; rate in {Unit(k)}; speedup = TypeScript median / this median):\n");
            sb.AppendLine("| Implementation | n | median ms | mean ms | sd ms | p95 ms | min ms | max ms | rate | vs TypeScript | vs C# scalar |");
            sb.AppendLine("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
            foreach (var r in rows.Where(r => r.Kernel == k).OrderBy(r => r.Impl == "ts" ? 0 : r.Impl == "csharp-scalar" ? 1 : r.Impl == "csharp-scalar-plain-widening" ? 2 : r.Impl == "csharp-vector128" ? 3 : 4))
                sb.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| {r.Impl} | {r.N} | {r.Median:F4} | {r.Mean:F4} | {r.StdDev:F4} | {r.P95:F4} | {r.Min:F4} | {r.Max:F4} | {Rate(r):F2} | {Med(k, "ts") / r.Median:F2}x | {Med(k, "csharp-scalar") / r.Median:F2}x |"));
        }
        Console.WriteLine(sb.ToString());
        Console.WriteLine($"checksums reproduced by C# scalar, C# vector and TypeScript: {ok}; wrote {args[3]}");
        return ok ? 0 : 1;
    }
}
