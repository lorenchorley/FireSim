using System.Runtime.Intrinsics;
using Fs.Kernel;

namespace Fs.Tests;

/// <summary>
/// Card T1.4b: the checks that depend on which SIMD paths the JIT gives this process (the arrangement of T1.2 and T1.4a, <see cref="AirPathChecks"/>). They run in the ordinary test run and
/// again, in child processes, under other settings (<see cref="FastSeparateProcessTests"/>). The child is told which situation to expect through <see cref="ExpectVariable"/>.
/// </summary>
[TestClass]
public sealed class FastPathChecks
{
    public const string ExpectVariable = "FS_FAST_EXPECT";
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

    [TestMethod]
    public void RealFixtureEqualsTheTypeScriptOnScalarVectorAndParallelVector()
    {
        KernelExec[] some = [KernelExec.Scalar, KernelExec.Vec, KernelExec.ParVec(4)];
        LevelSetKernelTests.CheckFixture("k6f-900", some);
        PyrogenicKernelTests.CheckFixture("k6f-900", some);
    }

    [TestMethod]
    public void EvaluateFormsAgree() => new LevelSetKernelTests().EvaluateFormsAgreeBitForBitOnEveryBandLengthAroundTheChunkEdges();

    [TestMethod]
    public void ReinitFormsAgree() => new LevelSetKernelTests().ReinitFormsAgreeBitForBitOnEveryShapeAndEveryTileEdge();

    [TestMethod]
    public void PyrogenicFormsAgree() => new PyrogenicKernelTests().EveryFormAgreesWithTheScalarFormOnEveryShapeAndRowLength();

    [TestMethod]
    public void NaNAndMinusZeroCases()
    {
        var t = new LevelSetKernelTests();
        t.ANaNCoefficientGivesANaNTendencyAndTheCFLMaximumIgnoresItWhileANaNNeighbourIsIgnored();
        t.AZeroCoefficientCellHasZeroTendencyAndAnArrivalCellKeepsItsStoredSpeed();
        t.ASequenceOfSubStepsWithReinitsEqualsTheScalarFormOnEveryForm();
    }
}
