using FsTestApp.Arms;

namespace FsTestApp.Runner;

/// <summary>A block: arms run one after another between two gate checks. Heat from one block must not bias the next, so the gate runs before each block.</summary>
public sealed record Block(string Name, IReadOnlyList<IArm> Arms)
{
    public double EstimatedSeconds => Arms.Sum(a => a.EstimatedSeconds);
}

/// <summary>Ordering helpers. Within a block, arms that are compared run close together; across blocks the order is counterbalanced so a drift (heat,
/// background work, battery) falls on both sides equally: the A B B A scheme.</summary>
public static class BlockPlan
{
    /// <summary>Two blocks, "AB" then "BA".</summary>
    public static IReadOnlyList<Block> AbBa(IArm a, IArm b) => new[]
    {
        new Block($"{a.Name}+{b.Name}", new[] { a, b }),
        new Block($"{b.Name}+{a.Name}", new[] { b, a }),
    };

    /// <summary>A B B A repeated <paramref name="repeats"/> times (so 2 * repeats blocks).</summary>
    public static IReadOnlyList<Block> AbBa(IArm a, IArm b, int repeats)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(repeats, 1);
        var blocks = new List<Block>();
        for (int i = 0; i < repeats; i++) blocks.AddRange(AbBa(a, b));
        return blocks;
    }

    /// <summary>For more than two arms: block k runs the arms rotated by k places (a cyclic Latin square), and every odd block reversed, so each arm
    /// sees every position and every neighbour about equally. Returns <paramref name="blocks"/> blocks.</summary>
    public static IReadOnlyList<Block> Counterbalanced(IReadOnlyList<IArm> arms, int blocks)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(blocks, 1);
        if (arms.Count == 0) throw new ArgumentException("no arms", nameof(arms));
        var result = new List<Block>();
        for (int k = 0; k < blocks; k++)
        {
            var order = new List<IArm>(arms.Count);
            for (int i = 0; i < arms.Count; i++) order.Add(arms[(i + k) % arms.Count]);
            if (k % 2 == 1) order.Reverse();
            result.Add(new Block(string.Join("+", order.Select(a => a.Name)), order));
        }
        return result;
    }

    /// <summary>One block holding the arms in the order given.</summary>
    public static IReadOnlyList<Block> Single(string name, params IArm[] arms) => new[] { new Block(name, arms) };

    public static double EstimatedSeconds(IEnumerable<Block> blocks) => blocks.Sum(b => b.EstimatedSeconds);
}
