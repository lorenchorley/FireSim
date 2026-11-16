namespace FsTestApp.Round0;

/// <summary>A file system in memory for the tests and the container dry run: files by path, directories implied by the paths, and paths that refuse to be read.</summary>
public sealed class InMemorySysfs : ISysfs
{
    readonly Dictionary<string, string> files = new(StringComparer.Ordinal);
    readonly Dictionary<string, string> refused = new(StringComparer.Ordinal);

    public InMemorySysfs Add(string path, string text) { files[path] = text; return this; }
    /// <summary>The path exists but reading it throws with this message (SELinux says no).</summary>
    public InMemorySysfs Refuse(string path, string error = "UnauthorizedAccessException: Access to the path is denied.") { refused[path] = error; return this; }

    public SysfsRead Read(string path)
    {
        if (refused.TryGetValue(path, out var err)) return new SysfsRead(null, err);
        return files.TryGetValue(path, out var text) ? new SysfsRead(text, null) : new SysfsRead(null, "FileNotFoundException: Could not find file '" + path + "'.");
    }

    public bool DirectoryExists(string path)
    {
        string prefix = path.TrimEnd('/') + "/";
        return files.Keys.Concat(refused.Keys).Any(k => k.StartsWith(prefix, StringComparison.Ordinal));
    }

    /// <summary>An 8-core phone in the usual three clusters: cpu0-3 up to 1.8 GHz (Cortex-A55), cpu4-6 up to 2.4 GHz (Cortex-A715), cpu7 up to 2.8 GHz (Cortex-X3).</summary>
    public static InMemorySysfs ThreeClusterPhone()
    {
        var fs = new InMemorySysfs();
        fs.Add("/sys/devices/system/cpu/present", "0-7\n").Add("/sys/devices/system/cpu/possible", "0-7\n").Add("/sys/devices/system/cpu/online", "0-7\n");
        var info = new System.Text.StringBuilder();
        for (int i = 0; i < 8; i++)
        {
            (long max, string part, string related) = i < 4 ? (1_800_000L, "0xd05", "0 1 2 3") : i < 7 ? (2_400_000L, "0xd4d", "4 5 6") : (2_800_000L, "0xd4e", "7");
            string d = $"/sys/devices/system/cpu/cpu{i}/cpufreq";
            fs.Add(d + "/cpuinfo_max_freq", max + "\n").Add(d + "/cpuinfo_min_freq", "300000\n").Add(d + "/scaling_cur_freq", "500000\n")
              .Add(d + "/scaling_governor", "schedutil\n").Add(d + "/related_cpus", related + "\n");
            info.Append($"processor\t: {i}\nBogoMIPS\t: 26.00\nFeatures\t: fp asimd\nCPU implementer\t: 0x41\nCPU architecture: 8\nCPU variant\t: 0x1\nCPU part\t: {part}\nCPU revision\t: 0\n\n");
        }
        fs.Add("/proc/cpuinfo", info.ToString());
        return fs;
    }
}

/// <summary>A scripted probe for the tests and the dry run: some facts, and a section that throws (to show the failures path).</summary>
public sealed class FakeDeviceProbe : IDeviceProbe
{
    public FakeDeviceProbe(bool withFailures = true)
    {
        var list = new List<ProbeSection>
        {
            new("hardware", b =>
            {
                b.Add("manufacturer", () => "Simulated");
                b.Add("model", () => "Dry Run 1");
                b.Add("supportedAbis", () => (IEnumerable<string>)new[] { "arm64-v8a", "armeabi-v7a" });
                b.Add("socModel", () => "SM-0000");
            }),
            new("os", b => { b.Add("release", () => "16"); b.Add("sdkInt", () => 36); }),
            new("memory", b => { b.Add("totalMb", () => 7800L); b.Add("lowMemory", () => false); }),
        };
        if (withFailures)
        {
            list.Add(new ProbeSection("screen", b =>
            {
                b.Add("widthPx", () => 1080);
                b.Add("refreshRateHz", () => throw new InvalidOperationException("no default Display"));
                b.Add("density", () => float.NaN);   // not a JSON number: left out, not written as NaN
            }));
            list.Add(new ProbeSection("battery", _ => throw new UnauthorizedAccessException("the sticky broadcast was refused")));
        }
        Sections = list;
    }

    public IReadOnlyList<ProbeSection> Sections { get; }
}
