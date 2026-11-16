// Shared by the MAUI app (Fs.Transport) and the desktop Harness: picture buffers, the pacing loop, the statistics it reports.
// No MAUI or ASP.NET types in here, so it compiles in both.
using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json.Serialization;

namespace FsTransport.Bench;

/// <summary>One picture = 32-byte header (little endian) + float32 payload.
/// 0 u32 magic 'FISM', 4 u32 seq, 8 f64 send time (epoch ms, .NET clock), 16 u32 total bytes, 20 u32 runId, 24 u32 reserved, 28 u32 reserved.
/// payload float i = (float)((i % 4093) * 0.00025), the page re-computes sampled values to detect corruption.</summary>
public static class Pattern
{
    public const int HeaderBytes = 32;
    public const uint Magic = 0x4D534946;
    static readonly Dictionary<int, byte[]> templates = new();

    public static byte[] Template(int totalBytes)
    {
        lock (templates)
        {
            if (templates.TryGetValue(totalBytes, out var t)) return t;
            var buf = new byte[totalBytes];
            int n = (totalBytes - HeaderBytes) / 4;
            var floats = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(buf.AsSpan(HeaderBytes, n * 4));
            for (int i = 0; i < n; i++) floats[i] = (float)((i % 4093) * 0.00025);
            templates[totalBytes] = buf;
            return buf;
        }
    }

    /// <summary>Fresh buffer per picture (like the real solver), copied from the template so the pattern costs a memcpy, not a loop.</summary>
    public static byte[] NewPicture(int totalBytes, uint seq, uint runId, double nowEpochMs)
    {
        var t = Template(totalBytes);
        var b = GC.AllocateUninitializedArray<byte>(totalBytes);
        Buffer.BlockCopy(t, 0, b, 0, totalBytes);
        Stamp(b, seq, runId, nowEpochMs);
        return b;
    }

    public static void Stamp(byte[] b, uint seq, uint runId, double nowEpochMs)
    {
        var s = b.AsSpan();
        BinaryPrimitives.WriteUInt32LittleEndian(s, Magic);
        BinaryPrimitives.WriteUInt32LittleEndian(s[4..], seq);
        BinaryPrimitives.WriteDoubleLittleEndian(s[8..], nowEpochMs);
        BinaryPrimitives.WriteUInt32LittleEndian(s[16..], (uint)b.Length);
        BinaryPrimitives.WriteUInt32LittleEndian(s[20..], runId);
    }

    static readonly long unixEpochTicks = DateTime.UnixEpoch.Ticks;
    /// <summary>Wall clock in epoch milliseconds with sub-millisecond resolution.</summary>
    public static double NowEpochMs() => (DateTime.UtcNow.Ticks - unixEpochTicks) / 10000.0;
}

public sealed class RunConfig
{
    public string Transport { get; set; } = "";
    public int SizeBytes { get; set; }
    public double Rate { get; set; }
    public double DurationS { get; set; }
    public int RunId { get; set; }
}

public sealed class RunStats
{
    public int RunId { get; set; }
    public string Transport { get; set; } = "";
    public int SizeBytes { get; set; }
    public double Rate { get; set; }
    public double DurationS { get; set; }
    public int Slots { get; set; }              // pictures scheduled
    public int Sent { get; set; }               // pictures handed to the transport and completed
    public int Skipped { get; set; }            // slots missed because the sender was late (>1 period) or had no credit
    public int SendErrors { get; set; }
    public string FirstError { get; set; } = "";
    public double ElapsedMs { get; set; }
    public double SendMsMedian { get; set; }    // time the send call took (serialise + hand over + await ack where there is one)
    public double SendMsP95 { get; set; }
    public double SendMsMax { get; set; }
    public double AllocMB { get; set; }         // managed bytes allocated during the run
    public double GcPauseMs { get; set; }       // total GC pause during the run
    public int Gen0 { get; set; }
    public int Gen1 { get; set; }
    public int Gen2 { get; set; }
    public double ManagedMBStart { get; set; }
    public double ManagedMBPeak { get; set; }
    public double WorkingSetMBStart { get; set; }
    public double WorkingSetMBPeak { get; set; }
    public double WorkingSetMBEnd { get; set; }
    public bool Cancelled { get; set; }
}

public sealed class WsInfo
{
    public int Port { get; set; }
    public string Token { get; set; } = "";
    public string Server { get; set; } = "";
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(RunConfig))]
[JsonSerializable(typeof(RunStats))]
[JsonSerializable(typeof(WsInfo))]
[JsonSerializable(typeof(bool))]
[JsonSerializable(typeof(int))]
[JsonSerializable(typeof(double))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(byte[]))]
public partial class BenchJson : JsonSerializerContext { }

public static class Runner
{
    /// <summary>Sender: hand one picture to the transport. Return false to say "no room, skip this slot" (no credit); throw on a transport failure.</summary>
    public delegate ValueTask<bool> Sender(byte[] picture, int seq, CancellationToken ct);

    public static async Task<RunStats> RunAsync(RunConfig cfg, Sender send, CancellationToken ct)
    {
        var st = new RunStats { RunId = cfg.RunId, Transport = cfg.Transport, SizeBytes = cfg.SizeBytes, Rate = cfg.Rate, DurationS = cfg.DurationS };
        double period = 1000.0 / cfg.Rate;
        st.Slots = (int)Math.Floor(cfg.DurationS * cfg.Rate);
        Pattern.Template(cfg.SizeBytes);                      // build once, outside the timed run
        GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();

        var proc = Process.GetCurrentProcess();
        long alloc0 = GC.GetTotalAllocatedBytes(precise: false);
        TimeSpan pause0 = GC.GetTotalPauseDuration();
        int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);
        double ws(Process p) { p.Refresh(); return p.WorkingSet64 / 1048576.0; }
        st.ManagedMBStart = GC.GetTotalMemory(false) / 1048576.0;
        st.WorkingSetMBStart = ws(proc);
        double mPeak = st.ManagedMBStart, wPeak = st.WorkingSetMBStart;

        var sendMs = new List<double>(st.Slots);
        var sw = Stopwatch.StartNew();
        double nextSample = 0;
        try
        {
            for (int n = 0; n < st.Slots && !ct.IsCancellationRequested; n++)
            {
                double due = n * period;
                double wait = due - sw.Elapsed.TotalMilliseconds;
                if (wait > 1) await Task.Delay(TimeSpan.FromMilliseconds(wait), ct).ConfigureAwait(false);
                if (sw.Elapsed.TotalMilliseconds - due > period) { st.Skipped++; continue; }   // a whole period late: drop the slot, stay in real time
                var pic = Pattern.NewPicture(cfg.SizeBytes, (uint)n, (uint)cfg.RunId, Pattern.NowEpochMs());
                double t0 = sw.Elapsed.TotalMilliseconds;
                try
                {
                    bool ok = await send(pic, n, ct).ConfigureAwait(false);
                    if (ok) { st.Sent++; sendMs.Add(sw.Elapsed.TotalMilliseconds - t0); } else st.Skipped++;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (Exception e)
                {
                    st.SendErrors++;
                    if (st.FirstError.Length == 0) st.FirstError = e.GetType().Name + ": " + e.Message;
                    if (st.SendErrors >= 5) break;       // the transport is broken, stop early
                }
                if (sw.Elapsed.TotalMilliseconds >= nextSample)
                {
                    nextSample = sw.Elapsed.TotalMilliseconds + 500;
                    mPeak = Math.Max(mPeak, GC.GetTotalMemory(false) / 1048576.0);
                    wPeak = Math.Max(wPeak, ws(proc));
                }
            }
            // let the last picture's delivery finish before the page reads the result
            await Task.Delay(300, CancellationToken.None).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        st.Cancelled = ct.IsCancellationRequested;
        st.ElapsedMs = sw.Elapsed.TotalMilliseconds;
        st.AllocMB = (GC.GetTotalAllocatedBytes(false) - alloc0) / 1048576.0;
        st.GcPauseMs = (GC.GetTotalPauseDuration() - pause0).TotalMilliseconds;
        st.Gen0 = GC.CollectionCount(0) - g0; st.Gen1 = GC.CollectionCount(1) - g1; st.Gen2 = GC.CollectionCount(2) - g2;
        st.ManagedMBPeak = Math.Max(mPeak, GC.GetTotalMemory(false) / 1048576.0);
        st.WorkingSetMBPeak = Math.Max(wPeak, ws(proc));
        st.WorkingSetMBEnd = ws(proc);
        if (sendMs.Count > 0)
        {
            sendMs.Sort();
            st.SendMsMedian = sendMs[sendMs.Count / 2];
            st.SendMsP95 = sendMs[Math.Min(sendMs.Count - 1, (int)(sendMs.Count * 0.95))];
            st.SendMsMax = sendMs[^1];
        }
        return st;
    }
}
