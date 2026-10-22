const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Explicit methods only: the renderer never gets a raw send/invoke.
contextBridge.exposeInMainWorld('topnotch', {
  platform: process.platform,
  setPassthrough: (passthrough) => ipcRenderer.send('set-passthrough', !!passthrough),

  mediaControl: (action) => ipcRenderer.send('media-control', action),
  seek: (seconds) => ipcRenderer.send('media-seek', Number(seconds)),
  onMediaState: (callback) => subscribe('media-state', callback),
  onLyrics: (callback) => subscribe('lyrics', callback),

  setVolume: (value) => ipcRenderer.send('set-volume', Number(value)),
  toggleMute: () => ipcRenderer.send('toggle-mute'),
  setBrightness: (value) => ipcRenderer.send('set-brightness', Number(value)),
  onSystemLevels: (callback) => subscribe('system-levels', callback),

  onPrivacy: (callback) => subscribe('privacy', callback),
  onBluetooth: (callback) => subscribe('bluetooth', callback),

  setStatsVisible: (on) => ipcRenderer.send('stats-visible', !!on),
  onStats: (callback) => subscribe('stats', callback),
  setMixerVisible: (on) => ipcRenderer.send('mixer-visible', !!on),
  onMixer: (callback) => subscribe('mixer', callback),
  setAppVolume: (pid, value) => ipcRenderer.send('app-volume', Number(pid), Number(value)),
  toggleAppMute: (pid) => ipcRenderer.send('app-mute', Number(pid)),
  onBluetoothDevices: (callback) => subscribe('bluetooth-devices', callback),
  onWeather: (callback) => subscribe('weather', callback),
  getWeather: () => ipcRenderer.invoke('weather-get'),
  quickTool: (name) => ipcRenderer.send('quick-tool', String(name)),

  onClipboard: (callback) => subscribe('clipboard', callback),
  copyClip: (id) => ipcRenderer.send('clipboard-copy', String(id)),
  pinClip: (id) => ipcRenderer.send('clipboard-pin', String(id)),
  removeClip: (id) => ipcRenderer.send('clipboard-remove', String(id)),
  clearClipboard: () => ipcRenderer.send('clipboard-clear'),

  onShelf: (callback) => subscribe('shelf', callback),
  onDragNear: (callback) => subscribe('drag-near', callback),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  addToShelf: (paths) => ipcRenderer.send('shelf-add', paths.map(String)),
  removeFromShelf: (p) => ipcRenderer.send('shelf-remove', String(p)),
  clearShelf: () => ipcRenderer.send('shelf-clear'),
  dragFromShelf: (paths) => ipcRenderer.send('shelf-drag', paths.map(String)),

  notify: (title, body) => ipcRenderer.send('notify', { title: String(title), body: String(body) }),

  getConfig: () => ipcRenderer.invoke('config-get'),
  setConfig: (patch) => ipcRenderer.send('config-set', patch),
  onConfig: (callback) => subscribe('config', callback),
  getDisplays: () => ipcRenderer.invoke('displays-get'),
  openSettings: () => ipcRenderer.send('open-settings'),

  onOpenPanel: (callback) => subscribe('open-panel', callback),
  onCovered: (callback) => subscribe('covered', callback),
  getDock: () => ipcRenderer.invoke('dock-get'),
  onDock: (callback) => subscribe('dock', callback),
  startDockDrag: () => ipcRenderer.send('dock-drag-start'),
  reportIslandShape: (rect) => ipcRenderer.send('island-shape', rect),
  onGlassShapeRequest: (callback) => subscribe('glass-shape-request', callback),
  setMeter: (on) => ipcRenderer.send('meter', !!on),
  onPeak: (callback) => subscribe('peak', callback),
  resyncLyrics: () => ipcRenderer.send('lyrics-resync'),
  nudgeLyrics: (seconds) => ipcRenderer.send('lyrics-offset', Number(seconds)),
  closeSettings: () => ipcRenderer.send('settings-close'),
  getAppInfo: () => ipcRenderer.invoke('app-info'),
  openFolder: (which) => ipcRenderer.send('open-folder', String(which)),
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
  openRelease: (url) => ipcRenderer.send('open-release', String(url)),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  getUpdateMode: () => ipcRenderer.invoke('update-mode'),
  onUpdateProgress: (callback) => subscribe('update-progress', callback),
  sensorsStatus: () => ipcRenderer.invoke('sensors-status'),
  installSensors: () => ipcRenderer.invoke('sensors-install'),
  startSensors: () => ipcRenderer.invoke('sensors-start'),
  setSensorsAtSignIn: (on) => ipcRenderer.invoke('sensors-at-sign-in', !!on),
  onWindowBlur: (callback) => subscribe('window-blur', callback),

  onWheelMenu: (callback) => subscribe('wheel-menu', callback),
  wheelPick: (id) => ipcRenderer.invoke('wheel-pick', String(id)),
  closeWheel: () => ipcRenderer.send('wheel-close'),
  downloadEngine: (name) => ipcRenderer.invoke('engine-download', String(name)),
  onEngineProgress: (callback) => subscribe('engine-progress', callback),
  openLibreOffice: () => ipcRenderer.send('open-libreoffice'),
  onConvertJob: (callback) => subscribe('convert-job', callback),
  showConverted: (file) => ipcRenderer.send('show-converted', String(file)),

  getEditorImage: () => ipcRenderer.invoke('editor-get'),
  onEditorOpen: (callback) => subscribe('editor-open', callback),
  saveEdited: (png, target) => ipcRenderer.invoke('editor-save', new Uint8Array(png), String(target)),
  revealEdited: (file) => ipcRenderer.send('editor-reveal', String(file)),
  closeEditor: () => ipcRenderer.send('editor-close'),
  removeBackgroundInEditor: () => ipcRenderer.invoke('editor-remove-bg'),
  downloadBackgroundModel: () => ipcRenderer.invoke('editor-download-model'),
  onEditorProgress: (callback) => subscribe('editor-progress', callback),
  getAiModels: () => ipcRenderer.invoke('ai-models-get'),
  downloadAiModel: (id) => ipcRenderer.invoke('ai-model-download', String(id)),
  deleteAiModel: (id) => ipcRenderer.invoke('ai-model-delete', String(id)),
  onAiModels: (callback) => subscribe('ai-models', callback),
  getEngines: () => ipcRenderer.invoke('engines-get'),
  installEngine: (id) => ipcRenderer.invoke('engine-install', String(id)),
  installMissingEngines: () => ipcRenderer.invoke('engines-install-missing'),
  onEngines: (callback) => subscribe('engines', callback),
  closeSetup: () => ipcRenderer.send('setup-close'),
  openSetup: () => ipcRenderer.send('open-setup')
});
