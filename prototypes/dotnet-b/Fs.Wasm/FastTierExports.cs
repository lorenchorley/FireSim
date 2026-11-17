using System.Runtime.InteropServices;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text.Json;
using Fs.Kernel;
using Fs.Tests;

namespace Fs.Wasm;

/// <summary>
/// T1.4b: the fast tier's kernels (Fs.Kernel/LevelSet and Fs.Kernel/Pyrogenic) as WebAssembly entry points. Arrays cross as <c>byte[]</c> (T1.3 found that a
/// <c>Span&lt;double&gt;</c> parameter rejects a JavaScript <c>Float64Array</c>): the driver stores every array of a fixture by name with <see cref="SetArray"/> (raw little-endian
/// bytes, one copy), sets the fixture header with <see cref="SetHeader"/>, then calls <see cref="Check"/> with the golden file's text and a form; the case runner
/// (Fs.Tests/FastCaseRunner.cs, compiled into this assembly: the very code that checked x64) runs every recorded case and variant on that form and compares every hash with the one
/// the real TypeScript kernels gave. Fs.Wasm has no threads, so the parallel forms run their chunks on the one thread; what is checked is that the bits are the same.
/// Nothing in this file touches the existing exports.
/// </summary>
[SupportedOSPlatform("browser")]
public static partial class FastTierExports
{
    static readonly Dictionary<string, byte[]> Store = [];
    static JsonDocument? s_header;

    sealed class StoreData : IFastData
    {
        static T[] Cast<T>(string n) where T : unmanaged => MemoryMarshal.Cast<byte, T>(Store[n].AsSpan()).ToArray();
        public double[] F64(string name) => Cast<double>(name);
        public float[] F32(string name) => Cast<float>(name);
        public int[] I32(string name) => Cast<int>(name);
        public byte[] U8(string name) => Store[name];
    }

    [JSExport]
    public static void SetHeader(string json)
    {
        s_header?.Dispose();
        s_header = JsonDocument.Parse(json);
    }

    [JSExport]
    public static void SetArray(string name, byte[] bytes) => Store[name] = bytes;

    [JSExport]
    public static string Info() =>
        $"{RuntimeInformation.FrameworkDescription}; rid {RuntimeInformation.RuntimeIdentifier}; dynamicCode {System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeCompiled}; " +
        $"vector128 {System.Runtime.Intrinsics.Vector128.IsHardwareAccelerated}";

    static Fs.Bench.FastOps? s_ops;

    /// <summary>Builds the timed operations (Fs.Bench/FastOps.cs) from the stored fixture; returns the sizes of the frames.</summary>
    [JSExport]
    public static string BenchSetup()
    {
        s_ops = new Fs.Bench.FastOps(new StoreData(), s_header!.RootElement);
        var z = s_ops.Sizes();
        return $$"""{"bandCount":{{z.Band}},"hookCells":{{z.Hooks}},"reinitBand":{{z.ReinitBand}}}""";
    }

    /// <summary>
    /// Times one operation ("evalStage1", "evalStage2", "reinit", "restore", "pyro") on a form as bench.ts times the TypeScript: a warm-up of at least <paramref name="warmupMs"/> and 30
    /// operations, then <paramref name="samples"/> single operations each timed on its own; returns the statistics in milliseconds as JSON.
    /// </summary>
    [JSExport]
    public static string BenchOp(string op, int form, int samples, int warmupMs)
    {
        var ops = s_ops!;
        KernelExec e = Form(form);
        double sink = 0;
        long w0 = System.Diagnostics.Stopwatch.GetTimestamp();
        for (int i = 0; i < 30 || System.Diagnostics.Stopwatch.GetElapsedTime(w0).TotalMilliseconds < warmupMs; i++) sink += ops.Run(op, e);
        var ms = new double[samples];
        for (int i = 0; i < samples; i++)
        {
            long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
            sink += ops.Run(op, e);
            ms[i] = System.Diagnostics.Stopwatch.GetElapsedTime(t0).TotalMilliseconds;
        }
        Array.Sort(ms);
        double mean = 0;
        foreach (double x in ms) mean += x;
        mean /= samples;
        double sd = 0;
        foreach (double x in ms) sd += (x - mean) * (x - mean);
        sd = Math.Sqrt(sd / (samples - 1));
        double P(int pct) => ms[Math.Min(samples - 1, Math.Max(0, (pct * samples + 99) / 100 - 1))]; // ceil(pct/100 * n) - 1 in integers (no float-to-integer cast)
        string F(double x) => x.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
        return $$"""{"op":"{{op}}","form":{{form}},"n":{{samples}},"medianMs":{{F(P(50))}},"meanMs":{{F(mean)}},"stdDevMs":{{F(sd)}},"p95Ms":{{F(P(95))}},"minMs":{{F(ms[0])}},"maxMs":{{F(ms[^1])}},"sinkFinite":{{(double.IsFinite(sink) ? "true" : "false")}}}""";
    }

    static KernelExec Form(int form) => form switch { 0 => KernelExec.Scalar, 1 => KernelExec.Vec, 2 => KernelExec.Par(4), _ => KernelExec.ParVec(4) };

    /// <summary>
    /// Runs every case and variant of the stored fixture on form 0 scalar, 1 Vector128, 2 Parallel.For x4, 3 Parallel.For x4 with the vector body, compares with the golden file
    /// (<paramref name="goldenJson"/>, as committed in Fs.Tests/golden/fast-*.json), and returns a JSON object: checks, the failures (the first 20), and a hash over all the computed hashes.
    /// </summary>
    [JSExport]
    public static string Check(string goldenJson, int form)
    {
        using JsonDocument golden = JsonDocument.Parse(goldenJson);
        var expected = FastCaseRunner.Expected(golden.RootElement);
        var got = FastCaseRunner.RunAll(new StoreData(), s_header!.RootElement, Form(form));
        var failures = new List<string>();
        int checks = 0;
        foreach (var kv in expected)
        {
            checks++;
            if (!got.TryGetValue(kv.Key, out string? g)) failures.Add($"{kv.Key}: not produced");
            else if (g != kv.Value) failures.Add($"{kv.Key}: {g} != {kv.Value}");
        }
        if (got.Count != expected.Count) failures.Add($"produced {got.Count} keys, the golden file has {expected.Count}");
        string all = string.Concat(got.Select(kv => kv.Key + "=" + kv.Value + ";"));
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            w.WriteNumber("checks", checks);
            w.WriteNumber("failures", failures.Count);
            w.WriteStartArray("failureList");
            foreach (string f in failures.Take(20)) w.WriteStringValue(f);
            w.WriteEndArray();
            w.WriteString("aggregateHash", FastCaseRunner.Hash(System.Text.Encoding.UTF8.GetBytes(all)));
            w.WriteEndObject();
        }
        return System.Text.Encoding.UTF8.GetString(ms.ToArray());
    }
}
