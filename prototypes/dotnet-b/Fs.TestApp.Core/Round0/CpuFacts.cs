using System.Globalization;
using System.Text.Json.Nodes;

namespace FsTestApp.Round0;

/// <summary>One read of a file under /sys or /proc: the text, or the reason it could not be read (permission refused by SELinux, file absent). Never throws.</summary>
public readonly record struct SysfsRead(string? Text, string? Error);

/// <summary>The files round 0 reads, behind an interface so the parsing and the document are unit-tested without a phone.</summary>
public interface ISysfs
{
    SysfsRead Read(string path);
    bool DirectoryExists(string path);
}

/// <summary>The real file system (the phone, or the container for the dry run).</summary>
public sealed class FileSysfs : ISysfs
{
    public SysfsRead Read(string path)
    {
        try { return new SysfsRead(File.ReadAllText(path), null); }
        catch (Exception e) { return new SysfsRead(null, e.GetType().Name + ": " + e.Message); }
    }

    public bool DirectoryExists(string path)
    {
        try { return Directory.Exists(path); } catch (Exception) { return false; }
    }
}

/// <summary>One logical processor of /proc/cpuinfo on an Arm phone: who made it (<c>CPU implementer</c>) and which core it is (<c>CPU part</c>).</summary>
public sealed record ProcCpu(int Processor, string? Implementer, string? Part);

/// <summary>Parsing of the CPU files that tell the big and little cores apart, and the <c>cpu</c> section of the device-facts document (round 0, plan T0.6b).
/// Everything here is pure over <see cref="ISysfs"/>: a refused or missing file becomes an entry in <c>unreadable</c>, never an exception.</summary>
public static class CpuFacts
{
    public const string CpuRoot = "/sys/devices/system/cpu";
    public const string ProcCpuinfo = "/proc/cpuinfo";
    const int MaxCpus = 128;
    const int MaxUnreadable = 8;

    /// <summary>A frequency file (kHz, one integer and a newline). Anything else ("max", "&lt;unknown&gt;", empty, negative) is null.</summary>
    public static long? ParseKhz(string? text)
        => long.TryParse(text?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : null;

    /// <summary>The kernel's cpu list format: "0-3,6,8-9" (files <c>present</c>, <c>possible</c>, <c>online</c>, <c>related_cpus</c> use it, with spaces in <c>related_cpus</c>).
    /// Malformed input gives an empty list; a range wider than the cap is rejected whole.</summary>
    public static IReadOnlyList<int> ParseCpuList(string? text)
    {
        var result = new List<int>();
        if (string.IsNullOrWhiteSpace(text)) return result;
        foreach (var part in text.Split(new[] { ',', ' ', '\t', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries))
        {
            int dash = part.IndexOf('-');
            if (dash < 0)
            {
                if (!int.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var one)) return Array.Empty<int>();
                result.Add(one);
            }
            else
            {
                if (!int.TryParse(part[..dash], NumberStyles.None, CultureInfo.InvariantCulture, out var from)
                    || !int.TryParse(part[(dash + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out var to)
                    || to < from || to - from >= MaxCpus * 8) return Array.Empty<int>();
                for (int i = from; i <= to; i++) result.Add(i);
            }
            if (result.Count > MaxCpus * 8) return Array.Empty<int>();
        }
        return result;
    }

    /// <summary>The blocks of /proc/cpuinfo ("processor : 0", "CPU implementer : 0x41", "CPU part : 0xd05", ...). Keys are matched case-insensitively; a file
    /// without any "processor" line (some x86 kernels print differently) gives an empty list.</summary>
    public static IReadOnlyList<ProcCpu> ParseProcCpuinfo(string? text)
    {
        var list = new List<ProcCpu>();
        if (string.IsNullOrEmpty(text)) return list;
        int? proc = null; string? impl = null, part = null;
        void flush() { if (proc is { } p) list.Add(new ProcCpu(p, impl, part)); proc = null; impl = null; part = null; }
        foreach (var raw in text.Split('\n'))
        {
            int colon = raw.IndexOf(':');
            if (colon < 0) continue;
            string key = raw[..colon].Trim().ToLowerInvariant(), value = raw[(colon + 1)..].Trim();
            if (key == "processor")
            {
                flush();
                if (int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var n)) proc = n;
            }
            else if (key == "cpu implementer") impl = Hex(value);
            else if (key == "cpu part") part = Hex(value);
        }
        flush();
        return list;
    }

    static string? Hex(string value)
    {
        string v = value.Trim().ToLowerInvariant();
        if (v.Length == 0 || v.Length > 12) return null;
        // the kernel prints these as 0x<hex>; anything else is not trusted
        return v.StartsWith("0x", StringComparison.Ordinal) && v.Length > 2 && v.Skip(2).All(Uri.IsHexDigit) ? v : null;
    }

    /// <summary>Best-effort names for Arm's own cores (implementer 0x41). Unknown parts, and every other implementer, give null (the raw hex is in the document).</summary>
    public static string? ArmCoreName(string? implementer, string? part)
    {
        if (implementer != "0x41" || part == null) return null;
        return part switch
        {
            "0xd03" => "Cortex-A53", "0xd04" => "Cortex-A35", "0xd05" => "Cortex-A55", "0xd07" => "Cortex-A57", "0xd08" => "Cortex-A72", "0xd09" => "Cortex-A73",
            "0xd0a" => "Cortex-A75", "0xd0b" => "Cortex-A76", "0xd0c" => "Neoverse-N1", "0xd0d" => "Cortex-A77", "0xd41" => "Cortex-A78", "0xd44" => "Cortex-X1",
            "0xd46" => "Cortex-A510", "0xd47" => "Cortex-A710", "0xd48" => "Cortex-X2", "0xd4d" => "Cortex-A715", "0xd4e" => "Cortex-X3",
            "0xd80" => "Cortex-A520", "0xd81" => "Cortex-A720", "0xd82" => "Cortex-X4", "0xd85" => "Cortex-X925", "0xd87" => "Cortex-A725",
            _ => null,
        };
    }

    /// <summary>Groups cores by maximum frequency (the big and little clusters show as different maxima). Cores without a frequency are one group with maxKhz absent.
    /// Ordered by maximum frequency, ascending, so the first group is the little cluster.</summary>
    public static IReadOnlyList<(long? MaxKhz, IReadOnlyList<int> Cpus)> Clusters(IEnumerable<(int Cpu, long? MaxKhz)> cores)
        => cores.GroupBy(c => c.MaxKhz).OrderBy(g => g.Key ?? long.MaxValue)
                .Select(g => (g.Key, (IReadOnlyList<int>)g.Select(c => c.Cpu).OrderBy(i => i).ToList())).ToList();

    /// <summary>The <c>cpu</c> section: cores with their frequencies, governor, related cpus and (from /proc/cpuinfo) implementer and part; clusters; and every file that could
    /// not be read. <paramref name="logicalCores"/> is what the runtime reports (<c>Environment.ProcessorCount</c>).</summary>
    public static JsonObject Read(ISysfs fs, int logicalCores, string root = CpuRoot, string procCpuinfo = ProcCpuinfo)
    {
        var unreadable = new List<(string Path, string Error)>();
        string? ReadText(string path)
        {
            var r = fs.Read(path);
            if (r.Text == null) { if (unreadable.Count < 64) unreadable.Add((path, r.Error ?? "no text")); return null; }
            return r.Text;
        }

        var o = new JsonObject { ["logicalCores"] = logicalCores };
        string? present = ReadText($"{root}/present");
        if (present != null) o["present"] = present.Trim();
        string? possible = ReadText($"{root}/possible");
        if (possible != null) o["possible"] = possible.Trim();
        string? online = ReadText($"{root}/online");
        if (online != null) o["online"] = online.Trim();

        var indices = ParseCpuList(present).ToList();
        if (indices.Count == 0)
            for (int i = 0; i < MaxCpus; i++) if (fs.DirectoryExists($"{root}/cpu{i}")) indices.Add(i);
        if (indices.Count > MaxCpus) indices = indices.Take(MaxCpus).ToList();

        var proc = ParseProcCpuinfo(ReadText(procCpuinfo)).ToDictionary(p => p.Processor);
        var cores = new JsonArray();
        var forClusters = new List<(int, long?)>();
        bool anyFreq = false;
        foreach (int i in indices)
        {
            string dir = $"{root}/cpu{i}/cpufreq";
            long? max = ParseKhz(ReadText($"{dir}/cpuinfo_max_freq"));
            long? min = ParseKhz(ReadText($"{dir}/cpuinfo_min_freq"));
            long? cur = ParseKhz(ReadText($"{dir}/scaling_cur_freq"));
            string? gov = ReadText($"{dir}/scaling_governor")?.Trim();
            var related = ParseCpuList(ReadText($"{dir}/related_cpus"));
            anyFreq |= max != null;
            var c = new JsonObject { ["cpu"] = i };
            if (max != null) c["maxKhz"] = max;
            if (min != null) c["minKhz"] = min;
            if (cur != null) c["curKhz"] = cur;
            if (!string.IsNullOrEmpty(gov)) c["governor"] = gov;
            if (related.Count > 0) c["relatedCpus"] = new JsonArray(related.Select(r => (JsonNode)JsonValue.Create(r)!).ToArray());
            if (proc.TryGetValue(i, out var p))
            {
                if (p.Implementer != null) c["implementer"] = p.Implementer;
                if (p.Part != null) c["part"] = p.Part;
                if (ArmCoreName(p.Implementer, p.Part) is { } name) c["armCore"] = name;
            }
            cores.Add((JsonNode)c);
            forClusters.Add((i, max));
        }
        o["cores"] = cores;
        o["cpufreqRead"] = anyFreq;
        var clusters = new JsonArray();
        foreach (var (maxKhz, cpus) in Clusters(forClusters))
        {
            var g = new JsonObject();
            if (maxKhz != null) g["maxKhz"] = maxKhz;
            g["cpus"] = new JsonArray(cpus.Select(i => (JsonNode)JsonValue.Create(i)!).ToArray());
            clusters.Add((JsonNode)g);
        }
        o["clusters"] = clusters;

        if (unreadable.Count > 0)
        {
            // the same error text for dozens of files says nothing more than once: group by error and list a few paths
            var arr = new JsonArray();
            foreach (var g in unreadable.GroupBy(u => u.Error).Take(MaxUnreadable))
                arr.Add((JsonNode)new JsonObject { ["error"] = Trim(g.Key, 200), ["count"] = g.Count(), ["firstPath"] = g.First().Path });
            o["unreadable"] = arr;
        }
        return o;
    }

    static string Trim(string s, int max) => s.Length <= max ? s : s[..max];
}
