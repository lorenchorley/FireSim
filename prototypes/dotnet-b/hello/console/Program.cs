using System.Runtime.InteropServices;

Console.WriteLine($"hello from {RuntimeInformation.FrameworkDescription} on {RuntimeInformation.RuntimeIdentifier} ({RuntimeInformation.ProcessArchitecture})");
