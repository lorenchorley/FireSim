using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FsTestApp.Results;

namespace FsTestApp.Sending;

/// <summary>What the build injected (build properties, never committed): empty by default, so a build without them has no primary channel and says so.</summary>
public sealed record ResultsConfig(string Endpoint = "", string UploadCode = "", string GitHubRepo = "")
{
    public bool HasEndpoint => Endpoint.Length > 0 && UploadCode.Length > 0;
    public bool HasGitHub => GitHubRepo.Length > 0 && GitHubIssueUrl.IsRepo(GitHubRepo);
}

public enum SendOutcome
{
    /// <summary>The endpoint accepted it (or already had it).</summary>
    Sent,
    /// <summary>Network trouble, a timeout or a 5xx/429/408: try again later with the same key.</summary>
    Retry,
    /// <summary>The endpoint refused this document (4xx): sending it again will not help.</summary>
    Rejected,
    /// <summary>This build has no endpoint or upload code.</summary>
    NotConfigured,
}

public sealed record SendResult(SendOutcome Outcome, int? HttpStatus = null, string? Detail = null, Receipt? Receipt = null);

public interface IResultsSender
{
    bool IsConfigured { get; }
    /// <summary>Sends the document bytes with the idempotency key. Never throws except for the caller's cancellation.</summary>
    Task<SendResult> SendAsync(string idempotencyKey, byte[] documentUtf8, DateTimeOffset now, CancellationToken ct);
}

/// <summary>The primary channel: a POST of the document to the owner's endpoint (plan section 5, T0.6a's Fs.Results).
/// Request: <c>POST {endpoint}</c>, <c>Content-Type: application/json</c>, <c>Idempotency-Key: {key}</c>, <c>X-Upload-Code: {code}</c>, body = the document (at most 64 KB).
/// Answer: 200/201/202 with <c>{"issue": 17, "url": "...", "duplicate": false}</c>, or 409/200 with <c>"duplicate": true</c> when the key is already held:
/// both are success. 408, 425, 429 and 5xx retry. Other 4xx do not. The upload code is never written to a log, an error or the document.</summary>
public sealed class HttpResultsSender : IResultsSender
{
    readonly ResultsConfig config;
    readonly HttpClient http;
    readonly TimeSpan timeout;

    public HttpResultsSender(ResultsConfig config, HttpClient http, TimeSpan? timeout = null)
    {
        this.config = config; this.http = http; this.timeout = timeout ?? TimeSpan.FromSeconds(30);
    }

    public bool IsConfigured => config.HasEndpoint;

    public static bool EndpointAllowed(string endpoint)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var u)) return false;
        if (u.Scheme == Uri.UriSchemeHttps) return true;
        return u.Scheme == Uri.UriSchemeHttp && u.IsLoopback;   // plain http only for the local fake endpoint of the dry run
    }

    public async Task<SendResult> SendAsync(string idempotencyKey, byte[] documentUtf8, DateTimeOffset now, CancellationToken ct)
    {
        if (!config.HasEndpoint) return new SendResult(SendOutcome.NotConfigured, Detail: "this build has no results endpoint or upload code");
        if (!EndpointAllowed(config.Endpoint)) return new SendResult(SendOutcome.NotConfigured, Detail: "endpoint is not an https address");
        if (documentUtf8.Length > ResultDocument.MaxPostBytes) return new SendResult(SendOutcome.Rejected, Detail: $"document is {documentUtf8.Length} bytes, over the {ResultDocument.MaxPostBytes} byte limit");

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, config.Endpoint) { Content = new ByteArrayContent(documentUtf8) };
            req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };
            req.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
            req.Headers.TryAddWithoutValidation("X-Upload-Code", config.UploadCode);
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token).ConfigureAwait(false);
            int status = (int)resp.StatusCode;
            string body = await ReadCapped(resp, timeoutCts.Token).ConfigureAwait(false);

            if (status is 200 or 201 or 202 or 409)
                return new SendResult(SendOutcome.Sent, status, status == 409 ? "already received" : "accepted", ParseReceipt(body, status == 409, now));
            if (status is 408 or 425 or 429 || status >= 500)
                return new SendResult(SendOutcome.Retry, status, "server asked to try again later");
            return new SendResult(SendOutcome.Rejected, status, Scrub(body));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (OperationCanceledException) { return new SendResult(SendOutcome.Retry, null, "timed out waiting for the answer"); }
        catch (HttpRequestException e) { return new SendResult(SendOutcome.Retry, null, "network error: " + Scrub(e.Message)); }
        catch (IOException e) { return new SendResult(SendOutcome.Retry, null, "connection error: " + Scrub(e.Message)); }
    }

    string Scrub(string s)
    {
        if (config.UploadCode.Length > 0) s = s.Replace(config.UploadCode, "***", StringComparison.Ordinal);
        s = new string(s.Select(c => char.IsControl(c) ? ' ' : c).ToArray());
        return s.Length <= 300 ? s : s[..300];
    }

    static async Task<string> ReadCapped(HttpResponseMessage resp, CancellationToken ct)
    {
        await using var s = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        var buf = new byte[4096];
        int n = 0, r;
        while (n < buf.Length && (r = await s.ReadAsync(buf.AsMemory(n, buf.Length - n), ct).ConfigureAwait(false)) > 0) n += r;
        return Encoding.UTF8.GetString(buf, 0, n);
    }

    static Receipt ParseReceipt(string body, bool conflict, DateTimeOffset now)
    {
        int? issue = null; string? url = null; bool dup = conflict;
        try
        {
            if (JsonNode.Parse(body) is JsonObject o)
            {
                if (o["issue"] is JsonValue iv && iv.TryGetValue<int>(out int n)) issue = n;
                if (o["url"] is JsonValue uv && uv.TryGetValue<string>(out var u) && u.StartsWith("https://", StringComparison.Ordinal) && u.Length <= 300) url = u;
                if (o["duplicate"] is JsonValue dv && dv.TryGetValue<bool>(out bool d)) dup |= d;
            }
        }
        catch (JsonException) { /* an answer that is not JSON still counts as accepted */ }
        return new Receipt { Text = issue is { } i ? $"issue {i}" : "accepted", Issue = issue, Url = url, AtUtc = now, Duplicate = dup };
    }
}

/// <summary>Shrinks the copy of the document that is sent when the saved one is over the endpoint's 64 KB limit, by thinning the long logs. The saved
/// document is untouched; the sent copy carries an error record saying what was thinned, so nobody reads thinned logs as complete.</summary>
public static class ResultCompactor
{
    public static byte[] FitForPost(string json, int maxBytes = ResultDocument.MaxPostBytes)
    {
        var bytes = Encoding.UTF8.GetBytes(json);
        if (bytes.Length <= maxBytes) return bytes;
        var doc = ResultJsonContext.Deserialize(json) ?? throw new InvalidOperationException("document does not parse");
        int keepEvery = 1;
        while (keepEvery < 4096)
        {
            keepEvery *= 2;
            var copy = ResultJsonContext.Deserialize(json)!;
            copy.Logs.Thermal = Thin(copy.Logs.Thermal, keepEvery);
            copy.Logs.Battery = Thin(copy.Logs.Battery, keepEvery);
            copy.Logs.Pauses = Thin(copy.Logs.Pauses, Math.Max(1, keepEvery / 4));
            copy.Errors.Add(new ErrorRecord { TMs = copy.Logs.Thermal.LastOrDefault()?.TMs ?? 0, Where = "send", Message = $"copy shrunk to fit {maxBytes} bytes: thermal and battery logs keep every {keepEvery}th sample; the full document is on the phone and comes by Share" });
            var b = ResultJsonContext.SerializeToUtf8(copy);
            if (b.Length <= maxBytes) return b;
        }
        throw new InvalidOperationException("document cannot be shrunk to the limit by thinning logs (arm results too large)");
    }

    static List<T> Thin<T>(List<T> list, int keepEvery)
    {
        if (keepEvery <= 1) return list;
        var r = new List<T>(list.Count / keepEvery + 1);
        for (int i = 0; i < list.Count; i++) if (i % keepEvery == 0 || i == list.Count - 1) r.Add(list[i]);
        return r;
    }
}
