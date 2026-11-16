using System.Net;
using System.Text;
using Fs.Tests.TestApp;
using FsResults;
using FsTestApp;
using FsTestApp.Results;
using FsTestApp.Sending;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

namespace Fs.Results.Tests;

/// <summary>The endpoint against the phone's own sender (<c>HttpResultsSender</c>, linked from Fs.TestApp.Core): the bytes, headers and content type the APK really POSTs,
/// and what the app makes of the answers. No network: an HttpMessageHandler hands each request to the handler in process.</summary>
[TestClass]
public sealed class ClientCompatTests
{
    const string Endpoint = "https://results.example.invalid/api/results";

    /// <summary>Plays the network: turns the app's HttpRequestMessage into the handler's request and the answer back into an HttpResponseMessage.</summary>
    sealed class InProcess : HttpMessageHandler
    {
        readonly ResultsHandler handler;
        public List<HttpRequestMessage> Seen { get; } = new();
        public InProcess(ResultsHandler handler) => this.handler = handler;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Seen.Add(request);
            byte[] body = request.Content is null ? Array.Empty<byte>() : await request.Content.ReadAsByteArrayAsync(ct);
            string? One(string name) => request.Headers.TryGetValues(name, out var v) && v.Count() == 1 ? v.First() : null;
            var r = await handler.HandleAsync(new HandlerRequest(request.Method.Method, request.Content?.Headers.ContentType?.ToString(), body.Length, One("X-Upload-Code"), One("Idempotency-Key"), new MemoryStream(body)), ct);
            return new HttpResponseMessage((HttpStatusCode)r.Status) { Content = new StringContent(r.Json, Encoding.UTF8, "application/json") };
        }
    }

    static (HttpResultsSender Sender, Harness H, InProcess Net) Make(string? code = null)
    {
        var h = new Harness();
        var net = new InProcess(h.Handler);
        var sender = new HttpResultsSender(new ResultsConfig(Endpoint, code ?? h.Code), new HttpClient(net));
        return (sender, h, net);
    }

    static (string Key, byte[] Bytes) AppDocument(int round = 0, string? runId = null)
    {
        var d = TestDocs.Valid();
        d.Round = round;
        if (runId != null) { d.RunId = runId; d.IdempotencyKey = ResultDocument.MakeIdempotencyKey(d.Build.ApkSha256, runId); }
        return (d.IdempotencyKey, ResultJsonContext.SerializeToUtf8(d));
    }

    [TestMethod]
    public async Task The_apps_document_is_accepted_and_the_app_reads_the_receipt()
    {
        var (sender, h, net) = Make();
        var (key, bytes) = AppDocument();
        var r = await sender.SendAsync(key, bytes, DateTimeOffset.UnixEpoch, default);

        Assert.AreEqual(SendOutcome.Sent, r.Outcome, r.Detail);
        Assert.AreEqual(201, r.HttpStatus);
        Assert.AreEqual(17, r.Receipt!.Issue);
        Assert.AreEqual("issue 17", r.Receipt.Text);
        Assert.IsFalse(r.Receipt.Duplicate);
        Assert.AreEqual("https://github.com/" + Harness.Repo + "/issues/17", r.Receipt.Url);
        Assert.HasCount(1, h.GitHub.Calls);

        // the headers, as the contract says
        var req = net.Seen.Single();
        Assert.AreEqual(HttpMethod.Post, req.Method);
        Assert.AreEqual(key, req.Headers.GetValues("Idempotency-Key").Single());
        Assert.AreEqual("application/json", req.Content!.Headers.ContentType!.MediaType);
    }

    [TestMethod]
    public async Task A_retry_after_a_lost_answer_gets_the_same_issue_and_the_app_calls_it_a_duplicate()
    {
        var (sender, h, _) = Make();
        var (key, bytes) = AppDocument();
        var first = await sender.SendAsync(key, bytes, DateTimeOffset.UnixEpoch, default);
        var again = await sender.SendAsync(key, bytes, DateTimeOffset.UnixEpoch, default);
        Assert.AreEqual(SendOutcome.Sent, again.Outcome);
        Assert.AreEqual(200, again.HttpStatus);
        Assert.AreEqual(first.Receipt!.Issue, again.Receipt!.Issue);
        Assert.IsTrue(again.Receipt.Duplicate);
        Assert.HasCount(1, h.GitHub.Calls);
    }

    [TestMethod]
    public async Task A_wrong_code_is_rejected_and_the_app_does_not_retry()
    {
        var (sender, h, _) = Make(code: "wrong-code-wrong-code-0000");
        var (key, bytes) = AppDocument();
        var r = await sender.SendAsync(key, bytes, DateTimeOffset.UnixEpoch, default);
        Assert.AreEqual(SendOutcome.Rejected, r.Outcome, "401 is a 4xx the app does not retry");
        Assert.AreEqual(401, r.HttpStatus);
        Assert.HasCount(0, h.GitHub.Calls);
    }

    [TestMethod]
    public async Task Refusals_the_app_must_not_retry_are_4xx_and_failures_it_should_retry_are_5xx()
    {
        // refusals: 400, 401, 403, 413, 415 are all "Rejected" for the app
        var (sender, h, _) = Make();
        var (key, bytes) = AppDocument(round: 5);
        Assert.AreEqual(SendOutcome.Rejected, (await sender.SendAsync(key, bytes, DateTimeOffset.UnixEpoch, default)).Outcome, "wrong round for the code");

        // GitHub down: 502, which the app retries with back-off
        var (sender2, h2, _) = Make();
        h2.GitHub.FailTheNext(1);
        var (key2, bytes2) = AppDocument();
        var r2 = await sender2.SendAsync(key2, bytes2, DateTimeOffset.UnixEpoch, default);
        Assert.AreEqual(SendOutcome.Retry, r2.Outcome);
        Assert.AreEqual(502, r2.HttpStatus);
        var r3 = await sender2.SendAsync(key2, bytes2, DateTimeOffset.UnixEpoch, default);
        Assert.AreEqual(SendOutcome.Sent, r3.Outcome, "the retry succeeds");
        Assert.HasCount(1, h2.GitHub.Calls);
        _ = h;
    }

    [TestMethod]
    public async Task The_largest_document_the_app_will_send_fits()
    {
        // ResultCompactor shrinks the sent copy to the 64 KB the endpoint accepts: the endpoint must accept exactly what it produces
        var (sender, h, _) = Make();
        var d = TestDocs.Valid(arms: 3, samples: 2500);
        string json = ResultJsonContext.Serialize(d);
        Assert.IsGreaterThan(ResultDocument.MaxPostBytes, Encoding.UTF8.GetByteCount(json), "the test needs a document over the cap before thinning");
        byte[] fit = ResultCompactor.FitForPost(json);
        Assert.IsLessThanOrEqualTo(ResultDocument.MaxPostBytes, fit.Length);
        var r = await sender.SendAsync(d.IdempotencyKey, fit, DateTimeOffset.UnixEpoch, default);
        Assert.AreEqual(SendOutcome.Sent, r.Outcome, r.Detail);
        Assert.HasCount(1, h.GitHub.Calls);
    }

    [TestMethod]
    public async Task The_function_wrapper_maps_headers_and_answers_with_json_and_no_store()
    {
        var h = new Harness();
        var fn = new ResultsFunction(h.Handler, NullLogger<ResultsFunction>.Instance);
        var (key, bytes) = AppDocument();

        var ctx = new DefaultHttpContext();
        ctx.Request.Method = "POST";
        ctx.Request.ContentType = "application/json; charset=utf-8";
        ctx.Request.Headers["X-Upload-Code"] = h.Code;
        ctx.Request.Headers["Idempotency-Key"] = key;
        ctx.Request.Body = new MemoryStream(bytes);
        ctx.Request.ContentLength = bytes.Length;
        var result = (ContentResult)await fn.Run(ctx.Request);
        Assert.AreEqual(201, result.StatusCode);
        StringAssert.Contains(result.Content!, "\"issue\":17");
        StringAssert.StartsWith(result.ContentType!, "application/json");
        Assert.AreEqual("no-store", ctx.Response.Headers.CacheControl.ToString());

        // a header given twice counts as absent: the code is then unknown
        var ctx2 = new DefaultHttpContext();
        ctx2.Request.Method = "POST";
        ctx2.Request.ContentType = "application/json";
        ctx2.Request.Headers["X-Upload-Code"] = new Microsoft.Extensions.Primitives.StringValues(new[] { h.Code, h.Code });
        ctx2.Request.Headers["Idempotency-Key"] = key;
        ctx2.Request.Body = new MemoryStream(bytes);
        var twice = (ContentResult)await fn.Run(ctx2.Request);
        Assert.AreEqual(401, twice.StatusCode);
    }

    [TestMethod]
    public void The_function_declares_post_only_and_an_anonymous_trigger_guarded_by_the_upload_code()
    {
        var method = typeof(ResultsFunction).GetMethod(nameof(ResultsFunction.Run))!;
        var trigger = method.GetParameters()[0].GetCustomAttributes(typeof(Microsoft.Azure.Functions.Worker.HttpTriggerAttribute), false).Cast<Microsoft.Azure.Functions.Worker.HttpTriggerAttribute>().Single();
        CollectionAssert.AreEqual(new[] { "post" }, trigger.Methods);
        Assert.AreEqual(Microsoft.Azure.Functions.Worker.AuthorizationLevel.Anonymous, trigger.AuthLevel);
        Assert.AreEqual("results", trigger.Route);
    }
}
