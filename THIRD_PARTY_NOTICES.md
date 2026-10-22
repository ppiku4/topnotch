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
| [sharp](https://sharp.pixelplumbing.com/) | Apache-2.0 | Image conversion (file wheel) |
| [libvips](https://www.libvips.org/) (in @img/sharp-win32-x64) | LGPL-3.0-or-later | Image codecs behind sharp; shipped as its own unmodified DLLs |
| [ag-psd](https://github.com/Agamnentzar/ag-psd) | MIT | Reading and writing PSD files |
| [marked](https://marked.js.org/) | MIT | Markdown → HTML/PDF |
| [turndown](https://github.com/mixmark-io/turndown) | MIT | HTML → Markdown |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause | Reading .docx |
| [yaml](https://eemeli.org/yaml/) | ISC | Reading lrclib's Lyricsfile (line end and word times) |
| [unpdf](https://github.com/unjs/unpdf) / [pdf.js](https://mozilla.github.io/pdf.js/) | MIT / Apache-2.0 | Text from PDF files |

## Downloaded only when you ask for it

| Project | License | Used for |
| --- | --- | --- |
| [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) v0.9.6 | [MPL-2.0](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LICENSE) | CPU temperature. Settings → General → Sensors downloads the unmodified official release into `%APPDATA%\topnotch\vendor`. Its source is available at the link. |
| [FFmpeg](https://ffmpeg.org/) 7.1.1 essentials build by [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) | [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html) | Audio/video conversion in the file wheel, only if no `ffmpeg` is on your PATH. The wheel asks before downloading the unmodified build (checked against a pinned SHA-256) into `%APPDATA%	opnotchendorfmpeg`; its license file is kept next to it. FFmpeg runs as a separate program. |

## Used if you have it installed

| Project | License | Used for |
| --- | --- | --- |
| [LibreOffice](https://www.libreoffice.org/) | MPL-2.0 | Office conversions: .doc, .odt, .rtf, writing .docx, and all spreadsheet, presentation and drawing formats. TopNotch runs your installed `soffice.exe` headless; it never downloads it. |

## Online services

TopNotch contacts these only for the features named. Each can be turned off in Settings → Widgets.

| Service | Feature | What is sent |
| --- | --- | --- |
| [lrclib.net](https://lrclib.net/) | Synced lyrics | Track title, artist, duration |
| [NetEase Cloud Music](https://music.163.com/) | Word-by-word timing for synced lyrics | Track title and artist |
| [Open-Meteo](https://open-meteo.com/) | Weather | Coordinates of your city, or of the IP location below |
| [ipwho.is](https://ipwho.is/) | Weather, only when no city is set | Your IP address (implicitly) |
| GitHub API | Update check, only when you click it | Nothing beyond the request itself |
