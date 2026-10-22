// TopNotch system helper. Compiled at startup by Windows PowerShell 5.1
// (C# 5: no string interpolation or null-propagation).
// Protocol: one command per stdin line, one JSON object per stdout line.
//   in : volume <0-100> | mute <on|off|toggle> | brightness <0-100> | seek <seconds> <appId?>
//        stats <on|off> | fileclick <on|off> | mixer list | mixer set <pid> <0-100> | mixer mute <pid> <on|off|toggle> | get
//   out: {"type":"volume","value":n,"muted":b} | {"type":"brightness","value":n,"supported":b}
//        {"type":"seek","ok":b} | {"type":"privacy","camera":[..],"microphone":[..]}
//        {"type":"net","rx":n,"tx":n} | {"type":"bluetooth","devices":[{name,connected,battery}]}
//        {"type":"ready"} | {"type":"error","message":s}
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Management;
using System.Runtime.InteropServices;
using System.Net.NetworkInformation;
using System.Threading;
using Microsoft.Win32;
using Windows.Devices.Bluetooth;
using Windows.Devices.Enumeration;
using Windows.Foundation;
using Windows.Media.Control;

namespace TopNotch {

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
    int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback pNotify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float levelDB, ref Guid context);
    int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel(out float levelDB);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float levelDB, ref Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    int GetChannelVolumeLevel(uint channel, out float levelDB);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolumeCallback {
    [PreserveSig] int OnNotify(IntPtr data);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator { }

class VolumeCallback : IAudioEndpointVolumeCallback {
    // AUDIO_VOLUME_NOTIFICATION_DATA: GUID context, BOOL muted, float master, ...
    // Read from the struct instead of calling back into COM from this thread.
    public int OnNotify(IntPtr data) {
        bool muted = Marshal.ReadInt32(data, 16) != 0;
        float level = BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, 20)), 0);
        Helper.EmitVolume(level, muted);
        return 0;
    }
}

static class Audio {
    static IAudioEndpointVolume endpoint;
    static VolumeCallback callback;
    static Guid context = Guid.NewGuid();

    public static void Init() {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out device));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object iface;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out iface));
        endpoint = (IAudioEndpointVolume)iface;
        callback = new VolumeCallback();
        endpoint.RegisterControlChangeNotify(callback);
    }

    public static void Report() {
        float level; bool muted;
        endpoint.GetMasterVolumeLevelScalar(out level);
        endpoint.GetMute(out muted);
        Helper.EmitVolume(level, muted);
    }

    public static void SetLevel(int percent) {
        float level = Math.Max(0, Math.Min(100, percent)) / 100f;
        endpoint.SetMasterVolumeLevelScalar(level, ref context);
        if (level > 0) endpoint.SetMute(false, ref context);
    }

    public static void SetMute(string mode) {
        bool muted;
        endpoint.GetMute(out muted);
        bool next = mode == "on" ? true : mode == "off" ? false : !muted;
        endpoint.SetMute(next, ref context);
    }
}

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
}

// Output loudness for the lyrics: peak level ~30x/s, only while asked ("meter on").
static class Meter {
    static volatile bool enabled;
    static IAudioMeterInformation meter;
    public static void SetEnabled(bool on) { enabled = on; }

    static IAudioMeterInformation Open() {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
        Guid iid = typeof(IAudioMeterInformation).GUID;
        object iface;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out iface));
        return (IAudioMeterInformation)iface;
    }

    public static void Start() {
        var thread = new Thread(() => {
            int failures = 0;
            while (true) {
                if (!enabled) { meter = null; Thread.Sleep(200); continue; }
                try {
                    if (meter == null) meter = Open();
                    float peak;
                    meter.GetPeakValue(out peak);
                    Helper.Emit("{\"type\":\"peak\",\"v\":" + peak.ToString("0.000", CultureInfo.InvariantCulture) + "}");
                    failures = 0;
                } catch {
                    meter = null;
                    if (++failures > 5) { Thread.Sleep(2000); failures = 0; }
                }
                Thread.Sleep(33);
            }
        });
        thread.IsBackground = true;
        thread.Start();
    }
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
    int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
}

[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
}

[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    int GetGroupingParam(out Guid param);
    int SetGroupingParam(ref Guid param, ref Guid context);
    int RegisterAudioSessionNotification(IntPtr client);
    int UnregisterAudioSessionNotification(IntPtr client);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
}

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid context);
    int GetMasterVolume(out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

// Per-app volume: one row per process with an active or inactive (not
// expired) session on the current default output device.
static class Mixer {
    static Guid context = Guid.NewGuid();

    static List<KeyValuePair<uint, ISimpleAudioVolume>> Sessions(out Dictionary<uint, IAudioSessionControl2> controls) {
        controls = new Dictionary<uint, IAudioSessionControl2>();
        var result = new List<KeyValuePair<uint, ISimpleAudioVolume>>();
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
        Guid iid = typeof(IAudioSessionManager2).GUID;
        object iface;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out iface));
        IAudioSessionEnumerator sessions;
        Marshal.ThrowExceptionForHR(((IAudioSessionManager2)iface).GetSessionEnumerator(out sessions));
        int count;
        sessions.GetCount(out count);
        for (int i = 0; i < count; i++) {
            IAudioSessionControl2 control;
            if (sessions.GetSession(i, out control) != 0 || control == null) continue;
            int state;
            control.GetState(out state);
            if (state == 2 /* expired */) continue;
            uint pid;
            control.GetProcessId(out pid);
            result.Add(new KeyValuePair<uint, ISimpleAudioVolume>(pid, (ISimpleAudioVolume)control));
            if (!controls.ContainsKey(pid)) controls[pid] = control;
        }
        return result;
    }

    public static void List() {
        Dictionary<uint, IAudioSessionControl2> controls;
        var sessions = Sessions(out controls);
        var parts = new List<string>();
        var seen = new HashSet<uint>();
        foreach (var entry in sessions) {
            if (!seen.Add(entry.Key)) continue;
            float level; bool muted;
            entry.Value.GetMasterVolume(out level);
            entry.Value.GetMute(out muted);
            bool system = controls[entry.Key].IsSystemSoundsSession() == 0;
            string name = system ? "System sounds" : null;
            string path = "";
            if (!system) {
                try {
                    var process = System.Diagnostics.Process.GetProcessById((int)entry.Key);
                    try {
                        path = process.MainModule.FileName;
                        string description = System.Diagnostics.FileVersionInfo.GetVersionInfo(path).FileDescription;
                        if (!string.IsNullOrWhiteSpace(description)) name = description.Trim();
                    } catch { }
                    if (string.IsNullOrEmpty(name)) name = process.ProcessName;
                } catch { continue; }
            }
            parts.Add("{\"pid\":" + entry.Key + ",\"name\":" + Helper.Str(name) + ",\"path\":" + Helper.Str(path) +
                ",\"volume\":" + (int)Math.Round(level * 100) + ",\"muted\":" + (muted ? "true" : "false") +
                ",\"system\":" + (system ? "true" : "false") + "}");
        }
        Helper.Emit("{\"type\":\"mixer\",\"sessions\":[" + string.Join(",", parts.ToArray()) + "]}");
    }

    public static void Set(uint pid, int percent) {
        Dictionary<uint, IAudioSessionControl2> controls;
        float level = Math.Max(0, Math.Min(100, percent)) / 100f;
        foreach (var entry in Sessions(out controls)) {
            if (entry.Key != pid) continue;
            entry.Value.SetMasterVolume(level, ref context);
            if (level > 0) entry.Value.SetMute(false, ref context);
        }
        List();
    }

    public static void Mute(uint pid, string mode) {
        Dictionary<uint, IAudioSessionControl2> controls;
        bool? next = null;
        foreach (var entry in Sessions(out controls)) {
            if (entry.Key != pid) continue;
            if (next == null) {
                bool muted;
                entry.Value.GetMute(out muted);
                next = mode == "on" ? true : mode == "off" ? false : !muted;
            }
            entry.Value.SetMute(next.Value, ref context);
        }
        List();
    }
}

// Laptop panels answer to WMI; external monitors only to DDC/CI (dxva2).
static class Brightness {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PHYSICAL_MONITOR { public IntPtr handle; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string description; }
    delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr rect, IntPtr data);

    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);
    [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint count);
    [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint count, [Out] PHYSICAL_MONITOR[] monitors);
    [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr monitor, out uint min, out uint current, out uint max);
    [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr monitor, uint value);

    class Ddc { public IntPtr handle; public uint min; public uint max; }

    static bool useWmi;
    static readonly List<Ddc> monitors = new List<Ddc>();
    static int current = -1;
    static int requested = -1;
    static readonly AutoResetEvent wake = new AutoResetEvent(false);

    public static bool Supported { get { return useWmi || monitors.Count > 0; } }

    public static void Init() {
        try {
            using (var searcher = new ManagementObjectSearcher("root\\wmi", "SELECT CurrentBrightness FROM WmiMonitorBrightness")) {
                foreach (ManagementObject item in searcher.Get()) {
                    current = Convert.ToInt32(item["CurrentBrightness"]);
                    useWmi = true;
                    break;
                }
            }
        } catch { useWmi = false; }

        if (useWmi) {
            try {
                var watcher = new ManagementEventWatcher(new ManagementScope("root\\wmi"), new EventQuery("SELECT * FROM WmiMonitorBrightnessEvent"));
                watcher.EventArrived += (s, e) => {
                    current = Convert.ToInt32(e.NewEvent.Properties["Brightness"].Value);
                    Helper.EmitBrightness(current);
                };
                watcher.Start();
            } catch { }
        } else {
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMonitor, hdc, rect, data) => {
                uint count;
                if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMonitor, out count) || count == 0) return true;
                var physical = new PHYSICAL_MONITOR[count];
                if (!GetPhysicalMonitorsFromHMONITOR(hMonitor, count, physical)) return true;
                foreach (var p in physical) {
                    uint min, cur, max;
                    if (GetMonitorBrightness(p.handle, out min, out cur, out max) && max > min) {
                        monitors.Add(new Ddc { handle = p.handle, min = min, max = max });
                        if (current < 0) current = (int)Math.Round(100.0 * (cur - min) / (max - min));
                    }
                }
                return true;
            }, IntPtr.Zero);
        }

        // DDC/CI writes take ~50ms per monitor: apply only the latest request.
        var worker = new Thread(Apply);
        worker.IsBackground = true;
        worker.Start();
    }

    public static void Report() {
        if (Supported) Helper.EmitBrightness(current);
        else Helper.Emit("{\"type\":\"brightness\",\"value\":-1,\"supported\":false}");
    }

    public static void Request(int percent) {
        if (!Supported) { Report(); return; }
        Interlocked.Exchange(ref requested, Math.Max(0, Math.Min(100, percent)));
        wake.Set();
    }

    static void Apply() {
        while (true) {
            wake.WaitOne();
            int value = Interlocked.Exchange(ref requested, -1);
            if (value < 0) continue;
            try {
                if (useWmi) {
                    using (var cls = new ManagementClass("root\\wmi", "WmiMonitorBrightnessMethods", null)) {
                        foreach (ManagementObject item in cls.GetInstances()) {
                            item.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)value });
                        }
                    }
                } else {
                    foreach (var m in monitors) {
                        SetMonitorBrightness(m.handle, (uint)(m.min + Math.Round((m.max - m.min) * value / 100.0)));
                    }
                }
                current = value;
                Helper.EmitBrightness(current);
            } catch (Exception e) {
                Helper.EmitError("brightness: " + e.Message);
            }
        }
    }
}

static class WinRt {
    // AsTask() needs the full "Windows" metadata union, which isn't available
    // to the in-box compiler, so wait on the WinRT operation directly.
    public static T Await<T>(IAsyncOperation<T> op) {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (op.Status == AsyncStatus.Started) {
            if (DateTime.UtcNow > deadline) { op.Cancel(); throw new TimeoutException("WinRT call timed out"); }
            Thread.Sleep(5);
        }
        if (op.Status != AsyncStatus.Completed) throw new InvalidOperationException("WinRT call " + op.Status);
        return op.GetResults();
    }
}

static class Media {
    static GlobalSystemMediaTransportControlsSessionManager manager;
    static readonly object managerLock = new object();
    static string lastTimeline = "";

    static GlobalSystemMediaTransportControlsSessionManager Manager {
        get {
            lock (managerLock) {
                if (manager == null) manager = WinRt.Await(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
                return manager;
            }
        }
    }

    // Browsers report Position only on play/pause/seek. LastUpdatedTime says
    // when that Position was true, which the SMTC addon doesn't expose.
    public static void ResendTimeline() { lastTimeline = ""; }

    public static void StartTimeline() {
        var thread = new Thread(() => {
            while (true) {
                try {
                    var parts = new List<string>();
                    foreach (var session in Manager.GetSessions()) {
                        var timeline = session.GetTimelineProperties();
                        long updated = timeline.LastUpdatedTime.ToUnixTimeMilliseconds();
                        parts.Add("{\"appId\":" + Helper.Str(session.SourceAppUserModelId) +
                            ",\"position\":" + timeline.Position.TotalSeconds.ToString("0.###", CultureInfo.InvariantCulture) +
                            ",\"updated\":" + updated + "}");
                    }
                    string json = "{\"type\":\"timeline\",\"sessions\":[" + string.Join(",", parts.ToArray()) + "]}";
                    if (json != lastTimeline) { lastTimeline = json; Helper.Emit(json); }
                } catch (Exception e) { Helper.EmitError("timeline: " + e.Message); }
                Thread.Sleep(1000);
            }
        });
        thread.IsBackground = true;
        thread.Start();
    }

    public static void Seek(double seconds, string appId) {
        bool ok = false;
        try {
            var manager = Manager;
            GlobalSystemMediaTransportControlsSession target = null;
            if (!string.IsNullOrEmpty(appId)) {
                foreach (var session in manager.GetSessions()) {
                    if (session.SourceAppUserModelId == appId) { target = session; break; }
                }
            }
            if (target == null) target = manager.GetCurrentSession();
            if (target != null) {
                long ticks = (long)(Math.Max(0, seconds) * TimeSpan.TicksPerSecond);
                ok = WinRt.Await(target.TryChangePlaybackPositionAsync(ticks));
            }
        } catch (Exception e) {
            Helper.EmitError("seek: " + e.Message);
        }
        Helper.Emit("{\"type\":\"seek\",\"ok\":" + (ok ? "true" : "false") + "}");
    }
}

// Camera/microphone use, from the same consent store the Windows privacy
// indicator reads: an app is using the device while LastUsedTimeStop is 0.
static class Privacy {
    const string Root = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\";
    static string last = "";

    static bool InUse(RegistryKey key) {
        object start = key.GetValue("LastUsedTimeStart");
        object stop = key.GetValue("LastUsedTimeStop");
        if (start == null) return false;
        long startValue = Convert.ToInt64(start);
        long stopValue = stop == null ? 0 : Convert.ToInt64(stop);
        return startValue > 0 && (stopValue == 0 || startValue > stopValue);
    }

    static string Friendly(string keyName, bool nonPackaged) {
        if (nonPackaged) {
            // "C:#Program Files#Zoom#bin#Zoom.exe" -> "Zoom"
            string file = keyName.Substring(keyName.LastIndexOf('#') + 1);
            return file.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? file.Substring(0, file.Length - 4) : file;
        }
        // "Microsoft.WindowsCamera_8wekyb3d8bbwe" -> "WindowsCamera"
        string name = keyName.Split('_')[0];
        int dot = name.LastIndexOf('.');
        return dot >= 0 ? name.Substring(dot + 1) : name;
    }

    static List<string> ActiveApps(string capability) {
        var apps = new List<string>();
        foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine }) {
            using (var store = hive.OpenSubKey(Root + capability)) {
                if (store == null) continue;
                foreach (string name in store.GetSubKeyNames()) {
                    using (var sub = store.OpenSubKey(name)) {
                        if (sub == null) continue;
                        if (string.Equals(name, "NonPackaged", StringComparison.OrdinalIgnoreCase)) {
                            foreach (string exe in sub.GetSubKeyNames()) {
                                using (var app = sub.OpenSubKey(exe)) {
                                    if (app != null && InUse(app)) Add(apps, Friendly(exe, true));
                                }
                            }
                        } else if (InUse(sub)) {
                            Add(apps, Friendly(name, false));
                        }
                    }
                }
            }
        }
        return apps;
    }

    static void Add(List<string> apps, string name) { if (!apps.Contains(name)) apps.Add(name); }

    public static void Start() {
        var thread = new Thread(() => {
            while (true) {
                try {
                    string json = "{\"type\":\"privacy\",\"camera\":" + Helper.StrArray(ActiveApps("webcam")) +
                        ",\"microphone\":" + Helper.StrArray(ActiveApps("microphone")) + "}";
                    if (json != last) { last = json; Helper.Emit(json); }
                } catch (Exception e) { Helper.EmitError("privacy: " + e.Message); }
                Thread.Sleep(1000);
            }
        });
        thread.IsBackground = true;
        thread.Start();
    }
}

// Network throughput, GPU 3D usage and CPU temperature, only while the UI
// shows them ("stats on"). CPU temperature needs LibreHardwareMonitor running
// (its WMI provider); Windows exposes no CPU sensor to normal apps.
static class NetStats {
    static volatile bool enabled;
    public static void SetEnabled(bool on) { enabled = on; }

    static void Totals(out long rx, out long tx) {
        rx = 0; tx = 0;
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces()) {
            if (ni.OperationalStatus != OperationalStatus.Up) continue;
            if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback || ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
            var stats = ni.GetIPStatistics();
            rx += stats.BytesReceived;
            tx += stats.BytesSent;
        }
    }

    // "GPU Engine" counters, one per process+engine; 3D engines summed and
    // capped at 100. Instances come and go, so the list is rebuilt every 10 s.
    static List<System.Diagnostics.PerformanceCounter> gpuCounters = new List<System.Diagnostics.PerformanceCounter>();
    static int gpuAge = 999;
    static double GpuUsage() {
        if (++gpuAge >= 10) {
            gpuAge = 0;
            foreach (var c in gpuCounters) c.Dispose();
            gpuCounters = new List<System.Diagnostics.PerformanceCounter>();
            try {
                var category = new System.Diagnostics.PerformanceCounterCategory("GPU Engine");
                foreach (var name in category.GetInstanceNames()) {
                    if (!name.EndsWith("engtype_3D")) continue;
                    var counter = new System.Diagnostics.PerformanceCounter("GPU Engine", "Utilization Percentage", name, true);
                    counter.NextValue();
                    gpuCounters.Add(counter);
                }
            } catch { return -1; }
            return -1;
        }
        double total = 0;
        foreach (var c in gpuCounters) { try { total += c.NextValue(); } catch { } }
        return Math.Min(100, total);
    }

    static double CpuTemperature() {
        try {
            using (var searcher = new ManagementObjectSearcher(@"root\LibreHardwareMonitor","SELECT Name, Value, Identifier FROM Sensor WHERE SensorType = 'Temperature'")) {
                double best = -1;
                foreach (ManagementObject sensor in searcher.Get()) {
                    string id = Convert.ToString(sensor["Identifier"]);
                    if (id == null || !(id.Contains("/amdcpu/") || id.Contains("/intelcpu/"))) continue;
                    best = Math.Max(best, Convert.ToDouble(sensor["Value"]));
                }
                return best;
            }
        } catch { return -1; }
    }

    public static void Start() {
        var thread = new Thread(() => {
            long prevRx = -1, prevTx = -1;
            int tick = 0;
            double cpuTemp = -1;
            while (true) {
                Thread.Sleep(1000);
                if (!enabled) { prevRx = -1; gpuAge = 999; continue; }
                try {
                    long rx, tx;
                    Totals(out rx, out tx);
                    if (tick++ % 2 == 0) cpuTemp = CpuTemperature();
                    double gpu = GpuUsage();
                    if (prevRx >= 0) Helper.Emit("{\"type\":\"net\",\"rx\":" + Math.Max(0, rx - prevRx) + ",\"tx\":" + Math.Max(0, tx - prevTx) +
                        ",\"gpu\":" + Math.Round(gpu).ToString(CultureInfo.InvariantCulture) +
                        ",\"cpuTemp\":" + Math.Round(cpuTemp).ToString(CultureInfo.InvariantCulture) + "}");
                    prevRx = rx; prevTx = tx;
                } catch (Exception e) { Helper.EmitError("net: " + e.Message); }
            }
        });
        thread.IsBackground = true;
        thread.Start();
    }
}

// Paired Bluetooth devices: connection state from WinRT, battery from the
// PnP property Windows shows in Settings (hands-free profile devices only).
static class Bluetooth {
    const string BatteryKey = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
    static string last = "";

    static int Battery(string name) {
        try {
            string safe = name.Replace("\\", "\\\\").Replace("'", "\\'");
            using (var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_PnPEntity WHERE Name = '" + safe + "'")) {
                foreach (ManagementObject device in searcher.Get()) {
                    var input = device.GetMethodParameters("GetDeviceProperties");
                    input["devicePropertyKeys"] = new[] { BatteryKey };
                    var output = device.InvokeMethod("GetDeviceProperties", input, null);
                    var props = output["deviceProperties"] as ManagementBaseObject[];
                    if (props == null) continue;
                    foreach (var prop in props) {
                        object data = prop["Data"];
                        if (data != null) return Convert.ToInt32(data);
                    }
                }
            }
        } catch { }
        return -1;
    }

    static string Scan() {
        var parts = new List<string>();
        var seen = new HashSet<string>();
        var selectors = new[] {
            BluetoothDevice.GetDeviceSelectorFromPairingState(true),
            BluetoothLEDevice.GetDeviceSelectorFromPairingState(true)
        };
        for (int i = 0; i < selectors.Length; i++) {
            var found = WinRt.Await(DeviceInformation.FindAllAsync(selectors[i]));
            foreach (var info in found) {
                bool connected;
                string name;
                if (i == 0) {
                    var device = WinRt.Await(BluetoothDevice.FromIdAsync(info.Id));
                    if (device == null) continue;
                    connected = device.ConnectionStatus == BluetoothConnectionStatus.Connected;
                    name = device.Name;
                    device.Dispose();
                } else {
                    var device = WinRt.Await(BluetoothLEDevice.FromIdAsync(info.Id));
                    if (device == null) continue;
                    connected = device.ConnectionStatus == BluetoothConnectionStatus.Connected;
                    name = device.Name;
                    device.Dispose();
                }
                if (string.IsNullOrEmpty(name) || !seen.Add(name)) continue;
                int battery = connected ? Battery(name) : -1;
                parts.Add("{\"name\":" + Helper.Str(name) + ",\"connected\":" + (connected ? "true" : "false") + ",\"battery\":" + battery + "}");
            }
        }
        return "{\"type\":\"bluetooth\",\"devices\":[" + string.Join(",", parts.ToArray()) + "]}";
    }

    public static void Start() {
        var thread = new Thread(() => {
            while (true) {
                try {
                    string json = Scan();
                    if (json != last) { last = json; Helper.Emit(json); }
                } catch (Exception e) { Helper.EmitError("bluetooth: " + e.Message); }
                Thread.Sleep(5000);
            }
        });
        thread.IsBackground = true;
        thread.Start();
    }
}

// Alt+left click on a file in Explorer or on the desktop opens TopNotch's
// file wheel. A low-level mouse hook catches Alt+clicks over Explorer's item
// views and holds them back; a worker thread asks UI Automation which item is
// under the cursor and maps it to a path. Files are reported to the app; any
// other click (folders, empty space, headers) is replayed unchanged, so
// Explorer's own Alt+click still works there.
static class FileClick {
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; public uint pad1, pad2; }
    [StructLayout(LayoutKind.Sequential)] struct KEYINPUT_WRAPPER { public uint type; public KEYBDINPUT ki; }
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT pt);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder name, int max);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll", EntryPoint = "SendInput")] static extern uint SendKeys(uint count, KEYINPUT_WRAPPER[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT pt);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    const int WH_MOUSE_LL = 14;
    const int WM_LBUTTONDOWN = 0x0201, WM_LBUTTONUP = 0x0202;
    const uint LLMHF_INJECTED = 0x1;
    const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;

    static volatile bool enabled;
    static HookProc proc;          // kept alive so the GC doesn't collect the callback
    static bool holding;           // an Alt+click is being held back
    static POINT heldAt;
    static readonly System.Collections.Concurrent.BlockingCollection<POINT> queue = new System.Collections.Concurrent.BlockingCollection<POINT>();

    static volatile HashSet<string> extensions = new HashSet<string>();

    // "fileclick on png,jpg,…": only these file types open the wheel; any
    // other file gets its click back.
    public static void SetEnabled(bool on, string exts) {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (exts != null) foreach (var e in exts.Split(',')) if (e.Length > 0) set.Add("." + e.Trim());
        extensions = set;
        enabled = on;
    }

    // Diagnostics: resolve a screen point without clicking.
    public static void Probe(int x, int y) {
        var t = new Thread(() => {
            string path = null;
            try { var pt = new POINT(); pt.x = x; pt.y = y; path = Resolve(pt); } catch (Exception e) { Helper.EmitError("file-probe: " + e.Message); }
            Helper.Emit("{\"type\":\"file-probe\",\"path\":" + (path == null ? "null" : Helper.Str(path)) + "}");
        });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
    }

    static string ClassOf(IntPtr hwnd) {
        var name = new System.Text.StringBuilder(64);
        GetClassName(hwnd, name, 64);
        return name.ToString();
    }

    // Item views: Explorer's DirectUIHWND inside a CabinetWClass window, or the
    // desktop's SysListView32 inside Progman/WorkerW.
    static bool OverItemView(POINT pt) {
        IntPtr hwnd = WindowFromPoint(pt);
        if (hwnd == IntPtr.Zero) return false;
        string cls = ClassOf(hwnd);
        string root = ClassOf(GetAncestor(hwnd, 2 /* GA_ROOT */));
        if (root == "CabinetWClass") return cls == "DirectUIHWND";
        if (root == "Progman" || root == "WorkerW") return cls == "SysListView32";
        return false;
    }

    static IntPtr Hook(int code, IntPtr wParam, IntPtr lParam) {
        if (code >= 0) {
            var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            int msg = wParam.ToInt32();
            if ((info.flags & LLMHF_INJECTED) == 0) {
                if (msg == WM_LBUTTONDOWN && enabled
                    && (GetAsyncKeyState(VK_MENU) & 0x8000) != 0
                    && (GetAsyncKeyState(VK_CONTROL) & 0x8000) == 0  // AltGr is Ctrl+Alt
                    && (GetAsyncKeyState(VK_SHIFT) & 0x8000) == 0
                    && OverItemView(info.pt)) {
                    holding = true;
                    heldAt = info.pt;
                    ThreadPool.QueueUserWorkItem(_ => MaskAlt());
                    return (IntPtr)1;
                }
                if (msg == WM_LBUTTONUP && holding) {
                    holding = false;
                    queue.Add(heldAt);
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    // Releasing Alt on its own makes the active window open its menu bar
    // (Explorer's "File, Edit, View…"). Pressing an unassigned key while Alt
    // is down marks it as used, so the release does nothing.
    static void MaskAlt() {
        var keys = new KEYINPUT_WRAPPER[2];
        keys[0].type = 1; keys[0].ki.wVk = 0xE8;
        keys[1].type = 1; keys[1].ki.wVk = 0xE8; keys[1].ki.dwFlags = 0x0002; // KEYUP
        SendKeys(2, keys, Marshal.SizeOf(typeof(KEYINPUT_WRAPPER)));
    }

    // Puts a held-back click back exactly where it happened.
    // Absolute coordinates on the whole virtual desktop, so the click lands
    // where it happened even if the pointer has moved on since, and the
    // pointer ends up back where the user left it.
    static void Replay(POINT pt) {
        POINT now;
        GetCursorPos(out now);
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        Func<POINT, MOUSEINPUT> move = (p) => {
            var mi = new MOUSEINPUT();
            mi.dx = (int)Math.Round((p.x - vx) * 65535.0 / Math.Max(1, vw - 1));
            mi.dy = (int)Math.Round((p.y - vy) * 65535.0 / Math.Max(1, vh - 1));
            mi.dwFlags = 0x0001 | 0x8000 | 0x4000; // MOVE | ABSOLUTE | VIRTUALDESK
            return mi;
        };
        var inputs = new INPUT[4];
        inputs[0].type = 0; inputs[0].mi = move(pt);
        inputs[1].type = 0; inputs[1].mi.dwFlags = 0x0002; // LEFTDOWN
        inputs[2].type = 0; inputs[2].mi.dwFlags = 0x0004; // LEFTUP
        inputs[3].type = 0; inputs[3].mi = move(now);
        SendInput(4, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    static object Invoke(object target, string member, System.Reflection.BindingFlags kind, params object[] args) {
        return target.GetType().InvokeMember(member, kind, null, target, args);
    }
    static object Get(object target, string name) { return Invoke(target, name, System.Reflection.BindingFlags.GetProperty); }

    // Folders shown by the Explorer window that owns hwnd, via Shell.Application.
    // Windows 11 tabs all report the window's HWND, so every tab is returned
    // and the caller looks for the clicked item in each.
    static List<object> ExplorerFolders(IntPtr root) {
        var result = new List<object>();
        var shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
        var windows = Invoke(shell, "Windows", System.Reflection.BindingFlags.InvokeMethod);
        int count = (int)Get(windows, "Count");
        for (int i = 0; i < count; i++) {
            object window = null;
            try { window = Invoke(windows, "Item", System.Reflection.BindingFlags.InvokeMethod, i); } catch { }
            if (window == null) continue;
            try {
                if (new IntPtr(Convert.ToInt64(Get(window, "HWND"))) != root) continue;
                result.Add(Get(Get(window, "Document"), "Folder"));
            } catch { }
        }
        return result;
    }

    // Virtual views (Home, Recent, search results) have no folder on disk;
    // find the item by its display name and take the file it points to.
    static string FindInShellFolder(object folder, string name) {
        try {
            var items = Invoke(folder, "Items", System.Reflection.BindingFlags.InvokeMethod);
            int count = (int)Get(items, "Count");
            for (int i = 0; i < count && i < 5000; i++) {
                object item = null;
                try { item = Invoke(items, "Item", System.Reflection.BindingFlags.InvokeMethod, i); } catch { }
                if (item == null) continue;
                string itemName = Get(item, "Name") as string;
                string path = Get(item, "Path") as string;
                if (path == null) continue;
                if (string.Equals(itemName, name, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(System.IO.Path.GetFileName(path), name, StringComparison.OrdinalIgnoreCase)) {
                    if (System.IO.File.Exists(path)) return path;
                }
            }
        } catch { }
        return null;
    }

    // UI Automation names an item by its display name, which hides the
    // extension when Explorer is set to; match either form.
    static string MatchFile(IEnumerable<string> folders, string name) {
        string loose = null;
        foreach (var folder in folders) {
            if (string.IsNullOrEmpty(folder) || !System.IO.Directory.Exists(folder)) continue;
            foreach (var file in System.IO.Directory.EnumerateFiles(folder)) {
                if (string.Equals(System.IO.Path.GetFileName(file), name, StringComparison.OrdinalIgnoreCase)) return file;
                if (loose == null && string.Equals(System.IO.Path.GetFileNameWithoutExtension(file), name, StringComparison.OrdinalIgnoreCase)) loose = file;
            }
        }
        return loose;
    }

    static string Resolve(POINT pt) {
        var element = System.Windows.Automation.AutomationElement.FromPoint(new System.Windows.Point(pt.x, pt.y));
        var walker = System.Windows.Automation.TreeWalker.ControlViewWalker;
        for (int depth = 0; element != null && depth < 6; depth++) {
            if (element.Current.ControlType == System.Windows.Automation.ControlType.ListItem) break;
            element = walker.GetParent(element);
        }
        if (element == null || element.Current.ControlType != System.Windows.Automation.ControlType.ListItem) return null;
        string name = element.Current.Name;
        if (string.IsNullOrEmpty(name)) return null;

        IntPtr root = GetAncestor(WindowFromPoint(pt), 2);
        string cls = ClassOf(root);
        string file = null;
        if (cls == "CabinetWClass") {
            var tabs = ExplorerFolders(root);
            var paths = new List<string>();
            foreach (var folder in tabs) {
                try {
                    string path = Get(Get(folder, "Self"), "Path") as string;
                    if (path != null && System.IO.Directory.Exists(path)) paths.Add(path);
                } catch { }
            }
            file = MatchFile(paths, name);
            if (file == null) foreach (var folder in tabs) { file = FindInShellFolder(folder, name); if (file != null) break; }
            if (file == null) Helper.EmitError("file-click: '" + name + "' not found in " + tabs.Count + " Explorer tab(s)");
        } else {
            file = MatchFile(new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)
            }, name);
        }
        if (file == null || !extensions.Contains(System.IO.Path.GetExtension(file))) return null;
        return file;
    }

    public static void Start() {
        SetProcessDPIAware(); // hook and UI Automation then agree on physical pixels
        var hookThread = new Thread(() => {
            proc = Hook;
            SetWindowsHookEx(WH_MOUSE_LL, proc, GetModuleHandle(null), 0);
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
        });
        hookThread.IsBackground = true;
        hookThread.Start();

        var worker = new Thread(() => {
            foreach (var pt in queue.GetConsumingEnumerable()) {
                string path = null;
                try { path = Resolve(pt); } catch (Exception e) { Helper.EmitError("file-click: " + e.Message); }
                if (path != null) Helper.Emit("{\"type\":\"file-click\",\"path\":" + Helper.Str(path) + ",\"x\":" + pt.x + ",\"y\":" + pt.y + "}");
                else Replay(pt);
            }
        });
        worker.SetApartmentState(ApartmentState.STA);
        worker.IsBackground = true;
        worker.Start();
    }
}

public static class Helper {
    static readonly object writeLock = new object();

    internal static string Str(string value) {
        var sb = new System.Text.StringBuilder("\"");
        foreach (char c in value) {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }
    internal static string StrArray(List<string> values) {
        var quoted = new List<string>();
        foreach (var v in values) quoted.Add(Str(v));
        return "[" + string.Join(",", quoted.ToArray()) + "]";
    }

    internal static void Emit(string json) {
        lock (writeLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }
    internal static void EmitVolume(float level, bool muted) {
        Emit("{\"type\":\"volume\",\"value\":" + (int)Math.Round(level * 100) + ",\"muted\":" + (muted ? "true" : "false") + "}");
    }
    internal static void EmitBrightness(int value) {
        Emit("{\"type\":\"brightness\",\"value\":" + value + ",\"supported\":true}");
    }
    internal static void EmitError(string message) {
        Emit("{\"type\":\"error\",\"message\":" + Str(message) + "}");
    }

    public static void Run() {
        try { Audio.Init(); } catch (Exception e) { EmitError("audio: " + e.Message); }
        try { Brightness.Init(); } catch (Exception e) { EmitError("brightness init: " + e.Message); }
        Media.StartTimeline();
        FileClick.Start();
        Meter.Start();
        Privacy.Start();
        NetStats.Start();
        Bluetooth.Start();
        Emit("{\"type\":\"ready\"}");
        try { Audio.Report(); } catch { }
        Brightness.Report();

        string line;
        while ((line = Console.In.ReadLine()) != null) {
            var parts = line.Trim().Split(new[] { ' ' }, 3);
            if (parts.Length == 0 || parts[0].Length == 0) continue;
            try {
                switch (parts[0]) {
                    case "volume": Audio.SetLevel(int.Parse(parts[1], CultureInfo.InvariantCulture)); break;
                    case "mute": Audio.SetMute(parts.Length > 1 ? parts[1] : "toggle"); break;
                    case "brightness": Brightness.Request(int.Parse(parts[1], CultureInfo.InvariantCulture)); break;
                    case "seek": Media.Seek(double.Parse(parts[1], CultureInfo.InvariantCulture), parts.Length > 2 ? parts[2] : null); break;
                    case "timeline": Media.ResendTimeline(); break;
                    case "meter": Meter.SetEnabled(parts.Length > 1 && parts[1] == "on"); break;
                    case "fileclick":
                        var probe = line.Trim().Split(' ');
                        if (probe.Length > 3 && probe[1] == "probe") FileClick.Probe(int.Parse(probe[2]), int.Parse(probe[3]));
                        else FileClick.SetEnabled(probe.Length > 1 && probe[1] == "on", probe.Length > 2 ? probe[2] : null);
                        break;
                    case "stats": NetStats.SetEnabled(parts.Length > 1 && parts[1] == "on"); break;
                    case "mixer": {
                        // mixer list | mixer set <pid> <0-100> | mixer mute <pid> <on|off|toggle>
                        var args = line.Trim().Split(' ');
                        if (args.Length >= 4 && args[1] == "set") Mixer.Set(uint.Parse(args[2]), int.Parse(args[3], CultureInfo.InvariantCulture));
                        else if (args.Length >= 4 && args[1] == "mute") Mixer.Mute(uint.Parse(args[2]), args[3]);
                        else Mixer.List();
                        break;
                    }
                    case "get": Audio.Report(); Brightness.Report(); break;
                    default: EmitError("unknown command: " + parts[0]); break;
                }
            } catch (Exception e) {
                EmitError(parts[0] + ": " + e.Message);
            }
        }
    }
}

}
