# Phase 0, T0.6a: the results endpoint

Date 2026-11-16. Machine: the build container (Linux x64, 4 shared cores), SDK 11.0.100, **only the .NET 11 runtime installed**. Everything below was run once, here; numbers are test counts, not timings.
Owner's deploy steps and the cost expectation: `../Fs.Results/README.md`.

## 1. What was built

`Fs.Results/` (Azure Functions isolated worker, ASP.NET Core integration, `net10.0`, for Flex Consumption) and `Fs.Results.Tests/` (MSTest 4.5.3 on Microsoft.Testing.Platform).

| File | Job |
|---|---|
| `ResultsFunction.cs` | `POST /api/results`, anonymous trigger (the upload code is the credential), `Cache-Control: no-store`, asks Kestrel for a 64 KB + 1 body limit as a second line |
| `ResultsHandler.cs` | the pipeline, framework-free (`HandlerRequest` in, `HandlerResponse` out), so every refusal is a plain unit test |
| `BodyAndJson.cs` | `BoundedBodyReader` (at most cap+1 bytes taken from the stream whatever Content-Length says), `JsonHygiene` (strict UTF-8, one value, depth 24, no duplicate names, no lone surrogates) |
| `Settings.cs` | `UPLOAD_CODES` parsing (`code`, `round`, `notAfter`), `UploadCodeChecker` (SHA-256 of both sides, `FixedTimeEquals` against every entry, no early exit) |
| `Storage.cs`, `TableResultStore.cs` | `IResultStore`: insert-if-not-exists and ETag compare-and-swap only; `InMemoryResultStore` for tests, Azure Table for deployment |
| `IssueFormatter.cs` | title from validated fields, fixed label `bench-result`, fenced body, `@` neutralised |
| `GitHub.cs` | `IGitHubIssues`; `GitHubRestIssues` (token from `GITHUB_TOKEN`, repository from `GITHUB_REPO`, both read at call time) |

**Order of checks** (a request stops at the first failure): method, settings, content type, key header shape, size (Content-Length, then the bounded read), upload code (401 unknown, 403 expired), JSON hygiene, schema, key header = `idempotencyKey` = `apkSha256:runId`, round = the code's round, then the store.

**The store protocol** (the answer to "never a second issue, even at the same moment"): (1) a row for the key exists: answer from it, `duplicate: true`; a pending row is waited for (up to 10 s, then `503 busy`) or taken over by compare-and-swap once its 2-minute lease has run out. (2) else reserve one of the code's three slot rows (insert-if-not-exists on `slot1..slot3`; a key that already holds a slot costs nothing). (3) else insert a pending row (insert-if-not-exists). (4) the winner makes the issue under its own 60 s token (a phone that hangs up does not orphan the issue) and marks the row done; on a GitHub failure the row is deleted and the answer is `502`.

**The schema validator is the T0.5 one**, not a rewrite: `ResultSchema.cs` and `ResultDocument.cs` are linked from `Fs.TestApp.Core` as source files (`Fs.TestApp.Core` targets net11.0, so a project reference from net10.0 is impossible), and the schema is the embedded `reports/results.schema.json`. Unknown fields are **refused** (the schema's `additionalProperties: false`), except inside the two free-form places the schema leaves open (`arms[].result`, `webView.extra`), where they are kept and neutralised.

**Extensions to the T0.5 contract** (compatible; the app ignores them): the receipt carries `"at"` (RFC 3339, the first receipt's time); `403 code_used_up` is used for the fourth key rather than `429`, because the app retries 429 twelve times; `Idempotency-Key` must equal `build.apkSha256:runId`, not only `idempotencyKey` (the app always satisfies this, a test drives the real `HttpResultsSender` to prove it).

## 2. Done-when

| Line | Result | Shown by |
|---|---|---|
| tests pass locally against a fake GitHub client | **met**: 132 of 132 passed, 3 s | `cd prototypes/dotnet-b; flock /tmp/firesim-heavy.lock dotnet test --project Fs.Results.Tests -c Release` (toolchain from `env.sh`) |
| existing `FsProto.slnx` still builds | **not met as stated, for a reason that is not mine**: `dotnet build FsProto.slnx -c Release` fails in `Fs.Bench` only (see 4); every other project builds (Analyzers, Kernel, TestApp.Core, TestApp.DryRun, Compare, Tests, Host). My two projects are not in the file and the diff against the base commit touches nothing outside `Fs.Results/` and `Fs.Results.Tests/` | `git diff --stat 0cc17cc HEAD -- . ':!Fs.Results' ':!Fs.Results.Tests'` is empty |

Test inventory (each refusal and the happy path have their own test; `RefusalTests`, `IdempotencyTests`, `IssueTests`, `CodesAndSettingsTests`, `GitHubRestTests`, `StoreContractTests`, `ClientCompatTests`):

- **Oversize:** declared over the cap (not read at all); no Content-Length or a lying one with an endless stream (at most 65,537 bytes consumed); oversize junk is `413` not a JSON error (refused before parsing); a document of exactly 65,536 bytes is accepted, 65,537 is not.
- **Malformed JSON:** 16 kinds (empty, truncated, array, trailing garbage, comments, BOM, invalid and overlong UTF-8, lone surrogate escapes in a value and a name, depth 200, duplicate names).
- **Schema:** 23 breakers (missing, wrong type, range, enum, pattern, unknown field at four levels, too many items, too long).
- **Codes:** unknown, partial, case-changed, padded, missing; expiry on both sides of `notAfter`; three keys accepted and the fourth `403` (with 12 concurrent distinct keys exactly 3 win); each code its own three; wrong round (and it does not use a slot); revoked; malformed settings entries accept nothing; no early exit in the comparison and only 32-byte values compared.
- **Idempotency:** same key returns the first receipt (issue number and time); a different body under the same key too; two identical requests at the same moment (the second waits, one issue, statuses 201 and 200); 40 at once; GitHub failure then retry; 503 for a pending key; takeover after the lease; a hang-up still records the issue; a key under another code.
- **Hostile strings:** 15 hostile strings plus a 20 KB line and a 15 KB mixed line, put one at a time into **every string field** of a document that has every optional field (over 40 paths; the test asserts more than 300 accepted and more than 20 refused, so it cannot pass vacuously): never a `500`; every accepted one checked for title shape, fixed label, ASCII-only body with no `@`, fence longer than any backtick run, nothing outside the fence but the fixed sentence (no `#`, `http`, `www`, `<`, `[`), and the fenced JSON parses back to the document that was sent. Also hostile property names inside the free-form objects, and invalid UTF-16 in every field (always `400`).
- **The real client:** the linked `HttpResultsSender` from `Fs.TestApp.Core` posts to the handler in process: receipt read as `issue 17`, retry gives `Duplicate`, wrong code is `Rejected` (not retried), `502` is `Retry`, and the compactor's largest thinned document is accepted.
- **Mutation check:** with `Neutralise` made a no-op, three hostile tests failed; with the read cap loosened, the while-reading test failed. Both reverted.

## 3. What could not be tested (also in the README)

A live Azure deployment (nothing published, no Azure contact); a live GitHub call (no token exists, none was made; the REST client ran against a stub transport); real Azure Table behaviour (a simulated `TableClient` reproduces 409, 412, 404 and ETags: an assumption written as code); the Functions host itself (the trigger is called with a hand-made `HttpRequest`; `host.json` was not exercised, including the `maxConcurrentRequests` value I put there); the tests ran on the .NET 11 runtime by `RollForward=Major`, not on .NET 10.

Known residual risks: (1) if the process dies after GitHub made the issue and before the row is marked done, a retry after the 2-minute lease makes a second issue (its title carries the same 8-digit run id, so it is recognisable). Closing it needs a search of GitHub by run id before creating, which the search index's lag makes unreliable. (2) No per-address rate limit. (3) Only the connection-string route to storage is supported (`RESULTS_STORAGE_CONNECTION`, or `AzureWebJobsStorage` when it is a connection string); the identity-based `AzureWebJobsStorage__accountName` that the Flex portal flow can create is not (adding `Azure.Identity` clashed with the `Azure.Core` the Tables package pulls in, `CS0433`, and could not be tested anyway). (4) The issue author is whoever owns the token: with a personal token that is the owner, so "only issues authored by the bot account" (plan section 5) cannot be applied; the rule that works is "label `bench-result` and author is the owner", because only users with write access can set labels.

## 4. For the orchestrator

**`FsProto.slnx`:** add these two lines inside `<Solution>`:

```
  <Project Path="Fs.Results/Fs.Results.csproj" />
  <Project Path="Fs.Results.Tests/Fs.Results.Tests.csproj" />
```

Safe? I built and ran a scratch solution holding Analyzers, Kernel and these two: it restores (Azure packages and the net10.0 targeting pack come from nuget.org on first restore, then the NuGet cache), builds with 0 warnings and `dotnet test` passes 132 of 132. Costs: `dotnet test FsProto.slnx` then needs network on a clean machine and a runtime that can host a net10.0 test (the test project rolls forward to .NET 11, so the container works; a CI with only .NET 11 is fine too). `packages.lock.json` files are committed for both projects, so `RestoreLockedMode` in CI works. I did not edit `Directory.Build.props` and needed no workaround for it (lock files and analyzers did not break the projects; they are not solver projects).

**`Fs.Bench` does not build on the base commit `0cc17cc`** (not caused by this card): `Fs.Bench.csproj` references BenchmarkDotNet `0.16.0-preview.2` while `FsMathBench.cs(27)` uses `InProcessEmitToolchain.Instance`, which that version does not have (its comment says 0.15.8). Someone changed one without the other; the T1.3 merge is the likely place. The slnx build is red until that is fixed.

**Plan notes:** section 5 says "Owner setup ... set two secrets (the GitHub token, the upload codes)"; it is four settings (`GITHUB_TOKEN`, `GITHUB_REPO`, `UPLOAD_CODES`, `RESULTS_STORAGE_CONNECTION`), the last two needed because the destination repository is undecided and the idempotency table needs a connection. Section 5's "accepts only issues whose author is the function's bot account" does not hold with a personal token (risk 4).

**Questions for the owner or orchestrator:** (a) which repository receives results (private `firesim-results` or `lorenchorley/FireSim`)? Nothing in the code depends on it. (b) is a personal fine-grained token acceptable, or should it be a GitHub App installation (a code change in `GitHubRestIssues`, about 40 lines for the JWT exchange)?

## 5. Skills

No `dotnet/skills` `SKILL.md` was read or used: the card names none, and `SKILLS.md` maps `dotnet-test/*` to `Fs.Tests` (applied by pattern: MSTest on Microsoft.Testing.Platform, assertion messages, no shared mutable state between tests, and the project file read for the pattern).
