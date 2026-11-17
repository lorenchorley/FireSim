using System.Text;
using FsTestApp;
using FsTestApp.Device;
using FsTestApp.DryRun;
using FsTestApp.Results;
using FsTestApp.Sending;
using FsTestApp.Storage;

namespace Fs.Tests.TestApp;

[TestClass]
public sealed class DeliveryTests
{
    // A sender with a server's memory: one result per key, however many times it is asked. It can lose the answer N times (the result is stored, the
    // client is told to retry), and records the key of every request.
    sealed class DedupingSender : IResultsSender
    {
        public bool IsConfigured => true;
        public int LoseAnswers;
        public Queue<SendResult> Script = new();
        public Dictionary<string, int> Stored = new();
        public List<string> Keys = new();
        public Task<SendResult> SendAsync(string key, byte[] doc, DateTimeOffset now, CancellationToken ct)
        {
            Keys.Add(key);
            if (Script.Count > 0) return Task.FromResult(Script.Dequeue());
            bool added = !Stored.ContainsKey(key);
            if (added) Stored[key] = 17 + Stored.Count;
            if (LoseAnswers > 0) { LoseAnswers--; return Task.FromResult(new SendResult(SendOutcome.Retry, null, "timed out waiting for the answer")); }
            return Task.FromResult(new SendResult(SendOutcome.Sent, added ? 201 : 200, null, new Receipt { Text = "issue " + Stored[key], Issue = Stored[key], AtUtc = now, Duplicate = !added }));
        }
    }

    static (FileResultStore store, ResultDocument doc, string dir) SavedDoc()
    {
        string dir = Path.Combine(Path.GetTempPath(), "fs-delivery-" + Guid.NewGuid().ToString("N"));
        var store = new FileResultStore(dir);
        var doc = TestDocs.Valid();
        store.SaveDocument(doc.RunId, ResultJsonContext.Serialize(doc));
        return (store, doc, dir);
    }

    static ResultsDelivery Delivery(IResultsSender s, IResultStore store, SimulatedDeviceState dev, ManualClock clock)
        => new(s, store, dev, clock, new BackoffPolicy { Jitter = () => 0.5 });

    [TestMethod]
    public async Task RetryAfterALostAnswerDoesNotMakeASecondResult()
    {
        var (store, doc, dir) = SavedDoc();
        try
        {
            var sender = new DedupingSender { LoseAnswers = 1 };
            var clock = new ManualClock();
            var r = await Delivery(sender, store, new SimulatedDeviceState(), clock).SendAsync(doc.RunId, null, CancellationToken.None);
            Assert.AreEqual(DeliveryResult.Delivered, r.Result);
            Assert.AreEqual(2, sender.Keys.Count, "first send (answer lost), then the retry");
            Assert.AreEqual(sender.Keys[0], sender.Keys[1], "same idempotency key on the retry");
            Assert.AreEqual(1, sender.Stored.Count, "one result at the server");
            Assert.IsTrue(r.Receipt!.Duplicate, "the retry was recognised as a duplicate");
            Assert.AreEqual("issue 17", r.Receipt.Text, "and returned the original receipt");
            Assert.AreEqual(1, clock.Delays.Count, "one back-off wait between the two sends");
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public async Task SendNowAfterDeliveryDoesNotSendAgain()
    {
        var (store, doc, dir) = SavedDoc();
        try
        {
            var sender = new DedupingSender();
            var d = Delivery(sender, store, new SimulatedDeviceState(), new ManualClock());
            await d.SendAsync(doc.RunId, null, CancellationToken.None);
            var again = await d.SendAsync(doc.RunId, null, CancellationToken.None);
            Assert.AreEqual(DeliveryResult.AlreadyDelivered, again.Result);
            Assert.AreEqual(1, sender.Keys.Count, "no second request once a receipt is saved");
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public async Task BackoffGrowsAndIsCappedAndGivesUpAfterTheLimit()
    {
        var (store, doc, dir) = SavedDoc();
        try
        {
            var sender = new DedupingSender();
            for (int i = 0; i < 20; i++) sender.Script.Enqueue(new SendResult(SendOutcome.Retry, 503, "server asked to try again later"));
            var clock = new ManualClock();
            var r = await Delivery(sender, store, new SimulatedDeviceState(), clock).SendAsync(doc.RunId, null, CancellationToken.None);
            Assert.AreEqual(DeliveryResult.GaveUp, r.Result);
            Assert.AreEqual(12, sender.Keys.Count);
            Assert.AreEqual(11, clock.Delays.Count);
            Assert.AreEqual(2, clock.Delays[0].TotalSeconds, 0.01);
            Assert.AreEqual(4, clock.Delays[1].TotalSeconds, 0.01);
            Assert.AreEqual(8, clock.Delays[2].TotalSeconds, 0.01);
            Assert.IsTrue(clock.Delays.All(d => d <= TimeSpan.FromMinutes(5) * 1.25));
            Assert.AreEqual(300, clock.Delays[^1].TotalSeconds, 0.01, "capped at five minutes");
            Assert.AreEqual(12, store.LoadState(doc.RunId).Attempts.Count, "every attempt is on record");
            Assert.IsNotNull(store.LoadDocumentJson(doc.RunId), "the document is still saved after giving up");
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public void JitterStaysWithinAQuarterEitherSide()
    {
        foreach (double j in new[] { 0.0, 0.5, 0.999 })
        {
            var d = new BackoffPolicy { Jitter = () => j }.DelayFor(3).TotalSeconds;
            Assert.IsTrue(d >= 6 - 0.001 && d <= 10 + 0.001, $"{d}");
        }
    }

    [TestMethod]
    public async Task RejectedIsNotRetried()
    {
        var (store, doc, dir) = SavedDoc();
        try
        {
            var sender = new DedupingSender();
            sender.Script.Enqueue(new SendResult(SendOutcome.Rejected, 400, "schema"));
            var r = await Delivery(sender, store, new SimulatedDeviceState(), new ManualClock()).SendAsync(doc.RunId, null, CancellationToken.None);
            Assert.AreEqual(DeliveryResult.Rejected, r.Result);
            Assert.AreEqual(1, sender.Keys.Count);
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public async Task NoNetworkWaitsWithoutSpendingAttemptsThenSends()
    {
        var (store, doc, dir) = SavedDoc();
        try
        {
            var sender = new DedupingSender();
            var device = new SimulatedDeviceState();
            device.Set(s => s with { NetworkReachable = false });
            var clock = new ManualClock();
            int waits = 0;
            clock.OnDelay = _ => { if (++waits == 3) device.SetNetwork(true); };
            var status = new List<DeliveryStatus>();
            var r = await Delivery(sender, store, device, clock).SendAsync(doc.RunId, status.Add, CancellationToken.None);
            Assert.AreEqual(DeliveryResult.Delivered, r.Result);
            Assert.AreEqual(1, sender.Keys.Count, "no send while offline");
            Assert.IsTrue(status.Any(s => s.WaitingForNetwork && s.Text == "Turn the network back on to send the results."));
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public async Task NotConfiguredBuildDoesNotTryToSend()
    {
        var (store, doc, dir) = SavedDoc();
        try
        {
            var sender = new HttpResultsSender(new ResultsConfig(), new HttpClient());
            var r = await Delivery(sender, store, new SimulatedDeviceState(), new ManualClock()).SendAsync(doc.RunId, null, CancellationToken.None);
            Assert.AreEqual(DeliveryResult.NotConfigured, r.Result);
            Assert.AreEqual(0, r.Attempts);
        }
        finally { Directory.Delete(dir, true); }
    }

    [TestMethod]
    public async Task SendingRequiresASavedDocument()
    {
        string dir = Path.Combine(Path.GetTempPath(), "fs-delivery-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new FileResultStore(dir);
            await Assert.ThrowsAsync<InvalidOperationException>(async () =>
                await Delivery(new DedupingSender(), store, new SimulatedDeviceState(), new ManualClock()).SendAsync("0123456789abcdef0123456789abcdef", null, CancellationToken.None));
        }
        finally { Directory.Delete(dir, true); }
    }

    // ---- the real HTTP client against the in-process endpoint ----

    [TestMethod]
    public async Task HttpSenderSendsKeyAndCodeAndReadsTheReceipt()
    {
        using var ep = new LocalEndpoint("code-123");
        using var http = new HttpClient();
        var sender = new HttpResultsSender(new ResultsConfig(ep.Url, "code-123", "o/r"), http, TimeSpan.FromSeconds(5));
        var doc = TestDocs.Valid();
        var bytes = ResultJsonContext.SerializeToUtf8(doc);
        var r = await sender.SendAsync(doc.IdempotencyKey, bytes, DateTimeOffset.UtcNow, CancellationToken.None);
        Assert.AreEqual(SendOutcome.Sent, r.Outcome);
        Assert.AreEqual(201, r.HttpStatus);
        Assert.AreEqual("issue 17", r.Receipt!.Text);
        Assert.IsFalse(r.Receipt.Duplicate);
        var r2 = await sender.SendAsync(doc.IdempotencyKey, bytes, DateTimeOffset.UtcNow, CancellationToken.None);
        Assert.AreEqual(SendOutcome.Sent, r2.Outcome);
        Assert.IsTrue(r2.Receipt!.Duplicate, "same key again: the endpoint says duplicate, with the same issue");
        Assert.AreEqual(17, r2.Receipt.Issue);
        Assert.AreEqual(1, ep.Stored.Count);
    }

    [TestMethod]
    public async Task HttpSenderMapsStatusesToRetryOrRejected()
    {
        using var ep = new LocalEndpoint("code-123");
        using var http = new HttpClient();
        var doc = TestDocs.Valid();
        var bytes = ResultJsonContext.SerializeToUtf8(doc);
        SendResult Send(string code) => new HttpResultsSender(new ResultsConfig(ep.Url, code, ""), http, TimeSpan.FromSeconds(5)).SendAsync(doc.IdempotencyKey, bytes, DateTimeOffset.UtcNow, CancellationToken.None).GetAwaiter().GetResult();

        ep.Script = _ => EndpointBehavior.ServerError;
        Assert.AreEqual(SendOutcome.Retry, Send("code-123").Outcome);
        ep.Script = _ => EndpointBehavior.TooManyRequests;
        Assert.AreEqual(SendOutcome.Retry, Send("code-123").Outcome);
        ep.Script = _ => EndpointBehavior.Accept;
        var bad = Send("not-the-code");
        Assert.AreEqual(SendOutcome.Rejected, bad.Outcome);
        Assert.AreEqual(401, bad.HttpStatus);
        Assert.IsFalse((bad.Detail ?? "").Contains("not-the-code"), "the code is never echoed");

        var tooBig = new HttpResultsSender(new ResultsConfig(ep.Url, "code-123", ""), http).SendAsync(doc.IdempotencyKey, new byte[ResultDocument.MaxPostBytes + 1], DateTimeOffset.UtcNow, CancellationToken.None).GetAwaiter().GetResult();
        Assert.AreEqual(SendOutcome.Rejected, tooBig.Outcome, "over 64 KB is refused before the network");
    }

    [TestMethod]
    public async Task HttpSenderTreatsConnectionFailureAndTimeoutAsRetry()
    {
        using var http = new HttpClient();
        var doc = TestDocs.Valid();
        var bytes = ResultJsonContext.SerializeToUtf8(doc);
        // nothing listens on this port (a listener was started and closed to find it)
        string url;
        using (var ep = new LocalEndpoint("c")) url = ep.Url;
        var r = await new HttpResultsSender(new ResultsConfig(url, "c", ""), http, TimeSpan.FromSeconds(3)).SendAsync(doc.IdempotencyKey, bytes, DateTimeOffset.UtcNow, CancellationToken.None);
        Assert.AreEqual(SendOutcome.Retry, r.Outcome);

        using var slow = new LocalEndpoint("c") { StoreThenDropSilence = TimeSpan.FromSeconds(2) };
        slow.Script = _ => EndpointBehavior.StoreThenDrop;
        var t = await new HttpResultsSender(new ResultsConfig(slow.Url, "c", ""), http, TimeSpan.FromMilliseconds(300)).SendAsync(doc.IdempotencyKey, bytes, DateTimeOffset.UtcNow, CancellationToken.None);
        Assert.AreEqual(SendOutcome.Retry, t.Outcome, "a timeout is a lost answer: retry");
        Assert.AreEqual(1, slow.Stored.Count, "and the result did arrive: exactly the case the idempotency key is for");
    }

    [TestMethod]
    public void PlainHttpIsOnlyAllowedToLoopback()
    {
        Assert.IsTrue(HttpResultsSender.EndpointAllowed("https://example.org/results"));
        Assert.IsTrue(HttpResultsSender.EndpointAllowed("http://127.0.0.1:8080/results"));
        Assert.IsFalse(HttpResultsSender.EndpointAllowed("http://example.org/results"), "an upload code must not travel in clear text");
        Assert.IsFalse(HttpResultsSender.EndpointAllowed("ftp://example.org/"));
        Assert.IsFalse(HttpResultsSender.EndpointAllowed("not a url"));
    }

    [TestMethod]
    public void OversizeDocumentIsThinnedToTheLimitWithoutTouchingTheSavedOne()
    {
        var doc = TestDocs.Valid(arms: 2, samples: 0);
        for (int i = 0; i < 3000; i++)
        {
            doc.Logs.Thermal.Add(new ThermalSample { TMs = i * 10_000.0, Status = "none", Headroom = 0.123456789 });
            doc.Logs.Battery.Add(new BatterySample { TMs = i * 10_000.0, Percent = 80, Charging = false, ChargeCounterUah = 3_000_000 - i, PowerSaver = false });
        }
        string json = ResultJsonContext.Serialize(doc);
        Assert.IsTrue(Encoding.UTF8.GetByteCount(json) > ResultDocument.MaxPostBytes, "test document is over the limit");
        var sent = ResultCompactor.FitForPost(json);
        Assert.IsTrue(sent.Length <= ResultDocument.MaxPostBytes);
        var copy = ResultJsonContext.Deserialize(sent)!;
        Assert.AreEqual(doc.IdempotencyKey, copy.IdempotencyKey, "same key, same run");
        Assert.IsTrue(copy.Errors.Any(e => e.Where == "send" && e.Message.Contains("shrunk")), "the thinning is on record in the copy");
        Assert.AreEqual(0, ResultValidator.Validate(Encoding.UTF8.GetString(sent)).Count, "the thinned copy still validates");
        Assert.AreEqual(3000, doc.Logs.Thermal.Count, "the original is unchanged");
    }
}
