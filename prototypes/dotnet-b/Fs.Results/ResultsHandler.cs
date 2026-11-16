using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FsTestApp.Results;
using Microsoft.Extensions.Logging;

namespace FsResults;

/// <summary>What the handler needs from an HTTP request, independent of the web framework (the Function maps its request onto this).</summary>
public sealed record HandlerRequest(string Method, string? ContentType, long? ContentLength, string? UploadCode, string? IdempotencyKey, Stream Body);

/// <summary>Status and a JSON body. Error bodies are fixed small strings (<c>{"error":"bad_code"}</c>): they never echo anything the client sent.</summary>
public sealed record HandlerResponse(int Status, string Json);

/// <summary>The whole endpoint behind the HTTP wrapper. In order:
/// method (POST only) → settings → content type → idempotency-key header shape → size (Content-Length first, then a hard cap while reading) →
/// upload code (constant time; unknown 401, expired 403) → raw JSON hygiene → schema (results.schema.json, the same validator the phone app uses) →
/// header key equals the document's key → round equals the code's round → the store (see <see cref="HandleNewKeyAsync"/>) → the issue → the receipt.</summary>
public sealed class ResultsHandler
{
    static readonly Regex KeyShape = new("^([0-9a-f]{64}|unavailable):[0-9a-f]{32}$", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    readonly IResultStore store;
    readonly IGitHubIssues github;
    readonly Func<ResultsSettings> settings;
    readonly TimeProvider time;
    readonly ILogger? log;
    readonly UploadCodeChecker codes = new();

    public ResultsHandler(IResultStore store, IGitHubIssues github, Func<ResultsSettings> settings, TimeProvider? time = null, ILogger? log = null)
    {
        this.store = store; this.github = github; this.settings = settings; this.time = time ?? TimeProvider.System; this.log = log;
    }

    public static HandlerResponse Error(int status, string code) => new(status, "{\"error\":\"" + code + "\"}");

    public async Task<HandlerResponse> HandleAsync(HandlerRequest req, CancellationToken ct)
    {
        if (!string.Equals(req.Method, "POST", StringComparison.Ordinal)) return Error(405, "method_not_allowed");

        var cfg = settings();
        if (cfg.ConfigError != null) { log?.LogError("Results endpoint is not configured: {Problem}", cfg.ConfigError); return Error(503, "not_configured"); }

        if (!IsJson(req.ContentType)) return Error(415, "unsupported_media_type");
        if (req.IdempotencyKey is null || !KeyShape.IsMatch(req.IdempotencyKey)) return Error(400, "bad_key");

        if (req.ContentLength is { } declared && declared > cfg.MaxBodyBytes) return Error(413, "too_large");
        byte[]? body;
        try { body = await BoundedBodyReader.ReadAsync(req.Body, cfg.MaxBodyBytes, ct).ConfigureAwait(false); }
        catch (IOException) { return Error(400, "bad_request"); }
        if (body is null) return Error(413, "too_large");

        var now = time.GetUtcNow();
        var (check, entry) = codes.Check(cfg.Codes, req.UploadCode, now);
        if (check == CodeCheck.Unknown) return Error(401, "bad_code");
        if (check == CodeCheck.Expired) return Error(403, "expired_code");

        if (!JsonHygiene.IsClean(body)) return Error(400, "bad_json");
        JsonObject doc;
        try
        {
            if (JsonNode.Parse(body) is not JsonObject o) return Error(400, "bad_schema");
            if (ResultSchema.Default.Validate(o).Count > 0) return Error(400, "bad_schema");
            doc = o;
        }
        catch (System.Text.Json.JsonException) { return Error(400, "bad_json"); }

        string docKey = doc["idempotencyKey"]!.GetValue<string>();
        string expectedKey = doc["build"]!["apkSha256"]!.GetValue<string>() + ":" + doc["runId"]!.GetValue<string>();
        if (!string.Equals(docKey, req.IdempotencyKey, StringComparison.Ordinal) || !string.Equals(docKey, expectedKey, StringComparison.Ordinal)) return Error(400, "key_mismatch");
        if (doc["round"]!.GetValue<int>() != entry!.Round) return Error(403, "wrong_round");

        try { return await HandleNewKeyAsync(cfg, entry, docKey, doc, ct).ConfigureAwait(false); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception e)
        {
            log?.LogError("Results endpoint failed: {Type}", e.GetType().Name);   // the type only: no message, nothing from the client
            return Error(500, "server_error");
        }
    }

    /// <summary>The store protocol. Every claim is an insert-if-not-exists or an ETag compare-and-swap, so concurrent requests never both win:
    /// 1. a row for the key exists: answer from it (the first receipt, <c>duplicate: true</c>); a pending row is waited for, or taken over once its lease has run out.
    /// 2. else reserve one of the code's three slots for this key (a key that already holds one costs nothing); none left: 403 code_used_up.
    /// 3. else insert a pending row (insert-if-not-exists). Losing that race means step 1 again.
    /// 4. the winner makes the issue, then marks the row done. If the issue fails the row is deleted (a retry may try again) and the answer is 502.</summary>
    async Task<HandlerResponse> HandleNewKeyAsync(ResultsSettings cfg, UploadCodeEntry entry, string key, JsonObject doc, CancellationToken ct)
    {
        string keyHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key)));
        string codeId = entry.CodeId;

        var existing = await store.GetAsync(keyHash, ct).ConfigureAwait(false);
        if (existing is null)
        {
            if (!await store.TryReserveSlotAsync(codeId, keyHash, cfg.MaxKeysPerCode, ct).ConfigureAwait(false)) return Error(403, "code_used_up");
            var now = time.GetUtcNow();
            var mine = await store.TryInsertPendingAsync(keyHash, codeId, now, now + cfg.PendingLease, ct).ConfigureAwait(false);
            if (mine is not null) return await MakeIssueAsync(cfg, mine, doc).ConfigureAwait(false);
            existing = await store.GetAsync(keyHash, ct).ConfigureAwait(false);
        }

        // somebody else holds a row for this key
        var waited = System.Diagnostics.Stopwatch.StartNew();   // real time, so a test clock that stands still cannot make this wait forever
        while (existing is not null)
        {
            if (existing.CodeId != codeId) return Error(403, "key_in_use");
            if (existing.State == EntryState.Done) return Receipt(cfg, existing, duplicate: true);
            var now = time.GetUtcNow();
            if (existing.LeaseUntilUtc <= now)
            {
                var taken = await store.TryTakeOverAsync(existing, now + cfg.PendingLease, ct).ConfigureAwait(false);
                if (taken is not null) return await MakeIssueAsync(cfg, taken, doc).ConfigureAwait(false);
            }
            else if (waited.Elapsed >= cfg.PendingWait) return Error(503, "busy");
            else await Task.Delay(TimeSpan.FromMilliseconds(25), ct).ConfigureAwait(false);
            existing = await store.GetAsync(keyHash, ct).ConfigureAwait(false);
        }
        // the row vanished (its owner could not make the issue and withdrew it): the phone retries
        return Error(503, "busy");
    }

    async Task<HandlerResponse> MakeIssueAsync(ResultsSettings cfg, StoredResult mine, JsonObject doc)
    {
        // From here on the work is not tied to the caller's connection: if the phone hangs up, the issue is still recorded against the key.
        using var work = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var draft = IssueFormatter.Format(doc);
        int issue;
        try { issue = await github.CreateIssueAsync(draft.Title, draft.Body, draft.Labels, work.Token).ConfigureAwait(false); }
        catch (Exception e)
        {
            log?.LogError("Creating the issue failed: {Type}", e is GitHubIssueException { Status: { } s } ? "GitHub " + s.ToString(CultureInfo.InvariantCulture) : e.GetType().Name);
            await store.AbandonAsync(mine, CancellationToken.None).ConfigureAwait(false);
            return Error(502, "github_failed");
        }

        var now = time.GetUtcNow();
        bool done = false;
        for (int attempt = 0; attempt < 3 && !done; attempt++)
        {
            try { done = await store.TryCompleteAsync(mine, issue, now, work.Token).ConfigureAwait(false); break; }
            catch (Exception e) when (attempt < 2 && e is not OperationCanceledException) { await Task.Delay(100, CancellationToken.None).ConfigureAwait(false); }
        }
        if (!done)
        {
            // the lease was taken over meanwhile: answer with whatever the row says now, so the phone and the table agree on one receipt
            var row = await store.GetAsync(mine.KeyHash, CancellationToken.None).ConfigureAwait(false);
            log?.LogError("Issue {Issue} was made but its row was taken over", issue);
            return row is { State: EntryState.Done } ? Receipt(cfg, row, duplicate: true) : Error(503, "busy");
        }
        return Receipt(cfg, mine with { State = EntryState.Done, Issue = issue, CompletedUtc = now }, duplicate: false);
    }

    static HandlerResponse Receipt(ResultsSettings cfg, StoredResult row, bool duplicate)
    {
        var o = new JsonObject
        {
            ["issue"] = row.Issue,
            ["url"] = $"https://github.com/{cfg.Repo}/issues/{row.Issue}",
            ["duplicate"] = duplicate,
            ["at"] = (row.CompletedUtc ?? row.CreatedUtc).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
        };
        return new HandlerResponse(duplicate ? 200 : 201, o.ToJsonString());
    }

    static bool IsJson(string? contentType)
    {
        if (contentType is null || !MediaTypeHeaderValue.TryParse(contentType, out var mt)) return false;
        if (!string.Equals(mt.MediaType, "application/json", StringComparison.OrdinalIgnoreCase)) return false;
        return mt.CharSet is null || string.Equals(mt.CharSet.Trim('"'), "utf-8", StringComparison.OrdinalIgnoreCase);
    }
}
