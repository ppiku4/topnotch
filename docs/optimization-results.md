# Optimization results

Implemented against the current working tree, preserving the existing Island layout changes.

## Changes

- Clipboard: Windows sequence numbers and macOS helper pasteboard counters avoid rereading, PNG-encoding and hashing unchanged images. If the native counter is unavailable, polling falls back to the existing read path. Private clipboard markers remain excluded.
- Persistence: clipboard and shelf writes are coalesced, serialized and atomically replaced. Quit waits for pending persistence. Clipboard encryption remains enabled when OS encryption is available.
- Memory: clipboard history has a 64 MiB payload budget and rejects individual oversized entries without truncating them. Existing pins are preserved, even if old pinned history exceeds the budget. Shelf icons are evicted on removal/clear and both shelf/mixer icon caches are capped at 256 entries.
- Shelf: file checks are asynchronous, with at most eight checks/icon lookups per listing. Mutations are serialized so overlapping add/clear operations cannot restore cleared entries.
- Images: a reusable worker handles image decoding/encoding and AI tensor preparation, mask normalization and alpha compositing. Jobs are serialized, worker failures reject pending requests, and an idle worker exits after 30 seconds. Native asynchronous ONNX inference retains the existing session queue and 60-second idle release.
- Editor: PNGs use binary IPC and temporary Blob URLs instead of base64 strings. The oriented preview canvas is capped at 2048 pixels on its longest edge. Saving uses original-resolution pixels and original-size crop coordinates. Blob URLs are revoked after decoding.
- Windows/screens: dynamic imports load only the active screen and its styles. A renderer-ready handshake replays initial state after subscriptions mount, including wheel state and renderer reloads.
- Rendering: paused/covered lyrics release audio metering; hidden documents suspend lyric/glow loops. Unchanged lyric CSS values are not rewritten. Countdown ticks align to displayed-second boundaries and still use absolute deadlines. Idle shelf-drag polling avoids cursor/window geometry calls.
- Battery: both hooks share one listener pair, and late promises cannot attach listeners after cleanup.
- CI: GitHub and GitLab pipelines run regression/UI checks before packaging; Windows also runs native/helper restart checks. UI tests account for macOS lacking the volume-mixer tab.

## Verification

- `npm test`: 16 passing regression tests, including all nine image output formats, clipboard privacy/persistence/change tokens, atomic writes, worker pixel math, shelf concurrency and battery subscription cleanup.
- `npm run build`: passes; output is split into shared and screen-specific chunks. Total output size is not claimed to decrease.
- `npm run test:ui`: all platform tabs and windows render without console errors; playback meter starts, stops when paused/covered, and resumes after uncovering.
- Editor checks preserve the original source and verify 120x80 uncropped / 80x80 cropped output, plus 4096x2048 uncropped / 2048x2048 cropped output through the smaller preview.
- ASAR fixture verifies unpacked decoder and image workers can load packed dependencies, preview BMP and encode PSD.
- `npm run test:native`: Windows native helper and subscription restoration after restart pass.
- Real installed ISNet CPU inference completes successfully. A before/after comparison on a synthetic 128x96 image compared 12,288 pixels with zero channel-value differences. No model downloads or model-file modifications were needed.

## Measurements and limits

The unchanged-image regression performs an initial clipboard poll plus ten unchanged polls and confirms just one image read/PNG encode. Timer React updates decrease from four per second to approximately one per displayed second.

An optional smoke-test measurement mode is available by setting `TOPNOTCH_BENCHMARK=1` when running `npm run test:ui`. It reports page-ready times and Electron process metrics. Single local samples before/after splitting were roughly 85-100 ms versus 101-114 ms for ordinary screens (wheel includes an explicit 200 ms fixture delay). These samples do not establish a startup improvement. Chromium's rounded heap values and process metrics from different fixture workloads are not suitable for claiming a memory/CPU percentage reduction.

macOS runtime behavior, GPU inference, all four real AI models, sustained idle CPU/battery use and a complete installer build were not verified here. Packaged-worker behavior was verified with the ASAR fixture. Existing pins are deliberately exempt from destructive budget eviction. Full-resolution source pixels remain resident in the editor so exports retain quality.
