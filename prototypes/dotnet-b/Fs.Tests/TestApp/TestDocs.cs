using System.Text.Json.Nodes;
using FsTestApp.Results;

namespace Fs.Tests.TestApp;

/// <summary>Builders for result documents used across the TestApp tests.</summary>
internal static class TestDocs
{
    public static readonly string Sha = new string('b', 64);
    public const string RunId = "0123456789abcdef0123456789abcdef";

    public static ResultDocument Valid(int arms = 2, int samples = 3)
    {
        var d = new ResultDocument
        {
            Round = 0, RoundName = "link check", RunId = RunId, StartedUtc = new DateTimeOffset(2026, 11, 16, 12, 0, 0, TimeSpan.Zero), FinishedUtc = new DateTimeOffset(2026, 11, 16, 12, 5, 0, TimeSpan.Zero),
            Status = RunStatus.Complete,
            Build = new BuildInfo { Configuration = "Release", Commit = "abc1234", ApkSha256 = Sha, ApplicationId = "au.firesim.proto.r0", AppVersion = "0.1.0-test.r0+abc1234", TargetFramework = "net11.0-android37.0" },
            Device = new DeviceFacts { Manufacturer = "Acme", Model = "Phone 1", Cores = 8, ApiLevel = 35, Dotnet = ".NET 11.0.0" },
            Conditions = new Conditions { BatteryStartPercent = 80, ChargingAtStart = false, ThermalAtStart = "none", AirplaneMode = true },
        };
        d.IdempotencyKey = ResultDocument.MakeIdempotencyKey(d.Build.ApkSha256, d.RunId);
        d.Blocks.Add(new BlockRecord { Index = 0, Name = "a+b", DurationMs = 100 });
        for (int i = 0; i < arms; i++)
            d.Arms.Add(new ArmRecord { Block = 0, Name = "arm-" + i, DurationMs = 50, EstimatedSeconds = 1, Result = new JsonObject { ["x"] = i, ["checksum"] = 1234567 + i } });
        for (int i = 0; i < samples; i++)
        {
            d.Logs.Thermal.Add(new ThermalSample { TMs = i * 10_000, Status = "none", Headroom = 0.3 });
            d.Logs.Battery.Add(new BatterySample { TMs = i * 10_000, Percent = 80, Charging = false, ChargeCounterUah = 3_000_000 - i * 100, PowerSaver = false });
        }
        return d;
    }

    /// <summary>A large document: many arms with long results, many log samples, odd characters, newlines and non-ASCII text.</summary>
    public static ResultDocument Large(int arms, int resultChars)
    {
        var d = Valid(arms: 0, samples: 0);
        d.Device.Model = "Pixel éè 日本`` Model";
        for (int i = 0; i < arms; i++)
            d.Arms.Add(new ArmRecord
            {
                Block = i % 4, Name = "arm-" + i, DurationMs = 1234.5, EstimatedSeconds = 10, Runtime = "v8-webview",
                Result = new JsonObject { ["text"] = new string('é', resultChars), ["lines"] = string.Join("\n", Enumerable.Repeat("line of text with `ticks` and @mention", 5)), ["n"] = i },
            });
        return d;
    }
}
