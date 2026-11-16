using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FsTestApp.Results;

namespace FsResults;

/// <summary>One upload code of the <c>UPLOAD_CODES</c> app setting: <c>{"code": "...", "round": 0, "notAfter": "2026-12-01T00:00:00Z"}</c>.
/// The owner revokes a code by deleting its entry from the setting. <see cref="Hash"/> is SHA-256 of the code, so every comparison is between two 32-byte values.</summary>
public sealed record UploadCodeEntry(string Code, int Round, DateTimeOffset NotAfter)
{
    public byte[] Hash { get; } = SHA256.HashData(Encoding.UTF8.GetBytes(Code));

    /// <summary>A short stable id for the table (a hash of the code, so the code itself is never stored).</summary>
    public string CodeId => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("fs-results-code-id:" + Code)))[..16];
}

/// <summary>Everything the endpoint reads from app settings, parsed once per request (an app-setting change restarts the app on Azure, so this is cheap and always current).
/// <c>GITHUB_TOKEN</c> is deliberately NOT here: only <see cref="GitHubRestIssues"/> reads it, so it cannot end up in a log line, a settings dump or a test.</summary>
public sealed class ResultsSettings
{
    public IReadOnlyList<UploadCodeEntry> Codes { get; init; } = Array.Empty<UploadCodeEntry>();
    /// <summary><c>owner/name</c> from <c>GITHUB_REPO</c>.</summary>
    public string Repo { get; init; } = "";
    /// <summary>Non-null when the endpoint cannot work (a setting is missing or malformed); the endpoint then answers 503 not_configured.</summary>
    public string? ConfigError { get; init; }
    /// <summary>Skipped entries of <c>UPLOAD_CODES</c> (malformed): they accept nothing; a log line names the index, never the value.</summary>
    public IReadOnlyList<int> SkippedCodeEntries { get; init; } = Array.Empty<int>();

    public int MaxBodyBytes { get; init; } = ResultDocument.MaxPostBytes;
    public int MaxKeysPerCode { get; init; } = 3;
    /// <summary>How long the request that owns a key may take before another request may take the work over.</summary>
    public TimeSpan PendingLease { get; init; } = TimeSpan.FromMinutes(2);
    /// <summary>How long a request that finds its key pending waits for the owner before answering 503 (the phone retries).</summary>
    public TimeSpan PendingWait { get; init; } = TimeSpan.FromSeconds(10);

    static readonly Regex CodeShape = new("^[A-Za-z0-9_-]{16,128}$", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    static readonly Regex RepoShape = new("^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    public static bool IsRepo(string? s) => s != null && RepoShape.IsMatch(s) && !s.StartsWith("./", StringComparison.Ordinal) && !s.Contains("..", StringComparison.Ordinal);

    public static ResultsSettings FromEnvironment(Func<string, string?> get) => Parse(get("UPLOAD_CODES"), get("GITHUB_REPO"));

    public static ResultsSettings Parse(string? uploadCodesJson, string? repo)
    {
        if (!IsRepo(repo)) return new ResultsSettings { ConfigError = "GITHUB_REPO is missing or is not owner/name" };
        if (string.IsNullOrWhiteSpace(uploadCodesJson)) return new ResultsSettings { Repo = repo!, ConfigError = "UPLOAD_CODES is missing" };
        JsonNode? root;
        try { root = JsonNode.Parse(uploadCodesJson); }
        catch (JsonException) { return new ResultsSettings { Repo = repo!, ConfigError = "UPLOAD_CODES is not valid JSON" }; }
        if (root is not JsonArray arr) return new ResultsSettings { Repo = repo!, ConfigError = "UPLOAD_CODES is not a JSON array" };

        var codes = new List<UploadCodeEntry>();
        var skipped = new List<int>();
        for (int i = 0; i < arr.Count; i++)
        {
            if (TryParseEntry(arr[i], out var e)) codes.Add(e!); else skipped.Add(i);
        }
        return new ResultsSettings { Repo = repo!, Codes = codes, SkippedCodeEntries = skipped };
    }

    static bool TryParseEntry(JsonNode? n, out UploadCodeEntry? entry)
    {
        entry = null;
        if (n is not JsonObject o) return false;
        try
        {
            string? code = o["code"] is JsonValue cv && cv.TryGetValue<string>(out var c) ? c : null;
            if (code == null || !CodeShape.IsMatch(code)) return false;
            if (o["round"] is not JsonValue rv || !rv.TryGetValue<int>(out int round) || round < 0 || round > 99) return false;
            if (o["notAfter"] is not JsonValue nv || !nv.TryGetValue<string>(out var na)) return false;
            // an offset (Z or +hh:mm) is required: a date without one would mean the server's local time
            if (!Regex.IsMatch(na, @"(Z|[+-]\d\d:\d\d)$", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1))) return false;
            if (!DateTimeOffset.TryParse(na, CultureInfo.InvariantCulture, DateTimeStyles.None, out var notAfter)) return false;
            entry = new UploadCodeEntry(code, round, notAfter);
            return true;
        }
        catch (InvalidOperationException) { return false; }
        catch (FormatException) { return false; }
    }
}

public enum CodeCheck { Unknown, Expired, Valid }

/// <summary>Finds the entry for a presented upload code in constant time: the presented code and every configured code are hashed (SHA-256), and the two 32-byte
/// hashes are compared with <see cref="CryptographicOperations.FixedTimeEquals"/> for every entry, with no early exit, so neither the content of the code nor how
/// many entries precede the match shows in the time taken.</summary>
public sealed class UploadCodeChecker
{
    readonly Func<byte[], byte[], bool> equals;
    public UploadCodeChecker(Func<byte[], byte[], bool>? equals = null) => this.equals = equals ?? ((a, b) => CryptographicOperations.FixedTimeEquals(a, b));

    public (CodeCheck Result, UploadCodeEntry? Entry) Check(IReadOnlyList<UploadCodeEntry> entries, string? presented, DateTimeOffset now)
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(presented ?? ""));
        UploadCodeEntry? found = null;
        bool presentedEmpty = string.IsNullOrEmpty(presented);
        foreach (var e in entries)
        {
            bool same = equals(hash, e.Hash);
            if (same && found == null) found = e;
        }
        if (found == null || presentedEmpty) return (CodeCheck.Unknown, null);
        return now > found.NotAfter ? (CodeCheck.Expired, found) : (CodeCheck.Valid, found);
    }
}
