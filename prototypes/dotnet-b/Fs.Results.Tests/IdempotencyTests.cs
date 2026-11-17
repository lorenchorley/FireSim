using System.Text;
using System.Text.Json.Nodes;
using FsResults;

namespace Fs.Results.Tests;

/// <summary>The happy path against the fake GitHub client, then one result per key: the first receipt comes back every time, including for requests that arrive together.</summary>
[TestClass]
public sealed class IdempotencyTests
{
    static JsonObject Json(HandlerResponse r) => (JsonObject)JsonNode.Parse(r.Json)!;

    [TestMethod]
    public async Task Happy_path_makes_one_issue_and_answers_with_the_receipt()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var r = await h.PostDocAsync(doc);

        Assert.AreEqual(201, r.Status, r.Json);
        var receipt = Json(r);
        Assert.AreEqual(17, receipt["issue"]!.GetValue<int>());
        Assert.AreEqual("https://github.com/" + Harness.Repo + "/issues/17", receipt["url"]!.GetValue<string>());
        Assert.IsFalse(receipt["duplicate"]!.GetValue<bool>());
        Assert.AreEqual("2026-11-16T13:00:00Z", receipt["at"]!.GetValue<string>(), "the time is the server's clock at the moment the issue was recorded");

        Assert.HasCount(1, h.GitHub.Calls);
        var call = h.GitHub.Calls[0];
        CollectionAssert.AreEqual(new[] { "bench-result" }, call.Labels.ToArray());
        StringAssert.StartsWith(call.Title, "Round 0 result: Phone 1 (0000");
        var row = h.Store.Rows().Single();
        Assert.AreEqual(EntryState.Done, row.State);
        Assert.AreEqual(17, row.Issue);
    }

    [TestMethod]
    public async Task The_same_key_again_returns_the_first_receipt_and_never_a_second_issue()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var first = await h.PostDocAsync(doc);
        h.Time.Advance(TimeSpan.FromMinutes(30));
        var second = await h.PostDocAsync(doc);
        var third = await h.PostDocAsync(doc);

        Assert.AreEqual(201, first.Status);
        Assert.AreEqual(200, second.Status);
        Assert.AreEqual(200, third.Status);
        Assert.AreEqual(Json(first)["issue"]!.GetValue<int>(), Json(second)["issue"]!.GetValue<int>());
        Assert.AreEqual(Json(first)["issue"]!.GetValue<int>(), Json(third)["issue"]!.GetValue<int>());
        Assert.IsTrue(Json(second)["duplicate"]!.GetValue<bool>());
        Assert.AreEqual(Json(first)["at"]!.GetValue<string>(), Json(second)["at"]!.GetValue<string>(), "the receipt is the first one, time included");
        Assert.HasCount(1, h.GitHub.Calls);
        Assert.AreEqual(1, h.Store.RowCount);
    }

    [TestMethod]
    public async Task The_same_key_with_a_different_body_still_gets_the_first_receipt()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var first = await h.PostDocAsync(doc);
        doc["status"] = "partial";
        var second = await h.PostDocAsync(doc);
        Assert.AreEqual(200, second.Status);
        Assert.AreEqual(Json(first)["issue"]!.GetValue<int>(), Json(second)["issue"]!.GetValue<int>());
        Assert.HasCount(1, h.GitHub.Calls);
    }

    [TestMethod]
    public async Task Different_keys_get_different_issues()
    {
        var h = new Harness();
        var a = Json(await h.PostDocAsync(Harness.DocN(1)));
        var b = Json(await h.PostDocAsync(Harness.DocN(2)));
        Assert.AreEqual(17, a["issue"]!.GetValue<int>());
        Assert.AreEqual(18, b["issue"]!.GetValue<int>());
    }

    [TestMethod]
    public async Task Two_identical_requests_at_the_same_moment_make_one_issue()
    {
        var h = new Harness();
        var gate = new TaskCompletionSource();
        h.GitHub.Gate = gate.Task;                       // the first request is held inside GitHub...
        var doc = Harness.DocN(1);
        var t1 = Task.Run(() => h.PostDocAsync(doc));
        await h.GitHub.Started.WaitAsync(TimeSpan.FromSeconds(10));
        var t2 = Task.Run(() => h.PostDocAsync(doc));    // ...while the second finds the key pending
        await Task.Delay(150);
        Assert.IsFalse(t2.IsCompleted, "the second request waits for the first instead of making an issue of its own");
        gate.SetResult();
        var r = await Task.WhenAll(t1, t2);

        Assert.HasCount(1, h.GitHub.Calls);
        CollectionAssert.AreEquivalent(new[] { 200, 201 }, r.Select(x => x.Status).ToArray());
        Assert.AreEqual(Json(r[0])["issue"]!.GetValue<int>(), Json(r[1])["issue"]!.GetValue<int>());
        Assert.AreEqual(1, r.Count(x => !Json(x)["duplicate"]!.GetValue<bool>()), "exactly one answer is the original");
    }

    [TestMethod]
    public async Task Many_identical_requests_at_once_make_one_issue()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var bodies = Enumerable.Range(0, 40).Select(_ => Task.Run(() => h.PostDocAsync(doc))).ToArray();
        var rs = await Task.WhenAll(bodies);
        Assert.HasCount(1, h.GitHub.Calls);
        Assert.AreEqual(1, rs.Count(r => r.Status == 201));
        Assert.AreEqual(39, rs.Count(r => r.Status == 200));
        Assert.AreEqual(1, rs.Select(r => Json(r)["issue"]!.GetValue<int>()).Distinct().Count());
    }

    [TestMethod]
    public async Task Concurrent_distinct_keys_on_one_code_never_exceed_three()
    {
        var h = new Harness();
        var rs = await Task.WhenAll(Enumerable.Range(1, 12).Select(n => Task.Run(() => h.PostDocAsync(Harness.DocN(n)))));
        Assert.AreEqual(3, rs.Count(r => r.Status == 201), string.Join(",", rs.Select(r => r.Status)));
        Assert.AreEqual(9, rs.Count(r => r.Status == 403 && r.Json == "{\"error\":\"code_used_up\"}"));
        Assert.HasCount(3, h.GitHub.Calls);
        Assert.AreEqual(3, h.Store.RowCount);
    }

    // ---- failures between the claim and the receipt ----

    [TestMethod]
    public async Task When_GitHub_fails_the_answer_is_502_and_a_retry_with_the_same_key_makes_the_issue()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        h.GitHub.FailTheNext(1);
        var failed = await h.PostDocAsync(doc);
        Assert.AreEqual(502, failed.Status);
        Assert.AreEqual("{\"error\":\"github_failed\"}", failed.Json);
        Assert.AreEqual(0, h.Store.RowCount, "the pending row is withdrawn so a retry can start again");

        var retry = await h.PostDocAsync(doc);
        Assert.AreEqual(201, retry.Status, retry.Json);
        Assert.HasCount(1, h.GitHub.Calls);

        // the failed attempt did not use up a second slot: two more keys fit, a fourth does not
        Assert.AreEqual(201, (await h.PostDocAsync(Harness.DocN(2))).Status);
        Assert.AreEqual(201, (await h.PostDocAsync(Harness.DocN(3))).Status);
        Assert.AreEqual(403, (await h.PostDocAsync(Harness.DocN(4))).Status);
    }

    [TestMethod]
    public async Task A_request_that_finds_the_key_pending_for_too_long_answers_503_so_the_phone_retries()
    {
        var h = new Harness(pendingWait: TimeSpan.FromMilliseconds(200));
        var doc = Harness.DocN(1);
        var gate = new TaskCompletionSource();
        h.GitHub.Gate = gate.Task;
        var owner = Task.Run(() => h.PostDocAsync(doc));
        await h.GitHub.Started.WaitAsync(TimeSpan.FromSeconds(10));
        var waiter = await h.PostDocAsync(doc);
        Assert.AreEqual(503, waiter.Status);
        Assert.AreEqual("{\"error\":\"busy\"}", waiter.Json);
        gate.SetResult();
        Assert.AreEqual(201, (await owner).Status);
        Assert.HasCount(1, h.GitHub.Calls);
    }

    [TestMethod]
    public async Task A_pending_row_whose_owner_vanished_is_taken_over_after_its_lease()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        string keyHash = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(Harness.KeyOf(doc))));
        var code = h.Settings.Codes[0];
        Assert.IsTrue(await h.Store.TryReserveSlotAsync(code.CodeId, keyHash, 3, default));
        var stale = await h.Store.TryInsertPendingAsync(keyHash, code.CodeId, h.Time.GetUtcNow(), h.Time.GetUtcNow() + TimeSpan.FromMinutes(2), default);
        Assert.IsNotNull(stale);

        // within the lease: not taken over
        Assert.AreEqual(503, (await WithStore(h, pendingWait: TimeSpan.FromMilliseconds(100)).PostDocAsync(doc)).Status);
        Assert.HasCount(0, h.GitHub.Calls);

        // after the lease: the request takes the work over and makes the one issue
        h.Time.Advance(TimeSpan.FromMinutes(3));
        var r = await h.PostDocAsync(doc);
        Assert.AreEqual(201, r.Status, r.Json);
        Assert.HasCount(1, h.GitHub.Calls);
        Assert.AreEqual(EntryState.Done, (await h.Store.GetAsync(keyHash, default))!.State);
    }

    static Harness WithStore(Harness h, TimeSpan pendingWait)
    {
        h.Settings = new ResultsSettings { Codes = h.Settings.Codes, Repo = h.Settings.Repo, PendingWait = pendingWait };
        return h;
    }

    [TestMethod]
    public async Task A_phone_that_hangs_up_mid_request_still_has_its_issue_recorded()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var gate = new TaskCompletionSource();
        h.GitHub.Gate = gate.Task;
        using var cts = new CancellationTokenSource();
        var t = Task.Run(() => h.PostDocAsync(doc, ct: cts.Token));
        await h.GitHub.Started.WaitAsync(TimeSpan.FromSeconds(10));
        cts.Cancel();                                    // the connection drops while GitHub is working
        gate.SetResult();
        var r = await t;
        Assert.AreEqual(201, r.Status, r.Json);

        h.GitHub.Gate = null;
        var retry = await h.PostDocAsync(doc);
        Assert.AreEqual(200, retry.Status);
        Assert.HasCount(1, h.GitHub.Calls, "the retry finds the recorded receipt");
    }

    [TestMethod]
    public async Task A_key_that_belongs_to_another_code_is_refused()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        Assert.AreEqual(201, (await h.PostDocAsync(doc)).Status);
        string other = "code" + Guid.NewGuid().ToString("N");
        h.Settings = new ResultsSettings { Repo = Harness.Repo, Codes = new[] { new UploadCodeEntry(other, 0, Harness.Build.AddDays(14)) }, PendingWait = TimeSpan.FromSeconds(1) };
        var r = await h.PostDocAsync(doc, code: other);
        Assert.AreEqual(403, r.Status);
        Assert.AreEqual("{\"error\":\"key_in_use\"}", r.Json);
    }
}
