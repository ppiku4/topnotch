import { useEffect } from 'react';
import { bridge } from './bridge.js';

// One shared view of the music's loudness for everything that moves with it:
// word swells in the lyrics, the island's glow and the Music tab's gradient.
//
// The helper reports the output peak about 30 times a second while asked
// ("meter on"). From it:
//   level  smoothed loudness 0..1 (gentle attack, slow release)
//   beat   0..1, jumps to 1 on an onset (a peak well above the recent
//          average) and decays over ~250 ms, the "kick" the glow follows
// Where no level arrives (macOS has no system meter yet), a slow breathe
// stands in so things still feel alive without pretending to be on the beat.

let users = 0;
let stopPeaks = null;
let level = 0;
let average = 0;
let beat = 0;
let lastOnset = 0;
let lastPeakAt = 0;
let startedAt = 0;

function onPeak(v) {
  const now = performance.now();
  lastPeakAt = now;
  const target = Math.min(1, Math.sqrt(Math.max(0, v)) * 1.25);
  level += (target - level) * (target > level ? 0.22 : 0.08);
  average += (target - average) * 0.03;
  if (target > average * 1.32 + 0.04 && now - lastOnset > 180) {
    lastOnset = now;
    beat = Math.min(1, 0.55 + (target - average) * 1.6);
  }
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
    average = 0;
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
