using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;
using Fs.Tests.TestApp;
using FsResults;
using FsTestApp.Results;

namespace Fs.Results.Tests;

/// <summary>A clock the test moves.</summary>
internal sealed class ManualTime : TimeProvider
{
    DateTimeOffset now;
    public ManualTime(DateTimeOffset start) => now = start;
    public override DateTimeOffset GetUtcNow() => now;
    public void Advance(TimeSpan by) => now += by;
    public void Set(DateTimeOffset to) => now = to;
}

/// <summary>The fake GitHub client: records every call, numbers issues from 17 (like the dry run's endpoint), and can hold a call open or fail it.</summary>
internal sealed class FakeGitHub : IGitHubIssues
{
    public sealed record Call(string Title, string Body, IReadOnlyList<string> Labels);

    readonly ConcurrentQueue<Call> calls = new();
    int next = 16;
    public IReadOnlyList<Call> Calls => calls.ToArray();
    /// <summary>When set, each call waits for it before answering (to hold two requests in flight together).</summary>
    public Task? Gate { get; set; }
    /// <summary>Released once for every call that has started.</summary>
    public SemaphoreSlim Started { get; } = new(0);
    public async Task<int> CreateIssueAsync(string title, string body, IReadOnlyList<string> labels, CancellationToken ct)
    {
        Started.Release();
        if (Gate is { } g) await g.ConfigureAwait(false);
        if (Interlocked.Decrement(ref failNextBox) >= 0) throw new GitHubIssueException("fake failure", 500);
        calls.Enqueue(new Call(title, body, labels.ToArray()));
        return Interlocked.Increment(ref next);
    }

    int failNextBox = 0;
    public void FailTheNext(int n) => Interlocked.Exchange(ref failNextBox, n);
}

/// <summary>An endpoint under test: in-memory store, fake GitHub, a manual clock and one upload code for round 0 built on <see cref="Build"/>.</summary>
internal sealed class Harness
{
    public static readonly DateTimeOffset Build = new(2026, 11, 16, 12, 0, 0, TimeSpan.Zero);
    public const string Repo = "example-owner/example-results";

    public InMemoryResultStore Store { get; } = new();
    public FakeGitHub GitHub { get; } = new();
    public ManualTime Time { get; } = new(Build.AddHours(1));
    /// <summary>A random placeholder, made per test run; it is not a secret.</summary>
    public string Code { get; } = "code" + Guid.NewGuid().ToString("N");
    public int CodeRound { get; init; } = 0;
    public ResultsSettings Settings { get; set; }
    public ResultsHandler Handler { get; }

    public Harness(int codeRound = 0, TimeSpan? pendingWait = null, TimeSpan? lease = null, int maxKeys = 3)
    {
        CodeRound = codeRound;
        Settings = MakeSettings(Code, codeRound, Build.AddDays(14), pendingWait, lease, maxKeys);
        Handler = new ResultsHandler(Store, GitHub, () => Settings, Time);
    }

    public static ResultsSettings MakeSettings(string code, int round, DateTimeOffset notAfter, TimeSpan? pendingWait = null, TimeSpan? lease = null, int maxKeys = 3)
    {
        var s = ResultsSettings.Parse($"[{{\"code\":\"{code}\",\"round\":{round},\"notAfter\":\"{notAfter:yyyy-MM-dd'T'HH:mm:ss'Z'}\"}}]", Repo);
        return new ResultsSettings
        {
            Codes = s.Codes, Repo = s.Repo, ConfigError = s.ConfigError,
            PendingWait = pendingWait ?? TimeSpan.FromSeconds(5), PendingLease = lease ?? TimeSpan.FromMinutes(2), MaxKeysPerCode = maxKeys,
        };
    }

    public static string KeyOf(JsonObject doc) => doc["idempotencyKey"]!.GetValue<string>();

    public Task<HandlerResponse> PostAsync(byte[] body, string? key, string? code = "", string method = "POST", string? contentType = "application/json; charset=utf-8", long? contentLength = -1, CancellationToken ct = default)
        => PostAsync(new MemoryStream(body), key, code, method, contentType, contentLength == -1 ? body.Length : contentLength, ct);

    public Task<HandlerResponse> PostAsync(Stream body, string? key, string? code = "", string method = "POST", string? contentType = "application/json; charset=utf-8", long? contentLength = null, CancellationToken ct = default)
        => Handler.HandleAsync(new HandlerRequest(method, contentType, contentLength, code == "" ? Code : code, key, body), ct);

    /// <summary>Posts a document with its own key and the harness's code.</summary>
    public Task<HandlerResponse> PostDocAsync(JsonObject doc, string? code = "", CancellationToken ct = default)
        => PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), KeyOf(doc), code, ct: ct);

    // ---- documents ----

    /// <summary>The document the real app builds in the T0.5 tests, as a tree.</summary>
    public static JsonObject ValidDoc() => (JsonObject)JsonNode.Parse(ResultJsonContext.Serialize(TestDocs.Valid()))!;

    /// <summary>A valid document for run number <paramref name="n"/>: its own run id and so its own idempotency key.</summary>
    public static JsonObject DocN(int n, int round = 0)
    {
        var d = ValidDoc();
        string runId = n.ToString("x32", System.Globalization.CultureInfo.InvariantCulture);
        d["runId"] = runId;
        d["round"] = round;
        d["idempotencyKey"] = d["build"]!["apkSha256"]!.GetValue<string>() + ":" + runId;
        return d;
    }

    /// <summary>A document with every optional field present and free-form objects with nested values, so a hostile-string test reaches every string field the schema has.</summary>
    public static JsonObject RichDoc()
    {
        var d = ValidDoc();
        d["roundName"] = "link check";
        d["device"] = JsonNode.Parse("""
            { "manufacturer": "Acme", "model": "Phone 1", "soc": "Acme SoC 9", "apiLevel": 35, "androidRelease": "15", "abis": ["arm64-v8a", "armeabi-v7a"],
              "cores": 8, "cpuCores": [ { "cpu": 0, "maxKhz": 2000000, "minKhz": 300000 } ], "ramMb": 8000,
              "webViewVersion": { "package": "com.google.android.webview", "version": "130.0.1" }, "dotnet": ".NET 11.0.0", "processArch": "Arm64" }
            """);
        d["webView"] = JsonNode.Parse("""
            { "origin": "https://0.0.0.1", "crossOriginIsolated": false, "sharedArrayBuffer": "undefined", "userAgent": "Mozilla/5.0 test", "isolationHeaderSent": true,
              "isolationHeaderValue": "isolate-and-require-corp", "pageReported": true,
              "allowlist": { "libraryPresent": true, "featureSupported": false, "applied": false, "origin": "https://0.0.0.1", "error": "none" },
              "extra": { "simd": true, "note": "free text", "nested": { "list": ["a", "b"], "n": 1 } } }
            """);
        d["errors"] = JsonNode.Parse("""[ { "tMs": 5, "where": "arm:x", "type": "System.Exception", "message": "boom", "stack": "at A.B()" } ]""");
        d["logs"]!["gating"] = JsonNode.Parse("""[ { "tMs": 1, "block": 0, "outcome": "Ready", "waitedMs": 0, "reason": "ok" } ]""");
        d["logs"]!["pauses"] = JsonNode.Parse("""[ { "tMs": 2, "kind": "native-pause", "block": 0, "arm": "arm-0" } ]""");
        d["blocks"]![0]!["gateOutcome"] = "Ready";
        d["arms"]![0]!["error"] = "none";
        d["arms"]![0]!["runtime"] = "v8-webview";
        return d;
    }

    /// <summary>Every string leaf (and every property name inside free-form objects) of the tree, as navigable paths.</summary>
    public static IEnumerable<string[]> StringLeafPaths(JsonNode node, params string[] prefix)
    {
        switch (node)
        {
            case JsonObject o:
                foreach (var kv in o)
                    foreach (var p in StringLeafPaths(kv.Value!, prefix.Append(kv.Key).ToArray())) yield return p;
                break;
            case JsonArray a:
                for (int i = 0; i < a.Count; i++)
                    foreach (var p in StringLeafPaths(a[i]!, prefix.Append(i.ToString(System.Globalization.CultureInfo.InvariantCulture)).ToArray())) yield return p;
                break;
            case JsonValue v when v.GetValueKind() == System.Text.Json.JsonValueKind.String:
                yield return prefix;
                break;
        }
    }

    public static void SetAt(JsonObject root, string[] path, JsonNode value)
    {
        JsonNode cur = root;
        for (int i = 0; i < path.Length - 1; i++) cur = cur is JsonArray a ? a[int.Parse(path[i], System.Globalization.CultureInfo.InvariantCulture)]! : cur[path[i]]!;
        if (cur is JsonArray last) last[int.Parse(path[^1], System.Globalization.CultureInfo.InvariantCulture)] = value; else cur[path[^1]] = value;
    }
}
