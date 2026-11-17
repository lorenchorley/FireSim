using System.Text.Json.Nodes;

namespace FsTestApp.Arms;

/// <summary>Progress an arm reports: a fraction 0..1 of the arm, and a short text for the screen ("warm-up 3 of 5").</summary>
public readonly record struct ArmProgress(double Fraction, string? Text = null);

/// <summary>One measurement (an "arm"). Arms are pluggable: the app's plan lists them, the block runner runs them. An arm must be re-entrant (the same
/// instance can run again in a later block or after a pause) and must honour the token promptly: a pause cancels the running arm and the block is re-run.
/// Warm-up and timed phases are the arm's own business; it reports them in its result.</summary>
public interface IArm
{
    /// <summary>Stable name used in the result document (lower-case letters, digits, '-', '.', '_').</summary>
    string Name { get; }
    /// <summary>Phone time the arm needs, in seconds, used for the first screen's "about N minutes" and the time left.</summary>
    double EstimatedSeconds { get; }
    /// <summary>The runtime the measurement ran on (<c>runtime</c> in the result schema, plan rule 11).</summary>
    string Runtime => RuntimeNames.CoreClr;
    Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct);
}

/// <summary>The values of <c>runtime</c> in the result schema (plan rule 11).</summary>
public static class RuntimeNames
{
    public const string CoreClr = "coreclr";
    public const string MonoWasmAot = "mono-wasm-aot";
    public const string MonoWasmInterp = "mono-wasm-interp";
    public const string CoreClrWasm = "coreclr-wasm";
    public const string V8Node = "v8-node";
    public const string V8Chromium = "v8-chromium";
    public const string V8WebView = "v8-webview";
    public static readonly IReadOnlyList<string> All = new[] { CoreClr, MonoWasmAot, MonoWasmInterp, CoreClrWasm, V8Node, V8Chromium, V8WebView };
}
