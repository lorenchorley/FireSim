namespace FsResults;

public enum EntryState { Pending, Done }

/// <summary>One row per idempotency key (the key is stored only as its SHA-256, never in clear). Pending: some request owns the work of making the issue
/// until <see cref="LeaseUntilUtc"/>. Done: the issue exists; the row is the first receipt and never changes again.</summary>
public sealed record StoredResult(
    string KeyHash,
    string CodeId,
    EntryState State,
    int? Issue,
    DateTimeOffset CreatedUtc,
    DateTimeOffset? CompletedUtc,
    DateTimeOffset LeaseUntilUtc,
    string ETag);

/// <summary>The results store. Every method that claims something is an insert-if-not-exists or a compare-and-swap on an ETag, never read-then-write,
/// so two requests that arrive at the same moment cannot both win. Azure Table Storage implements it for deployment (<see cref="TableResultStore"/>),
/// <see cref="InMemoryResultStore"/> for tests.</summary>
public interface IResultStore
{
    Task<StoredResult?> GetAsync(string keyHash, CancellationToken ct);

    /// <summary>Insert-if-not-exists. Returns the new row, or null when a row for the key already exists (somebody else owns or finished it).</summary>
    Task<StoredResult?> TryInsertPendingAsync(string keyHash, string codeId, DateTimeOffset now, DateTimeOffset leaseUntil, CancellationToken ct);

    /// <summary>Compare-and-swap on <paramref name="current"/>'s ETag: renews the lease of a pending row whose lease has run out. Null when the row changed meanwhile.</summary>
    Task<StoredResult?> TryTakeOverAsync(StoredResult current, DateTimeOffset leaseUntil, CancellationToken ct);

    /// <summary>Compare-and-swap on <paramref name="mine"/>'s ETag: Pending to Done with the issue number. False when the row changed meanwhile (the lease was taken over).</summary>
    Task<bool> TryCompleteAsync(StoredResult mine, int issue, DateTimeOffset now, CancellationToken ct);

    /// <summary>Deletes the pending row if it is still <paramref name="mine"/> (the issue could not be made; a retry may try again).</summary>
    Task AbandonAsync(StoredResult mine, CancellationToken ct);

    /// <summary>Reserves one of at most <paramref name="maxKeys"/> slots of a code for this key. True when the key already holds a slot or just got one; false when
    /// the code already serves <paramref name="maxKeys"/> other keys. Atomic per slot (insert-if-not-exists), so concurrent keys never exceed the limit.</summary>
    Task<bool> TryReserveSlotAsync(string codeId, string keyHash, int maxKeys, CancellationToken ct);
}

/// <summary>For tests (and a local run): a lock-protected dictionary with the same semantics as the table.</summary>
public sealed class InMemoryResultStore : IResultStore
{
    readonly object gate = new();
    readonly Dictionary<string, StoredResult> rows = new();
    readonly Dictionary<string, string?[]> slots = new();
    long version;

    public int RowCount { get { lock (gate) return rows.Count; } }
    public IReadOnlyList<StoredResult> Rows() { lock (gate) return rows.Values.ToArray(); }
    public int SlotsUsed(string codeId) { lock (gate) return slots.TryGetValue(codeId, out var s) ? s.Count(x => x != null) : 0; }

    string NextETag() => "v" + (++version).ToString(System.Globalization.CultureInfo.InvariantCulture);

    public Task<StoredResult?> GetAsync(string keyHash, CancellationToken ct)
    {
        lock (gate) return Task.FromResult(rows.TryGetValue(keyHash, out var r) ? r : null);
    }

    public Task<StoredResult?> TryInsertPendingAsync(string keyHash, string codeId, DateTimeOffset now, DateTimeOffset leaseUntil, CancellationToken ct)
    {
        lock (gate)
        {
            if (rows.ContainsKey(keyHash)) return Task.FromResult<StoredResult?>(null);
            var r = new StoredResult(keyHash, codeId, EntryState.Pending, null, now, null, leaseUntil, NextETag());
            rows[keyHash] = r;
            return Task.FromResult<StoredResult?>(r);
        }
    }

    public Task<StoredResult?> TryTakeOverAsync(StoredResult current, DateTimeOffset leaseUntil, CancellationToken ct)
    {
        lock (gate)
        {
            if (!rows.TryGetValue(current.KeyHash, out var r) || r.ETag != current.ETag || r.State != EntryState.Pending) return Task.FromResult<StoredResult?>(null);
            var n = r with { LeaseUntilUtc = leaseUntil, ETag = NextETag() };
            rows[r.KeyHash] = n;
            return Task.FromResult<StoredResult?>(n);
        }
    }

    public Task<bool> TryCompleteAsync(StoredResult mine, int issue, DateTimeOffset now, CancellationToken ct)
    {
        lock (gate)
        {
            if (!rows.TryGetValue(mine.KeyHash, out var r) || r.ETag != mine.ETag || r.State != EntryState.Pending) return Task.FromResult(false);
            rows[r.KeyHash] = r with { State = EntryState.Done, Issue = issue, CompletedUtc = now, ETag = NextETag() };
            return Task.FromResult(true);
        }
    }

    public Task AbandonAsync(StoredResult mine, CancellationToken ct)
    {
        lock (gate)
        {
            if (rows.TryGetValue(mine.KeyHash, out var r) && r.ETag == mine.ETag) rows.Remove(mine.KeyHash);
            return Task.CompletedTask;
        }
    }

    public Task<bool> TryReserveSlotAsync(string codeId, string keyHash, int maxKeys, CancellationToken ct)
    {
        lock (gate)
        {
            if (!slots.TryGetValue(codeId, out var s)) slots[codeId] = s = new string?[maxKeys];
            if (s.Contains(keyHash)) return Task.FromResult(true);
            for (int i = 0; i < s.Length; i++)
                if (s[i] == null) { s[i] = keyHash; return Task.FromResult(true); }
            return Task.FromResult(false);
        }
    }
}
