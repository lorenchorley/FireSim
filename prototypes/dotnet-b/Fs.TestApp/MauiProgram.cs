namespace FsTestApp.App;

public static class MauiProgram
{
	public static MauiApp CreateMauiApp()
	{
		CrashNote.Install();
		var builder = MauiApp.CreateBuilder();
		builder.UseMauiApp<TestApplication>();
		return builder.Build();
	}
}

public sealed class TestApplication : Application
{
	protected override Window CreateWindow(IActivationState? activationState) => new(new TestPage());
}
