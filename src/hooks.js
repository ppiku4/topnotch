import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from './bridge.js';

const DEFAULT_CONFIG = {
  scale: 1,
  features: { lyrics: true, glow: true, privacy: true, clipboard: true, shelf: true, timer: true, stats: true, bluetooth: true, charging: true }
};

// Last value pushed by main on `subscribe`, starting from `initial`.
function useSubscription(subscribe, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => subscribe(setValue), [subscribe]);
  return value;
}

export function useConfig() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  useEffect(() => {
    bridge.getConfig().then((c) => c && setConfig(c));
    return bridge.onConfig(setConfig);
  }, []);
  return config;
}

export const useLyrics = () => useSubscription(bridge.onLyrics, { key: null, lines: [] });
export const usePrivacy = () => useSubscription(bridge.onPrivacy, { camera: [], microphone: [], call: null });
export const useClipboard = () => useSubscription(bridge.onClipboard, []);
export const useShelf = () => useSubscription(bridge.onShelf, []);
export const useDragNear = () => useSubscription(bridge.onDragNear, false);

export function useStats(visible) {
  const [stats, setStats] = useState(null);
  useEffect(() => bridge.onStats(setStats), []);
  useEffect(() => {
    bridge.setStatsVisible(visible);
    return () => bridge.setStatsVisible(false);
  }, [visible]);
  return stats;
}

// Volume/brightness; onChange(kind) fires for real changes (not the first report).
export function useSystemLevels(onChange) {
  const [levels, setLevels] = useState({ volume: null, muted: false, brightness: null, brightnessSupported: false });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => bridge.onSystemLevels(({ levels: next, changed }) => {
    setLevels(next);
    if (changed) onChangeRef.current?.(changed);
  }), []);
  return levels;
}

const PRIORITY = { osd: 5, timer: 4, convert: 3.5, bluetooth: 3, battery: 2 };

// Short-lived "live activities" that take over the pill. The highest
// priority one shows; each expires on its own timer.
export function useActivities() {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((kind) => {
    clearTimeout(timers.current.get(kind));
    timers.current.delete(kind);
    setItems((list) => list.filter((a) => a.kind !== kind));
  }, []);

  const push = useCallback((kind, data, duration = 2500) => {
    clearTimeout(timers.current.get(kind));
    setItems((list) => [...list.filter((a) => a.kind !== kind), { kind, data, at: Date.now() }]);
    timers.current.set(kind, setTimeout(() => dismiss(kind), duration));
  }, [dismiss]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const current = items.reduce((best, a) => (!best || PRIORITY[a.kind] > PRIORITY[best.kind] ? a : best), null);
  return { current, push, dismiss };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// Lyrics and accents sit on black, so every color is lifted into a bright,
// readable band; near-grey artwork stays near-white instead of turning muddy.
function brighten([h, s, l]) {
  const sat = s < 0.12 ? s : Math.max(s, 0.6);
  const light = Math.min(0.84, Math.max(0.7, l));
  return `hsl(${Math.round(h)}, ${Math.round(sat * 100)}%, ${Math.round(light * 100)}%)`;
}

// Two accent colors from the artwork: the most vivid bucket and the most
// vivid one with a clearly different hue, from a 24×24 downsample.
export function useArtColors(art) {
  const [colors, setColors] = useState(null);
  useEffect(() => {
    if (!art) { setColors(null); return undefined; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const data = ctx.getImageData(0, 0, 24, 24).data;
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (Math.max(r, g, b) < 40) continue;
        const key = `${r >> 5},${g >> 5},${b >> 5}`;
        const entry = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
        entry.r += r; entry.g += g; entry.b += b; entry.n += 1;
        buckets.set(key, entry);
      }
      const ranked = [...buckets.values()].map((e) => {
        const hsl = rgbToHsl(e.r / e.n, e.g / e.n, e.b / e.n);
        return { hsl, score: e.n * (0.25 + hsl[1] * 2) };
      }).sort((a, b) => b.score - a.score);
      if (!ranked.length) { setColors(null); return; }
      const first = ranked[0];
      const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
      const second = ranked.find((c) => c.hsl[1] > 0.15 && hueGap(c.hsl[0], first.hsl[0]) > 35) || first;
      setColors([brighten(first.hsl), brighten(second.hsl)]);
    };
    img.src = art;
    return () => { cancelled = true; };
  }, [art]);
  return colors;
}

// navigator.getBattery() works in Chromium on Windows. Desktops report a
// permanently charging battery and never fire events, so nothing shows there.
export function useBatteryEvents(enabled, onEvent) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  useEffect(() => {
    if (!enabled || !navigator.getBattery) return undefined;
    let battery = null;
    let wasLow = false;
    const report = (reason) => onEventRef.current({ reason, charging: battery.charging, level: Math.round(battery.level * 100) });
    const onCharging = () => report(battery.charging ? 'plugged' : 'unplugged');
    const onLevel = () => {
      const low = !battery.charging && battery.level <= 0.2;
      if (low && !wasLow) report('low');
      wasLow = low;
    };
    navigator.getBattery().then((b) => {
      battery = b;
      wasLow = !b.charging && b.level <= 0.2;
      b.addEventListener('chargingchange', onCharging);
      b.addEventListener('levelchange', onLevel);
    });
    return () => {
      if (!battery) return;
      battery.removeEventListener('chargingchange', onCharging);
      battery.removeEventListener('levelchange', onLevel);
    };
  }, [enabled]);
}

// Countdown timer with an optional pomodoro cycle (25 min focus / 5 min break).
export function useTimer(onDone) {
  const [timer, setTimer] = useState(null); // { endsAt, total, remaining, paused, label, pomodoro, phase }
  const [now, setNow] = useState(Date.now());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!timer || timer.paused) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [timer]);

  const remaining = timer ? (timer.paused ? timer.remaining : Math.max(0, timer.endsAt - now)) : 0;

  useEffect(() => {
    if (!timer || timer.paused || remaining > 0) return;
    const finished = timer;
    if (finished.pomodoro) {
      const nextPhase = finished.phase === 'focus' ? 'break' : 'focus';
      const minutes = nextPhase === 'focus' ? 25 : 5;
      setTimer(makeTimer(minutes * 60, nextPhase === 'focus' ? 'Focus' : 'Break', true, nextPhase));
    } else {
      setTimer(null);
    }
    onDoneRef.current?.(finished);
  }, [timer, remaining]);

  const start = useCallback((seconds, label = 'Timer') => setTimer(makeTimer(seconds, label, false)), []);
  const startPomodoro = useCallback(() => setTimer(makeTimer(25 * 60, 'Focus', true, 'focus')), []);
  const pause = useCallback(() => setTimer((t) => (t && !t.paused ? { ...t, paused: true, remaining: Math.max(0, t.endsAt - Date.now()) } : t)), []);
  const resume = useCallback(() => setTimer((t) => (t && t.paused ? { ...t, paused: false, endsAt: Date.now() + t.remaining } : t)), []);
  const reset = useCallback(() => setTimer(null), []);

  return { timer, remaining, start, startPomodoro, pause, resume, reset };
}

function makeTimer(seconds, label, pomodoro, phase = null) {
  const total = seconds * 1000;
  return { endsAt: Date.now() + total, total, remaining: total, paused: false, label, pomodoro, phase };
}

export function formatCountdown(ms) {
  const seconds = Math.ceil(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// Soft two-note chime, no audio file needed.
export function playChime() {
  try {
    const ctx = new AudioContext();
    [[880, 0], [1318.5, 0.18]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (_) {}
}

export const useBluetoothDevices = () => useSubscription(bridge.onBluetoothDevices, []);
export const useWeather = () => useSubscription(bridge.onWeather, null);

export function useMixer(visible) {
  const [sessions, setSessions] = useState([]);
  useEffect(() => bridge.onMixer(setSessions), []);
  useEffect(() => {
    bridge.setMixerVisible(visible);
    return () => bridge.setMixerVisible(false);
  }, [visible]);
  return sessions;
}

// Battery level for the status chip. Desktops report 100% and charging.
export function useBattery() {
  const [battery, setBattery] = useState(null);
  useEffect(() => {
    if (!navigator.getBattery) return undefined;
    let target = null;
    const update = () => setBattery({ level: Math.round(target.level * 100), charging: target.charging });
    navigator.getBattery().then((b) => {
      target = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });
    return () => {
      if (!target) return;
      target.removeEventListener('levelchange', update);
      target.removeEventListener('chargingchange', update);
    };
  }, []);
  return battery;
}

// Current time, re-rendering on each minute (or second) boundary.
export function useClock(everySecond = false) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer;
    const step = everySecond ? 1000 : 60000;
    const schedule = () => {
      timer = setTimeout(() => { setNow(new Date()); schedule(); }, step - (Date.now() % step) + 30);
    };
    setNow(new Date());
    schedule();
    return () => clearTimeout(timer);
  }, [everySecond]);
  return now;
}

// Where the notch is docked: { edge, anchor (island centre along the edge,
// in window px), dragging }. Main pushes updates while it's being dragged.
export function useDock() {
  const [dock, setDock] = useState({ edge: 'top', anchor: null, dragging: false });
  useEffect(() => {
    bridge.getDock().then((d) => d && setDock(d));
    return bridge.onDock(setDock);
  }, []);
  return dock;
}
