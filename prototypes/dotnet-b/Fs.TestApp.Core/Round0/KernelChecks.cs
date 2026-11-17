using System.Text.Json.Nodes;

namespace FsTestApp.Round0;

/// <summary>The frozen speed-test kernels' contract (src/ui/speedTest.ts and speedTest.test.ts). A test in Fs.Tests reads those two files and fails if these constants drift.</summary>
public static class FrozenKernels
{
    public const int Version = 1;
    /// <summary>K1, the air stencil, FNV-1a checksum after 3 sweeps from the fixed seed.</summary>
    public const string StencilAfter3 = "0x7d268009";
    /// <summary>K2, the memory copy, checksum after 2 sweeps.</summary>
    public const string CopyAfter2 = "0x1e84aad9";
    /// <summary>The app's reference (SPEED_TEST_REFERENCE, 2026-10-30, node 22 on the build container, one core): what a ratio of 1 means.</summary>
    public const double ReferenceStencilMcellsPerS = 53.5;
    public const double ReferenceCopyGBps = 4.26;
    public const string ReferenceDate = "2026-10-30";
}

/// <summary>Judges the raw answer of the <c>speedtest-kernels</c> page arm: do the checksums match the frozen values on every run, and what are the medians. The page only
/// reports; the verdict is made here so a bug in the page cannot declare itself right. The ratios are the app's (reference / measured: over 1 means slower than the build machine),
/// so a phone's numbers can be set beside the app's own "Run the speed test" result.</summary>
public static class KernelChecks
{
    /// <summary>The page's result plus a <c>verdict</c> object. A result that is not an object, or has no runs, still gets a verdict (<c>checksumsMatch</c> false, with the reason).</summary>
    public static JsonObject Annotate(JsonNode? raw)
    {
        var o = raw as JsonObject ?? new JsonObject { ["raw"] = raw?.DeepClone() };
        var verdict = Evaluate(o);
        o["verdict"] = verdict;
        Digests.Attach(o, Digests.Kernels(verdict));
        return o;
    }

    public static JsonObject Evaluate(JsonObject result)
    {
        var runs = (result["runs"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var v = new JsonObject
        {
            ["expectedStencilAfter3"] = FrozenKernels.StencilAfter3, ["expectedCopyAfter2"] = FrozenKernels.CopyAfter2, ["runs"] = runs.Count,
        };
        if (runs.Count == 0)
        {
            v["checksumsMatch"] = false;
            v["why"] = "no run finished";
            return v;
        }
        int stencilOk = runs.Count(r => Str(r, "stencilAfter3") == FrozenKernels.StencilAfter3);
        int copyOk = runs.Count(r => Str(r, "copyAfter2") == FrozenKernels.CopyAfter2);
        v["stencilChecksumRunsOk"] = stencilOk;
        v["copyChecksumRunsOk"] = copyOk;
        bool match = stencilOk == runs.Count && copyOk == runs.Count;
        v["checksumsMatch"] = match;
        if (!match)
        {
            v["why"] = $"stencil matched in {stencilOk} of {runs.Count} runs, copy in {copyOk} of {runs.Count}";
            v["stencilSeen"] = new JsonArray(runs.Select(r => (JsonNode?)Str(r, "stencilAfter3")).ToArray());
            v["copySeen"] = new JsonArray(runs.Select(r => (JsonNode?)Str(r, "copyAfter2")).ToArray());
        }
        var shas = runs.Select(r => Str(r, "kernelsSha256")).Where(s => s != null).Distinct().ToList();
        v["kernelsSha256"] = new JsonArray(shas.Select(s => (JsonNode?)s).ToArray());

        var stencil = Stats(runs, "stencilMcellsPerS");
        var copy = Stats(runs, "copyGBps");
        if (stencil != null) v["stencilMcellsPerS"] = stencil.Value.Json;
        if (copy != null) v["copyGBps"] = copy.Value.Json;
        var ratio = new JsonObject();
        if (stencil is { Median: > 0 }) ratio["stencil"] = Math.Round(FrozenKernels.ReferenceStencilMcellsPerS / stencil.Value.Median, 3);
        if (copy is { Median: > 0 }) ratio["copy"] = Math.Round(FrozenKernels.ReferenceCopyGBps / copy.Value.Median, 3);
        if (ratio.Count > 0)
        {
            ratio["note"] = $"reference / measured, as the app's speed test: over 1 is slower than the build machine's node 22 ({FrozenKernels.ReferenceStencilMcellsPerS} Mcells/s, {FrozenKernels.ReferenceCopyGBps} GB/s, {FrozenKernels.ReferenceDate})";
            v["ratioVsReference"] = ratio;
        }
        return v;
    }

    /// <summary>Median, minimum, maximum and the spread (max minus min as a percentage of the median) of a numeric field over the runs; runs without a finite positive value are ignored.</summary>
    public static (double Median, JsonObject Json)? Stats(IEnumerable<JsonObject> runs, string field)
    {
        var xs = runs.Select(r => Num(r, field)).Where(x => x is > 0).Select(x => x!.Value).OrderBy(x => x).ToList();
        if (xs.Count == 0) return null;
        double median = xs.Count % 2 == 1 ? xs[xs.Count / 2] : (xs[xs.Count / 2 - 1] + xs[xs.Count / 2]) / 2;
        var j = new JsonObject
        {
            ["median"] = Math.Round(median, 4), ["min"] = Math.Round(xs[0], 4), ["max"] = Math.Round(xs[^1], 4), ["n"] = xs.Count,
            ["spreadPercent"] = Math.Round((xs[^1] - xs[0]) / median * 100, 2),
        };
        return (median, j);
    }

    static string? Str(JsonObject o, string key) => o[key] is JsonValue jv && jv.TryGetValue<string>(out var s) ? s : null;

    static double? Num(JsonObject o, string key) => Digests.Number(o[key]);
}
