using System.Runtime.Intrinsics;
using Fs.Kernel.Air;

namespace Fs.Tests;

/// <summary>
/// Card T1.4a: the checks that depend on which SIMD paths the JIT gives this process (the same arrangement as T1.2's <see cref="SpeedTestPathChecks"/>). They run
/// in the ordinary test run and again, in child processes, under other settings (<see cref="AirSeparateProcessTests"/>). The child is told which situation to
/// expect through <see cref="ExpectVariable"/>. Four tests: the SIMD support is the one asked for; the real fixture's cases on the scalar, vector and
/// parallel-vector forms equal the TypeScript's bits; the synthetic form-against-form checks of relax, of gradient and divergence, and of advect.
/// </summary>
[TestClass]
public sealed class AirPathChecks
{
    public const string ExpectVariable = "FS_AIR_EXPECT";
    public const int TestCount = 6;

    [TestMethod]
    public void TheProcessHasTheSimdSupportThatWasAskedFor()
    {
        switch (Environment.GetEnvironmentVariable(ExpectVariable))
        {
            case "hardware":
            case "no-avx2":
                Assert.IsTrue(Vector128.IsHardwareAccelerated);
                break;
            case "software":
                Assert.IsFalse(Vector128.IsHardwareAccelerated);
                break;
            default:
                break;
        }
        Console.WriteLine($"Vector128.IsHardwareAccelerated={Vector128.IsHardwareAccelerated} Vector256={Vector256.IsHardwareAccelerated} Vector512={Vector512.IsHardwareAccelerated}");
    }

    static readonly AirExec[] Some = [AirExec.Scalar, AirExec.Vec, AirExec.Par(4), AirExec.ParVec(4)];

    [TestMethod]
    public void RealFixtureEqualsTheTypeScriptOnScalarVectorAndParallel() => AirKernelTests.CheckFixture("fx-k3std", "k3std", Some);

    [TestMethod]
    public void RelaxFormsAgree() => new AirKernelTests().RelaxFormsAgreeBitForBitOnEveryRowLengthAndSweepCount();

    [TestMethod]
    public void GradientAndDivergenceFormsAgree() => new AirKernelTests().GradientAndDivergenceFormsAgreeBitForBitOnEveryRowLength();

    [TestMethod]
    public void AdvectFormsAgree() => new AirKernelTests().AdvectFormsAgreeBitForBitOnEveryRowLengthAndEveryStaggering();

    [TestMethod]
    public void NaNAndMinusZeroCases()
    {
        var t = new AirKernelTests();
        t.AdvectKeepsMinusZeroWithZeroDisplacementAndMakesNaNFromANaNDisplacement();
        t.RelaxNaNStaysInItsColumnAndItsNeighboursAndMinusZeroSurvivesAZeroRightHandSide();
    }
}
