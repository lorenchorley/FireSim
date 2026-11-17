using System.Diagnostics;
using System.Runtime.InteropServices;
using Fs.Kernel;

namespace Fs.Bench;

/// <summary>
/// The entry point a phone benchmark screen calls. BenchmarkDotNet does not run inside an Android app, so this is the one place a plain Stopwatch loop
/// is used (phone only; every desktop number is BenchmarkDotNet). It runs the self-test of the SIMD modes (so the phone proves its own path is
/// bit-identical to scalar, and says which path Auto took), then times scalar / Vector128 / Auto / parallel on 1, 2, 4, 8 threads on the synthetic source
/// (or a fixture the app has read) and returns plain text to show and copy. No TypeScript comparison here: the TypeScript number on the phone comes from
/// the app's WebView running the same kernel loop (see reports/1-kernel.md, "What the phone part needs").
/// </summary>
public static class PhoneBench
{
    public static Task<string> RunAsync(int repeats = 30, KernelFixture? fixture = null, Action<string>? progress = null) => Task.Run(() =>
    {
        var sb = new System.Text.StringBuilder();
        void Log(string s) { sb.AppendLine(s); progress?.Invoke(s); }
        var f = fixture ?? KernelFixture.Synthetic();
        Log($"{CpuModel()} | {RuntimeInformation.OSDescription} | {RuntimeInformation.FrameworkDescription} | {RuntimeInformation.ProcessArchitecture} | {Environment.ProcessorCount} cores");
        Log($"selftest exit code {SelfTest.Run(Log)}");
        Check.Run(f, Log, repeats: 3);
        ThreadPool.SetMinThreads(16, 16);
        var c = f.Cases[0];
        var k = new PyrogenicKernel(f.FireNx, f.FireNy, f.CellSizeM, f.PyroK, f.PyroMax);
        var forms = new List<(string, Action)> { ("scalar", () => k.SolveScalar(c.Q)), ("Vector128", () => k.SolveVector128(c.Q)) };
        foreach (int t in new[] { 1, 2, 4, 8 }) forms.Add(($"parallel x{t}", () => k.SolveParallel(c.Q, t)));
        foreach (var (name, run) in forms)
        {
            var sw = Stopwatch.StartNew();
            int calls = 0;
            while (calls < 30 || sw.Elapsed.TotalSeconds < 1.0) { run(); calls++; }
            var ms = new double[repeats];
            for (int i = 0; i < repeats; i++) { long t0 = Stopwatch.GetTimestamp(); run(); ms[i] = Stopwatch.GetElapsedTime(t0).TotalMilliseconds; }
            Array.Sort(ms);
            double P(double p) => ms[Math.Min(ms.Length - 1, Math.Max(0, (int)Math.Ceiling(p * ms.Length) - 1))];
            Log($"{name,-12} n={repeats} median {P(0.5):F3} ms  p95 {P(0.95):F3}  min {ms[0]:F3}  max {ms[^1]:F3}");
        }
        return sb.ToString();
    });

    public static string CpuModel()
    {
        try
        {
            foreach (var line in File.ReadLines("/proc/cpuinfo"))
                if (line.StartsWith("model name") || line.StartsWith("Hardware")) return line.Split(':', 2)[1].Trim();
        }
        catch { }
        return RuntimeInformation.ProcessArchitecture.ToString();
    }
}
