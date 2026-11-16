using Android.Content;
using Android.OS;
using Android.Provider;
using FsTestApp.Device;
using AContext = Android.App.Application;
using ThermalStatus = FsTestApp.Device.ThermalStatus;

namespace FsTestApp.App;

/// <summary>The phone, as <see cref="IDeviceState"/>. Every read is its own try/catch: a missing API or a refused call gives null (or Unknown), never an exception.
/// None of it needs a permission beyond ACCESS_NETWORK_STATE: charge comes from the sticky ACTION_BATTERY_CHANGED broadcast (BATTERY_STATS is never granted to a
/// sideloaded app), thermal status and headroom from PowerManager, airplane mode from Settings.Global.</summary>
public sealed class AndroidDeviceState : IDeviceState
{
	// PowerManager.getThermalHeadroom answers NaN when it is called much more than once a second; the sampler asks every 10 s, but Read() is also called by the
	// gate and the pause monitor, so the headroom is cached for a little over a second.
	static readonly TimeSpan HeadroomMinInterval = TimeSpan.FromMilliseconds(1500);
	readonly object gate = new();
	DateTime lastHeadroomAt = DateTime.MinValue;
	double? lastHeadroom;

	public event Action<bool>? ForegroundChanged;
	/// <summary>Never raised here: when the screen turns off Android calls OnPause, so the foreground event already carries it.</summary>
	public event Action<bool>? ScreenChanged { add { } remove { } }
	public event Action<bool>? NetworkChanged;

	public AndroidDeviceState()
	{
		AndroidLifecycle.ForegroundChanged += fg => ForegroundChanged?.Invoke(fg);
		try { Connectivity.Current.ConnectivityChanged += (_, e) => NetworkChanged?.Invoke(e.NetworkAccess == NetworkAccess.Internet); }
		catch (Exception) { /* no connectivity events: the delivery polls every 30 s instead */ }
	}

	public DeviceSnapshot Read()
	{
		var ctx = AContext.Context;
		int? percent = null; bool? charging = null; long? counter = null; bool? saver = null; var thermal = ThermalStatus.Unknown;
		double? headroom = null; bool? airplane = null; bool net = true, screen = true;

		try
		{
			using var filter = new IntentFilter(Intent.ActionBatteryChanged);
			using var sticky = ctx.RegisterReceiver(null, filter);   // null receiver: just returns the sticky broadcast; no permission, nothing registered
			if (sticky != null)
			{
				int level = sticky.GetIntExtra(BatteryManager.ExtraLevel, -1), scale = sticky.GetIntExtra(BatteryManager.ExtraScale, -1);
				if (level >= 0 && scale > 0) percent = (int)Math.Round(level * 100.0 / scale);
				int plugged = sticky.GetIntExtra(BatteryManager.ExtraPlugged, 0);
				int status = sticky.GetIntExtra(BatteryManager.ExtraStatus, -1);
				charging = plugged != 0 || status == (int)BatteryStatus.Charging || status == (int)BatteryStatus.Full;
			}
		}
		catch (Exception) { }

		try
		{
			if (ctx.GetSystemService(Context.BatteryService) is BatteryManager bm)
			{
				long v = bm.GetLongProperty((int)BatteryProperty.ChargeCounter);
				if (v != long.MinValue && v != 0) counter = v;   // Long.MIN_VALUE: not supported on this device
			}
		}
		catch (Exception) { }

		try
		{
			if (ctx.GetSystemService(Context.PowerService) is PowerManager pm)
			{
				try { saver = pm.IsPowerSaveMode; } catch (Exception) { }
				try { screen = pm.IsInteractive; } catch (Exception) { }
				if (Build.VERSION.SdkInt >= BuildVersionCodes.Q)
				{
					try { thermal = MapThermal((int)pm.CurrentThermalStatus); } catch (Exception) { }
				}
				if (Build.VERSION.SdkInt >= BuildVersionCodes.R)
				{
					lock (gate)
					{
						if (DateTime.UtcNow - lastHeadroomAt >= HeadroomMinInterval)
						{
							lastHeadroomAt = DateTime.UtcNow;
							try
							{
								float h = pm.GetThermalHeadroom(0);
								lastHeadroom = float.IsFinite(h) ? h : null;   // NaN: not available now
							}
							catch (Exception) { lastHeadroom = null; }
						}
						headroom = lastHeadroom;
					}
				}
			}
		}
		catch (Exception) { }

		try { airplane = Settings.Global.GetInt(ctx.ContentResolver, Settings.Global.AirplaneModeOn, 0) != 0; }
		catch (Exception) { }

		try { net = Connectivity.Current.NetworkAccess == NetworkAccess.Internet; }
		catch (Exception) { net = true; }

		return new DeviceSnapshot
		{
			BatteryPercent = percent, IsCharging = charging, ChargeCounterUah = counter, PowerSaver = saver, Thermal = thermal, ThermalHeadroom = headroom,
			AirplaneMode = airplane, NetworkReachable = net, ScreenOn = screen, IsForeground = AndroidLifecycle.IsForeground,
		};
	}

	static ThermalStatus MapThermal(int s) => s switch
	{
		0 => ThermalStatus.None, 1 => ThermalStatus.Light, 2 => ThermalStatus.Moderate, 3 => ThermalStatus.Severe,
		4 => ThermalStatus.Critical, 5 => ThermalStatus.Emergency, 6 => ThermalStatus.Shutdown, _ => ThermalStatus.Unknown,
	};
}
