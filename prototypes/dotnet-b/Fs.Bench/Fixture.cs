using System.Buffers.Binary;
using System.Text.Json;

namespace Fs.Bench;

/// <summary>Reads a kernel fixture written by ts/capture.ts: header.json (names, types, lengths, byte offsets) plus data.bin (little-endian typed arrays).</summary>
public sealed class KernelFixture
{
    public int FireNx, FireNy, CoarseNx, CoarseNy;
    public double CellSizeM, PyroK, PyroMax;
    public List<KernelCase> Cases = new();

    public static KernelFixture Load(string dir)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "header.json")));
        var h = doc.RootElement;
        var data = File.ReadAllBytes(Path.Combine(dir, h.GetProperty("dataFile").GetString()!));
        var arrays = new Dictionary<string, (string type, int length, int off)>();
        foreach (var a in h.GetProperty("arrays").EnumerateArray())
            arrays[a.GetProperty("name").GetString()!] = (a.GetProperty("type").GetString()!, a.GetProperty("length").GetInt32(), a.GetProperty("byteOffset").GetInt32());
        float[] F32(string name)
        {
            var (type, len, off) = arrays[name];
            if (type != "float32") throw new InvalidDataException(name + " is not float32");
            var r = new float[len];
            for (int i = 0; i < len; i++) r[i] = BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(off + 4 * i, 4)));
            return r;
        }
        double[] F64(string name)
        {
            var (type, len, off) = arrays[name];
            if (type != "float64") throw new InvalidDataException(name + " is not float64");
            var r = new double[len];
            for (int i = 0; i < len; i++) r[i] = BitConverter.Int64BitsToDouble(BinaryPrimitives.ReadInt64LittleEndian(data.AsSpan(off + 8 * i, 8)));
            return r;
        }
        var f = new KernelFixture
        {
            FireNx = h.GetProperty("fireNx").GetInt32(),
            FireNy = h.GetProperty("fireNy").GetInt32(),
            CoarseNx = h.GetProperty("coarseNx").GetInt32(),
            CoarseNy = h.GetProperty("coarseNy").GetInt32(),
            CellSizeM = h.GetProperty("cellSizeM").GetDouble(),
            PyroK = h.GetProperty("pyroK").GetDouble(),
            PyroMax = h.GetProperty("pyroMax").GetDouble(),
        };
        foreach (var c in h.GetProperty("cases").EnumerateArray())
        {
            var name = c.GetProperty("name").GetString()!;
            f.Cases.Add(new KernelCase
            {
                Name = name,
                SimTimeS = c.GetProperty("simTimeS").GetDouble(),
                NonZeroSourceCells = c.GetProperty("nonZeroSourceCells").GetInt32(),
                Q = F32(name + ".q"),
                Psi = F64(name + ".psi"),
                Up = F32(name + ".up"),
                Vp = F32(name + ".vp"),
            });
        }
        return f;
    }

    /// <summary>A deterministic stand-in for a fixture (for a phone, where no fixture file is pushed): a 310 m heat line like the demo ignition, 81 kW/m2.</summary>
    public static KernelFixture Synthetic(int nx = 200, int ny = 200, double cell = 30)
    {
        var q = new float[nx * ny];
        // a diagonal band, 2 cells thick, about 11 cells long, then grown to ~190 source cells (the t = 900 s fixture has 191)
        int cx = nx / 2 - 20, cy = ny / 2 - 15;
        int n = 0;
        for (int s = 0; s < 20 && n < 191; s++)
            for (int w = -4; w <= 4 && n < 191; w++)
            {
                int i = cx + s + w / 2, j = cy + s - (w - w / 2);
                if (i >= 0 && j >= 0 && i < nx && j < ny && q[j * nx + i] == 0) { q[j * nx + i] = 81f * (1 - 0.02f * (Math.Abs(w))); n++; }
            }
        var f = new KernelFixture { FireNx = nx, FireNy = ny, CoarseNx = (nx + 1) / 2, CoarseNy = (ny + 1) / 2, CellSizeM = cell, PyroK = 6e-4, PyroMax = 5 };
        f.Cases.Add(new KernelCase { Name = "synthetic", SimTimeS = 0, NonZeroSourceCells = n, Q = q, Psi = Array.Empty<double>(), Up = Array.Empty<float>(), Vp = Array.Empty<float>() });
        return f;
    }
}

public sealed class KernelCase
{
    public string Name = "";
    public double SimTimeS;
    public int NonZeroSourceCells;
    public float[] Q = Array.Empty<float>();
    /// <summary>The TypeScript's outputs (empty for a synthetic case).</summary>
    public double[] Psi = Array.Empty<double>();
    public float[] Up = Array.Empty<float>(), Vp = Array.Empty<float>();
}
