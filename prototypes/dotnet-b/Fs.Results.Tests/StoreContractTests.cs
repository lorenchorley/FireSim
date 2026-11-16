using System.Diagnostics.CodeAnalysis;
using Azure;
using Azure.Core;
using Azure.Data.Tables;
using Azure.Data.Tables.Models;
using FsResults;

namespace Fs.Results.Tests;

/// <summary>A simulated Azure table: the behaviour the table service documents and <see cref="TableResultStore"/> relies on (409 for an insert onto an existing row,
/// 412 for a conditional write whose ETag is stale, 404 for a missing row; a new ETag on every write). It is an assumption written down, not Azure: the real service
/// was not available here.</summary>
internal sealed class FakeTableClient : TableClient
{
    sealed class Row { public TableEntity Entity = null!; public long Version; }

    readonly object gate = new();
    readonly Dictionary<(string, string), Row> rows = new();
    long version;
    public int Created;

    public int RowCount { get { lock (gate) return rows.Count; } }

    sealed class FakeResponse : Response
    {
        readonly int status; readonly string? etag;
        public FakeResponse(int status, string? etag = null) { this.status = status; this.etag = etag; }
        public override int Status => status;
        public override string ReasonPhrase => "fake";
        public override Stream? ContentStream { get; set; }
        public override string ClientRequestId { get; set; } = "";
        public override void Dispose() { }
        protected override bool TryGetHeader(string name, [NotNullWhen(true)] out string? value)
        {
            if (etag != null && string.Equals(name, "ETag", StringComparison.OrdinalIgnoreCase)) { value = etag; return true; }
            value = null; return false;
        }
        protected override bool TryGetHeaderValues(string name, [NotNullWhen(true)] out IEnumerable<string>? values)
        {
            if (TryGetHeader(name, out var v)) { values = new[] { v }; return true; }
            values = null; return false;
        }
        protected override bool ContainsHeader(string name) => TryGetHeader(name, out _);
        protected override IEnumerable<HttpHeader> EnumerateHeaders() => etag == null ? Array.Empty<HttpHeader>() : new[] { new HttpHeader("ETag", etag) };
    }

    sealed class FakeNullable<T> : NullableResponse<T> where T : class
    {
        readonly T? value;
        public FakeNullable(T? value) => this.value = value;
        public override bool HasValue => value != null;
        public override T? Value => value;
        public override Response GetRawResponse() => new FakeResponse(value != null ? 200 : 404);
    }

    static TableEntity Clone(TableEntity e, string etag)
    {
        var c = new TableEntity(e.PartitionKey, e.RowKey);
        foreach (var kv in e) if (kv.Key is not ("PartitionKey" or "RowKey" or "odata.etag" or "Timestamp")) c[kv.Key] = kv.Value;
        c.ETag = new ETag(etag);
        return c;
    }

    static string ETagOf(long v) => "W/\"v" + v + "\"";

    public override Task<Response<TableItem>> CreateIfNotExistsAsync(CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref Created);
        return Task.FromResult(Response.FromValue(new TableItem("fsresults"), new FakeResponse(204)));
    }

    public override async Task<Response> AddEntityAsync<T>(T entity, CancellationToken cancellationToken = default)
    {
        await Task.Yield();   // let concurrent callers interleave
        lock (gate)
        {
            var key = (entity.PartitionKey, entity.RowKey);
            if (rows.ContainsKey(key)) throw new RequestFailedException(409, "EntityAlreadyExists");
            long v = ++version;
            rows[key] = new Row { Entity = Clone((TableEntity)(object)entity, ETagOf(v)), Version = v };
            return new FakeResponse(204, ETagOf(v));
        }
    }

    public override async Task<NullableResponse<T>> GetEntityIfExistsAsync<T>(string partitionKey, string rowKey, IEnumerable<string>? select = null, CancellationToken cancellationToken = default)
    {
        await Task.Yield();
        lock (gate)
        {
            if (!rows.TryGetValue((partitionKey, rowKey), out var row)) return new FakeNullable<T>(null);
            return new FakeNullable<T>((T)(object)Clone(row.Entity, ETagOf(row.Version)));
        }
    }

    public override async Task<Response> UpdateEntityAsync<T>(T entity, ETag ifMatch, TableUpdateMode mode = TableUpdateMode.Merge, CancellationToken cancellationToken = default)
    {
        await Task.Yield();
        lock (gate)
        {
            var key = (entity.PartitionKey, entity.RowKey);
            if (!rows.TryGetValue(key, out var row)) throw new RequestFailedException(404, "ResourceNotFound");
            if (ifMatch != ETag.All && ifMatch.ToString() != ETagOf(row.Version)) throw new RequestFailedException(412, "UpdateConditionNotSatisfied");
            long v = ++version;
            rows[key] = new Row { Entity = Clone((TableEntity)(object)entity, ETagOf(v)), Version = v };
            return new FakeResponse(204, ETagOf(v));
        }
    }

    public override async Task<Response> DeleteEntityAsync(string partitionKey, string rowKey, ETag ifMatch = default, CancellationToken cancellationToken = default)
    {
        await Task.Yield();
        lock (gate)
        {
            if (!rows.TryGetValue((partitionKey, rowKey), out var row)) throw new RequestFailedException(404, "ResourceNotFound");
            if (ifMatch != ETag.All && ifMatch.ToString() != ETagOf(row.Version)) throw new RequestFailedException(412, "UpdateConditionNotSatisfied");
            rows.Remove((partitionKey, rowKey));
            return new FakeResponse(204);
        }
    }
}

/// <summary>One set of tests for the store contract, run against both implementations: the in-memory one and the Azure Table one (on the simulated table).</summary>
[TestClass]
public sealed class StoreContractTests
{
    static readonly DateTimeOffset T0 = new(2026, 11, 16, 12, 0, 0, TimeSpan.Zero);

    static IResultStore Make(string kind) => kind == "memory" ? new InMemoryResultStore() : new TableResultStore(new FakeTableClient());

    [TestMethod]
    [DataRow("memory")]
    [DataRow("table")]
    public async Task Insert_if_not_exists_has_exactly_one_winner(string kind)
    {
        var store = Make(kind);
        var wins = await Task.WhenAll(Enumerable.Range(0, 30).Select(_ => Task.Run(() => store.TryInsertPendingAsync("k1", "c1", T0, T0.AddMinutes(2), default))));
        Assert.AreEqual(1, wins.Count(w => w is not null));
        var row = await store.GetAsync("k1", default);
        Assert.AreEqual(EntryState.Pending, row!.State);
        Assert.AreEqual("c1", row.CodeId);
        Assert.IsNull(row.Issue);
        Assert.IsNull(await store.GetAsync("missing", default));
    }

    [TestMethod]
    [DataRow("memory")]
    [DataRow("table")]
    public async Task Complete_turns_the_row_done_with_the_issue_and_a_second_complete_loses(string kind)
    {
        var store = Make(kind);
        var mine = (await store.TryInsertPendingAsync("k1", "c1", T0, T0.AddMinutes(2), default))!;
        Assert.IsTrue(await store.TryCompleteAsync(mine, 17, T0.AddSeconds(5), default));
        var row = (await store.GetAsync("k1", default))!;
        Assert.AreEqual(EntryState.Done, row.State);
        Assert.AreEqual(17, row.Issue);
        Assert.AreEqual(T0.AddSeconds(5), row.CompletedUtc);
        Assert.AreEqual(T0, row.CreatedUtc);
        Assert.IsFalse(await store.TryCompleteAsync(mine, 99, T0.AddSeconds(9), default), "the first receipt never changes");
        Assert.AreEqual(17, (await store.GetAsync("k1", default))!.Issue);
        Assert.IsNull(await store.TryInsertPendingAsync("k1", "c1", T0, T0, default), "a done key cannot be inserted again");
    }

    [TestMethod]
    [DataRow("memory")]
    [DataRow("table")]
    public async Task Taking_over_is_a_compare_and_swap_so_only_one_taker_wins_and_the_old_owner_loses(string kind)
    {
        var store = Make(kind);
        var owner = (await store.TryInsertPendingAsync("k1", "c1", T0, T0.AddMinutes(2), default))!;
        var stale = (await store.GetAsync("k1", default))!;
        var takers = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Task.Run(() => store.TryTakeOverAsync(stale, T0.AddMinutes(10), default))));
        Assert.AreEqual(1, takers.Count(t => t is not null));
        Assert.IsFalse(await store.TryCompleteAsync(owner, 5, T0.AddMinutes(3), default), "the original owner no longer holds the row");
        var winner = takers.Single(t => t is not null)!;
        Assert.AreEqual(T0.AddMinutes(10), winner.LeaseUntilUtc);
        Assert.IsTrue(await store.TryCompleteAsync(winner, 6, T0.AddMinutes(4), default));
        Assert.AreEqual(6, (await store.GetAsync("k1", default))!.Issue);
    }

    [TestMethod]
    [DataRow("memory")]
    [DataRow("table")]
    public async Task Abandon_removes_only_the_owners_own_pending_row(string kind)
    {
        var store = Make(kind);
        var owner = (await store.TryInsertPendingAsync("k1", "c1", T0, T0.AddMinutes(2), default))!;
        var taken = (await store.TryTakeOverAsync((await store.GetAsync("k1", default))!, T0.AddMinutes(9), default))!;
        await store.AbandonAsync(owner, default);                       // stale ETag: no effect
        Assert.IsNotNull(await store.GetAsync("k1", default));
        await store.AbandonAsync(taken, default);
        Assert.IsNull(await store.GetAsync("k1", default));
        await store.AbandonAsync(taken, default);                       // already gone: no error
        Assert.IsNotNull(await store.TryInsertPendingAsync("k1", "c1", T0, T0, default), "after abandoning, the key can be tried again");
    }

    [TestMethod]
    [DataRow("memory")]
    [DataRow("table")]
    public async Task A_code_has_at_most_three_slots_and_a_key_keeps_the_one_it_has(string kind)
    {
        var store = Make(kind);
        Assert.IsTrue(await store.TryReserveSlotAsync("c1", "a", 3, default));
        Assert.IsTrue(await store.TryReserveSlotAsync("c1", "b", 3, default));
        Assert.IsTrue(await store.TryReserveSlotAsync("c1", "a", 3, default), "asking again with the same key is free");
        Assert.IsTrue(await store.TryReserveSlotAsync("c1", "c", 3, default));
        Assert.IsFalse(await store.TryReserveSlotAsync("c1", "d", 3, default));
        Assert.IsTrue(await store.TryReserveSlotAsync("c1", "b", 3, default), "the keys that hold slots keep them");
        Assert.IsTrue(await store.TryReserveSlotAsync("c2", "d", 3, default), "another code has its own slots");
    }

    [TestMethod]
    [DataRow("memory")]
    [DataRow("table")]
    public async Task Concurrent_distinct_keys_never_get_more_than_three_slots(string kind)
    {
        for (int round = 0; round < 20; round++)
        {
            var store = Make(kind);
            var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => Task.Run(() => store.TryReserveSlotAsync("c1", "key" + i, 3, default))));
            Assert.IsLessThanOrEqualTo(3, results.Count(r => r), "round " + round + ": more than three keys got a slot");
        }
    }

    [TestMethod]
    [DataRow("memory")]
    [DataRow("table")]
    public async Task Concurrent_requests_for_the_same_key_hold_one_slot_between_them(string kind)
    {
        var store = Make(kind);
        var same = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => Task.Run(() => store.TryReserveSlotAsync("c1", "same", 3, default))));
        Assert.IsTrue(same.All(r => r));
        // two other keys still fit: the racing requests for "same" did not eat the other slots
        Assert.IsTrue(await store.TryReserveSlotAsync("c1", "x", 3, default));
        Assert.IsTrue(await store.TryReserveSlotAsync("c1", "y", 3, default));
        Assert.IsFalse(await store.TryReserveSlotAsync("c1", "z", 3, default));
    }

    [TestMethod]
    public async Task The_table_store_creates_its_table_once_and_stores_no_key_in_clear()
    {
        var table = new FakeTableClient();
        var store = new TableResultStore(table);
        await Task.WhenAll(Enumerable.Range(0, 10).Select(i => Task.Run(() => store.GetAsync("k" + i, default))));
        Assert.AreEqual(1, table.Created);
        // end to end with the handler: the row key is the SHA-256 of the idempotency key
        var h = new Harness();
        var handler = new ResultsHandler(store, h.GitHub, () => h.Settings, h.Time);
        var doc = Harness.DocN(1);
        var r = await handler.HandleAsync(new HandlerRequest("POST", "application/json", null, h.Code, Harness.KeyOf(doc), new MemoryStream(System.Text.Encoding.UTF8.GetBytes(doc.ToJsonString()))), default);
        Assert.AreEqual(201, r.Status, r.Json);
        string hash = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Harness.KeyOf(doc))));
        var row = await store.GetAsync(hash, default);
        Assert.AreEqual(EntryState.Done, row!.State);
        Assert.AreEqual(17, row.Issue);
    }
}
