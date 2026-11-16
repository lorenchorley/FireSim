using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace Fs.Bench;

/// <summary>
/// T1.3: evaluates every FsMath candidate over the fixed input files (raw little-endian float64, two per call for pow, atan2 and hypot) and writes the
/// results as raw float64 bit patterns, one file per function and implementation, so that Node and Chromium outputs can be compared bit for bit.
///   dotnet run -c Release --project Fs.Bench -- fsmath-run INPUT_DIR OUTPUT_DIR [fdlibm,cms,platform] [fn,fn,...]
/// Writes OUTPUT_DIR/{fn}.{impl}.f64 and OUTPUT_DIR/run-{impl}.json (SHA-256 of each output, process facts).
/// </summary>
public static class FsMathRun
{
    public static int Run(string[] args)
    {
        string inDir = args[0], outDir = args[1];
        string[] impls = args.Length > 2 && args[2] != "" ? args[2].Split(',') : FsMathTable.Impls;
        string[] fns = args.Length > 3 && args[3] != "" ? args[3].Split(',') : FsMathTable.Names;
        Directory.CreateDirectory(outDir);
        foreach (string impl in impls)
        {
            var report = new Dictionary<string, object>
            {
                ["impl"] = impl,
                ["runtime"] = RuntimeInformation.FrameworkDescription,
                ["rid"] = RuntimeInformation.RuntimeIdentifier,
                ["avx2"] = System.Runtime.Intrinsics.X86.Avx2.IsSupported,
                ["fma"] = System.Runtime.Intrinsics.X86.Fma.IsSupported,
                ["vector128Accelerated"] = System.Runtime.Intrinsics.Vector128.IsHardwareAccelerated,
                ["env"] = new Dictionary<string, string?>
                {
                    ["DOTNET_EnableAVX2"] = Environment.GetEnvironmentVariable("DOTNET_EnableAVX2"),
                    ["DOTNET_EnableHWIntrinsic"] = Environment.GetEnvironmentVariable("DOTNET_EnableHWIntrinsic"),
                },
            };
            var sha = new Dictionary<string, string>();
            foreach (string fn in fns)
            {
                if (!File.Exists(Path.Combine(inDir, fn + ".in"))) continue; // a set may lack a function (the recorded set has no log2, log10, sinh)
                byte[] raw = File.ReadAllBytes(Path.Combine(inDir, fn + ".in"));
                var input = MemoryMarshal.Cast<byte, double>(raw);
                int n = input.Length / FsMathTable.Arity(fn);
                var output = new double[n];
                FsMathTable.Eval(impl, fn, input, output);
                byte[] bytes = MemoryMarshal.AsBytes(output.AsSpan()).ToArray();
                File.WriteAllBytes(Path.Combine(outDir, $"{fn}.{impl}.f64"), bytes);
                sha[fn] = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            }
            report["sha256"] = sha;
            File.WriteAllText(Path.Combine(outDir, $"run-{impl}.json"), JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            Console.WriteLine($"{impl}: {fns.Length} functions -> {outDir}");
        }
        return 0;
    }
}
