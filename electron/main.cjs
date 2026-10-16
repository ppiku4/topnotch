const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, spawn } = require('child_process');
const readline = require('readline');
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, powerMonitor, screen, shell } = require('electron');
const { pressMediaKey, isLeftButtonDown, maximizedForegroundRect, setAcrylic, setRoundedCorners } = require('./win32.cjs');
const { createSystemService } = require('./system-service.cjs');
const { createConfig, sanitizePatch } = require('./config.cjs');
const { createClipboardHistory } = require('./clipboard.cjs');
const { createShelf } = require('./shelf.cjs');
const { fetchLyrics } = require('./lyrics.cjs');
const { createWeather } = require('./weather.cjs');
const { createSensors } = require('./sensors.cjs');
const { checkForUpdate, createInstaller } = require('./updater.cjs');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Diagnostics: %APPDATA%\topnotch\topnotch.log
const logFile = path.join(app.getPath('userData'), 'topnotch.log');
function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try { fs.appendFileSync(logFile, line); } catch (_) {}
  console.log(message);
}
process.on('uncaughtException', (error) => log('uncaughtException: ' + (error.stack || error)));
process.on('unhandledRejection', (reason) => log('unhandledRejection: ' + (reason && reason.stack || reason)));
process.on('exit', (code) => log('process exit ' + code));
app.on('child-process-gone', (_e, details) => log('child-process-gone ' + JSON.stringify(details)));
app.on('render-process-gone', (_e, _wc, details) => log('render-process-gone ' + JSON.stringify(details)));
app.on('will-quit', () => log('will-quit'));
log(`start electron ${process.versions.electron} pid ${process.pid}`);

// The window never resizes: the island animates inside a fixed transparent
// box, and everything outside the pill lets clicks through to the desktop.
const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 600;
const ASSETS = path.join(__dirname, '..', 'assets');
const CALL_APPS = /zoom|teams|discord|slack|skype|webex|whatsapp|telegram|signal|meet|facetime/i;

let notchWindow = null;
let settingsWindow = null;
let tray = null;
let mediaWorker = null;
let lastMedia = null;
let systemService = null;
let config = null;
let clipboardHistory = null;
let shelf = null;
let quitting = false;
let lyricsKey = null;
let lastLyrics = { key: null, lines: [] };
let lastPrivacy = { camera: [], microphone: [], call: null };
let bluetoothDevices = null;
let statsTimer = null;
let weather = null;
let sensors = null;
let installer = null;
let lhmCpuTemp = null;
let lastWeather = null;
let mixerTimer = null;
const appIcons = new Map();
let lastNet = { rx: 0, tx: 0, gpu: -1, cpuTemp: -1 };
let nvidia = null;      // { usage, temp, name } from nvidia-smi
let nvidiaProcess = null;

const features = () => config.get().features;

function send(channel, payload) {
  if (notchWindow && !notchWindow.isDestroyed()) notchWindow.webContents.send(channel, payload);
}

function broadcast(channel, payload) {
  for (const win of [notchWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function loadPage(win, hash = '') {
  if (process.env.TOPNOTCH_DEV) win.loadURL('http://127.0.0.1:5173/' + (hash ? '#' + hash : ''));
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), hash ? { hash } : undefined);
}

// ── Notch window ──────────────────────────────────────────────────────────

function targetDisplay() {
  const id = config.get().displayId;
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}

function notchBounds() {
  const { bounds } = targetDisplay();
  const width = Math.min(WINDOW_WIDTH, bounds.width);
  const height = Math.min(WINDOW_HEIGHT, bounds.height);
  return { x: Math.round(bounds.x + (bounds.width - width) / 2), y: bounds.y, width, height };
}

function positionNotch() {
  if (notchWindow && !notchWindow.isDestroyed()) notchWindow.setBounds(notchBounds());
}

function createNotchWindow() {
  notchWindow = new BrowserWindow({
    ...notchBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  notchWindow.setAlwaysOnTop(true, 'screen-saver');
  notchWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notchWindow.setIgnoreMouseEvents(true, { forward: true });

  // Fullscreen apps and UAC prompts can knock us off the top band.
  notchWindow.on('always-on-top-changed', (_e, onTop) => {
    if (!onTop && !notchWindow.isDestroyed()) notchWindow.setAlwaysOnTop(true, 'screen-saver');
  });
  const onTopTimer = setInterval(() => {
    if (notchWindow && !notchWindow.isDestroyed()) notchWindow.setAlwaysOnTop(true, 'screen-saver');
  }, 3000);
  notchWindow.on('closed', () => { clearInterval(onTopTimer); notchWindow = null; });

  notchWindow.on('blur', () => send('window-blur'));
  if (process.env.TOPNOTCH_DEV) {
    notchWindow.webContents.on('console-message', (_e, _level, message) => console.log('[renderer] ' + message));
  }
  notchWindow.webContents.on('render-process-gone', (_e, details) => {
    if (!quitting && details.reason !== 'clean-exit') setTimeout(() => notchWindow?.webContents.reload(), 1000);
  });
  notchWindow.webContents.on('did-finish-load', async () => {
    send('config', config.get());
    if (lastMedia) send('media-state', lastMedia);
    if (systemService) send('system-levels', { levels: systemService.getLevels(), changed: null });
    send('lyrics', lastLyrics);
    send('covered', covered);
    send('privacy', lastPrivacy);
    send('bluetooth-devices', bluetoothDevices || []);
    if (lastWeather) send('weather', lastWeather);
    if (clipboardHistory) send('clipboard', clipboardHistory.list());
    send('shelf', await shelf.list());
    notchWindow.showInactive();
  });

  loadPage(notchWindow);
}

// ── Settings window + tray ────────────────────────────────────────────────

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 860,
    height: 600,
    minWidth: 720,
    minHeight: 480,
    title: 'TopNotch Settings',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#141416',
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
  loadPage(settingsWindow, 'settings');
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('TopNotch');
  const rebuild = () => {
    const current = config.get();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open panel', click: () => send('open-panel', null) },
      { label: 'Settings…', click: openSettings },
      { label: 'Launch at login', type: 'checkbox', checked: current.launchAtLogin, click: (item) => config.set({ launchAtLogin: item.checked }) },
      { type: 'separator' },
      { label: 'Reload notch', click: () => notchWindow?.webContents.reload() },
      { label: 'Restart system helper', click: () => systemService?.restart() },
      { type: 'separator' },
      { label: 'Quit TopNotch', click: () => app.quit() }
    ]));
  };
  rebuild();
  config.onChange(rebuild);
  tray.on('click', openSettings);
}

function applyLoginItem(enabled) {
  // In development the login item launches electron.exe with this project.
  const args = app.isPackaged ? [] : [path.resolve(__dirname, '..')];
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args });
}

// ── Media, lyrics ─────────────────────────────────────────────────────────

function startMediaWorker() {
  mediaWorker = fork(path.join(__dirname, 'media-worker.cjs'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  });
  mediaWorker.on('message', (msg) => {
    if (!msg || msg.type !== 'media') return;
    // Artwork is only sent when it changes; keep the last one for reloads.
    const art = msg.state && msg.state.art === undefined && lastMedia ? lastMedia.art : msg.state?.art;
    lastMedia = msg.state ? withTimeline({ ...msg.state, art }) : null;
    send('media-state', lastMedia);
    updateLyrics();
  });
  mediaWorker.on('exit', (code, signal) => {
    log(`media worker exit ${code} ${signal}`);
    mediaWorker = null;
    if (!quitting) setTimeout(startMediaWorker, 2000);
  });
}

// The SMTC addon has no LastUpdatedTime, so a browser that reported 0:00 when
// the video started looks stuck at 0:00. The helper's WinRT timeline says
// when each position was taken; the renderer extrapolates from there.
let timelines = new Map();
function withTimeline(state) {
  const timeline = timelines.get(state.appId);
  if (!timeline || !(timeline.updated > 0)) return state;
  return { ...state, position: timeline.position, positionAt: timeline.updated };
}

function updateLyrics() {
  const key = lastMedia ? `${lastMedia.title}|${lastMedia.artist}` : null;
  if (key === lyricsKey) return;
  lyricsKey = key;
  lastLyrics = { key, lines: [] };
  send('lyrics', lastLyrics);
  if (!key || !features().lyrics) return;
  const { title, artist, duration } = lastMedia;
  const load = (retriesLeft) => fetchLyrics({ title, artist, duration })
    .then((lines) => {
      if (lyricsKey !== key) return;
      log(`lyrics: ${lines.length} lines for "${title}"`);
      lastLyrics = { key, lines };
      send('lyrics', lastLyrics);
    })
    .catch((error) => {
      log(`lyrics: ${error.message} for "${title}"`);
      if (retriesLeft > 0) setTimeout(() => { if (lyricsKey === key) load(retriesLeft - 1); }, 8000);
    });
  load(2);
}

// ── Helper events: privacy, Bluetooth, network ────────────────────────────

function onHelperEvent(msg) {
  if (msg.type === 'ready') {
    bluetoothDevices = null; // the first scan after a restart is a baseline
  } else if (msg.type === 'privacy') {
    const users = [...new Set([...msg.camera, ...msg.microphone])];
    lastPrivacy = { camera: msg.camera, microphone: msg.microphone, call: users.find((a) => CALL_APPS.test(a)) || null };
    send('privacy', lastPrivacy);
  } else if (msg.type === 'timeline') {
    timelines = new Map(msg.sessions.map((s) => [s.appId, s]));
    if (lastMedia) {
      const next = withTimeline(lastMedia);
      if (next.position !== lastMedia.position || next.positionAt !== lastMedia.positionAt) {
        lastMedia = next;
        send('media-state', lastMedia);
      }
    }
  } else if (msg.type === 'peak') {
    send('peak', msg.v);
  } else if (msg.type === 'mixer') {
    publishMixer(msg.sessions);
  } else if (msg.type === 'net') {
    lastNet = { rx: msg.rx, tx: msg.tx, gpu: msg.gpu, cpuTemp: msg.cpuTemp };
  } else if (msg.type === 'bluetooth') {
    const previous = bluetoothDevices;
    bluetoothDevices = msg.devices;
    send('bluetooth-devices', msg.devices);
    if (!previous || !features().bluetooth) return;
    for (const device of msg.devices) {
      const before = previous.find((d) => d.name === device.name);
      if (device.connected && !before?.connected) send('bluetooth', { type: 'connected', ...device });
      else if (!device.connected && before?.connected) send('bluetooth', { type: 'disconnected', ...device });
      else if (device.connected && device.battery >= 0 && before && device.battery !== before.battery && device.battery <= 20) {
        send('bluetooth', { type: 'battery', ...device });
      }
    }
  }
}

// ── Per-app mixer, polled only while the Mixer tab is open ───────────────

async function publishMixer(sessions) {
  const rows = await Promise.all(sessions.map(async (session) => {
    if (session.path && !appIcons.has(session.path)) {
      try { appIcons.set(session.path, (await app.getFileIcon(session.path, { size: 'small' })).toDataURL()); }
      catch (_) { appIcons.set(session.path, null); }
    }
    return { ...session, icon: session.path ? appIcons.get(session.path) : null };
  }));
  send('mixer', rows);
}

function setMixerVisible(on) {
  if (on && !mixerTimer) {
    systemService?.listMixer();
    mixerTimer = setInterval(() => systemService?.listMixer(), 2000);
  } else if (!on && mixerTimer) {
    clearInterval(mixerTimer);
    mixerTimer = null;
  }
}

// ── CPU / RAM / network, only while visible ──────────────────────────────

function cpuTimes() {
  let idle = 0, total = 0;
  for (const cpu of os.cpus()) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

// NVIDIA cards: usage and temperature from nvidia-smi, sampled every second
// by one long-running process while stats are visible. Other GPUs fall back
// to the Windows GPU Engine counters (usage only).
const NVIDIA_SMI = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'nvidia-smi.exe');
function startNvidia() {
  if (nvidiaProcess || !fs.existsSync(NVIDIA_SMI)) return;
  nvidiaProcess = spawn(NVIDIA_SMI, ['--query-gpu=utilization.gpu,temperature.gpu,name', '--format=csv,noheader,nounits', '-lms', '1000'], { windowsHide: true });
  readline.createInterface({ input: nvidiaProcess.stdout }).on('line', (line) => {
    const [usage, temp, ...name] = line.split(',').map((v) => v.trim());
    if (Number.isFinite(Number(usage))) nvidia = { usage: Number(usage), temp: Number(temp), name: name.join(',') };
  });
  nvidiaProcess.on('error', () => { nvidiaProcess = null; });
  nvidiaProcess.on('exit', () => { nvidiaProcess = null; });
}
function stopNvidia() {
  nvidiaProcess?.kill();
  nvidiaProcess = null;
}

function setStatsVisible(on) {
  if (on && features().stats && !statsTimer) {
    systemService?.setStats(true);
    startNvidia();
    let previous = cpuTimes();
    let sensorTick = 0;
    statsTimer = setInterval(() => {
      if (sensorTick++ % 2 === 0) sensors?.readCpuTemperature().then((t) => { lhmCpuTemp = t; });
      const now = cpuTimes();
      const total = now.total - previous.total;
      const cpu = total > 0 ? Math.round(100 * (1 - (now.idle - previous.idle) / total)) : 0;
      previous = now;
      const ram = Math.round(100 * (1 - os.freemem() / os.totalmem()));
      send('stats', {
        cpu,
        ram,
        ramUsedGb: (os.totalmem() - os.freemem()) / 1073741824,
        ramTotalGb: os.totalmem() / 1073741824,
        rx: lastNet.rx,
        tx: lastNet.tx,
        cpuTemp: lhmCpuTemp ?? (lastNet.cpuTemp >= 0 ? lastNet.cpuTemp : null),
        gpu: nvidia ? nvidia.usage : lastNet.gpu >= 0 ? lastNet.gpu : null,
        gpuTemp: nvidia && Number.isFinite(nvidia.temp) ? nvidia.temp : null,
        gpuName: nvidia?.name || null
      });
    }, 1000);
  } else if (!on && statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
    systemService?.setStats(false);
    stopNvidia();
  }
}

// ── Dark glass ────────────────────────────────────────────────────────────

// Windows paints an acrylic accent across a window's whole rectangle and
// ignores its window region, so the blur lives in its own small window
// behind the island instead of on the big transparent notch window. The
// renderer reports the island's rect every animation frame and the backdrop
// follows it. Windows 11 rounds the backdrop's corners (about 8px), so it's
// inset a little to keep those corners inside the island's larger curve, and
// it starts above the screen edge so its top corners are never visible.
// Windows ignores window regions for acrylic (tested on Electron and plain
// Win32 windows), so its own corner rounding is the only clip available.
let glassOn = false;
let backdrop = null;
const BACKDROP_TINT = 0x99121214;           // 0xAABBGGRR
const OFFSCREEN = { x: -200, y: -200, width: 10, height: 10 };

// Windows won't make this window shorter than its minimum tracking height
// (about 50 DIP), so small pills get a tall backdrop that extends further
// above the screen edge, keeping its bottom aligned with the island.
const BACKDROP_MIN_HEIGHT = 60;

function backdropBoundsFor(rect) {
  const nb = notchWindow.getBounds();
  // The island uses Windows' own 8 DIP corner radius in glass mode, so the
  // backdrop covers it edge to edge; larger radii (mid-animation) get inset.
  const r = Math.max(0, rect.radius);
  // At least 1 DIP: window positions are whole DIPs, so the backdrop can land
  // a pixel or two off the island's fractional edge.
  const inset = r > 8.5 ? Math.ceil((r - 8) * 0.3) + 1 : 1;
  const bottom = nb.y + rect.y + rect.height - inset;
  const height = Math.max(BACKDROP_MIN_HEIGHT, Math.round(rect.height + 12 - inset));
  return {
    x: Math.round(nb.x + rect.x + inset),
    y: Math.round(bottom - height),
    width: Math.max(1, Math.round(rect.width - inset * 2)),
    height
  };
}

function createBackdrop() {
  backdrop = new BrowserWindow({
    ...OFFSCREEN,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  backdrop.setIgnoreMouseEvents(true);
  backdrop.setAlwaysOnTop(true, 'screen-saver');
  backdrop.loadURL('data:text/html,<body style="margin:0;background:transparent"></body>');
  try {
    setAcrylic(backdrop, true, BACKDROP_TINT);
    setRoundedCorners(backdrop);
  } catch (error) { log('glass: ' + error.message); }
  backdrop.showInactive();
  // The notch window is owned by the backdrop, which keeps it stacked above.
  notchWindow.setParentWindow(backdrop);
  backdrop.on('closed', () => { backdrop = null; });
}

function applyGlass(on) {
  if (!notchWindow || notchWindow.isDestroyed() || on === glassOn) return;
  glassOn = on;
  if (on) {
    createBackdrop();
    send('glass-shape-request');
  } else if (backdrop) {
    notchWindow.setParentWindow(null);
    backdrop.destroy();
    backdrop = null;
  }
}

function moveBackdrop(rect) {
  if (!backdrop || backdrop.isDestroyed()) return;
  backdrop.setBounds(rect.hidden ? OFFSCREEN : backdropBoundsFor(rect));
}

// ── Hide behind maximized windows ─────────────────────────────────────────

let coverTimer = null;
let covered = false;
function setCovered(next) {
  if (next === covered) return;
  covered = next;
  send('covered', covered);
}
function startCoverWatch() {
  if (coverTimer) return;
  coverTimer = setInterval(() => {
    const rect = maximizedForegroundRect();
    if (!rect) { setCovered(false); return; }
    const dip = screen.screenToDipRect(null, { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
    const { bounds } = targetDisplay();
    // Maximized windows overhang their monitor by a few pixels.
    setCovered(dip.x <= bounds.x + 16 && dip.y <= bounds.y + 16 && dip.width >= bounds.width - 32);
  }, 1000);
}
function stopCoverWatch() {
  clearInterval(coverTimer);
  coverTimer = null;
  setCovered(false);
}

// ── File drags toward the notch ───────────────────────────────────────────
// A click-through window can't receive drops, so watch for a mouse drag that
// started elsewhere and reaches the top of the screen, then start catching.

function startDragWatch() {
  let wasDown = false;
  let startedOutside = false;
  let active = false;
  setInterval(() => {
    if (!notchWindow || notchWindow.isDestroyed() || !features().shelf) return;
    const down = isLeftButtonDown();
    const cursor = screen.getCursorScreenPoint();
    const b = notchWindow.getBounds();
    const center = b.x + b.width / 2;
    const inZone = cursor.y >= b.y && cursor.y < b.y + 70 && Math.abs(cursor.x - center) < 260;
    if (down && !wasDown) startedOutside = !inZone;
    if (down && startedOutside && inZone && !active) {
      active = true;
      notchWindow.setIgnoreMouseEvents(false);
      send('drag-near', true);
    } else if (!down && active) {
      active = false;
      send('drag-near', false);
    }
    wasDown = down;
  }, 100);
}

// ── IPC ───────────────────────────────────────────────────────────────────

const fromNotch = (event) => BrowserWindow.fromWebContents(event.sender) === notchWindow;
const fromOurWindows = (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && (win === notchWindow || win === settingsWindow);
};
const ALLOWED_MEDIA_KEYS = new Set(['play-pause', 'next', 'previous']);

ipcMain.on('set-passthrough', (event, passthrough) => {
  if (!fromNotch(event)) return;
  if (passthrough) notchWindow.setIgnoreMouseEvents(true, { forward: true });
  else notchWindow.setIgnoreMouseEvents(false);
});

ipcMain.on('media-control', (event, action) => {
  if (fromNotch(event) && ALLOWED_MEDIA_KEYS.has(action)) pressMediaKey(action);
});
ipcMain.on('media-seek', (event, seconds) => {
  if (fromNotch(event) && Number.isFinite(seconds) && lastMedia) systemService?.seek(seconds, lastMedia.appId);
});
ipcMain.on('set-volume', (event, value) => {
  if (fromNotch(event) && Number.isFinite(value)) systemService?.setVolume(value);
});
ipcMain.on('toggle-mute', (event) => {
  if (fromNotch(event)) systemService?.toggleMute();
});
ipcMain.on('set-brightness', (event, value) => {
  if (fromNotch(event) && Number.isFinite(value)) systemService?.setBrightness(value);
});

ipcMain.on('stats-visible', (event, on) => { if (fromNotch(event)) setStatsVisible(!!on); });
// The renderer reports the island's rect (CSS px, zoom included) each frame
// while it animates; in glass mode the window region follows it.
ipcMain.on('island-shape', (event, rect) => {
  if (!fromNotch(event) || !glassOn || !rect) return;
  if (![rect.x, rect.y, rect.width, rect.height, rect.radius].every(Number.isFinite)) return;
  moveBackdrop(rect);
});
ipcMain.on('meter', (event, on) => { if (fromNotch(event)) systemService?.setMeter(!!on); });
ipcMain.on('mixer-visible', (event, on) => { if (fromNotch(event)) setMixerVisible(!!on); });
ipcMain.on('app-volume', (event, pid, value) => {
  if (fromNotch(event) && Number.isInteger(pid) && Number.isFinite(value)) systemService?.setAppVolume(pid, value);
});
ipcMain.on('app-mute', (event, pid) => { if (fromNotch(event) && Number.isInteger(pid)) systemService?.toggleAppMute(pid); });

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:/Windows', 'System32');
const QUICK_TOOLS = {
  calculator: () => shell.openPath(path.join(SYSTEM32, 'calc.exe')),
  snip: () => shell.openExternal('ms-screenclip:'),
  taskmgr: () => shell.openPath(path.join(SYSTEM32, 'Taskmgr.exe')),
  bluetooth: () => shell.openExternal('ms-settings:bluetooth'),
  sound: () => shell.openExternal('ms-settings:apps-volume')
};
ipcMain.on('quick-tool', (event, name) => {
  if (fromNotch(event) && Object.hasOwn(QUICK_TOOLS, name)) QUICK_TOOLS[name]();
});

ipcMain.on('clipboard-copy', (event, id) => { if (fromNotch(event) && typeof id === 'string') clipboardHistory?.copy(id); });
ipcMain.on('clipboard-pin', (event, id) => { if (fromNotch(event) && typeof id === 'string') clipboardHistory?.togglePin(id); });
ipcMain.on('clipboard-remove', (event, id) => { if (fromNotch(event) && typeof id === 'string') clipboardHistory?.remove(id); });
ipcMain.on('clipboard-clear', (event) => { if (fromNotch(event)) clipboardHistory?.clear(); });

ipcMain.on('shelf-add', (event, paths) => { if (fromNotch(event) && Array.isArray(paths)) shelf.add(paths); });
ipcMain.on('shelf-remove', (event, p) => { if (fromNotch(event) && typeof p === 'string') shelf.remove(p); });
ipcMain.on('shelf-clear', (event) => { if (fromNotch(event)) shelf.clear(); });
ipcMain.on('shelf-drag', (event, paths) => {
  if (!fromNotch(event) || !Array.isArray(paths)) return;
  const files = paths.filter((p) => typeof p === 'string' && shelf.has(p));
  if (!files.length) return;
  const iconUrl = shelf.icon(files[0]);
  const icon = iconUrl ? nativeImage.createFromDataURL(iconUrl) : nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  event.sender.startDrag({ files, file: files[0], icon });
});

ipcMain.on('notify', (event, payload) => {
  if (!fromNotch(event) || !payload) return;
  const title = String(payload.title || 'TopNotch').slice(0, 80);
  const body = String(payload.body || '').slice(0, 200);
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(ASSETS, 'icon.png') }).show();
});

ipcMain.handle('config-get', (event) => (fromOurWindows(event) ? config.get() : null));
ipcMain.on('config-set', (event, patch) => { if (fromOurWindows(event)) config.set(sanitizePatch(patch)); });
ipcMain.handle('weather-get', (event) => (fromOurWindows(event) ? lastWeather : null));
ipcMain.handle('displays-get', (event) => {
  if (!fromOurWindows(event)) return [];
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `Display ${i + 1}${d.id === primary ? ' (primary)' : ''} · ${d.size.width}×${d.size.height}`
  }));
});
ipcMain.on('open-settings', (event) => { if (fromOurWindows(event)) openSettings(); });
ipcMain.on('settings-close', (event) => {
  if (settingsWindow && BrowserWindow.fromWebContents(event.sender) === settingsWindow) settingsWindow.close();
});
ipcMain.handle('app-info', (event) => (fromOurWindows(event)
  ? { name: 'TopNotch', version: app.getVersion(), electron: process.versions.electron }
  : null));
ipcMain.on('open-folder', (event, which) => {
  if (!fromOurWindows(event)) return;
  if (which === 'log') shell.showItemInFolder(logFile);
  else if (which === 'data') shell.openPath(app.getPath('userData'));
});
ipcMain.handle('update-check', async (event) => {
  if (!fromOurWindows(event)) return null;
  try { return await checkForUpdate(app.getVersion()); } catch (error) { return { status: 'error', error: error.message, current: app.getVersion() }; }
});
ipcMain.handle('update-install', async (event) => (fromOurWindows(event) ? installer.install() : null));
ipcMain.handle('update-mode', (event) => (fromOurWindows(event) ? { selfInstall: installer.canSelfInstall } : null));
ipcMain.on('open-release', (event, url) => {
  if (fromOurWindows(event) && /^https:\/\/github\.com\//.test(String(url))) shell.openExternal(String(url));
});
ipcMain.handle('sensors-status', async (event) => (fromOurWindows(event) ? { ...(await sensors.status()), ...sensors.info } : null));
ipcMain.handle('sensors-install', async (event) => {
  if (!fromOurWindows(event)) return { ok: false };
  try {
    await sensors.install();
    const started = await sensors.start();
    return { ok: true, started };
  } catch (error) { log('sensors: ' + error.message); return { ok: false, error: error.message }; }
});
ipcMain.handle('sensors-start', async (event) => {
  if (!fromOurWindows(event)) return { ok: false };
  try { return { ok: true, started: await sensors.start() }; } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('sensors-at-sign-in', async (event, on) => {
  if (!fromOurWindows(event)) return { ok: false };
  try { return { ok: true, atSignIn: await sensors.setAtSignIn(!!on) }; } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.on('lyrics-resync', (event) => {
  if (!fromNotch(event)) return;
  systemService?.resendTimeline();
  lyricsKey = null;
  updateLyrics();
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  config = createConfig(dir);
  clipboardHistory = createClipboardHistory({ dir, onChange: (items) => send('clipboard', items) });
  shelf = createShelf({ dir, onChange: (items) => send('shelf', items) });
  sensors = createSensors({ dir, log });
  installer = createInstaller({ app, shell, log, onProgress: (progress) => broadcast('update-progress', progress) });
  weather = createWeather({
    getConfig: () => config.get(),
    onChange: (data) => { lastWeather = data; broadcast('weather', data); },
    log
  });
  systemService = createSystemService({
    onLevels: (levels, changed) => send('system-levels', { levels, changed }),
    onEvent: onHelperEvent,
    log
  });

  const applyConfig = (current) => {
    applyLoginItem(current.launchAtLogin);
    if (current.features.clipboard) clipboardHistory.start(); else clipboardHistory.stop();
    if (!current.features.stats) setStatsVisible(false);
    if (current.features.weather) weather.start(); else weather.stop();
    if (current.hideBehindMaximized) startCoverWatch(); else stopCoverWatch();
    applyGlass(current.material === 'glass');
  };
  applyConfig(config.get());
  let previous = config.get();
  config.onChange((current) => {
    applyConfig(current);
    if (current.displayId !== previous.displayId) positionNotch();
    if (current.features.lyrics && !previous.features.lyrics) { lyricsKey = null; updateLyrics(); }
    if (current.weatherCity !== previous.weatherCity || current.temperatureUnit !== previous.temperatureUnit) weather.reset();
    previous = current;
    broadcast('config', current);
  });

  createNotchWindow();
  applyGlass(config.get().material === 'glass');
  createTray();
  startMediaWorker();
  startDragWatch();

  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, positionNotch);
  powerMonitor.on('resume', () => setTimeout(() => { systemService?.restart(); weather.refresh(); }, 2000));
});

app.on('second-instance', openSettings);
app.on('before-quit', () => {
  quitting = true;
  mediaWorker?.kill();
  systemService?.stop();
  stopNvidia();
  if (backdrop && !backdrop.isDestroyed()) backdrop.destroy();
});
// Closing settings must not quit; only the tray's Quit does.
app.on('window-all-closed', () => { if (quitting) app.quit(); });
