using System.Text.Json.Nodes;
using FsTestApp.Results;

namespace FsTestApp.Round0;

/// <summary>What the app knows about the WebView from the native side, to set beside what the page reported.</summary>
public sealed record NativeWebFacts(
    AllowlistFacts? Allowlist, bool IsolationHeaderSent, string? IsolationHeaderValue, string ExpectedOrigin, string? WebViewPackage, string? WebViewVersion, bool PageReady);

/// <summary>Round 0, arm (b): the page's facts (round0-arms.js) with the native side added and a plain-words explanation of whether shared memory was obtained and, if not,
/// the first thing that went wrong. Pure: the page's answer is data (never trusted for the explanation beyond reading named fields).</summary>
public static class WebViewFactsMerge
{
    public static JsonObject Merge(JsonNode? page, NativeWebFacts native)
    {
        var o = page as JsonObject ?? new JsonObject { ["raw"] = page?.DeepClone() };
        o["native"] = NativeJson(native);
        o["verdict"] = Verdict(o, native);
        Digests.Attach(o, Digests.WebView(o));
        return o;
    }

    static JsonObject NativeJson(NativeWebFacts n)
    {
        var o = new JsonObject
        {
            ["pageReady"] = n.PageReady, ["isolationHeaderSent"] = n.IsolationHeaderSent, ["expectedOrigin"] = n.ExpectedOrigin,
        };
        if (n.IsolationHeaderValue != null) o["isolationHeaderValue"] = n.IsolationHeaderValue;
        if (n.WebViewPackage != null) o["webViewPackage"] = n.WebViewPackage;
        if (n.WebViewVersion != null) o["webViewVersion"] = n.WebViewVersion;
        if (n.Allowlist is { } a)
        {
            var al = new JsonObject { ["libraryPresent"] = a.LibraryPresent, ["applied"] = a.Applied };
            if (a.FeatureSupported is { } fs) al["featureSupported"] = fs;
            if (a.Origin != null) al["origin"] = a.Origin;
            if (a.Error != null) al["error"] = a.Error;
            o["allowlist"] = al;
        }
        else o["allowlist"] = null;
        return o;
    }

    public static JsonObject Verdict(JsonObject page, NativeWebFacts n)
    {
        var features = page["features"] as JsonObject;
        bool? isolated = Bool(features, "crossOriginIsolated");
        string? sab = Str(features, "sharedArrayBuffer");
        var v = new JsonObject();
        if (isolated != null) v["crossOriginIsolated"] = isolated;
        if (sab != null) v["sharedArrayBuffer"] = sab;
        v["sharedMemoryObtained"] = isolated == true && sab == "function" && Bool(features, "sharedArrayBufferConstructs") != false;
        v["wasmSimd"] = Tri(features, "wasmSimd");
        v["wasmThreads"] = Tri(features, "wasmThreads");
        string? origin = Str(page["page"] as JsonObject, "origin");
        if (origin != null)
        {
            v["pageOrigin"] = origin;
            v["originIsExpected"] = origin == n.ExpectedOrigin;
        }
        var why = new JsonArray();
        foreach (var line in Explain(page, n, isolated, sab, origin)) why.Add((JsonNode)JsonValue.Create(line)!);
        v["explanation"] = why;
        return v;
    }

    /// <summary>Plain sentences, in the order a reader should check them. Empty only when everything the app set out to get was obtained.</summary>
    public static IReadOnlyList<string> Explain(JsonObject page, NativeWebFacts n, bool? isolated, string? sab, string? origin)
    {
        var lines = new List<string>();
        if (!n.PageReady) lines.Add("The page never told the app it was ready, so nothing below is from the page; check the 'webview' entries in errors.");
        if (origin != null && origin != n.ExpectedOrigin)
            lines.Add($"The page's origin is {origin}, not {n.ExpectedOrigin}: the allowlist was set for the wrong origin string.");
        if (isolated == true && sab == "function") return lines;

        if (isolated == null && n.PageReady) lines.Add("The page gave no crossOriginIsolated answer.");
        if (isolated == false || sab == "undefined")
        {
            lines.Add(n.IsolationHeaderSent
                ? $"The app answered the page with {ArmHostHeaderName}: {n.IsolationHeaderValue}, but this WebView did not isolate the page."
                : $"The app did not answer the page with {ArmHostHeaderName} (the WebResourceRequested hook did not handle the request), so the page was never isolated.");
            if (Str(page["page"] as JsonObject, "headerSeenByPage") is { } seen) lines.Add("The page fetched itself and saw the header value: " + seen);
        }
        var a = n.Allowlist;
        if (a == null) lines.Add("The allowlist was not attempted (no native WebView in the initialized event, or it failed before reporting).");
        else if (!a.LibraryPresent) lines.Add("androidx.webkit 1.18 is not in the app: " + (a.Error ?? "no reason recorded"));
        else if (a.FeatureSupported == false) lines.Add("This WebView does not report WebViewFeature.CROSS_ORIGIN_ISOLATED_ALLOWLIST as supported (an older WebView).");
        else if (!a.Applied) lines.Add("Setting the allowlist did not work: " + (a.Error ?? "no reason recorded"));
        else lines.Add($"The allowlist was set for {a.Origin} without an exception, yet the page is not isolated: the origin string may be the wrong form, or the header was not honoured.");
        return lines;
    }

    const string ArmHostHeaderName = "Document-Isolation-Policy";

    static bool? Bool(JsonObject? o, string key) => o?[key] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;
    static string? Str(JsonObject? o, string key) => o?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>true, false, or "error: ..." / absent as null: a feature test the page could not make is "unknown", not "no".</summary>
    static JsonNode? Tri(JsonObject? features, string key)
    {
        if (features?[key] is not JsonValue v) return null;
        if (v.TryGetValue<bool>(out var b)) return b;
        return null;
    }
}
