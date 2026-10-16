const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  displayId: null,        // null = primary display
  scale: 1,
  launchAtLogin: false,
  expandOnHover: true,    // false = click the pill to open
  keepOpen: false,        // the panel pin, remembered
  hideBehindMaximized: false,
  weatherCity: '',        // empty = approximate location from IP
  temperatureUnit: 'c',
  accent: 'album',        // 'album' or a #rrggbb swatch
  edgeGlow: 'subtle',     // off | subtle | strong
  corners: 'rounded',     // rounded | squared
  material: 'solid',      // solid | glass
  clockFormat: 'system',  // system | 12h | 24h
  clockSeconds: false,
  clockDate: 'full',      // full | weekday | off
  clockStyle: 'regular',  // regular | bold | mono | thin
  clockColor: 'white',    // white | accent
  weatherShow: 'icon-temp', // icon-temp | temp | detailed
  weatherColor: 'white',  // white | accent | weather
  features: {
    lyrics: true,
    pillLyrics: true,
    pillInfo: true,
    weather: true,
    privacy: true,
    clipboard: true,
    shelf: true,
    timer: true,
    stats: true,
    bluetooth: true,
    charging: true
  }
};

const ACCENT_SWATCHES = ['#5ac8fa', '#34c759', '#ffd60a', '#ff9f0a', '#ff453a', '#ff375f', '#bf5af2', '#ffffff'];

// Small JSON config in userData; set() merges a patch and notifies listeners.
function createConfig(dir) {
  const file = path.join(dir, 'config.json');
  let value = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    // The old on/off "glow" feature became the edge glow setting.
    if (saved.features && saved.features.glow === false && !saved.edgeGlow) saved.edgeGlow = 'off';
    if (saved.features) delete saved.features.glow;
    value = { ...value, ...saved, features: { ...value.features, ...(saved.features || {}) } };
  } catch (_) {}

  const listeners = new Set();
  return {
    get: () => structuredClone(value),
    set(patch) {
      value = { ...value, ...patch, features: { ...value.features, ...(patch.features || {}) } };
      try { fs.writeFileSync(file, JSON.stringify(value, null, 2)); } catch (_) {}
      for (const listener of listeners) listener(structuredClone(value));
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

const oneOf = (value, options) => options.includes(value);

// Only accept known keys with the right types from the renderer.
function sanitizePatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if (patch.displayId === null || typeof patch.displayId === 'number') out.displayId = patch.displayId;
  if (Number.isFinite(patch.scale)) out.scale = Math.max(0.8, Math.min(1.4, patch.scale));
  if (oneOf(patch.clockFormat, ['system', '12h', '24h'])) out.clockFormat = patch.clockFormat;
  if (oneOf(patch.clockDate, ['full', 'weekday', 'off'])) out.clockDate = patch.clockDate;
  if (oneOf(patch.clockStyle, ['regular', 'bold', 'mono', 'thin'])) out.clockStyle = patch.clockStyle;
  if (oneOf(patch.clockColor, ['white', 'accent'])) out.clockColor = patch.clockColor;
  if (oneOf(patch.weatherShow, ['icon-temp', 'temp', 'detailed'])) out.weatherShow = patch.weatherShow;
  if (oneOf(patch.weatherColor, ['white', 'accent', 'weather'])) out.weatherColor = patch.weatherColor;
  for (const key of ['launchAtLogin', 'expandOnHover', 'keepOpen', 'hideBehindMaximized', 'clockSeconds']) {
    if (typeof patch[key] === 'boolean') out[key] = patch[key];
  }
  if (typeof patch.weatherCity === 'string') out.weatherCity = patch.weatherCity.slice(0, 80);
  if (oneOf(patch.temperatureUnit, ['c', 'f'])) out.temperatureUnit = patch.temperatureUnit;
  if (patch.accent === 'album' || ACCENT_SWATCHES.includes(patch.accent)) out.accent = patch.accent;
  if (oneOf(patch.edgeGlow, ['off', 'subtle', 'strong'])) out.edgeGlow = patch.edgeGlow;
  if (oneOf(patch.corners, ['rounded', 'squared'])) out.corners = patch.corners;
  if (oneOf(patch.material, ['solid', 'glass'])) out.material = patch.material;
  if (patch.features && typeof patch.features === 'object') {
    out.features = {};
    for (const key of Object.keys(DEFAULTS.features)) {
      if (typeof patch.features[key] === 'boolean') out.features[key] = patch.features[key];
    }
  }
  return out;
}

module.exports = { createConfig, sanitizePatch, ACCENT_SWATCHES };
