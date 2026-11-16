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
