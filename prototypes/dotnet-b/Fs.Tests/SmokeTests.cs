using Fs.Kernel;

namespace Fs.Tests;

[TestClass]
public sealed class SmokeTests
{
    [TestMethod]
    public void SolverAssemblyLoadsAndReportsItsScalarMode()
    {
        // Fs.Kernel's SIMD mode enum (K1, since T1.4b with the two modes the plan allows); the scalar mode is the reference one.
        Assert.AreEqual("Scalar", SimdMode.Scalar.ToString());
        Assert.AreEqual(4, PyrogenicKernel.ChunkRows);
    }
}
