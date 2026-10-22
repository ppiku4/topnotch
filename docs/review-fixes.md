# Review fixes and smoke-test results

All ten findings from the repository review have been addressed. Original files
are preserved during conversion; no dependencies were added.

| Finding | Change |
| --- | --- |
| Elevated sensor archive race | Create an administrator/SYSTEM-only staging directory, copy the archive there, then verify and extract the protected copy. Resolve the installation root using Windows' Program Files special folder. |
| BMP/ICO memory exhaustion | Validate headers, dimensions, palettes, pixel lengths and ICO entry bounds before allocation. Decode in a time-limited worker with a 32-megapixel limit. Package the worker and codec as unpacked files. |
| Downloads hang on disk errors | Share an error-aware stream pipeline across LibreOffice, ffmpeg, models and portable/macOS updates. Reject failures and remove partial downloads. |
| Wrong Explorer tab selected | Match the clicked tab's native window to its shell browser before resolving the filename. Reject ambiguous fallback results. |
| Volume bound to old device | Register default-output-device notifications, rebind volume callbacks on a worker thread, and reopen the audio meter on device changes. |
| Inference session released during a job | Serialize inference, session creation and deletion. Start idle release only after queued work completes. |
| Conversion remains running after output error | Include output-file reservation inside job error handling. |
| Clipboard text truncated | Persist and restore complete text; truncate only the visible preview. Private-copy exclusions and encryption remain in place. |
| Crop-off still crops export | Use the full image when cropping is off and reset the derived output size when toggling cropping. |
| Helper loses subscriptions after restart | Retain and replay requested stats, meter and file-wheel states on every helper-ready event. |

## Results

- **Regression tests: 11 passed, 0 failed.** Includes simulated disk-full and
  network failures, checksum rejection, oversized/truncated images, valid BMP/ICO
  decoding, all nine image output formats, source-file preservation, permission
  errors, clipboard persistence/private-copy exclusion, session concurrency and
  idle release, subscription replay, and sensor script generation/PowerShell parsing.
- **Production Vite build: passed.**
- **Windows C# helper compilation: passed.**
- **Native read-only smoke: passed**, with volume, brightness, privacy, mixer,
  timeline, Bluetooth, audio-peak and network events and no reported errors.
- **Real helper restart: passed.** Network stats and audio peaks resumed after
  the second helper started, without toggling the subscriptions again.
- **Electron UI smoke: passed.** All eight notch tabs, five Settings sections,
  setup and file wheel rendered; media and wheel actions reached the real preload IPC.
- **Editor export smoke: passed.** Crop-on exported 80×80; crop-off exported
  120×80. Original image bytes were unchanged.
- **Packaged ASAR worker smoke: passed.** The decoder loaded through an ASAR
  package and ran from the unpacked worker path.
- **Renderer console errors: none.**

## Reproduce

```sh
npm test
npm run build
npm run test:ui
npm run test:native
```

The native smoke tests require Windows and access to the desktop's native APIs.
The UI harness uses temporary fixture data; it does not install engines or
sensors, write the real clipboard, change volume/brightness, or modify login settings.

## Coverage limits

macOS was not run on this Windows host. Physical audio-device switching and
interactive Explorer tab selection were not exercised end to end. The elevated
sensor installation was checked structurally and parsed by PowerShell, but not
executed with administrator privileges. AI lifecycle checks use a mocked inference
runtime; no large models were downloaded. Live update/download servers and a full
installer distribution were not exercised.
