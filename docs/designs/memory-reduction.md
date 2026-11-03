# TopNotch memory reduction (staying on Electron)

* **Author:** ppiku4
* **Date:** 2026-11-03

## Overview

TopNotch uses about 600 MB of private memory when idle on Windows (nothing playing, panel closed). The goal is to bring that as low as possible while staying on Electron and keeping every feature on Windows and macOS.

The user's first wish was 100 MB in total. That is out of reach on Electron: a blank transparent Electron window alone measured 152 MB private (471 MB working set) on the same machine. Getting under 100 MB would mean a rewrite in native code, which is out of scope.

Measured on Windows, idle, fresh launch (dev build, 2026-11-03):

| Process | Working set | Private | What it is |
| --- | --- | --- | --- |
| Notch renderer | 175 MB | 114 MB | React UI and animations |
| GPU process | 163 MB | 290 MB | Draws the transparent, animated window |
| Main | 130 MB | 87 MB | Electron core, windows, clipboard, shelf |
| Media worker | 76 MB | 24 MB | A second Electron binary run as Node, only to host the Windows media (SMTC) addon |
| Network service | 54 MB | 15 MB | Weather and lyrics requests |
| System helper (PowerShell) | ~85–115 MB | ~70–86 MB | PowerShell host that compiles `system-helper.cs` in memory at every launch |
| **Total** | ~680 MB | **~600–615 MB** | |

Every saving figure below is a reviewer's estimate. Nothing below has been measured, except the table above.

## Analysis

### Several parts of the plan already exist

The reviewers checked the code and found that much of "load rarely used tools on demand" is already done. That work should not be planned again, and its savings should not be counted twice:

* Settings, Wheel, Editor and Setup pages are already split into their own bundles and loaded per window (`src/main.jsx`).
* sharp, ONNX Runtime, mammoth, ag-psd, turndown and the updater are already loaded only on first use (`electron/convert.cjs`, `bgremove.cjs`, `updater.cjs`).
* The background-removal AI session is already released after 60 seconds idle (`bgremove.cjs`).
* Settings, Setup and Editor windows are destroyed when closed; the glass backdrop is destroyed when glass is turned off.
* Animation pausing is partly built (`AnimationVisibility` in `src/beat.js`, used in `Island.jsx`).

What remains in this area:

* The file wheel window is only hidden, never destroyed (`main.cjs` `hideWheel`). After the first Alt+click its renderer stays alive for the whole session.
* Native libraries (libvips, ONNX Runtime, DirectML) cannot be unloaded once they have run in the main process. Main stays larger for the rest of the session after any conversion or background removal.
* The notch window loads every panel tab at startup, even if the panel is never opened.

### The biggest wins are outside the renderer

1. **The system helper (Windows).** It runs inside a full PowerShell host and compiles C# source in memory at every launch (`electron/system-helper.ps1`). Building it ahead of time as a normal `.exe` and starting that directly would drop the PowerShell host and the compile step. Estimated saving: 50–80 MB, plus faster startup.
2. **The media worker (Windows) is redundant.** The C# helper already holds the same Windows media session manager (`system-helper.cs`), and main already merges the helper's timeline into media state. Moving title, artwork and playback control into the helper would remove the second Electron process and the `@coooookies/windows-smtc-monitor` dependency. Estimated saving: 25–75 MB. On macOS, the worker only wraps a perl script, which main could start directly.
3. **The GPU process (290 MB private) is the largest single item, and nobody knows what fills it.** Likely causes: the fixed 900×600 transparent window that never shrinks (by design), large CSS blur filters (`blur(32px)` in `dashboard.css`, `blur(28px)` in `lyrics.css`), `will-change` layers, endless CSS animations, and box-shadows repainted every frame by the beat effect. Some of it may be driver memory that cannot be reduced. Short experiments are needed before any GPU work (hardware acceleration off, backdrop off, animations paused, blur removed). Estimated saving: 30–150 MB, with wide uncertainty.

### Smaller wins

* Destroy the wheel window after about 60 seconds hidden. It can already be re-created. 50–90 MB, but only after it has been used once.
* Run conversion, background removal and sharp in a separate process that exits when idle. Small gain at idle (10–20 MB); returns 100–500 MB after heavy use.
* Glass backdrop (Windows): it is a whole second browser window just to hold an acrylic effect. Replace it with a plain native window through koffi, or create it only while the island is visible. 30–50 MB with glass on.
* Stop resending artwork as a base64 string on every media update. Move clipboard history images (up to 64 MB) to disk, and cap the app-icon cache (256 entries). 10–70 MB in total.
* Load panel tabs only when the panel first opens. 5–20 MB.
* V8 and Chromium switches (`--max-old-space-size`, network service in-process, software compositing). Single-digit to 40 MB each, high risk. Do these last, and only if measurements point there.

Pausing animations mostly saves CPU and wake-ups, not memory. GPU memory follows how many large layers the page has and how big they are, so removing blurs and extra layers matters more than pausing.

### Measurement has to be settled first

* The earlier numbers mixed two measures: working set, which counts shared Windows files in every process, and private memory. The success measure should be **private memory, summed over every process under the main TopNotch process, including the helper and any tools it starts**. Sum by parent process, not by name, since every process is called `electron.exe`. On macOS, use the memory footprint (`footprint` / `vmmap --summary`). The two platforms' numbers cannot be compared with each other.
* Electron's `app.getAppMetrics()` does not include child processes started with `spawn` or `fork`, so the helper, the media worker, perl and nvidia-smi must be added by process ID.
* Shrinking the working set (for example with `EmptyWorkingSet`) does not count. It hides memory without freeing it.
* The current UI test (`tests/ui-smoke.cjs`) turns hardware acceleration off, fakes the main process, and reports only Electron's own processes. It cannot measure the success metric. A new measuring mode is needed that runs the real app with the GPU on.
* Scenarios to measure: idle from a fresh launch; idle after every tool has been opened and closed once; typical use (scripted music source, glow strong, lyrics on); 30 minutes idle to check for leaks. Record each with glass on and off, plus the screen resolution and scaling.

### Risks

* **Crash isolation.** The media worker exists so a crash in the Windows media addon cannot take down the app. Moving media into the helper keeps that isolation, but then one helper crash stops audio levels, media and Bluetooth together. Keep the helper's restart-with-backoff, and limit artwork size over the helper's output.
* **An unsigned `.exe` written to the user's folder** may be flagged by antivirus or SmartScreen. Ship it signed inside the installer, as an unpacked file next to the app archive (`asarUnpack`), and don't build it on the user's machine.
* **macOS gets fewer wins.** The helper, backdrop and network ideas help only Windows. Without deliberate macOS work (perl started directly from main, wheel teardown, GPU work), macOS memory may stay the same while every test passes.
* **Per-tool start and stop code will drift.** Use one shared manager in main for windows and workers that start on demand, with clear states and an idle-release rule. Keep state outside the windows.
* **Each change needs its own off switch**, a main-only setting that defaults to on. Unknown settings are already kept when reading the config, so going back to 0.1.18 needs no migration.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Lower private memory, summed over all TopNotch processes plus the helper, at idle and in typical use, on Windows and macOS.
  * Working estimate for the Windows target, to be confirmed after measuring: about 300–350 MB idle with glass off; about 350–420 MB in typical use.
  * macOS memory no worse than today, ideally lower.
  * Every current feature still works on both platforms.
  * A repeatable measuring mode and CI reports that catch memory regressions and leaks.
* **Out-of-Scope Non-Goals:**
  * Leaving Electron (Tauri, native rewrite).
  * Removing features, or a separate "Lite mode".
  * The 100 MB total.
  * Shrinking the working set without freeing memory.

## Alternatives Weighed

* **Rewrite in native code (C#/WinUI, Rust or C++; Swift on macOS) to reach 100 MB.** Rejected by author: too large a rewrite. The goal is now the lowest memory possible on Electron.
* **Move to Tauri / WebView2.** Rejected by author along with the rewrite. It is also unlikely to reach 100 MB, because WebView2 is Chromium with the same multi-process layout.
* **Move the media worker into an Electron `utilityProcess`.** Set aside in review: a utility process is still a Chromium child with Node, so it saves little over the current fork. Folding media into the existing C# helper removes the process entirely.
* **Tear down rarely used tool windows (file wheel, Settings, Editor) and re-create them on demand.** Rejected by author: every tool must open instantly, including the first time. Re-creating a window takes a visible moment on Electron.
* **Load notch panel tabs only when the panel first opens.** Rejected by author for the same reason. Saved only an estimated 5–20 MB.
* **Move the media addon into the main process.** Set aside in review: it removes the crash isolation the worker exists for.
* **Rely on pausing animations to cut GPU memory.** Set aside in review: pausing mostly saves CPU. GPU memory depends on layer count and size, so blur and layer reduction come first. Pausing stays as a CPU win.
* **Trimming the working set (`EmptyWorkingSet`).** Rejected in review: it does not lower private memory, so it would fake the result.

## Key Decisions & Staging for Next Steps

**Decisions carried into the design doc:**

1. Stay on Electron and keep every feature.
2. Success metric: private memory summed over the whole process tree, helper included (footprint on macOS). Working set is for diagnosis only.
3. **Every tool window must open instantly, including the first time** (decided by author, 2026-11-03). Consequences:
   * Tool windows that users open directly (file wheel, Settings, Editor, Setup) are not torn down to save memory. The wheel teardown idea (50–90 MB) is dropped. Settings, Setup and Editor keep today's behaviour.
   * The work inside the tools (conversion, background removal, sharp) may still move to a separate process that starts when a job starts and exits when idle. The window opens instantly; only the job's start may wait for that process. The design must state how long that wait may be.
   * Panel tabs inside the notch keep loading at startup, so opening the panel stays instant.
4. **The system helper will be rebuilt** (decided by author). It ships as a precompiled, signed `.exe` inside the installer, and it takes over Windows media (title, artwork, playback), so the media worker and `@coooookies/windows-smtc-monitor` go away on Windows.
5. **Memory is judged with dark glass both on and off** (decided by author). Each scenario is measured twice, and each has its own target.
6. Build the measuring mode before changing anything.

**Proposed phases** (re-measure at the end of each):

* **Phase 0 — measure.** A `TOPNOTCH_MEMPROBE` mode that runs the real app with the GPU on and writes per-process memory to JSON, a script that sums the process tree on each OS, baselines for every scenario, the GPU experiments, and a report-only CI job.
* **Phase 1 — helper and media worker.** Precompiled helper `.exe`; media moved into the Windows helper; perl started directly on macOS.
* **Phase 2 — quick wins.** Idle timers, artwork IPC, clipboard images to disk, icon cache cap, backdrop rework. (Wheel teardown dropped: windows must open instantly.)
* **Phase 3 — GPU and renderer, guided by Phase 0.** Fewer blurs and layers, `will-change` dropped when idle, pausing through one shared visibility signal. (Panel tabs keep loading at startup so the panel opens instantly.)
* **Phase 4 — only if the data supports it.** Tools in an idle-exit process; Chromium and V8 switches behind flags.
* **Phase 5 — gates.** CI memory budgets per process with about 15% tolerance, a leak test over repeated tool open/close cycles, and a check that closed windows really free their memory.

**Stop rule:** stop when the target is met, or when a phase saves less than about 20 MB.

**Resolved by author (2026-11-03):** the helper is rebuilt and takes over media; tool windows open instantly; memory is judged with glass on and off.

**Revised Windows target (estimate, to confirm in Phase 0):** keeping tool windows loaded removes the wheel saving, so the idle target after use rises by up to about 50–90 MB. Fresh-launch idle targets are unchanged: about 300–350 MB with glass off, plus one backdrop window with glass on (30–50 MB less if the backdrop is replaced with a native window).

**Open questions for the author:**

* Once a conversion or background-removal job starts, how long may it wait for its worker process (roughly 0.3–1 s on first use)?
* Which Macs and macOS versions are the reference for measuring?

## Results so far (Windows, 2026-11-03)

Measured with `npm run memprobe` (private memory summed over the whole process tree, helper included), median of 5 samples after at least 60 s.

| Step | Idle, video playing in browser | Notes |
| --- | --- | --- |
| Start (0.1.18) | 399 MB | PowerShell helper 71 MB, media worker 25 MB, GPU process 112 MB |
| Helper precompiled to `topnotch-helper.exe` | 357 MB | Helper 71 → 23 MB |
| Now playing moved into the helper (media worker removed on Windows) | ~326 MB | Same-session A/B against the old worker: 354 MB |
| Hardware acceleration off by default on Windows | ~241 MB | GPU process 109 → 17 MB; CPU unchanged (8.8–15% of one core idle, 25–26% with the Music panel open, both modes) |

With nothing playing, the app settles at **~190 MB** and stays there over 5 minutes.

Findings that changed the plan:

* **Blur, shadows and animations don't cost memory.** Turning all of them off in the running renderer saved nothing. They still cost CPU, so animation pausing stays a CPU task, not a memory one.
* **The renderer's JavaScript is tiny** (about 4 MB heap). Its ~50 MB settled size is Chromium's own; a blank Electron window with the GPU off uses 25 MB. A ~99 MB reading soon after launch fades within a few minutes.
* **The main process's JavaScript heap is about 7 MB.** Most of its ~80 MB is Chromium's browser process (blank Electron: 36 MB). The `yaml` package (lyrics) is the only notable startup module.
* **Clipboard images** stay in main's memory only (up to 64 MB), on purpose, so copies never touch the disk. Moving them to disk is a privacy decision for the author, not done.

Off switches: `TOPNOTCH_HELPER=powershell` (old helper path), `TOPNOTCH_MEDIA=worker` (old media worker), `"hardwareAcceleration": true` in `config.json` or `TOPNOTCH_GPU=on` (GPU drawing).

Not done yet: macOS (media worker still used; no baseline), the remaining small items (each under the 20 MB stop rule), CI memory reports.
