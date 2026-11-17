using Azure.Data.Tables;
using FsResults;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

// Azure Functions, isolated worker, ASP.NET Core integration (Flex Consumption: .NET 10). Every secret is an app setting; none is in this repository:
//   GITHUB_TOKEN               fine-grained token, Issues: write on the one results repository (read only by GitHubRestIssues, at call time)
//   GITHUB_REPO                owner/name of the repository that receives the issues
//   UPLOAD_CODES               JSON array of {"code","round","notAfter"}; deleting an entry revokes that code
//   RESULTS_STORAGE_CONNECTION storage account connection string for the idempotency table (optional: falls back to AzureWebJobsStorage when that is a connection
//                              string; an identity-based AzureWebJobsStorage__accountName is NOT supported here: use the connection string)
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<Func<ResultsSettings>>(_ => () => ResultsSettings.FromEnvironment(Environment.GetEnvironmentVariable));
builder.Services.AddSingleton<IResultStore>(_ => new TableResultStore(CreateTableClient(Environment.GetEnvironmentVariable)));
builder.Services.AddSingleton<IGitHubIssues>(sp => new GitHubRestIssues(
    new HttpClient { Timeout = TimeSpan.FromSeconds(30) },
    () => Environment.GetEnvironmentVariable("GITHUB_TOKEN"),
    () => Environment.GetEnvironmentVariable("GITHUB_REPO"),
    sp.GetRequiredService<ILoggerFactory>().CreateLogger("Fs.Results.GitHub")));
builder.Services.AddSingleton(sp => new ResultsHandler(
    sp.GetRequiredService<IResultStore>(),
    sp.GetRequiredService<IGitHubIssues>(),
    sp.GetRequiredService<Func<ResultsSettings>>(),
    sp.GetRequiredService<TimeProvider>(),
    sp.GetRequiredService<ILoggerFactory>().CreateLogger("Fs.Results")));

builder.Build().Run();

static TableClient CreateTableClient(Func<string, string?> get)
{
    string? conn = get("RESULTS_STORAGE_CONNECTION");
    if (string.IsNullOrWhiteSpace(conn))
    {
        string? web = get("AzureWebJobsStorage");
        if (!string.IsNullOrWhiteSpace(web) && (web.Contains("AccountName=", StringComparison.OrdinalIgnoreCase) || web.Contains("UseDevelopmentStorage", StringComparison.OrdinalIgnoreCase))) conn = web;
    }
    if (!string.IsNullOrWhiteSpace(conn)) return new TableClient(conn, TableResultStore.TableName);

    throw new InvalidOperationException("No storage for the results table: set RESULTS_STORAGE_CONNECTION (see README.md)");
}
