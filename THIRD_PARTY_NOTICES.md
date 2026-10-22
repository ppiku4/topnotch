# Third-party notices

TopNotch is MIT-licensed (see [LICENSE](LICENSE)). It builds on the projects below; each keeps its own license.

## Bundled with the app

| Project | License | Used for |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) | MIT | App shell |
| [React](https://react.dev/) / react-dom | MIT | UI |
| [framer-motion](https://www.framer.com/motion/) | MIT | Animations |
| [koffi](https://koffi.dev/) | MIT | Calls into user32/gdi32 (media keys, window region, acrylic) |
| [@coooookies/windows-smtc-monitor](https://github.com/LeagueTavern/node-windows-smtc-monitor) | MIT | Now-playing info from Windows media sessions |
| [mediaremote-adapter](https://github.com/ungive/mediaremote-adapter) (macOS build only) | BSD-3-Clause | Now-playing info on macOS 15.4 and later; built from v0.7.7 and shipped unmodified with its license |
| [sharp](https://sharp.pixelplumbing.com/) | Apache-2.0 | Image conversion (file wheel) |
| [libvips](https://www.libvips.org/) (in @img/sharp-win32-x64) | LGPL-3.0-or-later | Image codecs behind sharp; shipped as its own unmodified DLLs |
| [ag-psd](https://github.com/Agamnentzar/ag-psd) | MIT | Reading and writing PSD files |
| [marked](https://marked.js.org/) | MIT | Markdown → HTML/PDF |
| [turndown](https://github.com/mixmark-io/turndown) | MIT | HTML → Markdown |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause | Reading .docx |
| [ONNX Runtime](https://onnxruntime.ai/) (onnxruntime-node) with DirectML | MIT | Running the background-removal models on CPU or GPU |
| [yaml](https://eemeli.org/yaml/) | ISC | Reading lrclib's Lyricsfile (line end and word times) |
| [unpdf](https://github.com/unjs/unpdf) / [pdf.js](https://mozilla.github.io/pdf.js/) | MIT / Apache-2.0 | Text from PDF files |

## Downloaded on first run (or when you ask for it)

| Project | License | Used for |
| --- | --- | --- |
| [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) v0.9.6 | [MPL-2.0](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LICENSE) | CPU temperature. Settings → General → Sensors downloads the unmodified official release into `%APPDATA%\topnotch\vendor`. Its source is available at the link. |
| [FFmpeg](https://ffmpeg.org/) 7.1.1 essentials build by [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (Windows) / 6.1.1 static build from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) (macOS) | [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html) | Audio/video conversion in the file wheel, only if no `ffmpeg` is on your PATH. The wheel asks before downloading the unmodified build (checked against a pinned SHA-256) into `%APPDATA%\topnotch\vendor\ffmpeg`; its license file is kept next to it. FFmpeg runs as a separate program. |

| [ISNet (DIS)](https://github.com/xuebinqin/DIS) "general use" (179 MB) and [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) Lite / General / Portrait (224 MB / 973 MB / 973 MB), ONNX exports from [rembg](https://github.com/danielgatis/rembg) | Apache-2.0 (ISNet), MIT (BiRefNet) | Remove background in the file wheel and image editor. Each model downloads only when you ask (Settings → General, or the first time you use it), checked against a pinned SHA-256, into `%APPDATA%\topnotch\vendor\bgmodels`. They run locally on the CPU or, if you choose, the GPU through DirectML; images never leave your PC. |

| [LibreOffice](https://www.libreoffice.org/) 26.2.6 | MPL-2.0 | Office conversions: .doc, .odt, .rtf, writing .docx, and all spreadsheet, presentation and drawing formats. On first run TopNotch downloads the unmodified official installer (checked against a pinned SHA-256) and unpacks it into its own data folder (macOS: the app from the DMG; Windows: an administrative extract of the MSI, nothing registered with Windows), unless LibreOffice is already installed. It runs headless as a separate program. |

## Online services

TopNotch contacts these only for the features named. Each can be turned off in Settings → Widgets.

| Service | Feature | What is sent |
| --- | --- | --- |
| [lrclib.net](https://lrclib.net/) | Synced lyrics | Track title, artist, duration |
| [NetEase Cloud Music](https://music.163.com/) | Word-by-word timing for synced lyrics | Track title and artist |
| [Open-Meteo](https://open-meteo.com/) | Weather | Coordinates of your city, or of the IP location below |
| [ipwho.is](https://ipwho.is/) | Weather, only when no city is set | Your IP address (implicitly) |
| GitHub API | Update check, only when you click it | Nothing beyond the request itself |
