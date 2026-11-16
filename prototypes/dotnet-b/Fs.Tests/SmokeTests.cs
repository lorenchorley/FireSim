using Fs.Kernel;

namespace Fs.Tests;

[TestClass]
public sealed class SmokeTests
{
    [TestMethod]
    public void SolverAssemblyLoadsAndReportsItsScalarMode()
    {
        // Fs.Kernel's SIMD mode enum is the one stable public symbol of the K1 salvage; the scalar mode is the reference one.
        Assert.AreEqual("Scalar", SimdMode.Scalar.ToString());
        Assert.AreEqual(4, PyrogenicKernel.ChunkRows);
    }
}
