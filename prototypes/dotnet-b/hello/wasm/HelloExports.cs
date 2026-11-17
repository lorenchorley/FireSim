using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

namespace HelloWasm;

[SupportedOSPlatform("browser")]
public static partial class HelloExports
{
    [JSExport]
    public static string Hello(string name) => $"hello, {name}, from .NET {Environment.Version} on {System.Runtime.InteropServices.RuntimeInformation.RuntimeIdentifier}";

    /// <summary>A scalar loop, so the AOT compiler has something to compile: the sum of squares of 1..n, in double.</summary>
    [JSExport]
    public static double SumOfSquares(int n)
    {
        double s = 0;
        for (int i = 1; i <= n; i++) s += (double)i * i;
        return s;
    }
}
