using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using FsTestApp.Arms;
using FsTestApp.Device;
using FsTestApp.Runner;

namespace FsTestApp.Round0;

/// <summary>Collects named facts into a JSON object; a member that throws becomes an entry in <see cref="Failures"/> and the others still run (the first run on a
/// phone must tell us as much as it can). Values are written in an invariant form: numbers as JSON numbers, text as given, never a localised string.</summary>
public sealed class FactBag
{
    public JsonObject Values { get; } = new();
    public List<(string Item, string Error)> Failures { get; } = new();

    /// <summary>Reads one fact. Null means "not available" and is left out. string, bool, integers, finite floating point, a string sequence or a JsonNode are accepted.</summary>
    public FactBag Add(string name, Func<object?> read)
    {
        try
        {
            var node = ToNode(read());
            if (node != null) Values[name] = node;
        }
        catch (Exception e) { Fail(name, e); }
        return this;
    }

    /// <summary>Notes a failure that happened outside <see cref="Add"/>.</summary>
    public void Fail(string name, Exception e) => Failures.Add((name, Trim(e.GetType().Name + ": " + e.Message, 300)));

    static JsonNode? ToNode(object? v) => v switch
    {
        null => null,
        string s => JsonValue.Create(s),
        bool b => JsonValue.Create(b),
        int i => JsonValue.Create(i),
        long l => JsonValue.Create(l),
        float f => float.IsFinite(f) ? JsonValue.Create((double)f) : null,   // NaN and infinities are not JSON: a missing fact
        double d => double.IsFinite(d) ? JsonValue.Create(d) : null,
        JsonNode n => n.DeepClone(),
        IEnumerable<string> list => new JsonArray(list.Select(x => (JsonNode)JsonValue.Create(x)!).ToArray()),
        _ => JsonValue.Create(Convert.ToString(v, CultureInfo.InvariantCulture)),
    };

    static string Trim(string s, int max) => s.Length <= max ? s : s[..max];
}

/// <summary>A named section of the device-facts document and the code that fills it.</summary>
public sealed record ProbeSection(string Name, Action<FactBag> Fill);

/// <summary>What the platform can tell about the phone, as sections. The Android implementation (Fs.TestApp) lists hardware, os, memory, screen, battery, process; the
/// container dry run and the tests use a fake. The CPU section is built by <see cref="CpuFacts"/> from files, not here.</summary>
public interface IDeviceProbe
{
    IReadOnlyList<ProbeSection> Sections { get; }
}

/// <summary>Builds the device-facts document (the result of the <c>device-facts</c> arm). Pure over its inputs.</summary>
public static class DeviceFactsDocument
{
    public const int SchemaVersion = 1;

    public static JsonObject Build(IDeviceProbe probe, DeviceSnapshot state, ISysfs sysfs, int logicalCores)
    {
        var sw = Stopwatch.StartNew();
        var doc = new JsonObject { ["schema"] = SchemaVersion };
        var failures = new JsonArray();
        void failed(string item, string error) => failures.Add((JsonNode)new JsonObject { ["item"] = item, ["error"] = error });

        foreach (var section in probe.Sections)
        {
            var bag = new FactBag();
            try { section.Fill(bag); }
            catch (Exception e) { bag.Fail("(whole section)", e); }
            doc[section.Name] = bag.Values;
            foreach (var (item, error) in bag.Failures) failed(section.Name + "." + item, error);
        }

        try { doc["cpu"] = CpuFacts.Read(sysfs, logicalCores); }
        catch (Exception e) { failed("cpu", e.GetType().Name + ": " + e.Message); doc["cpu"] = new JsonObject { ["logicalCores"] = logicalCores }; }

        doc["state"] = State(state);
        doc["failures"] = failures;
        doc["collectedMs"] = Math.Round(sw.Elapsed.TotalMilliseconds, 1);
        Digests.Attach(doc, Digests.Device(doc));
        return doc;
    }

    /// <summary>Thermal status, battery and the other conditions at the moment the arm ran. Null readings are left out, never guessed.</summary>
    public static JsonObject State(DeviceSnapshot s)
    {
        var o = new JsonObject { ["thermalStatus"] = RunLog.ThermalName(s.Thermal), ["networkReachable"] = s.NetworkReachable };
        if (s.ThermalHeadroom is { } h && double.IsFinite(h)) o["thermalHeadroom"] = h;
        if (s.BatteryPercent is { } p) o["batteryPercent"] = p;
        if (s.IsCharging is { } c) o["charging"] = c;
        if (s.ChargeCounterUah is { } cc) o["chargeCounterUah"] = cc;
        if (s.PowerSaver is { } ps) o["powerSaver"] = ps;
        if (s.AirplaneMode is { } a) o["airplaneMode"] = a;
        return o;
    }
}

/// <summary>Round 0, arm (a): device facts. Model, manufacturer, Android version and SDK, SoC, ABI, core count and each core's frequencies, RAM, screen, thermal status
/// and battery at the start. Every read is guarded and a failure is in the result's <c>failures</c>.</summary>
public sealed class DeviceFactsArm : IArm
{
    public const string ArmName = "device-facts";
    readonly IDeviceProbe probe;
    readonly IDeviceState device;
    readonly ISysfs sysfs;

    public DeviceFactsArm(IDeviceProbe probe, IDeviceState device, ISysfs sysfs)
    {
        this.probe = probe; this.device = device; this.sysfs = sysfs;
    }

    public string Name => ArmName;
    public double EstimatedSeconds => 2;

    public Task<JsonNode> RunAsync(IProgress<ArmProgress> progress, CancellationToken ct)
        => Task.Run<JsonNode>(() =>
        {
            ct.ThrowIfCancellationRequested();
            progress.Report(new ArmProgress(0.1, "reading the device"));
            DeviceSnapshot state;
            try { state = device.Read(); } catch (Exception) { state = new DeviceSnapshot(); }
            var doc = DeviceFactsDocument.Build(probe, state, sysfs, Math.Max(1, Environment.ProcessorCount));
            progress.Report(new ArmProgress(1, "device facts read"));
            return doc;
        }, ct);
}
