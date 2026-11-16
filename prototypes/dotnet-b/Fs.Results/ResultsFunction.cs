using FsTestApp.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace FsResults;

/// <summary>The HTTP trigger: <c>POST /api/results</c>. Anonymous at the Functions level on purpose: the credential is the upload code, which the handler checks.
/// Only POST is declared, and the handler refuses any other method as well.</summary>
public sealed class ResultsFunction
{
    readonly ResultsHandler handler;
    readonly ILogger<ResultsFunction> log;

    public ResultsFunction(ResultsHandler handler, ILogger<ResultsFunction> log) { this.handler = handler; this.log = log; }

    [Function("results")]
    public async Task<IActionResult> Run([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "results")] HttpRequest req)
    {
        // Ask the web server to cut the body off too, as a second line behind the handler's own bounded read (best effort: the feature may be absent or read-only).
        try
        {
            var f = req.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (f is { IsReadOnly: false }) f.MaxRequestBodySize = ResultDocument.MaxPostBytes + 1;
        }
        catch (InvalidOperationException) { }

        var r = await handler.HandleAsync(Map(req), req.HttpContext.RequestAborted).ConfigureAwait(false);
        req.HttpContext.Response.Headers.CacheControl = "no-store";
        return new ContentResult { StatusCode = r.Status, Content = r.Json, ContentType = "application/json; charset=utf-8" };
    }

    public static HandlerRequest Map(HttpRequest req) => new(
        req.Method,
        req.ContentType,
        req.ContentLength,
        Single(req, "X-Upload-Code"),
        Single(req, "Idempotency-Key"),
        req.Body);

    /// <summary>The header's value when it is given exactly once, else null.</summary>
    static string? Single(HttpRequest req, string name) => req.Headers.TryGetValue(name, out var v) && v.Count == 1 ? v[0] : null;
}
