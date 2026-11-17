using System.Text;
using System.Text.Json.Nodes;
using FsResults;
using FsTestApp.Results;

namespace Fs.Results.Tests;

/// <summary>Every refusal the endpoint has, with its status and its fixed body, and the proof that nothing was stored and GitHub was not called.</summary>
[TestClass]
public sealed class RefusalTests
{
    static void AssertRefused(Harness h, HandlerResponse r, int status, string error)
    {
        Assert.AreEqual(status, r.Status, r.Json);
        Assert.AreEqual("{\"error\":\"" + error + "\"}", r.Json);
        Assert.HasCount(0, h.GitHub.Calls, "a refused request must not reach GitHub");
    }

    static void AssertNothingStored(Harness h) => Assert.AreEqual(0, h.Store.RowCount, "a refused request must not leave a row");

    // ---- 1. method, size ----

    [TestMethod]
    [DataRow("GET")]
    [DataRow("PUT")]
    [DataRow("DELETE")]
    [DataRow("post")]
    public async Task Only_POST_is_accepted(string method)
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), Harness.KeyOf(doc), method: method);
        AssertRefused(h, r, 405, "method_not_allowed");
        AssertNothingStored(h);
    }

    [TestMethod]
    public async Task Body_over_the_cap_by_content_length_is_refused_without_reading()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var body = new CountingStream(new MemoryStream(Encoding.UTF8.GetBytes(doc.ToJsonString())));
        var r = await h.PostAsync(body, Harness.KeyOf(doc), contentLength: ResultDocument.MaxPostBytes + 1);
        AssertRefused(h, r, 413, "too_large");
        Assert.AreEqual(0, body.BytesRead, "a declared oversize body is not read at all");
    }

    [TestMethod]
    public async Task Body_over_the_cap_is_cut_off_while_reading_when_content_length_is_absent_or_lies()
    {
        var h = new Harness();
        var key = Harness.KeyOf(Harness.DocN(1));
        foreach (long? declared in new long?[] { null, 10 })
        {
            var endless = new CountingStream(new EndlessStream((byte)' '));
            var r = await h.PostAsync(endless, key, contentLength: declared);
            AssertRefused(h, r, 413, "too_large");
            Assert.IsLessThanOrEqualTo(ResultDocument.MaxPostBytes + 1, endless.BytesRead, "no more than cap+1 bytes may be taken from the connection");
        }
        AssertNothingStored(h);
    }

    [TestMethod]
    public async Task Oversize_is_refused_before_parsing_so_it_is_413_not_a_JSON_error()
    {
        var h = new Harness();
        var junk = new string('{', ResultDocument.MaxPostBytes + 10);   // not JSON at all, and over the cap
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(junk), Harness.KeyOf(Harness.DocN(1)));
        AssertRefused(h, r, 413, "too_large");
    }

    [TestMethod]
    public async Task A_document_of_exactly_the_cap_is_accepted_and_one_byte_more_is_not()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        doc["arms"]![0]!["result"] = new JsonObject { ["pad"] = "" };
        byte[] Make(int padChars) { doc["arms"]![0]!["result"]!["pad"] = new string('x', padChars); return Encoding.UTF8.GetBytes(doc.ToJsonString()); }
        int baseLen = Make(0).Length;
        var exact = Make(ResultDocument.MaxPostBytes - baseLen);
        Assert.AreEqual(ResultDocument.MaxPostBytes, exact.Length);
        var ok = await h.PostAsync(exact, Harness.KeyOf(doc));
        Assert.AreEqual(201, ok.Status, ok.Json);

        var doc2 = Harness.DocN(2);
        doc2["arms"]![0]!["result"] = new JsonObject { ["pad"] = new string('x', ResultDocument.MaxPostBytes - baseLen + 1) };
        var over = Encoding.UTF8.GetBytes(doc2.ToJsonString());
        Assert.AreEqual(ResultDocument.MaxPostBytes + 1, over.Length);
        var r = await h.PostAsync(over, Harness.KeyOf(doc2));
        Assert.AreEqual(413, r.Status);
        Assert.HasCount(1, h.GitHub.Calls);
    }

    // ---- request shape ----

    [TestMethod]
    [DataRow("text/plain")]
    [DataRow("application/json; charset=utf-16")]
    [DataRow("application/xml")]
    [DataRow(null)]
    public async Task Content_type_must_be_json(string? contentType)
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), Harness.KeyOf(doc), contentType: contentType);
        AssertRefused(h, r, 415, "unsupported_media_type");
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("not-a-key")]
    [DataRow("bbbb:0123456789abcdef0123456789abcdef")]
    [DataRow("`@org/team #1")]
    public async Task Idempotency_key_header_must_have_the_documented_shape(string? key)
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), key);
        AssertRefused(h, r, 400, "bad_key");
    }

    [TestMethod]
    public async Task Idempotency_key_header_must_equal_the_documents_key()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        var other = Harness.KeyOf(Harness.DocN(2));
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), other);
        AssertRefused(h, r, 400, "key_mismatch");
        AssertNothingStored(h);
    }

    [TestMethod]
    public async Task Documents_key_must_be_the_apk_hash_and_run_id_it_claims()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        // a key that is well-formed and matches the header, but is not build.apkSha256 + ":" + runId
        doc["idempotencyKey"] = new string('c', 64) + ":" + doc["runId"]!.GetValue<string>();
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), Harness.KeyOf(doc));
        AssertRefused(h, r, 400, "key_mismatch");
    }

    // ---- 2. malformed JSON and schema ----

    static readonly (string Name, byte[] Body)[] MalformedBodies =
    {
        ("empty", Array.Empty<byte>()),
        ("not json", Encoding.UTF8.GetBytes("this is not json")),
        ("truncated", Encoding.UTF8.GetBytes("{\"schemaVersion\":1,\"kind\":")),
        ("array", Encoding.UTF8.GetBytes("[]")),
        ("string", Encoding.UTF8.GetBytes("\"x\"")),
        ("null", Encoding.UTF8.GetBytes("null")),
        ("trailing garbage", Encoding.UTF8.GetBytes("{} {}")),
        ("trailing comma", Encoding.UTF8.GetBytes("{\"a\":1,}")),
        ("comment", Encoding.UTF8.GetBytes("{/*c*/}")),
        ("byte order mark", new byte[] { 0xEF, 0xBB, 0xBF, (byte)'{', (byte)'}' }),
        ("invalid UTF-8", new byte[] { (byte)'{', (byte)'"', 0xC3, 0x28, (byte)'"', (byte)':', (byte)'1', (byte)'}' }),
        ("overlong UTF-8", new byte[] { (byte)'"', 0xC0, 0xAF, (byte)'"' }),
        ("lone high surrogate escape", Encoding.UTF8.GetBytes("{\"a\":\"\\ud800\"}")),
        ("lone low surrogate escape", Encoding.UTF8.GetBytes("{\"a\":\"\\udc00\"}")),
        ("lone surrogate in a property name", Encoding.UTF8.GetBytes("{\"\\ud800\":1}")),
        ("deep nesting", Encoding.UTF8.GetBytes(new string('[', 200) + new string(']', 200))),
    };

    [TestMethod]
    public async Task Malformed_JSON_is_refused_with_a_fixed_body()
    {
        var h = new Harness();
        var key = Harness.KeyOf(Harness.DocN(1));
        foreach (var (name, body) in MalformedBodies)
        {
            var r = await h.PostAsync(body, key);
            Assert.AreEqual(400, r.Status, name + ": " + r.Json);
            Assert.IsTrue(r.Json is "{\"error\":\"bad_json\"}" or "{\"error\":\"bad_schema\"}", name + ": " + r.Json);
        }
        Assert.HasCount(0, h.GitHub.Calls);
        AssertNothingStored(h);
    }

    [TestMethod]
    public async Task Invalid_UTF16_in_any_client_field_is_refused_not_repaired()
    {
        var h = new Harness();
        foreach (string[] path in Harness.StringLeafPaths(Harness.RichDoc()))
        {
            var doc = Harness.RichDoc();
            const string marker = "MARKER-for-lone-surrogate";
            Harness.SetAt(doc, path, marker);
            string text = doc.ToJsonString().Replace(marker, "a\\ud800b", StringComparison.Ordinal);
            var r = await h.PostAsync(Encoding.UTF8.GetBytes(text), Harness.KeyOf(doc));
            Assert.AreEqual(400, r.Status, string.Join("/", path) + ": " + r.Json);
            Assert.IsTrue(r.Json is "{\"error\":\"bad_json\"}" or "{\"error\":\"bad_schema\"}" or "{\"error\":\"key_mismatch\"}" or "{\"error\":\"bad_key\"}", string.Join("/", path) + ": " + r.Json);
        }
        Assert.HasCount(0, h.GitHub.Calls);
        AssertNothingStored(h);
    }

    [TestMethod]
    public async Task Duplicate_property_names_are_refused()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        string text = doc.ToJsonString();
        text = text.Insert(text.Length - 1, ",\"round\":5");   // a second "round"
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(text), Harness.KeyOf(doc));
        AssertRefused(h, r, 400, "bad_json");
    }

    static IEnumerable<(string Name, Action<JsonObject> Break)> SchemaBreakers() => new (string, Action<JsonObject>)[]
    {
        ("missing required status", d => d.Remove("status")),
        ("missing required device", d => d.Remove("device")),
        ("wrong kind", d => d["kind"] = "something-else"),
        ("wrong schema version", d => d["schemaVersion"] = 2),
        ("round is a string", d => d["round"] = "0"),
        ("round out of range", d => d["round"] = 100),
        ("negative round", d => d["round"] = -1),
        ("fractional round", d => d["round"] = 0.5),
        ("run id is not hex", d => d["runId"] = new string('z', 32)),
        ("status not in the enum", d => d["status"] = "great"),
        ("unknown field at the root", d => d["extra"] = "x"),
        ("unknown field in build", d => d["build"]!["extra"] = 1),
        ("unknown field in device", d => d["device"]!["imei"] = "123"),
        ("unknown field in a block", d => d["blocks"]![0]!["extra"] = 1),
        ("unknown field in an arm", d => d["arms"]![0]!["extra"] = 1),
        ("arm runtime not in the enum", d => d["arms"]![0]!["runtime"] = "unknown-runtime"),
        ("arm name with a space", d => d["arms"]![0]!["name"] = "has space"),
        ("arms is an object", d => d["arms"] = new JsonObject()),
        ("too many errors", d => d["errors"] = new JsonArray(Enumerable.Range(0, 201).Select(i => (JsonNode?)new JsonObject { ["tMs"] = 0, ["where"] = "w", ["message"] = "m" }).ToArray())),
        ("string too long", d => d["device"]!["model"] = new string('m', 129)),
        ("date is not RFC 3339", d => d["startedUtc"] = "yesterday"),
        ("apk hash wrong length", d => d["build"]!["apkSha256"] = "abc"),
        ("cores zero", d => d["device"]!["cores"] = 0),
    };

    [TestMethod]
    public async Task Schema_violations_are_refused_with_a_fixed_body()
    {
        var h = new Harness();
        foreach (var (name, brk) in SchemaBreakers())
        {
            var doc = Harness.DocN(1);
            brk(doc);
            // keep the header equal to the (possibly broken) document key so the schema, not the key check, is what refuses
            string key = doc["idempotencyKey"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : Harness.KeyOf(Harness.DocN(1));
            var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), key);
            Assert.AreEqual(400, r.Status, name + ": " + r.Json);
            Assert.AreEqual("{\"error\":\"bad_schema\"}", r.Json, name);
        }
        Assert.HasCount(0, h.GitHub.Calls);
        AssertNothingStored(h);
    }

    [TestMethod]
    public async Task The_refusal_body_never_echoes_what_the_client_sent()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        doc["unknown-hostile-`@org/team-#1"] = "https://evil.example/x";
        var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), Harness.KeyOf(doc));
        Assert.AreEqual("{\"error\":\"bad_schema\"}", r.Json);
    }

    // ---- 3. upload codes ----

    [TestMethod]
    public async Task Unknown_missing_or_partial_codes_are_401()
    {
        var h = new Harness();
        var doc = Harness.DocN(1);
        foreach (string? code in new string?[] { null, "wrong", h.Code[..^1], h.Code + "x", h.Code.ToUpperInvariant(), " " + h.Code })
        {
            var r = await h.PostAsync(Encoding.UTF8.GetBytes(doc.ToJsonString()), Harness.KeyOf(doc), code: code ?? "wrong");
            AssertRefused(h, r, 401, "bad_code");
        }
        // an empty or absent header
        var none = await h.Handler.HandleAsync(new HandlerRequest("POST", "application/json", 10, null, Harness.KeyOf(doc), new MemoryStream(new byte[10])), default);
        AssertRefused(h, none, 401, "bad_code");
        AssertNothingStored(h);
    }

    [TestMethod]
    public async Task A_code_is_refused_after_its_not_after_time_and_accepted_up_to_it()
    {
        var h = new Harness();
        h.Time.Set(Harness.Build.AddDays(14).AddSeconds(-1));
        var ok = await h.PostDocAsync(Harness.DocN(1));
        Assert.AreEqual(201, ok.Status, ok.Json);

        h.Time.Set(Harness.Build.AddDays(14).AddSeconds(1));
        var r = await h.PostDocAsync(Harness.DocN(2));
        AssertRefusedKeepingCalls(h, r, 403, "expired_code", expectedCalls: 1);
        Assert.AreEqual(1, h.Store.RowCount);
    }

    static void AssertRefusedKeepingCalls(Harness h, HandlerResponse r, int status, string error, int expectedCalls)
    {
        Assert.AreEqual(status, r.Status, r.Json);
        Assert.AreEqual("{\"error\":\"" + error + "\"}", r.Json);
        Assert.HasCount(expectedCalls, h.GitHub.Calls);
    }

    [TestMethod]
    public async Task A_code_serves_three_distinct_keys_and_refuses_the_fourth()
    {
        var h = new Harness();
        for (int n = 1; n <= 3; n++)
        {
            var ok = await h.PostDocAsync(Harness.DocN(n));
            Assert.AreEqual(201, ok.Status, ok.Json);
        }
        var fourth = await h.PostDocAsync(Harness.DocN(4));
        AssertRefusedKeepingCalls(h, fourth, 403, "code_used_up", expectedCalls: 3);
        Assert.AreEqual(3, h.Store.RowCount, "the refused fourth key leaves no row");

        // the first three keys still get their receipts (a retry after a lost answer is not a new key)
        var again = await h.PostDocAsync(Harness.DocN(2));
        Assert.AreEqual(200, again.Status);
        Assert.Contains("\"duplicate\":true", again.Json);
        Assert.HasCount(3, h.GitHub.Calls);
    }

    [TestMethod]
    public async Task Each_code_has_its_own_three_keys()
    {
        var h = new Harness();
        string second = "code" + Guid.NewGuid().ToString("N");
        h.Settings = new ResultsSettings
        {
            Repo = Harness.Repo,
            Codes = h.Settings.Codes.Append(new UploadCodeEntry(second, 0, Harness.Build.AddDays(14))).ToArray(),
            PendingWait = TimeSpan.FromSeconds(5),
        };
        for (int n = 1; n <= 3; n++) Assert.AreEqual(201, (await h.PostDocAsync(Harness.DocN(n))).Status);
        Assert.AreEqual(403, (await h.PostDocAsync(Harness.DocN(4))).Status);
        for (int n = 5; n <= 7; n++) Assert.AreEqual(201, (await h.PostDocAsync(Harness.DocN(n), code: second)).Status);
        Assert.AreEqual(403, (await h.PostDocAsync(Harness.DocN(8), code: second)).Status);
    }

    [TestMethod]
    public async Task A_code_for_one_round_is_refused_for_another()
    {
        var h = new Harness(codeRound: 1);
        var r = await h.PostDocAsync(Harness.DocN(1, round: 0));
        AssertRefused(h, r, 403, "wrong_round");
        AssertNothingStored(h);
        Assert.AreEqual(0, h.Store.SlotsUsed(h.Settings.Codes[0].CodeId), "a wrong-round request must not use up one of the code's three keys");

        var ok = await h.PostDocAsync(Harness.DocN(1, round: 1));
        Assert.AreEqual(201, ok.Status, ok.Json);
    }

    [TestMethod]
    public async Task A_revoked_code_is_refused_at_once()
    {
        var h = new Harness();
        Assert.AreEqual(201, (await h.PostDocAsync(Harness.DocN(1))).Status);
        h.Settings = new ResultsSettings { Repo = Harness.Repo, Codes = Array.Empty<UploadCodeEntry>() };   // the owner deleted the entry
        AssertRefusedKeepingCalls(h, await h.PostDocAsync(Harness.DocN(2)), 401, "bad_code", expectedCalls: 1);
    }

    // ---- configuration ----

    [TestMethod]
    [DataRow(null, "owner/name")]
    [DataRow("not json", "owner/name")]
    [DataRow("{}", "owner/name")]
    [DataRow("[]", null)]
    [DataRow("[]", "no-slash")]
    [DataRow("[]", "../evil/x")]
    [DataRow("[]", "a/b/c")]
    public async Task A_missing_or_malformed_setting_is_a_503_not_a_crash(string? codes, string? repo)
    {
        var h = new Harness();
        h.Settings = ResultsSettings.Parse(codes, repo);
        Assert.IsNotNull(h.Settings.ConfigError);
        AssertRefused(h, await h.PostDocAsync(Harness.DocN(1)), 503, "not_configured");
    }

    sealed class CountingStream : Stream
    {
        readonly Stream inner;
        public long BytesRead;
        public CountingStream(Stream inner) => this.inner = inner;
        public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) { int n = inner.Read(buffer, offset, count); BytesRead += n; return n; }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) { int n = await inner.ReadAsync(buffer, ct); BytesRead += n; return n; }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    sealed class EndlessStream : Stream
    {
        readonly byte fill;
        public EndlessStream(byte fill) => this.fill = fill;
        public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) { Array.Fill(buffer, fill, offset, Math.Min(count, 4096)); return Math.Min(count, 4096); }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) { int n = Math.Min(buffer.Length, 4096); buffer.Span[..n].Fill(fill); return ValueTask.FromResult(n); }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
