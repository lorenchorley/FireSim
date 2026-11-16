using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Fs.Bench;

/// <summary>
/// T1.3: ns per call of every function and implementation, with a plain stopwatch loop over the first N inputs of the fixed input files (the same loop
/// shape, repeats and statistics as the WebAssembly and Node timings, so the three are comparable; BenchmarkDotNet's numbers for the same functions
/// are in <see cref="FsMathBench"/>).
///   dotnet run -c Release --project Fs.Bench -- fsmath-ns INPUT_DIR OUT.json [N=65536] [REPEATS=15] [impls] [fns]
/// Each repeat evaluates N calls (N pairs for two-argument functions) and sums the results (so nothing is optimised away); ns per call is the repeat's
/// wall time over N. The report has the median, the minimum and the maximum over the repeats. Warm-up: 3 repeats.
/// </summary>
public static class FsMathNs
{
    public static int Run(string[] args)
    {
        string inDir = args[0], outJson = args[1];
        int n = args.Length > 2 && args[2] != "" ? int.Parse(args[2]) : 65536;
        int repeats = args.Length > 3 && args[3] != "" ? int.Parse(args[3]) : 15;
        string[] impls = args.Length > 4 && args[4] != "" ? args[4].Split(',') : FsMathTable.Impls;
        string[] fns = args.Length > 5 && args[5] != "" ? args[5].Split(',') : FsMathTable.Names;
        var rows = new List<Dictionary<string, object>>();
        double sink = 0;
        foreach (string fn in fns)
        {
            int arity = FsMathTable.Arity(fn);
            var all = MemoryMarshal.Cast<byte, double>(File.ReadAllBytes(Path.Combine(inDir, fn + ".in")));
            var input = all[..(n * arity)].ToArray();
            foreach (string impl in impls)
            {
                var loop = FsMathLoops.Get(impl, fn);
                var times = new double[repeats];
                double[] output = new double[n];
                for (int r = -3; r < repeats; r++)
                {
                    long t0 = Stopwatch.GetTimestamp();
                    loop(input, output, n);
                    double dt = Stopwatch.GetElapsedTime(t0).TotalMilliseconds * 1e6 / n;
                    if (r >= 0) times[r] = dt;
                    sink += output[(r + 3) % n];
                }
                Array.Sort(times);
                rows.Add(new Dictionary<string, object>
                {
                    ["fn"] = fn, ["impl"] = impl, ["n"] = n, ["repeats"] = repeats,
                    ["nsMedian"] = times[repeats / 2], ["nsMin"] = times[0], ["nsMax"] = times[^1],
                });
                Console.WriteLine($"{fn,-6} {impl,-8} median {times[repeats / 2],8:F2} ns   min {times[0],8:F2}   max {times[^1],8:F2}");
            }
        }
        File.WriteAllText(outJson, JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, rid = RuntimeInformation.RuntimeIdentifier, sink, rows }, new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }
}
