#!/usr/bin/env bash
# Builds the macOS native pieces into build/mac/ (run on a Mac; CI does this
# before electron-builder packs them into Contents/Resources):
#   topnotch-helper  Swift system helper (volume, brightness, Bluetooth, …)
#   mediaremote/     ungive/mediaremote-adapter: Now Playing on macOS 15.4+
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/mac"
ADAPTER_TAG="v0.7.7"
ARCH="${ARCH:-arm64}"
mkdir -p "$OUT"

echo "› Swift helper ($ARCH)"
swiftc -O -target "$ARCH-apple-macos12.0" \
  -framework AppKit -framework AudioToolbox -framework CoreAudio -framework CoreMediaIO -framework IOBluetooth -framework IOKit \
  "$ROOT/electron/mac/helper.swift" -o "$OUT/topnotch-helper"

echo "› mediaremote-adapter $ADAPTER_TAG"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --quiet --depth 1 --branch "$ADAPTER_TAG" https://github.com/ungive/mediaremote-adapter.git "$WORK/src"
cmake -S "$WORK/src" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="$ARCH" >/dev/null
cmake --build "$WORK/build" --config Release >/dev/null
rm -rf "$OUT/mediaremote"
mkdir -p "$OUT/mediaremote"
cp -R "$WORK/build/MediaRemoteAdapter.framework" "$OUT/mediaremote/"
cp "$WORK/src/bin/mediaremote-adapter.pl" "$OUT/mediaremote/"
cp "$WORK/src/LICENSE" "$OUT/mediaremote/LICENSE"

echo "› done: $OUT"
ls -la "$OUT" "$OUT/mediaremote"
