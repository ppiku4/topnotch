import { createContext, useContext, useEffect, useState } from 'react';
import { bridge } from './bridge.js';

export const AnimationVisibility = createContext(true);
export function useAnimationVisible() {
  const visible = useContext(AnimationVisibility);
  const [shown, setShown] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setShown(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible && shown;
}

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

// Sensitivity (0..1, 0.5 = default) from settings: higher catches softer
// beats and pulses harder.
let sensitivity = 0.5;
export function setBeatSensitivity(value) {
  if (Number.isFinite(value)) sensitivity = Math.max(0, Math.min(1, value));
}
// Threshold scale: 1 at the default, 1.5x stricter at 0, half at 1.
const thresholdScale = (s) => 1.5 - s;
// Output gain: 1 at the default, 0.2 at 0, 1.8 at 1.
const outputGain = (s) => 0.2 + 1.6 * s;

// Adaptive onset detector over raw peaks (0..1). Exported for tests; the
// optional third argument overrides the sensitivity.
export function createBeatDetector() {
  let mean = 0;       // ~1 s running average of the peak
  let spread = 0.05;  // ~1 s running mean absolute deviation
  let previous = 0;
  let lastOnset = -1e9;
  return function push(v, now, s = sensitivity) {
    const x = Math.max(0, Math.min(1, v));
    const rise = x - previous;
    previous = x;
    const above = x - mean;
    // Quiet passages (and silence) never count as beats.
    const threshold = Math.max(0.03, spread * 1.3) * thresholdScale(s);
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
  const visible = useAnimationVisible();
  active = active && visible;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return undefined;
    acquire();
    let frame = 0;
    const tick = (now) => {
      const b = stepBeat(now);
      const gain = outputGain(sensitivity);
      el.style.setProperty('--beat', Math.min(1, b * gain).toFixed(3));
      el.style.setProperty('--level', Math.min(1, (metered() ? level : b * 0.6) * gain).toFixed(3));
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
