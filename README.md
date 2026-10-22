# TopNotch

A Dynamic Island for Windows. A small pill at the top of your screen that shows what's playing (with word-by-word synced lyrics), your volume and brightness, the day, time and weather. Hover it to open a panel with music controls, a volume mixer, Bluetooth devices, clipboard history, a focus timer, system stats and a file shelf.

Built with Electron, React, Vite and framer-motion. Windows 10 (1809) or later; some effects need Windows 11.

> [!WARNING]
> **This is a vibe-coded app.** It was built mostly by prompting an AI coding assistant, not written and reviewed line by line, so expect rough edges.
>
> It's provided **as is, without warranty of any kind**. **The developer is not responsible for anything** that happens from using it, including crashes, data loss, damage to your system or hardware, security or privacy issues, or anything else.
>
> Some features run with extra rights or change system settings: volume, brightness, per-app audio, and optionally LibreHardwareMonitor as administrator plus a sign-in scheduled task. **Use it at your own risk.**

<!-- Add a screenshot or short GIF here, e.g. docs/screenshot.png -->

## Features

- **Now playing** from any app that reports to Windows media controls (Spotify, browsers, media players): artwork, play/pause/next/previous, seek bar, album-colour accents.
- **Synced lyrics** from [lrclib.net](https://lrclib.net/) (the copy matching what's playing), with real word timing from NetEase Cloud Music where available, in the style of Apple Music:
  - words fill as they're sung
  - held words swell and glow
  - the Music tab shows a scrolling list; click a line to jump there
  - Re-sync button
- **Pill** that resizes to its content: the current lyric line, or day · time · weather when nothing plays.
- **Volume & brightness:**
  - pop-up on any change; scroll over the notch for volume, Shift+scroll for brightness
  - external monitors over DDC/CI
- **Panel tabs:**
  - Dashboard
  - Music
  - Volume mixer (per app)
  - Bluetooth
  - Clipboard history
  - Focus timer & pomodoro
  - System status (CPU, GPU, memory, download, upload, temperatures)
  - File shelf (drag files to the top of the screen)
- **File wheel:** Shift+click a file in Explorer or on the desktop for a radial menu of conversions. The copy is saved next to the original and never overwrites it; progress and "Show" appear in the notch.
  - Images (PNG, JPG, WEBP, TIFF, AVIF, GIF, BMP, ICO, PSD; SVG as input): convert, or open the quick editor to crop (free or fixed ratios), rotate, flip, resize and adjust brightness/contrast/saturation.
  - Documents: TXT, MD, HTML, DOCX and PDF convert among each other built in. DOC, ODT, RTF and writing DOCX use your installed [LibreOffice](https://www.libreoffice.org/).
  - Office files, through your installed LibreOffice: Word-style documents (DOC/DOCX/DOCM/DOTX, ODT, RTF, WPD, WPS) to PDF, DOCX, ODT, RTF, DOC, HTML, TXT or MD; spreadsheets (XLSX/XLS/XLSM/XLSB, ODS, CSV, TSV) to XLSX, PDF, CSV, ODS, XLS or HTML; presentations (PPTX/PPT/PPSX/POTX, ODP, Keynote) to PPTX, PDF, ODP or PPT; drawings (VSDX/VSD, ODG, Publisher) to PDF, PNG, SVG or ODG.
  - Video (to MP4, MKV, WEBM, MOV, GIF, or MP3/WAV/M4A audio) and audio (MP3, WAV, FLAC, M4A, OGG, OPUS) use `ffmpeg` from your PATH, or a copy TopNotch downloads after asking (~88 MB).
  - Turn it off in Settings → Widgets.
- **Live activities:** camera/mic in use (and the call app), Bluetooth connect/disconnect, charging, timer finished.
- **Settings:**
  - display, size, expand on hover or click, keep open, hide behind maximised windows
  - accent colour, edge glow, corners, Solid or Dark glass (real acrylic blur)
  - per-feature switches
  - update check

## Install

Download the installer or portable `.exe` from [Releases](../../releases).

### CPU temperature (optional)

Windows doesn't give apps the CPU temperature. In **Settings → General → Sensors**, *Download & enable* fetches [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) (MPL-2.0) from its official release and starts it as administrator; Windows asks for permission.

Its web server is bound to `127.0.0.1` only. *Start sensors at sign-in* adds a scheduled task, so you aren't prompted every time. GPU usage and temperature (NVIDIA via `nvidia-smi`) work without it.

## Develop

```bash
npm install
npm run dev        # Vite dev server + Electron with hot reload
npm start          # production build, then Electron
npm run dist       # Windows installer + portable exe in release/
```

Pushing a tag like `v0.2.0` runs [the build workflow](.github/workflows/release.yml) and attaches the installer to a GitHub Release.

Before publishing:
- if you fork this, point `repository`, `homepage`, `bugs` and `build.publish` in `package.json` at your repo so the update check and releases use it
- bump `version` in `package.json` for each release

### Project layout

| Path | What it does |
| --- | --- |
| `electron/main.cjs` | Windows, tray, IPC, services (lyrics, weather, stats, clipboard, shelf, sensors, updates) |
| `electron/system-helper.cs` + `.ps1` | Long-lived helper compiled by Windows PowerShell 5.1 at startup. It handles volume, brightness, seek, timeline, per-app mixer, privacy, network/GPU counters, Bluetooth and the audio meter, speaking JSON lines over stdio. |
| `electron/media-worker.cjs` | Child process reading Windows media sessions |
| `electron/win32.cjs` | koffi calls: media keys, foreground window, acrylic + window region |
| `src/Island.jsx` | What the pill shows and how it animates |
| `src/Lyrics.jsx` | Word timing and the lyric animations |
| `src/Settings.jsx` | Settings window |

### Known issues

- **Electron install on Node 26:** Electron's postinstall can exit halfway, leaving `node_modules/electron/dist` with only `locales/`. Extract the cached zip yourself:
  ```powershell
  $zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse -Filter 'electron-v*-win32-x64.zip' | Select-Object -First 1
  Expand-Archive $zip.FullName node_modules\electron\dist -Force
  Set-Content node_modules\electron\path.txt 'electron.exe' -NoNewline
  ```
- **Local `npm run dist` symlink error:** it may report `Cannot create symbolic link` while unpacking electron-builder's signing tools. Turn on Windows Developer Mode, or build from an administrator terminal. CI isn't affected.
- **Browser positions:** Brave/Chrome report a stale position until something seeks; TopNotch corrects it with the WinRT timeline timestamp.
- **Monitor buttons:** brightness changed with the monitor's own buttons isn't picked up (DDC/CI has no events).
- **Native flyout:** the Windows volume flyout still appears alongside the pop-up.

## Privacy

TopNotch runs locally. The only network requests are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md#online-services), each tied to a feature you can switch off.

Clipboard history text is saved to `%APPDATA%\topnotch\clipboard.json`. Turn it off in Settings if you copy passwords.

## Disclaimer

TopNotch is a vibe-coded hobby project, provided as is and without warranty. The developer accepts no responsibility or liability for any damage, loss or problem arising from its use. See the [license](LICENSE) for the full terms.

## License

[MIT](LICENSE). Third-party components keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
