using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace FsTestApp.Results;

// The result document of a test APK (plan section 5; schema: reports/results.schema.json, prose: reports/RESULTS-SCHEMA.md).
// Nothing personal in it: no location, accounts, serials or advertising/android ids. Property names are camelCase on the wire, nulls are omitted.

public sealed class ResultDocument
{
    public const string KindValue = "firesim-test-result";
    public const int CurrentSchemaVersion = 1;
    /// <summary>The primary endpoint accepts at most this many bytes (plan section 5).</summary>
    public const int MaxPostBytes = 64 * 1024;

    public int SchemaVersion { get; set; } = CurrentSchemaVersion;
    public string Kind { get; set; } = KindValue;
    public int Round { get; set; }
    public string? RoundName { get; set; }
    /// <summary>32 lower-case hex digits (a GUID without dashes), made when the run starts and kept in the saved document.</summary>
    public string RunId { get; set; } = "";
    /// <summary>APK SHA-256 + ":" + run id. Same for every send of this run, so a retry after a lost answer never makes a second result.</summary>
    public string IdempotencyKey { get; set; } = "";
    public BuildInfo Build { get; set; } = new();
    public DateTimeOffset StartedUtc { get; set; }
    public DateTimeOffset? FinishedUtc { get; set; }
    /// <summary>complete: every block ran. partial: some block failed or was given up. aborted: stopped early (low battery). cancelled: the user left or cancelled.</summary>
    public string Status { get; set; } = RunStatus.Complete;
    public DeviceFacts Device { get; set; } = new();
    public Conditions Conditions { get; set; } = new();
    public WebViewFacts? WebView { get; set; }
    public List<BlockRecord> Blocks { get; set; } = new();
    public List<ArmRecord> Arms { get; set; } = new();
    public DeviceLogs Logs { get; set; } = new();
    public List<ErrorRecord> Errors { get; set; } = new();

    public static string MakeIdempotencyKey(string apkSha256, string runId) => apkSha256 + ":" + runId;
    public static string NewRunId() => Guid.NewGuid().ToString("N");
    /// <summary>The value of <see cref="BuildInfo.ApkSha256"/> when the APK file could not be read at run time.</summary>
    public const string ApkShaUnavailable = "unavailable";
}

public static class RunStatus
{
    public const string Complete = "complete";
    public const string Partial = "partial";
    public const string Aborted = "aborted";
    public const string Cancelled = "cancelled";
}

public sealed class BuildInfo
{
    /// <summary>"Release" or "Debug" (a Debug APK's numbers are not phone numbers; plan rule 4).</summary>
    public string Configuration { get; set; } = "";
    public string Commit { get; set; } = "";
    /// <summary>SHA-256 (lower-case hex) of the installed APK file, computed by the app when it starts, or "unavailable". Placeholder in tests and the dry run.</summary>
    public string ApkSha256 { get; set; } = new string('0', 64);
    public string ApplicationId { get; set; } = "";
    public string AppVersion { get; set; } = "";
    public string TargetFramework { get; set; } = "";
}

public sealed class DeviceFacts
{
    public string? Manufacturer { get; set; }
    public string? Model { get; set; }
    public string? Soc { get; set; }
    public int? ApiLevel { get; set; }
    public string? AndroidRelease { get; set; }
    public List<string>? Abis { get; set; }
    public int Cores { get; set; }
    /// <summary>From /sys/devices/system/cpu/cpu*/cpufreq: the big and little cores show as different maximum frequencies.</summary>
    public List<CpuCore>? CpuCores { get; set; }
    public long? RamMb { get; set; }
    public WebViewVersion? WebViewVersion { get; set; }
    /// <summary>RuntimeInformation.FrameworkDescription, e.g. ".NET 11.0.0".</summary>
    public string? Dotnet { get; set; }
    public string? ProcessArch { get; set; }
}

public sealed class CpuCore
{
    public int Cpu { get; set; }
    public long? MaxKhz { get; set; }
    public long? MinKhz { get; set; }
}

public sealed class WebViewVersion
{
    public string? Package { get; set; }
    public string? Version { get; set; }
}

public sealed class Conditions
{
    public bool? AirplaneMode { get; set; }
    public bool? NetworkAtStart { get; set; }
    public int? BatteryStartPercent { get; set; }
    public bool? ChargingAtStart { get; set; }
    public bool? PowerSaverAtStart { get; set; }
    public string? ThermalAtStart { get; set; }
}

/// <summary>What the HybridWebView page reported about itself, plus what the app did to get shared memory (plan T0.5, section 10.2).</summary>
public sealed class WebViewFacts
{
    /// <summary>The page's <c>location.origin</c> (MAUI serves https://0.0.0.1).</summary>
    public string? Origin { get; set; }
    public bool? CrossOriginIsolated { get; set; }
    /// <summary><c>typeof SharedArrayBuffer</c>: "function" or "undefined".</summary>
    public string? SharedArrayBuffer { get; set; }
    public string? UserAgent { get; set; }
    /// <summary>Did the app answer asset requests itself with Document-Isolation-Policy: isolate-and-require-corp?</summary>
    public bool? IsolationHeaderSent { get; set; }
    /// <summary>The header value the app sent, for the record.</summary>
    public string? IsolationHeaderValue { get; set; }
    /// <summary>The page loaded and answered: false when the WebView never reported (arms using it are skipped or failed).</summary>
    public bool PageReported { get; set; }
    public AllowlistFacts? Allowlist { get; set; }
    /// <summary>Anything else the page wants recorded (WebAssembly SIMD and threads support in round 0, T0.6b).</summary>
    public JsonObject? Extra { get; set; }
}

public sealed class AllowlistFacts
{
    /// <summary>androidx.webkit 1.18 present in the app at all (the class could be loaded).</summary>
    public bool LibraryPresent { get; set; }
    /// <summary>WebViewFeature.isFeatureSupported(CROSS_ORIGIN_ISOLATED_ALLOWLIST) on this WebView.</summary>
    public bool? FeatureSupported { get; set; }
    /// <summary>Profile.setCrossOriginIsolatedAllowlist(origin) was called without an exception.</summary>
    public bool Applied { get; set; }
    public string? Origin { get; set; }
    public string? Error { get; set; }
}

public sealed class BlockRecord
{
    public int Index { get; set; }
    public string Name { get; set; } = "";
    /// <summary>1 for the first run of the block, 2 for a re-run after a pause, ...</summary>
    public int Attempt { get; set; } = 1;
    /// <summary>ok: ran to the end without a pause: use it. paused: a pause hit it, its numbers are not to be used (a re-run follows if there is one).
    /// failed: gave up after the re-run limit. skipped: not run because the run stopped.</summary>
    public string Status { get; set; } = BlockStatus.Ok;
    public double StartedAtMs { get; set; }
    public double DurationMs { get; set; }
    public string? GateOutcome { get; set; }
}

public static class BlockStatus
{
    public const string Ok = "ok";
    public const string Paused = "paused";
    public const string Failed = "failed";
    public const string Skipped = "skipped";
}

public sealed class ArmRecord
{
    public int Block { get; set; }
    public int BlockAttempt { get; set; } = 1;
    public string Name { get; set; } = "";
    public string Runtime { get; set; } = "coreclr";
    /// <summary>ok, error (threw), paused (cancelled by a pause), skipped.</summary>
    public string Status { get; set; } = ArmStatus.Ok;
    public double StartedAtMs { get; set; }
    public double DurationMs { get; set; }
    public double EstimatedSeconds { get; set; }
    /// <summary>The arm's own result (any JSON object); absent when it threw or was cancelled.</summary>
    public JsonNode? Result { get; set; }
    public string? Error { get; set; }
}

public static class ArmStatus
{
    public const string Ok = "ok";
    public const string Error = "error";
    public const string Paused = "paused";
    public const string Skipped = "skipped";
}

public sealed class DeviceLogs
{
    public List<ThermalSample> Thermal { get; set; } = new();
    public List<BatterySample> Battery { get; set; } = new();
    public List<PauseEvent> Pauses { get; set; } = new();
    public List<GateEvent> Gating { get; set; } = new();
}

public sealed class ThermalSample
{
    /// <summary>Milliseconds since the run started.</summary>
    public double TMs { get; set; }
    /// <summary>none, light, moderate, severe, critical, emergency, shutdown or unknown.</summary>
    public string Status { get; set; } = "unknown";
    /// <summary>PowerManager.getThermalHeadroom; absent when the platform answered NaN or the API is missing.</summary>
    public double? Headroom { get; set; }
}

public sealed class BatterySample
{
    public double TMs { get; set; }
    public int? Percent { get; set; }
    public bool? Charging { get; set; }
    public long? ChargeCounterUah { get; set; }
    public bool? PowerSaver { get; set; }
}

public sealed class PauseEvent
{
    public double TMs { get; set; }
    /// <summary>native-pause, native-resume, screen-off, screen-on, webview-hidden, webview-visible.</summary>
    public string Kind { get; set; } = "";
    public int? Block { get; set; }
    public string? Arm { get; set; }
}

public sealed class GateEvent
{
    public double TMs { get; set; }
    public int Block { get; set; }
    public string Outcome { get; set; } = "";
    public double WaitedMs { get; set; }
    public string? Reason { get; set; }
}

public sealed class ErrorRecord
{
    public double TMs { get; set; }
    public string Where { get; set; } = "";
    public string? Type { get; set; }
    public string Message { get; set; } = "";
    public string? Stack { get; set; }
}

/// <summary>The saved state of one run's delivery, kept beside the document (never inside it: the document does not change after it is saved).</summary>
public sealed class SendState
{
    public string RunId { get; set; } = "";
    public string IdempotencyKey { get; set; } = "";
    public Receipt? Receipt { get; set; }
    public List<SendAttempt> Attempts { get; set; } = new();
    public DateTimeOffset? GitHubOpenedUtc { get; set; }
    public DateTimeOffset? SharedUtc { get; set; }
    public UninstallAttempt? Uninstall { get; set; }
}

public sealed class Receipt
{
    /// <summary>"issue 17" for the screen; whatever the endpoint answered.</summary>
    public string Text { get; set; } = "";
    public int? Issue { get; set; }
    public string? Url { get; set; }
    public DateTimeOffset AtUtc { get; set; }
    /// <summary>True when the endpoint said it already had this key (the answer to an earlier send was lost).</summary>
    public bool Duplicate { get; set; }
}

public sealed class SendAttempt
{
    public DateTimeOffset AtUtc { get; set; }
    public string Outcome { get; set; } = "";
    public int? HttpStatus { get; set; }
    public string? Detail { get; set; }
}

public sealed class UninstallAttempt
{
    public DateTimeOffset AtUtc { get; set; }
    /// <summary>uninstall-screen-opened, app-info-opened, failed.</summary>
    public string Outcome { get; set; } = "";
    public string? Detail { get; set; }
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, WriteIndented = false,
    UseStringEnumConverter = false)]
[JsonSerializable(typeof(ResultDocument))]
[JsonSerializable(typeof(SendState))]
[JsonSerializable(typeof(JsonObject))]
public sealed partial class ResultJsonContext : JsonSerializerContext
{
    public static string Serialize(ResultDocument doc) => JsonSerializer.Serialize(doc, Default.ResultDocument);
    public static byte[] SerializeToUtf8(ResultDocument doc) => JsonSerializer.SerializeToUtf8Bytes(doc, Default.ResultDocument);
    public static ResultDocument? Deserialize(string json) => JsonSerializer.Deserialize(json, Default.ResultDocument);
    public static ResultDocument? Deserialize(ReadOnlySpan<byte> utf8) => JsonSerializer.Deserialize(utf8, Default.ResultDocument);
    public static string SerializeState(SendState s) => JsonSerializer.Serialize(s, Default.SendState);
    public static SendState? DeserializeState(string json) => JsonSerializer.Deserialize(json, Default.SendState);
}
