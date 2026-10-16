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

## Downloaded only when you ask for it

| Project | License | Used for |
| --- | --- | --- |
| [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) v0.9.6 | [MPL-2.0](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LICENSE) | CPU temperature. Settings → General → Sensors downloads the unmodified official release into `%APPDATA%\topnotch\vendor`. Its source is available at the link. |

## Online services

TopNotch contacts these only for the features named. Each can be turned off in Settings → Widgets.

| Service | Feature | What is sent |
| --- | --- | --- |
| [lrclib.net](https://lrclib.net/) | Synced lyrics | Track title, artist, duration |
| [Open-Meteo](https://open-meteo.com/) | Weather | Coordinates of your city, or of the IP location below |
| [ipwho.is](https://ipwho.is/) | Weather, only when no city is set | Your IP address (implicitly) |
| GitHub API | Update check, only when you click it | Nothing beyond the request itself |
