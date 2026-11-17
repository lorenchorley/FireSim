using FsTestApp.Device;
using FsTestApp.Results;
using FsTestApp.Storage;

namespace FsTestApp.Sending;

/// <summary>Retry timing: exponential from <see cref="Initial"/>, capped at <see cref="Max"/>, with a little jitter (0.75x to 1.25x) so phones do not retry in step.</summary>
public sealed class BackoffPolicy
{
    public TimeSpan Initial { get; init; } = TimeSpan.FromSeconds(2);
    public double Factor { get; init; } = 2;
    public TimeSpan Max { get; init; } = TimeSpan.FromMinutes(5);
    /// <summary>After this many failed sends in one go the delivery gives up until the user taps Send now (the document stays saved).</summary>
    public int MaxFailures { get; init; } = 12;
    /// <summary>Returns a value in [0,1); fixed in tests.</summary>
    public Func<double> Jitter { get; init; } = () => Random.Shared.NextDouble();

    public TimeSpan DelayFor(int failures)
    {
        double ms = Initial.TotalMilliseconds * Math.Pow(Factor, Math.Max(0, failures - 1));
        ms = Math.Min(ms, Max.TotalMilliseconds);
        ms *= 0.75 + 0.5 * Jitter();
        return TimeSpan.FromMilliseconds(Math.Min(ms, Max.TotalMilliseconds * 1.25));
    }
}

public enum DeliveryResult { Delivered, AlreadyDelivered, NotConfigured, Rejected, GaveUp }

public sealed record DeliveryOutcome(DeliveryResult Result, Receipt? Receipt, string? Detail, int Attempts);

public sealed record DeliveryStatus(string Text, bool WaitingForNetwork);

/// <summary>Save-then-send: sends what is in the store (not what is in memory), with the same idempotency key every time, recording every attempt beside the
/// document. With no network it waits for the connectivity event instead of burning attempts; after a failure it waits with back-off (and wakes early when
/// the network comes back). A lost answer is just another retry: the key makes the endpoint answer "duplicate" with the original receipt.</summary>
public sealed class ResultsDelivery
{
    readonly IResultsSender sender;
    readonly IResultStore store;
    readonly IDeviceState device;
    readonly IClock clock;
    readonly BackoffPolicy backoff;

    public ResultsDelivery(IResultsSender sender, IResultStore store, IDeviceState device, IClock clock, BackoffPolicy? backoff = null)
    {
        this.sender = sender; this.store = store; this.device = device; this.clock = clock; this.backoff = backoff ?? new BackoffPolicy();
    }

    public async Task<DeliveryOutcome> SendAsync(string runId, Action<DeliveryStatus>? status, CancellationToken ct)
    {
        string json = store.LoadDocumentJson(runId) ?? throw new InvalidOperationException("nothing saved for this run: save the document before sending");
        var doc = ResultJsonContext.Deserialize(json) ?? throw new InvalidOperationException("saved document does not parse");
        var state = store.LoadState(runId);
        state.IdempotencyKey = doc.IdempotencyKey;
        if (state.Receipt != null) return new DeliveryOutcome(DeliveryResult.AlreadyDelivered, state.Receipt, null, state.Attempts.Count);

        if (!sender.IsConfigured)
            return new DeliveryOutcome(DeliveryResult.NotConfigured, null, "this build has no results endpoint; use Send with GitHub or Share", state.Attempts.Count);

        byte[] bytes = ResultCompactor.FitForPost(json);
        int failures = 0;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            if (!device.Read().NetworkReachable)
            {
                status?.Invoke(new DeliveryStatus("Turn the network back on to send the results.", true));
                await WaitForNetworkAsync(ct).ConfigureAwait(false);
                continue;   // not an attempt
            }

            status?.Invoke(new DeliveryStatus("Sending the results...", false));
            var result = await sender.SendAsync(doc.IdempotencyKey, bytes, clock.UtcNow, ct).ConfigureAwait(false);
            state.Attempts.Add(new SendAttempt { AtUtc = clock.UtcNow, Outcome = result.Outcome.ToString(), HttpStatus = result.HttpStatus, Detail = result.Detail });
            if (result.Outcome == SendOutcome.Sent) state.Receipt = result.Receipt ?? new Receipt { Text = "accepted", AtUtc = clock.UtcNow };
            store.SaveState(state);

            switch (result.Outcome)
            {
                case SendOutcome.Sent:
                    return new DeliveryOutcome(DeliveryResult.Delivered, state.Receipt, result.Detail, state.Attempts.Count);
                case SendOutcome.NotConfigured:
                    return new DeliveryOutcome(DeliveryResult.NotConfigured, null, result.Detail, state.Attempts.Count);
                case SendOutcome.Rejected:
                    return new DeliveryOutcome(DeliveryResult.Rejected, null, result.Detail, state.Attempts.Count);
                case SendOutcome.Retry:
                    failures++;
                    if (failures >= backoff.MaxFailures)
                        return new DeliveryOutcome(DeliveryResult.GaveUp, null, result.Detail, state.Attempts.Count);
                    var wait = backoff.DelayFor(failures);
                    status?.Invoke(new DeliveryStatus($"Could not send ({result.Detail}). Trying again in {Math.Ceiling(wait.TotalSeconds)} s.", false));
                    await WaitForNetworkOrDelayAsync(wait, ct).ConfigureAwait(false);
                    break;
            }
        }
    }

    /// <summary>Waits until the network is reachable (event or poll every 30 s, in case an event was missed).</summary>
    async Task WaitForNetworkAsync(CancellationToken ct)
    {
        while (!device.Read().NetworkReachable) await WaitForNetworkOrDelayAsync(TimeSpan.FromSeconds(30), ct).ConfigureAwait(false);
    }

    async Task WaitForNetworkOrDelayAsync(TimeSpan delay, CancellationToken ct)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        void onNet(bool reachable) { if (reachable) tcs.TrySetResult(); }
        device.NetworkChanged += onNet;
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var sleep = clock.DelayAsync(delay, cts.Token);
            await Task.WhenAny(sleep, tcs.Task).ConfigureAwait(false);
            cts.Cancel();
            try { await sleep.ConfigureAwait(false); } catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
            ct.ThrowIfCancellationRequested();
        }
        finally { device.NetworkChanged -= onNet; }
    }
}
