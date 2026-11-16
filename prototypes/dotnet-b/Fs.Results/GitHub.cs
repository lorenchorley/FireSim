using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace FsResults;

public sealed class GitHubIssueException : Exception
{
    /// <summary>The HTTP status GitHub answered, or null for a network error or a missing setting.</summary>
    public int? Status { get; }
    public GitHubIssueException(string message, int? status = null, Exception? inner = null) : base(message, inner) => Status = status;
}

/// <summary>Opens one issue. The only thing the endpoint needs from GitHub; a fake implements it in the tests.</summary>
public interface IGitHubIssues
{
    /// <summary>Creates the issue and returns its number. Throws <see cref="GitHubIssueException"/> on any failure (no message ever contains the token or any client text).</summary>
    Task<int> CreateIssueAsync(string title, string body, IReadOnlyList<string> labels, CancellationToken ct);
}

/// <summary>The real thing: <c>POST https://api.github.com/repos/{owner}/{name}/issues</c> with a bearer token. The token comes from the <c>GITHUB_TOKEN</c> app setting, is
/// read when a request needs it, goes only into the Authorization header of that request, and is never logged, never put in an exception message and never in the repository.
/// The repository comes from <c>GITHUB_REPO</c> (owner/name), also read at call time, so changing the destination is a settings change.</summary>
public sealed class GitHubRestIssues : IGitHubIssues
{
    readonly HttpClient http;
    readonly Func<string?> token;
    readonly Func<string?> repo;
    readonly ILogger? log;

    public GitHubRestIssues(HttpClient http, Func<string?> token, Func<string?> repo, ILogger? log = null)
    {
        this.http = http; this.token = token; this.repo = repo; this.log = log;
    }

    public async Task<int> CreateIssueAsync(string title, string body, IReadOnlyList<string> labels, CancellationToken ct)
    {
        string? r = repo();
        if (!ResultsSettings.IsRepo(r)) throw new GitHubIssueException("GITHUB_REPO is missing or is not owner/name");
        string? t = token();
        if (string.IsNullOrWhiteSpace(t)) throw new GitHubIssueException("GITHUB_TOKEN is not set");

        var payload = new JsonObject { ["title"] = title, ["body"] = body, ["labels"] = new JsonArray(labels.Select(l => (JsonNode?)JsonValue.Create(l)).ToArray()) };
        using var req = new HttpRequestMessage(HttpMethod.Post, $"https://api.github.com/repos/{r}/issues")
        {
            Content = new StringContent(payload.ToJsonString(), new UTF8Encoding(false), "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t.Trim());
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        req.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28");
        req.Headers.UserAgent.Add(new ProductInfoHeaderValue("FireSim-Results", "1"));

        try
        {
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            int status = (int)resp.StatusCode;
            if (status != 201)
            {
                log?.LogWarning("GitHub answered {Status} to the issue request", status);
                throw new GitHubIssueException($"GitHub answered {status}", status);
            }
            await using var s = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            var buf = new byte[1 << 20];
            int n = 0, k;
            while (n < buf.Length && (k = await s.ReadAsync(buf.AsMemory(n), ct).ConfigureAwait(false)) > 0) n += k;
            var node = JsonNode.Parse(buf.AsSpan(0, n));
            if (node?["number"] is JsonValue nv && nv.TryGetValue<int>(out int number) && number > 0) return number;
            throw new GitHubIssueException("GitHub's answer has no issue number", status);
        }
        catch (HttpRequestException e) { throw new GitHubIssueException("network error talking to GitHub", null, e); }
        catch (JsonException e) { throw new GitHubIssueException("GitHub's answer is not JSON", null, e); }
        catch (OperationCanceledException e) when (!ct.IsCancellationRequested) { throw new GitHubIssueException("GitHub did not answer in time", null, e); }
    }
}
