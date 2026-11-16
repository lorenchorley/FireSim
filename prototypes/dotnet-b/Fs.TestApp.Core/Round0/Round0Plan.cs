using System.Globalization;
using System.Text.Json.Nodes;
using FsTestApp.Arms;
using FsTestApp.Device;
using FsTestApp.Results;
using FsTestApp.Runner;
using FsTestApp.Session;

namespace FsTestApp.Round0;

/// <summary>An arm that does nothing but say it did not run, for the container dry run (no WebView there) and for a phone with no page host. Its record is
/// <c>ok</c> with <c>{"skipped":true,"reason":...}</c>, so the rest of the run is unaffected.</summary>
public sealed class SkippedArm : IArm
{
    readonly string reason;
    public SkippedArm(string name, string runtime, string reason) { Name = name; Runtime = runtime; this.reason = reason; }
    public string Name { get; }
    public string Runtime { get; }
    public double EstimatedSeconds => 0.1;
    public Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
        => Task.FromResult<JsonNode>(new JsonObject { ["skipped"] = true, ["reason"] = reason });
}

/// <summary>Round 0 ("link check", plan section 5): device facts, WebView facts, the frozen speed-test kernels in a WebView worker. One block per arm so the screen's
/// progress line says which check is running; the order is fixed (facts first, so a crash in the kernels still leaves them in the saved document of the next launch).
/// The arms themselves are given in (the app passes the real ones, the dry run passes <see cref="SkippedArm"/> for the WebView ones).</summary>
public static class Round0Plan
{
    public const int Round = 0;
    public const string RoundName = "link check";
    public const string WebViewFactsName = "webview-facts";
    public const string KernelsName = "speedtest-kernels";

    /// <summary>Files the page host serves with the isolation header in round 0 (paths under wwwroot).</summary>
    public static readonly IReadOnlyList<string> WebFiles = new[] { "index.html", "arm-host.js", "round0-arms.js", "speedtest.worker.js" };

    public static TestPlan Build(IArm deviceFacts, IArm webViewFacts, IArm kernels)
    {
        var blocks = new List<Block>
        {
            new("device check", new[] { deviceFacts }),
            new("WebView check", new[] { webViewFacts }),
            new("speed check", new[] { kernels }),
        };
        double seconds = BlockPlan.EstimatedSeconds(blocks);
        // the plan's budget for round 0 is 2 minutes of phone time: the arms are about half a minute, the rest is the 10-second countdown, the send and the screens
        int minutes = Math.Max(2, ScreenText.Minutes(seconds));
        return new TestPlan(Round, RoundName, blocks, ScreenText.FirstRound0(minutes));
    }

    /// <summary>Round 0 is a link check, not a gated speed run: if the phone is warm at the start it waits for the status to fall for 20 s per block instead of the 5 minutes of
    /// the speed rounds. The thermal status at the start and every gate wait are in the document, so a warm start is visible.</summary>
    public static SessionOptions Options() => new() { Gate = new GateOptions { ThermalMaxWait = TimeSpan.FromSeconds(20) } };
}

/// <summary>The lines under the Done screen that say, in words, what the run found and what went wrong. Read from the finished document only.</summary>
public static class RunSummary
{
    public static IReadOnlyList<string> Lines(ResultDocument doc)
    {
        var lines = new List<string>();
        foreach (var g in doc.Arms.GroupBy(a => a.Name))
        {
            var last = g.Last();
            string text = last.Status switch
            {
                ArmStatus.Ok when IsSkipped(last.Result) => "skipped (" + Reason(last.Result) + ")",
                ArmStatus.Ok => "ok",
                ArmStatus.Error => "FAILED: " + Trim(last.Error ?? "no reason recorded", 140),
                ArmStatus.Paused => "interrupted by a pause",
                _ => last.Status,
            };
            string extra = last.Status == ArmStatus.Ok ? Extra(last) : "";
            lines.Add($"{g.Key}: {text}{extra}");
        }
        if (doc.Status != RunStatus.Complete) lines.Add($"The run ended as '{doc.Status}'.");
        if (doc.Errors.Count > 0) lines.Add($"{doc.Errors.Count} problem{(doc.Errors.Count == 1 ? "" : "s")} recorded in the results (first: {doc.Errors[0].Where}: {Trim(doc.Errors[0].Message, 120)}).");
        return lines;
    }

    static string Extra(ArmRecord a)
    {
        if (a.Result is not JsonObject r) return "";
        if (a.Name == Round0Plan.KernelsName && r["verdict"] is JsonObject v)
        {
            bool match = v["checksumsMatch"] is JsonValue m && m.TryGetValue<bool>(out var b) && b;
            string rates = "";
            if (v["stencilMcellsPerS"] is JsonObject s && v["copyGBps"] is JsonObject c)
                rates = $"; stencil {Num(s["median"])} Mcells/s, copy {Num(c["median"])} GB/s";
            return match ? " (both checksums match" + rates + ")" : " (CHECKSUMS DO NOT MATCH: " + (v["why"] as JsonValue)?.ToString() + ")";
        }
        if (a.Name == Round0Plan.WebViewFactsName && r["verdict"] is JsonObject w)
        {
            if (r["pageError"] is JsonValue pe && pe.TryGetValue<string>(out var perr)) return " (the page did not answer: " + Trim(perr, 140) + ")";
            string obtained = w["sharedMemoryObtained"] is JsonValue o && o.TryGetValue<bool>(out var got) && got ? "yes" : "no";
            return $" (shared memory: {obtained}; WebAssembly SIMD: {Tri(w["wasmSimd"])}; threads: {Tri(w["wasmThreads"])})";
        }
        return "";
    }

    static bool IsSkipped(JsonNode? r) => r is JsonObject o && o["skipped"] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    static string Reason(JsonNode? r) => (r as JsonObject)?["reason"] is JsonValue v && v.TryGetValue<string>(out var s) ? Trim(s, 100) : "no reason";
    static string Tri(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) ? (b ? "yes" : "no") : "unknown";
    static string Num(JsonNode? n) => Digests.Num(n);
    static string Trim(string s, int max) => s.Length <= max ? s : s[..max] + "...";
}
