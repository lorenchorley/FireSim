using System.Globalization;
using Azure;
using Azure.Data.Tables;

namespace FsResults;

/// <summary>The deployed store: Azure Table Storage, one table (<see cref="TableName"/>) in the function app's storage account. NOT exercised against a live account
/// in this repository (no Azure here); <c>Fs.Results.Tests</c> runs it against a simulated <see cref="TableClient"/> that reproduces the documented status codes
/// (409 on a duplicate insert, 412 on an ETag mismatch, 404 on a missing row).
/// <para>Rows: partition <c>key</c>, row key = SHA-256 of the idempotency key (the key itself is not stored): <c>CodeId</c>, <c>State</c>, <c>Issue</c>, times.
/// Partition <c>code-{codeId}</c>, row keys <c>slot1</c>..<c>slot3</c>: <c>KeyHash</c> of the key that holds the slot. A slot is claimed with an insert (409 = taken),
/// so the limit holds however many requests arrive together.</para></summary>
public sealed class TableResultStore : IResultStore
{
    public const string TableName = "fsresults";
    const string KeyPartition = "key";

    readonly TableClient table;
    readonly SemaphoreSlim init = new(1, 1);
    bool created;

    public TableResultStore(TableClient table) => this.table = table;

    async Task EnsureAsync(CancellationToken ct)
    {
        if (created) return;
        await init.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (!created) { await table.CreateIfNotExistsAsync(ct).ConfigureAwait(false); created = true; }
        }
        finally { init.Release(); }
    }

    static StoredResult FromEntity(TableEntity e) => new(
        e.RowKey,
        e.GetString("CodeId") ?? "",
        string.Equals(e.GetString("State"), "Done", StringComparison.Ordinal) ? EntryState.Done : EntryState.Pending,
        e.GetInt32("Issue"),
        Parse(e.GetString("CreatedUtc")) ?? DateTimeOffset.UnixEpoch,
        Parse(e.GetString("CompletedUtc")),
        Parse(e.GetString("LeaseUntilUtc")) ?? DateTimeOffset.UnixEpoch,
        e.ETag.ToString());

    static DateTimeOffset? Parse(string? s) => s != null && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : null;
    static string Fmt(DateTimeOffset d) => d.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    static TableEntity ToEntity(string keyHash, string codeId, EntryState state, int? issue, DateTimeOffset created, DateTimeOffset? completed, DateTimeOffset lease)
    {
        var e = new TableEntity(KeyPartition, keyHash)
        {
            ["CodeId"] = codeId,
            ["State"] = state.ToString(),
            ["CreatedUtc"] = Fmt(created),
            ["LeaseUntilUtc"] = Fmt(lease),
        };
        if (issue is { } i) e["Issue"] = i;
        if (completed is { } c) e["CompletedUtc"] = Fmt(c);
        return e;
    }

    public async Task<StoredResult?> GetAsync(string keyHash, CancellationToken ct)
    {
        await EnsureAsync(ct).ConfigureAwait(false);
        var r = await table.GetEntityIfExistsAsync<TableEntity>(KeyPartition, keyHash, cancellationToken: ct).ConfigureAwait(false);
        return r.HasValue ? FromEntity(r.Value!) : null;
    }

    public async Task<StoredResult?> TryInsertPendingAsync(string keyHash, string codeId, DateTimeOffset now, DateTimeOffset leaseUntil, CancellationToken ct)
    {
        await EnsureAsync(ct).ConfigureAwait(false);
        var entity = ToEntity(keyHash, codeId, EntryState.Pending, null, now, null, leaseUntil);
        try
        {
            var resp = await table.AddEntityAsync(entity, ct).ConfigureAwait(false);
            return new StoredResult(keyHash, codeId, EntryState.Pending, null, now, null, leaseUntil, resp.Headers.ETag?.ToString() ?? "");
        }
        catch (RequestFailedException e) when (e.Status == 409) { return null; }
    }

    public async Task<StoredResult?> TryTakeOverAsync(StoredResult current, DateTimeOffset leaseUntil, CancellationToken ct)
    {
        await EnsureAsync(ct).ConfigureAwait(false);
        var entity = ToEntity(current.KeyHash, current.CodeId, EntryState.Pending, null, current.CreatedUtc, null, leaseUntil);
        try
        {
            var resp = await table.UpdateEntityAsync(entity, new ETag(current.ETag), TableUpdateMode.Replace, ct).ConfigureAwait(false);
            return current with { LeaseUntilUtc = leaseUntil, ETag = resp.Headers.ETag?.ToString() ?? "" };
        }
        catch (RequestFailedException e) when (e.Status is 412 or 404) { return null; }
    }

    public async Task<bool> TryCompleteAsync(StoredResult mine, int issue, DateTimeOffset now, CancellationToken ct)
    {
        await EnsureAsync(ct).ConfigureAwait(false);
        var entity = ToEntity(mine.KeyHash, mine.CodeId, EntryState.Done, issue, mine.CreatedUtc, now, mine.LeaseUntilUtc);
        try
        {
            await table.UpdateEntityAsync(entity, new ETag(mine.ETag), TableUpdateMode.Replace, ct).ConfigureAwait(false);
            return true;
        }
        catch (RequestFailedException e) when (e.Status is 412 or 404) { return false; }
    }

    public async Task AbandonAsync(StoredResult mine, CancellationToken ct)
    {
        await EnsureAsync(ct).ConfigureAwait(false);
        try { await table.DeleteEntityAsync(KeyPartition, mine.KeyHash, new ETag(mine.ETag), ct).ConfigureAwait(false); }
        catch (RequestFailedException e) when (e.Status is 412 or 404) { /* already gone or taken over: nothing to withdraw */ }
    }

    public async Task<bool> TryReserveSlotAsync(string codeId, string keyHash, int maxKeys, CancellationToken ct)
    {
        await EnsureAsync(ct).ConfigureAwait(false);
        string partition = "code-" + codeId;

        if (await HoldsSlotAsync(partition, keyHash, maxKeys, ct).ConfigureAwait(false) is not null) return true;
        for (int i = 1; i <= maxKeys; i++)
        {
            var slot = new TableEntity(partition, "slot" + i.ToString(CultureInfo.InvariantCulture)) { ["KeyHash"] = keyHash };
            try { await table.AddEntityAsync(slot, ct).ConfigureAwait(false); }
            catch (RequestFailedException e) when (e.Status == 409) { continue; }

            // Won slot i. If a concurrent request for the SAME key won a lower slot meanwhile, give mine back, so one key never holds two slots.
            int? lower = await HoldsSlotAsync(partition, keyHash, i - 1, ct).ConfigureAwait(false);
            if (lower is not null)
            {
                try { await table.DeleteEntityAsync(partition, slot.RowKey, ETag.All, ct).ConfigureAwait(false); }
                catch (RequestFailedException e) when (e.Status == 404) { }
            }
            return true;
        }
        return false;
    }

    /// <summary>The number of the slot (1..upTo) that holds this key, or null.</summary>
    async Task<int?> HoldsSlotAsync(string partition, string keyHash, int upTo, CancellationToken ct)
    {
        for (int i = 1; i <= upTo; i++)
        {
            var r = await table.GetEntityIfExistsAsync<TableEntity>(partition, "slot" + i.ToString(CultureInfo.InvariantCulture), cancellationToken: ct).ConfigureAwait(false);
            if (r.HasValue && string.Equals(r.Value!.GetString("KeyHash"), keyHash, StringComparison.Ordinal)) return i;
        }
        return null;
    }
}
