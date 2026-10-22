// TopNotch system helper for macOS: the counterpart of system-helper.cs.
// Speaks the same JSON-lines protocol on stdin/stdout:
//   in:  volume <0-100> | mute <on|off|toggle> | brightness <0-100>
//        stats <on|off> | fileclick <on|off> [ext,ext,…] | get
//        (meter, mixer, timeline and seek are Windows-only and ignored)
//   out: ready, volume, brightness, privacy, net, bluetooth, file-click, error
// Built in CI with: swiftc -O helper.swift -o topnotch-helper

import AppKit
import AudioToolbox
import CoreAudio
import CoreMediaIO
import Foundation
import IOBluetooth
import IOKit

// ── Output ─────────────────────────────────────────────────────────────────

let outputLock = NSLock()

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          let line = String(data: data, encoding: .utf8) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    outputLock.unlock()
}

func emitError(_ message: String) {
    emit(["type": "error", "message": message])
}

// ── Volume (CoreAudio, default output device) ──────────────────────────────

enum Volume {
    static var device = AudioObjectID(kAudioObjectUnknown)
    static var lastReport = ""

    static func address(_ selector: AudioObjectPropertySelector,
                        _ scope: AudioObjectPropertyScope = kAudioDevicePropertyScopeOutput) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    static func defaultOutput() -> AudioObjectID {
        var id = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var where_ = address(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &where_, 0, nil, &size, &id)
        return id
    }

    static func level() -> Float? {
        var value = Float32(0)
        var size = UInt32(MemoryLayout<Float32>.size)
        var where_ = address(kAudioHardwareServiceDeviceProperty_VirtualMainVolume)
        guard AudioObjectHasProperty(device, &where_),
              AudioObjectGetPropertyData(device, &where_, 0, nil, &size, &value) == noErr else { return nil }
        return value
    }

    static func muted() -> Bool {
        var value = UInt32(0)
        var size = UInt32(MemoryLayout<UInt32>.size)
        var where_ = address(kAudioDevicePropertyMute)
        guard AudioObjectHasProperty(device, &where_),
              AudioObjectGetPropertyData(device, &where_, 0, nil, &size, &value) == noErr else { return false }
        return value != 0
    }

    static func report(force: Bool = false) {
        guard let value = level() else { return }
        let percent = Int((value * 100).rounded())
        let isMuted = muted()
        let key = "\(percent)|\(isMuted)"
        if !force && key == lastReport { return }
        lastReport = key
        emit(["type": "volume", "value": percent, "muted": isMuted])
    }

    static func set(_ percent: Int) {
        var value = Float32(max(0, min(100, percent))) / 100
        var where_ = address(kAudioHardwareServiceDeviceProperty_VirtualMainVolume)
        AudioObjectSetPropertyData(device, &where_, 0, nil, UInt32(MemoryLayout<Float32>.size), &value)
        if value > 0 && muted() { setMute("off") }
    }

    static func setMute(_ mode: String) {
        var value: UInt32 = mode == "on" ? 1 : mode == "off" ? 0 : (muted() ? 0 : 1)
        var where_ = address(kAudioDevicePropertyMute)
        AudioObjectSetPropertyData(device, &where_, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value)
    }

    static func watch(_ id: AudioObjectID) {
        for selector in [kAudioHardwareServiceDeviceProperty_VirtualMainVolume, kAudioDevicePropertyMute] {
            var where_ = address(selector)
            AudioObjectAddPropertyListenerBlock(id, &where_, DispatchQueue.main) { _, _ in report() }
        }
    }

    static func start() {
        device = defaultOutput()
        watch(device)
        var where_ = address(kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal)
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &where_, DispatchQueue.main) { _, _ in
            device = defaultOutput()
            watch(device)
            report(force: true)
        }
        report(force: true)
    }
}

// ── Brightness (built-in display, DisplayServices) ─────────────────────────

enum Brightness {
    typealias GetFn = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
    typealias SetFn = @convention(c) (UInt32, Float) -> Int32
    static var get: GetFn?
    static var setter: SetFn?
    static var display: UInt32 = 0
    static var last = -2

    static func start() {
        if let handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY) {
            if let g = dlsym(handle, "DisplayServicesGetBrightness") { get = unsafeBitCast(g, to: GetFn.self) }
            if let s = dlsym(handle, "DisplayServicesSetBrightness") { setter = unsafeBitCast(s, to: SetFn.self) }
        }
        var count: UInt32 = 0
        var ids = [CGDirectDisplayID](repeating: 0, count: 16)
        CGGetOnlineDisplayList(16, &ids, &count)
        display = ids.prefix(Int(count)).first(where: { CGDisplayIsBuiltin($0) != 0 }) ?? CGMainDisplayID()
        report()
        // Brightness keys don't notify; a light poll catches them.
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in report() }
    }

    static func current() -> Int? {
        guard let get = get else { return nil }
        var value: Float = 0
        return get(display, &value) == 0 ? Int((value * 100).rounded()) : nil
    }

    static func report(force: Bool = false) {
        guard let value = current() else {
            if last != -1 { last = -1; emit(["type": "brightness", "value": -1, "supported": false]) }
            return
        }
        if !force && value == last { return }
        last = value
        emit(["type": "brightness", "value": value, "supported": true])
    }

    static func set(_ percent: Int) {
        _ = setter?(display, Float(max(0, min(100, percent))) / 100)
        report(force: true)
    }
}

// ── Camera and microphone in use ───────────────────────────────────────────

enum Privacy {
    static var last = ""

    static func microphoneInUse() -> Bool {
        var id = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var where_ = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                                mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &where_, 0, nil, &size, &id) == noErr,
              id != kAudioObjectUnknown else { return false }
        var running = UInt32(0)
        size = UInt32(MemoryLayout<UInt32>.size)
        var runningAddress = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
                                                        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        AudioObjectGetPropertyData(id, &runningAddress, 0, nil, &size, &running)
        return running != 0
    }

    static func cameraInUse() -> Bool {
        var where_ = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
                                               mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                                               mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var size: UInt32 = 0
        guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &where_, 0, nil, &size) == 0, size > 0 else { return false }
        let count = Int(size) / MemoryLayout<CMIOObjectID>.size
        var devices = [CMIOObjectID](repeating: 0, count: count)
        var used: UInt32 = 0
        guard CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &where_, 0, nil, size, &used, &devices) == 0 else { return false }
        for device in devices {
            var running = UInt32(0)
            var runningAddress = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
                                                           mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeWildcard),
                                                           mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementWildcard))
            var got: UInt32 = 0
            if CMIOObjectGetPropertyData(device, &runningAddress, 0, nil, UInt32(MemoryLayout<UInt32>.size), &got, &running) == 0, running != 0 {
                return true
            }
        }
        return false
    }

    static func start() {
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in report() }
        report()
    }

    // macOS doesn't say which app holds the device, so the notch just shows
    // that one does.
    static func report() {
        let camera = cameraInUse(), mic = microphoneInUse()
        let key = "\(camera)|\(mic)"
        if key == last { return }
        last = key
        emit(["type": "privacy", "camera": camera ? ["Camera"] : [], "microphone": mic ? ["Microphone"] : []])
    }
}

// ── Network, GPU and memory while the System tab is open ───────────────────

enum Stats {
    static var timer: Timer?
    static var previous: (rx: UInt64, tx: UInt64)?

    static func networkBytes() -> (rx: UInt64, tx: UInt64) {
        var rx: UInt64 = 0, tx: UInt64 = 0
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return (0, 0) }
        defer { freeifaddrs(list) }
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let entry = cursor {
            let name = String(cString: entry.pointee.ifa_name)
            if let addr = entry.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_LINK),
               !name.hasPrefix("lo"), let data = entry.pointee.ifa_data {
                let stats = data.assumingMemoryBound(to: if_data.self).pointee
                rx += UInt64(stats.ifi_ibytes)
                tx += UInt64(stats.ifi_obytes)
            }
            cursor = entry.pointee.ifa_next
        }
        return (rx, tx)
    }

    // "Device Utilization %" from the GPU driver's performance statistics.
    static func gpuUsage() -> Int {
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &iterator) == KERN_SUCCESS else { return -1 }
        defer { IOObjectRelease(iterator) }
        var best = -1
        var service = IOIteratorNext(iterator)
        while service != 0 {
            if let stats = IORegistryEntryCreateCFProperty(service, "PerformanceStatistics" as CFString, kCFAllocatorDefault, 0)?
                .takeRetainedValue() as? [String: Any],
               let usage = stats["Device Utilization %"] as? Int {
                best = max(best, usage)
            }
            IOObjectRelease(service)
            service = IOIteratorNext(iterator)
        }
        return best
    }

    // Memory the way Activity Monitor counts it: app + wired + compressed.
    // (Node's os.freemem() leaves out the file cache macOS can reclaim.)
    static func memoryUsed() -> UInt64 {
        var info = vm_statistics64()
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) }
        }
        guard result == KERN_SUCCESS else { return 0 }
        let page = UInt64(vm_kernel_page_size)
        let app = UInt64(info.internal_page_count) - UInt64(info.purgeable_count)
        return (app + UInt64(info.wire_count) + UInt64(info.compressor_page_count)) * page
    }

    static func set(_ on: Bool) {
        timer?.invalidate()
        timer = nil
        previous = nil
        guard on else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            Temperatures.read()
            tick()
        }
        Temperatures.read()
        tick()
    }

    static func tick() {
        let now = networkBytes()
        if let before = previous {
            emit([
                "type": "net",
                "rx": now.rx >= before.rx ? now.rx - before.rx : 0,
                "tx": now.tx >= before.tx ? now.tx - before.tx : 0,
                "gpu": gpuUsage(),
                "cpuTemp": Temperatures.cpu ?? -1,
                "gpuTemp": Temperatures.gpu ?? -1,
                "memUsed": memoryUsed()
            ])
        }
        previous = now
    }
}

// ── CPU and GPU temperature (Apple Silicon) ────────────────────────────────
// The SoC's thermal sensors are HID services (usage page 0xff00, usage 5)
// readable without admin rights through the IOHIDEventSystemClient SPI, the
// same source as Stats and other menu-bar monitors. Sensor names:
// "pACC/eACC MTR Temp Sensor…" and "PMU tdie…" are CPU, "GPU MTR…" is GPU.

@_silgen_name("IOHIDEventSystemClientCreate")
func hidClientCreate(_ allocator: CFAllocator?) -> OpaquePointer?
@_silgen_name("IOHIDEventSystemClientSetMatching")
func hidClientSetMatching(_ client: OpaquePointer, _ matching: CFDictionary) -> Int32
@_silgen_name("IOHIDEventSystemClientCopyServices")
func hidClientCopyServices(_ client: OpaquePointer) -> Unmanaged<CFArray>?
@_silgen_name("IOHIDServiceClientCopyProperty")
func hidServiceCopyProperty(_ service: OpaquePointer, _ key: CFString) -> Unmanaged<CFTypeRef>?
@_silgen_name("IOHIDServiceClientCopyEvent")
func hidServiceCopyEvent(_ service: OpaquePointer, _ type: Int64, _ options: Int32, _ timestamp: Int64) -> OpaquePointer?
@_silgen_name("IOHIDEventGetFloatValue")
func hidEventGetFloatValue(_ event: OpaquePointer, _ field: Int32) -> Double

enum Temperatures {
    static let typeTemperature: Int64 = 15
    static var client: OpaquePointer?
    static var cpu: Int?
    static var gpu: Int?

    static func read() {
        if client == nil {
            client = hidClientCreate(kCFAllocatorDefault)
            if let client = client {
                _ = hidClientSetMatching(client, ["PrimaryUsagePage": 0xff00, "PrimaryUsage": 5] as CFDictionary)
            }
        }
        guard let client = client, let services = hidClientCopyServices(client)?.takeRetainedValue() as? [AnyObject] else { return }
        var cpuMax: Double?, gpuMax: Double?
        for object in services {
            let service = OpaquePointer(Unmanaged.passUnretained(object).toOpaque())
            guard let name = hidServiceCopyProperty(service, "Product" as CFString)?.takeRetainedValue() as? String,
                  let event = hidServiceCopyEvent(service, typeTemperature, 0, 0) else { continue }
            let value = hidEventGetFloatValue(event, Int32(typeTemperature << 16))
            Unmanaged<AnyObject>.fromOpaque(UnsafeRawPointer(event)).release()
            guard value > 5, value < 130 else { continue }
            if name.contains("ACC") || name.contains("tdie") || name.hasPrefix("CPU") {
                cpuMax = max(cpuMax ?? value, value)
            } else if name.hasPrefix("GPU") {
                gpuMax = max(gpuMax ?? value, value)
            }
        }
        cpu = cpuMax.map { Int($0.rounded()) }
        gpu = gpuMax.map { Int($0.rounded()) }
    }
}

// ── File drags (for the shelf) ─────────────────────────────────────────────
// A file drag from Finder or anywhere else writes file URLs to the drag
// pasteboard. Watching its change count while the button is down tells the
// app a file drag is in progress, more reliably than mouse state alone.

enum FileDrag {
    static var lastChange = NSPasteboard(name: .drag).changeCount
    static var active = false

    static func start() {
        Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { _ in poll() }
    }

    static func poll() {
        let down = NSEvent.pressedMouseButtons & 1 != 0
        let board = NSPasteboard(name: .drag)
        if down && !active && board.changeCount != lastChange {
            lastChange = board.changeCount
            let files = board.types?.contains(.fileURL) ?? false
            if files {
                active = true
                emit(["type": "file-drag", "active": true])
            }
        } else if !down && active {
            active = false
            lastChange = board.changeCount
            emit(["type": "file-drag", "active": false])
        } else if !down {
            lastChange = board.changeCount
        }
    }
}

// ── Bluetooth ──────────────────────────────────────────────────────────────

enum Bluetooth {
    static var last = ""

    // Battery for Apple accessories (Magic Keyboard/Mouse/Trackpad, AirPods)
    // from the HID services in the I/O Registry, by product name.
    static func batteries() -> [String: Int] {
        var result: [String: Int] = [:]
        var iterator: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleDeviceManagementHIDEventService"), &iterator) == KERN_SUCCESS else { return result }
        defer { IOObjectRelease(iterator) }
        var service = IOIteratorNext(iterator)
        while service != 0 {
            let product = IORegistryEntryCreateCFProperty(service, "Product" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String
            let percent = IORegistryEntryCreateCFProperty(service, "BatteryPercent" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? Int
            if let product = product, let percent = percent { result[product] = percent }
            IOObjectRelease(service)
            service = IOIteratorNext(iterator)
        }
        return result
    }

    static func report() {
        guard let paired = IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] else { return }
        let levels = batteries()
        let devices: [[String: Any]] = paired.compactMap { device in
            guard let name = device.name, !name.isEmpty else { return nil }
            return ["name": name, "connected": device.isConnected(), "battery": levels[name] ?? -1]
        }
        let key = devices.map { "\($0["name"]!)|\($0["connected"]!)|\($0["battery"]!)" }.joined(separator: ";")
        if key == last { return }
        last = key
        emit(["type": "bluetooth", "devices": devices])
    }

    static func start() {
        report()
        Timer.scheduledTimer(withTimeInterval: 8.0, repeats: true) { _ in report() }
    }
}

// ── Option+click a file in Finder ──────────────────────────────────────────
// The click goes through (it selects the file); a moment later the helper asks
// Finder for its selection. Exactly one supported file opens the wheel. Needs
// no Accessibility permission; macOS asks once to let TopNotch control Finder.

enum FileClick {
    static var enabled = false
    static var extensions = Set<String>()
    static var monitor: Any?

    static func set(_ on: Bool, _ list: String?) {
        enabled = on
        extensions = Set((list ?? "").split(separator: ",").map { $0.lowercased() })
        if on && monitor == nil {
            monitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { event in handle(event) }
        }
    }

    static func handle(_ event: NSEvent) {
        guard enabled else { return }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.option), !flags.contains(.command), !flags.contains(.control), !flags.contains(.shift) else { return }
        // Points in screen coordinates with the origin at the top-left of the
        // main display, matching Electron's DIP coordinates.
        let location = NSEvent.mouseLocation
        let height = NSScreen.screens.first?.frame.height ?? 0
        let x = Int(location.x.rounded()), y = Int((height - location.y).rounded())
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.finder" else { return }
            let script = """
            tell application "Finder"
              set picked to selection as alias list
              if (count of picked) is not 1 then return ""
              return POSIX path of (item 1 of picked)
            end tell
            """
            var error: NSDictionary?
            let result = NSAppleScript(source: script)?.executeAndReturnError(&error).stringValue ?? ""
            if let error = error {
                emitError("file-click: Finder said \(error[NSAppleScript.errorMessage] ?? error)")
                return
            }
            guard !result.isEmpty, !result.hasSuffix("/") else { return }
            let ext = (result as NSString).pathExtension.lowercased()
            guard extensions.contains(ext) else { return }
            emit(["type": "file-click", "path": result, "x": x, "y": y])
        }
    }
}

// ── Commands ───────────────────────────────────────────────────────────────

func handle(_ line: String) {
    let parts = line.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").map(String.init)
    guard let command = parts.first else { return }
    let arg = parts.count > 1 ? parts[1] : ""
    switch command {
    case "volume": if let v = Int(arg) { Volume.set(v) }
    case "mute": Volume.setMute(arg)
    case "brightness": if let v = Int(arg) { Brightness.set(v) }
    case "stats": Stats.set(arg == "on")
    case "fileclick": FileClick.set(arg == "on", parts.count > 2 ? parts[2] : nil)
    case "get":
        Volume.report(force: true)
        Brightness.report(force: true)
    default: break // meter, mixer, timeline, seek: Windows only
    }
}

setvbuf(stdout, nil, _IONBF, 0)
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

Volume.start()
Brightness.start()
Privacy.start()
Bluetooth.start()
FileDrag.start()

// stdin on a background thread; commands run on the main thread. When the
// app closes the pipe, the helper exits.
Thread.detachNewThread {
    while let line = readLine() {
        DispatchQueue.main.async { handle(line) }
    }
    exit(0)
}

emit(["type": "ready"])
app.run()
