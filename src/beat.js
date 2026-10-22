import { useEffect } from 'react';
import { bridge } from './bridge.js';

// One shared view of the music's loudness for everything that moves with it:
// word swells in the lyrics, the island's glow and the Music tab's gradient.
//
// The helper reports the output peak about 30 times a second while asked
// ("meter on"). From it:
//   level  smoothed loudness 0..1 (gentle attack, slow release)
//   beat   0..1, jumps up on an onset and decays over ~250 ms, the "kick"
//          the glow follows. An onset is a rising peak that stands out from
//          the recent average by more than the track's usual wobble, so it
//          works for quiet songs and for loud, heavily mastered ones (whose
//          peaks sit near full scale all the time).
// Where no level arrives (macOS has no system meter yet), a slow breathe
// stands in so things still feel alive without pretending to be on the beat.

// Adaptive onset detector over raw peaks (0..1). Exported for tests.
export function createBeatDetector() {
  let mean = 0;       // ~1 s running average of the peak
  let spread = 0.05;  // ~1 s running mean absolute deviation
  let previous = 0;
  let lastOnset = -1e9;
  return function push(v, now) {
    const x = Math.max(0, Math.min(1, v));
    const rise = x - previous;
    previous = x;
    const above = x - mean;
    // Quiet passages (and silence) never count as beats.
    const threshold = Math.max(0.03, spread * 1.3);
    let onset = 0;
    if (x > 0.02 && above > threshold && rise > threshold * 0.35 && now - lastOnset > 200) {
      lastOnset = now;
      onset = Math.min(1, 0.45 + above / (threshold * 4));
    }
    mean += (x - mean) * 0.04;
    spread += (Math.abs(x - mean) - spread) * 0.04;
    return onset;
  };
}

let users = 0;
let stopPeaks = null;
let level = 0;
let beat = 0;
let lastPeakAt = 0;
let startedAt = 0;
const detect = createBeatDetector();

function onPeak(v) {
  const now = performance.now();
  lastPeakAt = now;
  // Loudness for the lyric swell: sqrt lifts quiet passages a little.
  const target = Math.min(1, Math.sqrt(Math.max(0, v)) * 1.1);
  level += (target - level) * (target > level ? 0.22 : 0.08);
  const onset = detect(v, now);
  if (onset > beat) beat = onset;
}

function acquire() {
  if (users++ === 0) {
    startedAt = performance.now();
    lastPeakAt = 0;
    bridge.setMeter(true);
    stopPeaks = bridge.onPeak(onPeak);
  }
}

function release() {
  if (--users === 0) {
    bridge.setMeter(false);
    stopPeaks?.();
    stopPeaks = null;
    level = 0;
    beat = 0;
  }
}

// No peaks for a while after turning the meter on: no system meter here.
const metered = () => lastPeakAt > 0 && performance.now() - lastPeakAt < 1500;

export function getLevel() {
  return level;
}

// Advances the decay; call once per frame from a single writer.
let lastFrame = 0;
export function stepBeat(now = performance.now()) {
  const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
  lastFrame = now;
  if (metered()) {
    beat *= Math.pow(0.86, dt / 16.7);
    return beat;
  }
  if (now - startedAt < 1500) return 0;
  // Fallback breathe: soft rise and fall, about 70 per minute.
  const phase = (now % 860) / 860;
  return Math.pow(Math.sin(Math.PI * phase), 6) * 0.45;
}

// Keeps the meter on while mounted (the lyrics use this).
export function useLoudness(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    acquire();
    return release;
  }, [active]);
}

// While active, writes --beat (0..1) and --level (0..1) on the element every
// frame, for CSS to follow without re-rendering React.
export function useBeatVars(ref, active) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return undefined;
    acquire();
    let frame = 0;
    const tick = (now) => {
      const b = stepBeat(now);
      el.style.setProperty('--beat', b.toFixed(3));
      el.style.setProperty('--level', (metered() ? level : b * 0.6).toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.style.setProperty('--beat', '0');
      el.style.setProperty('--level', '0');
      release();
    };
  }, [ref, active]);
}
