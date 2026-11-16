using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using FsResults;
using Microsoft.Extensions.Logging;

namespace Fs.Results.Tests;

/// <summary>The real GitHub client against a stub transport: nothing here touches the network and no real token exists. The "token" is a random value made per test run,
/// so a test can check that it appears in exactly one place (the Authorization header) and nowhere else.</summary>
[TestClass]
public sealed class GitHubRestTests
{
    sealed class Stub : HttpMessageHandler
    {
        public HttpRequestMessage? Request;
        public string? RequestBody;
        public Func<HttpResponseMessage> Answer = () => new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"number\":42,\"html_url\":\"https://github.com/x/y/issues/42\"}") };
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            RequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return Answer();
        }
    }

    sealed class CaptureLog : ILogger
    {
        public List<string> Lines { get; } = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Lines.Add(formatter(state, exception) + (exception is null ? "" : " | " + exception));
    }

    static readonly string Token = "tok-" + Guid.NewGuid().ToString("N");

    static (GitHubRestIssues Client, Stub Stub, CaptureLog Log) Make(string? repo = "owner/name", string? token = null)
    {
        var stub = new Stub();
        var log = new CaptureLog();
        return (new GitHubRestIssues(new HttpClient(stub), () => token ?? Token, () => repo, log), stub, log);
    }

    [TestMethod]
    public async Task Posts_the_issue_to_the_configured_repository_with_the_token_in_the_authorization_header_only()
    {
        var (client, stub, _) = Make("some-owner/some-repo");
        int number = await client.CreateIssueAsync("The title", "The body", new[] { "bench-result" }, default);

        Assert.AreEqual(42, number);
        var req = stub.Request!;
        Assert.AreEqual(HttpMethod.Post, req.Method);
        Assert.AreEqual("https://api.github.com/repos/some-owner/some-repo/issues", req.RequestUri!.ToString());
        Assert.AreEqual("Bearer", req.Headers.Authorization!.Scheme);
        Assert.AreEqual(Token, req.Headers.Authorization.Parameter);
        Assert.AreEqual("application/vnd.github+json", req.Headers.Accept.Single().MediaType);
        Assert.AreEqual("2022-11-28", req.Headers.GetValues("X-GitHub-Api-Version").Single());
        Assert.IsTrue(req.Headers.UserAgent.Count > 0, "GitHub refuses requests without a User-Agent");
        Assert.IsFalse(stub.RequestBody!.Contains(Token, StringComparison.Ordinal), "the token is never in the body");

        var sent = JsonNode.Parse(stub.RequestBody)!;
        Assert.AreEqual("The title", sent["title"]!.GetValue<string>());
        Assert.AreEqual("The body", sent["body"]!.GetValue<string>());
        CollectionAssert.AreEqual(new[] { "bench-result" }, sent["labels"]!.AsArray().Select(l => l!.GetValue<string>()).ToArray());
        Assert.AreEqual(3, sent.AsObject().Count, "only title, body and labels are sent");
    }

    [TestMethod]
    public async Task The_repository_is_read_at_call_time_so_changing_the_setting_changes_the_destination()
    {
        string? repo = "first/one";
        var stub = new Stub();
        var client = new GitHubRestIssues(new HttpClient(stub), () => Token, () => repo);
        await client.CreateIssueAsync("t", "b", new[] { "l" }, default);
        StringAssert.Contains(stub.Request!.RequestUri!.ToString(), "/repos/first/one/issues");
        repo = "lorenchorley/FireSim";
        await client.CreateIssueAsync("t", "b", new[] { "l" }, default);
        StringAssert.Contains(stub.Request!.RequestUri!.ToString(), "/repos/lorenchorley/FireSim/issues");
    }

    [TestMethod]
    [DataRow(HttpStatusCode.Unauthorized)]
    [DataRow(HttpStatusCode.Forbidden)]
    [DataRow(HttpStatusCode.NotFound)]
    [DataRow(HttpStatusCode.UnprocessableEntity)]
    [DataRow(HttpStatusCode.InternalServerError)]
    [DataRow(HttpStatusCode.OK)]
    public async Task Any_answer_but_201_is_a_failure_that_carries_the_status_and_no_secret(HttpStatusCode status)
    {
        var (client, stub, log) = Make();
        stub.Answer = () => new HttpResponseMessage(status) { Content = new StringContent("{\"message\":\"Bad credentials for " + Token + "\"}") };
        var e = await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));
        Assert.AreEqual((int)status, e.Status);
        AssertNoToken(e.ToString(), log);
    }

    [TestMethod]
    public async Task A_network_error_a_timeout_and_a_junk_answer_are_failures_without_the_token()
    {
        var (client, stub, log) = Make();
        stub.Answer = () => throw new HttpRequestException("connection refused");
        var e1 = await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));
        Assert.IsNull(e1.Status);

        stub.Answer = () => throw new TaskCanceledException("timeout");
        await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));

        stub.Answer = () => new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("not json") };
        await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));

        stub.Answer = () => new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"number\":\"x\"}") };
        await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));

        stub.Answer = () => new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"number\":0}") };
        await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));
        AssertNoToken(e1.ToString(), log);
    }

    [TestMethod]
    public async Task The_callers_cancellation_is_not_turned_into_a_github_failure()
    {
        var (client, stub, _) = Make();
        stub.Answer = () => throw new TaskCanceledException();
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, cts.Token));
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("   ")]
    public async Task A_missing_token_fails_without_sending_anything(string? token)
    {
        var stub = new Stub();
        var client = new GitHubRestIssues(new HttpClient(stub), () => token, () => "owner/name");
        await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));
        Assert.IsNull(stub.Request);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow("no-slash")]
    [DataRow("a/b/../../x")]
    public async Task A_missing_or_malformed_repository_fails_without_sending_anything(string? repo)
    {
        var (client, stub, _) = Make(repo);
        await Assert.ThrowsExactlyAsync<GitHubIssueException>(() => client.CreateIssueAsync("t", "b", new[] { "l" }, default));
        Assert.IsNull(stub.Request);
    }

    [TestMethod]
    public async Task A_github_failure_through_the_endpoint_logs_the_status_and_nothing_else()
    {
        // the whole endpoint with the real client on a stub transport: the token must not surface in the answer to the phone or in a log line
        var stub = new Stub { Answer = () => new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("Bad credentials " + Token) } };
        var log = new CaptureLog();
        var h = new Harness();
        var client = new GitHubRestIssues(new HttpClient(stub), () => Token, () => Harness.Repo, log);
        var handler = new ResultsHandler(h.Store, client, () => h.Settings, h.Time, log);
        var doc = Harness.DocN(1);
        var r = await handler.HandleAsync(new HandlerRequest("POST", "application/json", null, h.Code, Harness.KeyOf(doc), new MemoryStream(Encoding.UTF8.GetBytes(doc.ToJsonString()))), default);
        Assert.AreEqual(502, r.Status);
        Assert.AreEqual("{\"error\":\"github_failed\"}", r.Json);
        AssertNoToken(r.Json, log);
        Assert.IsTrue(log.Lines.Any(l => l.Contains("401", StringComparison.Ordinal)), "the status is logged");
        Assert.IsFalse(log.Lines.Any(l => l.Contains(h.Code, StringComparison.Ordinal)), "the upload code is not logged");
    }

    static void AssertNoToken(string text, CaptureLog log)
    {
        Assert.IsFalse(text.Contains(Token, StringComparison.Ordinal), "the token appeared in: " + text);
        Assert.IsFalse(log.Lines.Any(l => l.Contains(Token, StringComparison.Ordinal)), "the token appeared in a log line");
    }
}
