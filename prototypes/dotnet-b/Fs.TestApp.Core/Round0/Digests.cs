using System.Globalization;
using System.Text.Json.Nodes;

namespace FsTestApp.Round0;

/// <summary>One short line per round-0 arm that says what the arm found. The prefilled-issue fallback (<c>GitHubIssueUrl</c>, capped at 6 KB after encoding) prints an arm's
/// <c>digest</c> instead of the first characters of its JSON, so the answers that matter (checksums, isolation, SIMD, clusters) always reach the issue even when the owner
/// sends it with the one-tap fallback. The digest is the first member of the arm's result; the full result is in the document that Share sends.</summary>
public static class Digests
{
    public const string Key = "digest";
    public const int MaxLength = 280;

    /// <summary>Puts <paramref name="digest"/> first in <paramref name="result"/> (replacing any "digest" the page put there, which is data and is not trusted).</summary>
    public static void Attach(JsonObject result, string digest)
    {
        result.Remove(Key);
        result.Insert(0, Key, JsonValue.Create(digest.Length <= MaxLength ? digest : digest[..MaxLength]));
    }

    /// <summary>The digest of an arm result, or null.</summary>
    public static string? Of(JsonNode? result) => result is JsonObject o && o[Key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static string Device(JsonObject d)
    {
        string hw(string k) => Str(d, "hardware", k) ?? "?";
        var abis = (d["hardware"]?["supportedAbis"] as JsonArray)?.Select(a => a?.ToString()).FirstOrDefault() ?? "?";
        string soc = Str(d, "hardware", "socModel") ?? Str(d, "hardware", "hardware") ?? "?";
        var clusters = (d["cpu"]?["clusters"] as JsonArray)?.OfType<JsonObject>()
            .Select(c => $"{Num(c["maxKhz"])}x{(c["cpus"] as JsonArray)?.Count ?? 0}") ?? Enumerable.Empty<string>();
        string screen = $"{Num(d["screen"]?["widthPx"])}x{Num(d["screen"]?["heightPx"])}@{Num(d["screen"]?["refreshRateHz"])}Hz";
        string batt = Num(d["state"]?["batteryPercent"]) + "%" + (d["state"]?["charging"] is JsonValue c && c.TryGetValue<bool>(out var ch) ? (ch ? " charging" : " not charging") : "");
        int failures = (d["failures"] as JsonArray)?.Count ?? 0;
        return $"{hw("manufacturer")} {hw("model")} | soc {soc} | android {Str(d, "os", "release") ?? "?"} sdk {Num(d["os"]?["sdkInt"])} | {abis} | ram {Num(d["memory"]?["totalMb"])} MB | screen {screen}"
             + $" | cores {Num(d["cpu"]?["logicalCores"])}: kHz {string.Join("/", clusters)} | thermal {Str(d, "state", "thermalStatus") ?? "?"} battery {batt} | {failures} unread";
    }

    public static string WebView(JsonObject merged)
    {
        var v = merged["verdict"] as JsonObject;
        var f = merged["features"] as JsonObject;
        string tri(JsonNode? n) => n is JsonValue x && x.TryGetValue<bool>(out var b) ? (b ? "yes" : "no") : "?";
        string gpu = merged["webgpu"] is JsonObject g ? (g["present"] is JsonValue p && p.TryGetValue<bool>(out var present) && present ? (g["adapter"] is JsonObject ? "adapter" : "no adapter") : "no") : "?";
        var al = (merged["native"] as JsonObject)?["allowlist"] as JsonObject;
        string allow = al == null ? "not attempted" : al["applied"] is JsonValue a && a.TryGetValue<bool>(out var applied) && applied ? "set" : al["featureSupported"] is JsonValue fs && fs.TryGetValue<bool>(out var sup) && !sup ? "feature unsupported" : "failed";
        string header = (merged["native"] as JsonObject)?["isolationHeaderSent"] is JsonValue h && h.TryGetValue<bool>(out var sent) ? (sent ? "sent" : "not sent") : "?";
        string ua = Str(merged, "navigator", "chromeVersion") ?? "?";
        return $"coi={tri(f?["crossOriginIsolated"])} sab={Str(merged, "features", "sharedArrayBuffer") ?? "?"} shared={tri(v?["sharedMemoryObtained"])} simd={tri(f?["wasmSimd"])} threads={tri(f?["wasmThreads"])}"
             + $" waitAsync={Str(merged, "features", "atomicsWaitAsync") ?? "?"} webgpu={gpu} chrome={ua} header={header} allowlist={allow} origin={Str(merged, "page", "origin") ?? "?"}";
    }

    public static string Kernels(JsonObject verdict)
    {
        string match = verdict["checksumsMatch"] is JsonValue m && m.TryGetValue<bool>(out var b) ? (b ? "MATCH" : "MISMATCH") : "?";
        var s = verdict["stencilMcellsPerS"] as JsonObject;
        var c = verdict["copyGBps"] as JsonObject;
        var r = verdict["ratioVsReference"] as JsonObject;
        return $"checksums {match} in {Num(verdict["runs"])} runs | stencil {Num(s?["median"])} Mcells/s (spread {Num(s?["spreadPercent"])}%) | copy {Num(c?["median"])} GB/s (spread {Num(c?["spreadPercent"])}%) | ratio vs reference {Num(r?["stencil"])}/{Num(r?["copy"])}"
             + (verdict["why"] is JsonValue w ? " | " + w : "");
    }

    static string? Str(JsonObject o, string section, string key) => o[section]?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>A JSON number as a double whatever its backing type (a value built in memory from an int is not readable as a long or a double through TryGetValue, one parsed from text is).</summary>
    public static double? Number(JsonNode? n)
    {
        if (n is not JsonValue v || v.GetValueKind() != System.Text.Json.JsonValueKind.Number) return null;
        return double.TryParse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) ? d : null;
    }

    public static string Num(JsonNode? n) => Number(n) is { } d ? d.ToString("0.##", CultureInfo.InvariantCulture) : "?";
}
