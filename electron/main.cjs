const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, spawn } = require('child_process');
const readline = require('readline');
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, powerMonitor, screen, shell } = require('electron');
const { pressMediaKey, isLeftButtonDown, isKeyDown, forceForeground, maximizedForegroundRect, setAcrylic, setRoundedCorners } = require('./native.cjs');
const { createSystemService } = require('./system-service.cjs');
const { createConfig, sanitizePatch } = require('./config.cjs');
const { createClipboardHistory } = require('./clipboard.cjs');
const { createShelf } = require('./shelf.cjs');
const { fetchLyrics } = require('./lyrics.cjs');
const { createWeather } = require('./weather.cjs');
const { createSensors } = require('./sensors.cjs');
const { checkForUpdate, createInstaller } = require('./updater.cjs');
const { createConverter, extOf, TARGETS, EXTENSIONS } = require('./convert.cjs');
const { pathToFileURL } = require('url');

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
// Top/bottom edges get a wide window; left/right a taller, narrower one
// (the resting pill is a vertical strip there, the panel still horizontal).
const WINDOW_SIZE = {
  horizontal: { width: 900, height: 600 },
  vertical: { width: 720, height: 780 }
};
const ASSETS = path.join(__dirname, '..', 'assets');
const MAC = process.platform === 'darwin';
const CALL_APPS = /zoom|teams|discord|slack|skype|webex|whatsapp|telegram|signal|meet|facetime/i;

let notchWindow = null;
let settingsWindow = null;
let setupWindow = null;
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
let converter = null;
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

// ── Docking ───────────────────────────────────────────────────────────────
// The notch can sit anywhere along any edge of any display. `dock` is where
// it is right now (the saved config, or the live position while dragging);
// `anchor` tells the renderer where the island's centre is inside the
// window, which differs from the window's centre near the screen corners.
let dock = null;          // { edge, offset, displayId }
let dockDragging = false;

const isVertical = (edge) => edge === 'left' || edge === 'right';

function dockFromConfig() {
  const c = config.get();
  return { edge: c.dockEdge || 'top', offset: Number.isFinite(c.dockOffset) ? c.dockOffset : 0.5, displayId: c.displayId };
}

function displayFor(id) {
  return screen.getAllDisplays().find((d) => d.id === id) || screen.getPrimaryDisplay();
}

// The top edge uses the full screen (a real notch sits on the bezel); the
// other edges stay clear of the taskbar.
const edgeArea = (display, edge) => (edge === 'top' ? display.bounds : display.workArea);

function dockLayout(d = dock || dockFromConfig()) {
  const display = displayFor(d.displayId);
  const area = edgeArea(display, d.edge);
  const size = WINDOW_SIZE[isVertical(d.edge) ? 'vertical' : 'horizontal'];
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (isVertical(d.edge)) {
    const along = area.y + d.offset * area.height;
    const y = Math.round(clamp(along - height / 2, area.y, area.y + area.height - height));
    const x = d.edge === 'left' ? area.x : area.x + area.width - width;
    return { bounds: { x, y, width, height }, anchor: along - y };
  }
  const along = area.x + d.offset * area.width;
  const x = Math.round(clamp(along - width / 2, area.x, area.x + area.width - width));
  const y = d.edge === 'top' ? area.y : area.y + area.height - height;
  return { bounds: { x, y, width, height }, anchor: along - x };
}

function sendDock() {
  const d = dock || dockFromConfig();
  send('dock', { edge: d.edge, anchor: dockLayout(d).anchor, dragging: dockDragging });
}

// Older call sites: the bounds the window should have right now.
function notchBounds() {
  return dockLayout().bounds;
}

function positionNotch() {
  if (!notchWindow || notchWindow.isDestroyed()) return;
  if (!dockDragging) dock = dockFromConfig();
  const { bounds } = dockLayout();
  const current = notchWindow.getBounds();
  if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
    notchWindow.setBounds(bounds);
  }
  sendDock();
}

// Nearest edge of the display under the cursor, and how far along it.
// Within 4% of the centre or an end it snaps there.
// grab: how far along the edge the cursor sat from the island's centre when
// the drag began, so the island keeps that offset instead of jumping to
// centre itself under the cursor.
function dockAtCursor(cursor, grab = null) {
  const display = screen.getDisplayNearestPoint(cursor);
  const b = display.bounds;
  const distances = {
    top: cursor.y - b.y,
    bottom: b.y + b.height - cursor.y,
    left: cursor.x - b.x,
    right: b.x + b.width - cursor.x
  };
  const edge = Object.keys(distances).reduce((best, e) => (distances[e] < distances[best] ? e : best), 'top');
  const area = edgeArea(display, edge);
  const shift = grab && grab.edge === edge && grab.displayId === display.id ? grab.along : 0;
  let offset = isVertical(edge) ? (cursor.y - shift - area.y) / area.height : (cursor.x - shift - area.x) / area.width;
  offset = Math.max(0, Math.min(1, offset));
  for (const snap of [0, 0.5, 1]) if (Math.abs(offset - snap) < 0.04) offset = snap;
  return { edge, offset, displayId: display.id };
}

let dragTimer = null;
function startDockDrag() {
  if (dragTimer || config.get().lockPosition || !notchWindow) return;
  dockDragging = true;
  dock = dockFromConfig();
  sendDock();
  const startCursor = screen.getCursorScreenPoint();
  const startArea = edgeArea(displayFor(dock.displayId), dock.edge);
  let grab = {
    edge: dock.edge,
    displayId: dock.displayId,
    along: isVertical(dock.edge)
      ? startCursor.y - (startArea.y + dock.offset * startArea.height)
      : startCursor.x - (startArea.x + dock.offset * startArea.width)
  };
  dragTimer = setInterval(() => {
    if (!notchWindow || notchWindow.isDestroyed()) return endDockDrag(false);
    if (!isLeftButtonDown()) return endDockDrag(true);
    const next = dockAtCursor(screen.getCursorScreenPoint(), grab);
    // Once it moves to another edge or screen, the old grab point means
    // nothing there; follow the cursor directly from then on.
    if (grab && (next.edge !== grab.edge || next.displayId !== grab.displayId)) grab = null;
    if (next.edge !== dock.edge || next.displayId !== dock.displayId || Math.abs(next.offset - dock.offset) > 0.0005) {
      dock = next;
      notchWindow.setBounds(dockLayout().bounds);
      sendDock();
    }
  }, 16);
}

function endDockDrag(save) {
  clearInterval(dragTimer);
  dragTimer = null;
  dockDragging = false;
  if (save && dock) {
    config.set({ dockEdge: dock.edge, dockOffset: Math.round(dock.offset * 1000) / 1000, displayId: dock.displayId });
  }
  positionNotch();
}

function createNotchWindow() {
  notchWindow = new BrowserWindow({
    ...notchBounds(),
    // macOS: a panel floats over full-screen apps on every Space.
    ...(MAC ? { type: 'panel', enableLargerThanScreen: true } : null),
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
    sendDock();
    send('privacy', lastPrivacy);
    send('bluetooth-devices', bluetoothDevices || []);
    if (lastWeather) send('weather', lastWeather);
    if (clipboardHistory) send('clipboard', clipboardHistory.list());
    send('shelf', await shelf.list());
    notchWindow.showInactive();
  });

  loadPage(notchWindow);
}

// ── First run: download the conversion engines ────────────────────────────
// ffmpeg, LibreOffice and the background-removal model aren't in the
// installer; the first launch fetches whatever's missing (skipping copies
// already on the system) and shows progress. Closing the window lets it
// carry on in the background; Settings → General can retry later.

function openSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.show(); setupWindow.focus(); return; }
  setupWindow = new BrowserWindow({
    width: 520,
    height: 470,
    resizable: false,
    title: 'Set up TopNotch',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#141416',
    frame: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  setupWindow.once('ready-to-show', () => setupWindow.show());
  setupWindow.on('closed', () => { setupWindow = null; });
  loadPage(setupWindow, 'setup');
}

let installingMissing = null;
function installMissingEngines() {
  if (!installingMissing) {
    installingMissing = converter.installMissing().then((complete) => {
      if (complete) config.set({ enginesSetup: 'done' });
      return complete;
    }).finally(() => { installingMissing = null; });
  }
  return installingMissing;
}

function sendEngines(status) {
  for (const win of [setupWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('engines', status);
  }
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
  const trayIcon = nativeImage.createFromPath(path.join(ASSETS, MAC ? 'trayTemplate.png' : 'tray.png'));
  if (MAC) trayIcon.setTemplateImage(true); // follows the light/dark menu bar
  tray = new Tray(trayIcon);
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

// macOS reads Now Playing through the MediaRemote adapter (perl script +
// framework); packaged builds ship it in Resources, dev builds in build/mac.
function mediaRemotePaths() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'mediaremote');
  const dir = packaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', 'build', 'mac', 'mediaremote');
  return [path.join(dir, 'mediaremote-adapter.pl'), path.join(dir, 'MediaRemoteAdapter.framework')];
}

function startMediaWorker() {
  const [script, args] = MAC ? ['media-worker-mac.cjs', mediaRemotePaths()] : ['media-worker.cjs', []];
  mediaWorker = fork(path.join(__dirname, script), args, {
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

// Per-song timing nudges from the Music tab, kept across restarts. Positive
// seconds show the lyrics later.
let lyricsOffsets = null;
let rawLyricLines = [];
const offsetsFile = () => path.join(app.getPath('userData'), 'lyrics-offsets.json');
function lyricsOffset(key) {
  if (!lyricsOffsets) {
    try { lyricsOffsets = JSON.parse(fs.readFileSync(offsetsFile(), 'utf8')) || {}; } catch (_) { lyricsOffsets = {}; }
  }
  return Number(lyricsOffsets[key]) || 0;
}
function shiftLines(lines, offset) {
  if (!offset) return lines;
  return lines.map((line) => ({
    ...line,
    time: line.time + offset,
    ...(line.words ? { words: line.words.map((w) => ({ ...w, time: w.time + offset })) } : null)
  }));
}
function publishLyrics() {
  const offset = lyricsOffset(lyricsKey);
  lastLyrics = { key: lyricsKey, lines: shiftLines(rawLyricLines, offset), offset };
  send('lyrics', lastLyrics);
}

function updateLyrics() {
  const key = lastMedia ? `${lastMedia.title}|${lastMedia.artist}` : null;
  if (key === lyricsKey) return;
  lyricsKey = key;
  rawLyricLines = [];
  publishLyrics();
  if (!key || !features().lyrics) return;
  const { title, artist, album, duration } = lastMedia;
  const load = (retriesLeft) => fetchLyrics({ title, artist, album, duration })
    .then(({ lines, id, duration: lyricDuration, wordSync }) => {
      if (lyricsKey !== key) return;
      log(`lyrics: ${lines.length} lines for "${title}"${id ? ` (lrclib ${id}, ${lyricDuration}s vs ${Math.round(duration)}s${wordSync ? ', word-synced' : ''})` : ''}`);
      rawLyricLines = lines;
      publishLyrics();
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
    applyFileWheel();
  } else if (msg.type === 'file-click') {
    if (features().fileWheel && typeof msg.path === 'string') openWheel(msg.path, msg).catch((error) => log('wheel: ' + error.message));
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
    lastNet = { rx: msg.rx, tx: msg.tx, gpu: msg.gpu, cpuTemp: msg.cpuTemp, gpuTemp: msg.gpuTemp, memUsed: msg.memUsed };
  } else if (msg.type === 'file-drag') {
    fileDragActive = !!msg.active;
    if (!msg.active) fileDragEnded(msg);
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
      // LibreHardwareMonitor is Windows-only.
      if (!MAC && sensorTick++ % 2 === 0) sensors?.readCpuTemperature().then((t) => { lhmCpuTemp = t; });
      const now = cpuTimes();
      const total = now.total - previous.total;
      const cpu = total > 0 ? Math.round(100 * (1 - (now.idle - previous.idle) / total)) : 0;
      previous = now;
      // macOS counts reclaimable file cache as used in os.freemem(); its
      // helper reports memory the way Activity Monitor does.
      const used = MAC && lastNet.memUsed > 0 ? lastNet.memUsed : os.totalmem() - os.freemem();
      const ram = Math.round((100 * used) / os.totalmem());
      send('stats', {
        cpu,
        ram,
        ramUsedGb: used / 1073741824,
        ramTotalGb: os.totalmem() / 1073741824,
        rx: lastNet.rx,
        tx: lastNet.tx,
        cpuTemp: lhmCpuTemp ?? (lastNet.cpuTemp >= 0 ? lastNet.cpuTemp : null),
        gpu: nvidia ? nvidia.usage : lastNet.gpu >= 0 ? lastNet.gpu : null,
        gpuTemp: nvidia && Number.isFinite(nvidia.temp) ? nvidia.temp : lastNet.gpuTemp >= 0 ? lastNet.gpuTemp : null,
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
// it extends past the screen edge the island is docked to, so the corners on
// that side are never visible.
// Windows ignores window regions for acrylic (tested on Electron and plain
// Win32 windows), so its own corner rounding is the only clip available.
let glassOn = false;
let backdrop = null;
const BACKDROP_TINT = 0x99121214;           // 0xAABBGGRR
const OFFSCREEN = { x: -200, y: -200, width: 10, height: 10 };

// Windows won't make this window smaller than its minimum tracking size
// (about 50 DIP), so small pills get a backdrop that extends further past
// the screen edge the island is docked to, keeping its other sides aligned.
const BACKDROP_MIN_SIZE = 60;

function backdropBoundsFor(rect) {
  const nb = notchWindow.getBounds();
  const edge = (dock || dockFromConfig()).edge;
  // The island uses Windows' own 8 DIP corner radius in glass mode, so the
  // backdrop covers it edge to edge; larger radii (mid-animation) get inset.
  const r = Math.max(0, rect.radius);
  // At least 1 DIP: window positions are whole DIPs, so the backdrop can land
  // a pixel or two off the island's fractional edge.
  const inset = r > 8.5 ? Math.ceil((r - 8) * 0.3) + 1 : 1;
  const left = nb.x + rect.x, top = nb.y + rect.y;
  const right = left + rect.width, bottom = top + rect.height;
  const extend = (span) => Math.max(BACKDROP_MIN_SIZE, Math.round(span + 12 - inset));
  if (edge === 'bottom') {
    const height = extend(rect.height);
    return { x: Math.round(left + inset), y: Math.round(top + inset), width: Math.max(1, Math.round(rect.width - inset * 2)), height };
  }
  if (edge === 'left') {
    const width = extend(rect.width);
    return { x: Math.round(right - inset - width), y: Math.round(top + inset), width, height: Math.max(1, Math.round(rect.height - inset * 2)) };
  }
  if (edge === 'right') {
    const width = extend(rect.width);
    return { x: Math.round(left + inset), y: Math.round(top + inset), width, height: Math.max(1, Math.round(rect.height - inset * 2)) };
  }
  const height = extend(rect.height);
  return { x: Math.round(left + inset), y: Math.round(bottom - inset - height), width: Math.max(1, Math.round(rect.width - inset * 2)), height };
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
// started elsewhere and reaches the notch's edge, then start catching.

// macOS: the helper reports file drags from the system drag pasteboard.
let fileDragActive = false;
let dragNearActive = false;

// macOS: a drag that reached the notch ended. The window only starts
// accepting the mouse mid-drag, and macOS doesn't always deliver the drop to
// it, so the helper's file list is passed on too; the renderer parks the
// files if they were released over the island (duplicates are ignored).
function fileDragEnded(msg) {
  if (!dragNearActive || !notchWindow || notchWindow.isDestroyed() || !features().shelf) return;
  const paths = Array.isArray(msg.files) ? msg.files.filter((p) => typeof p === 'string' && p) : [];
  if (!paths.length || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
  const b = notchWindow.getBounds();
  log(`shelf: ${paths.length} file(s) released near the notch`);
  send('shelf-drop', { paths, x: msg.x - b.x, y: msg.y - b.y });
}

function startDragWatch() {
  let wasDown = false;
  let startedOutside = false;
  let active = false;
  setInterval(() => {
    if (!notchWindow || notchWindow.isDestroyed() || !features().shelf) return;
    // Windows: any drag with the left button; macOS: only file drags.
    const down = MAC ? fileDragActive : isLeftButtonDown();
    const cursor = screen.getCursorScreenPoint();
    if (dockDragging) return;
    const b = notchWindow.getBounds();
    const d = dock || dockFromConfig();
    const anchor = dockLayout(d).anchor;
    // A band along the docked edge, centred on the island.
    const inZone = d.edge === 'top' ? cursor.y >= b.y && cursor.y < b.y + 70 && Math.abs(cursor.x - (b.x + anchor)) < 260
      : d.edge === 'bottom' ? cursor.y <= b.y + b.height && cursor.y > b.y + b.height - 70 && Math.abs(cursor.x - (b.x + anchor)) < 260
      : d.edge === 'left' ? cursor.x >= b.x && cursor.x < b.x + 70 && Math.abs(cursor.y - (b.y + anchor)) < 260
      : cursor.x <= b.x + b.width && cursor.x > b.x + b.width - 70 && Math.abs(cursor.y - (b.y + anchor)) < 260;
    if (down && !wasDown) startedOutside = !inZone;
    if (down && startedOutside && inZone && !active) {
      active = dragNearActive = true;
      notchWindow.setIgnoreMouseEvents(false);
      if (MAC) notchWindow.moveTop();
      send('drag-near', true);
      log('shelf: file drag reached the notch');
    } else if (!down && active) {
      active = dragNearActive = false;
      send('drag-near', false);
    }
    wasDown = down;
  }, 100);
}

// ── IPC ───────────────────────────────────────────────────────────────────

// IPC only counts when it comes from TopNotch's own page in the window's top
// frame, not just from one of its windows: a window that somehow navigated
// elsewhere keeps the preload, so the page's URL is checked too.
const APP_PAGE = process.env.TOPNOTCH_DEV ? 'http://127.0.0.1:5173/' : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
const isAppUrl = (url) => {
  const bare = String(url || '').split('#')[0].split('?')[0];
  return process.env.TOPNOTCH_DEV ? bare === APP_PAGE || bare === APP_PAGE.slice(0, -1) : bare === APP_PAGE;
};
const fromAppPage = (event) => {
  const frame = event.senderFrame;
  return !!frame && frame === event.sender.mainFrame && isAppUrl(frame.url);
};
const fromNotch = (event) => fromAppPage(event) && BrowserWindow.fromWebContents(event.sender) === notchWindow;
const fromOurWindows = (event) => {
  if (!fromAppPage(event)) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && (win === notchWindow || win === settingsWindow || win === setupWindow);
};

// No window ever leaves TopNotch's page: dropping a link or file on a window
// would otherwise load it there (with the preload attached). No pop-ups or
// webviews either.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!isAppUrl(url) && !url.startsWith('file:')) event.preventDefault(); });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
const ALLOWED_MEDIA_KEYS = new Set(['play-pause', 'next', 'previous']);

ipcMain.on('set-passthrough', (event, passthrough) => {
  if (!fromNotch(event)) return;
  if (passthrough) notchWindow.setIgnoreMouseEvents(true, { forward: true });
  else notchWindow.setIgnoreMouseEvents(false);
});

ipcMain.on('media-control', (event, action) => {
  if (!fromNotch(event) || !ALLOWED_MEDIA_KEYS.has(action)) return;
  if (MAC) mediaWorker?.send({ type: 'control', action });
  else pressMediaKey(action);
});
ipcMain.on('media-seek', (event, seconds) => {
  if (!fromNotch(event) || !Number.isFinite(seconds) || !lastMedia) return;
  if (MAC) mediaWorker?.send({ type: 'seek', seconds });
  else systemService?.seek(seconds, lastMedia.appId);
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

ipcMain.on('dock-drag-start', (event) => { if (fromNotch(event)) startDockDrag(); });
ipcMain.handle('dock-get', (event) => {
  if (!fromOurWindows(event)) return null;
  const d = dock || dockFromConfig();
  return { edge: d.edge, anchor: dockLayout(d).anchor, dragging: dockDragging };
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
const QUICK_TOOLS = MAC ? {
  calculator: () => shell.openPath('/System/Applications/Calculator.app'),
  snip: () => shell.openPath('/System/Applications/Utilities/Screenshot.app'),
  taskmgr: () => shell.openPath('/System/Applications/Utilities/Activity Monitor.app'),
  bluetooth: () => shell.openExternal('x-apple.systempreferences:com.apple.BluetoothSettings'),
  sound: () => shell.openExternal('x-apple.systempreferences:com.apple.Sound-Settings.extension')
} : {
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
  log(`shelf: dragging ${files.length} file(s) out`);
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
  if (fromAppPage(event) && settingsWindow && BrowserWindow.fromWebContents(event.sender) === settingsWindow) settingsWindow.close();
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
ipcMain.on('lyrics-offset', (event, delta) => {
  if (!fromNotch(event) || !lyricsKey || !Number.isFinite(delta)) return;
  const current = lyricsOffset(lyricsKey);
  const next = delta === 0 ? 0 : Math.max(-15, Math.min(15, Math.round((current + delta) * 20) / 20));
  if (next) lyricsOffsets[lyricsKey] = next; else delete lyricsOffsets[lyricsKey];
  try { fs.writeFileSync(offsetsFile(), JSON.stringify(lyricsOffsets, null, 2)); } catch (_) {}
  publishLyrics();
});
ipcMain.on('lyrics-resync', (event) => {
  if (!fromNotch(event)) return;
  systemService?.resendTimeline();
  lyricsKey = null;
  updateLyrics();
});

// ── File wheel (Alt+click a file) and the image editor ──────────────────

const WHEEL_SIZE = 340;
let wheelWindow = null;
let wheelMenu = null;
let editorWindow = null;
let editorState = null;      // { file, mode }
let wheelWatch = null;
const convertedFiles = new Set(); // outputs "Show in folder" may reveal

function applyFileWheel() {
  systemService?.setFileClick(!!features().fileWheel, EXTENSIONS);
}

function createWheelWindow() {
  wheelWindow = new BrowserWindow({
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
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
  wheelWindow.setAlwaysOnTop(true, 'pop-up-menu');
  // The wheel opens with Alt still held, and releasing Alt takes focus from
  // it, so it doesn't close on blur: the watcher below closes it on Esc or
  // a click outside, focused or not.
  wheelWindow.removeMenu();
  wheelWindow.on('closed', () => { wheelWindow = null; });
  loadPage(wheelWindow, 'wheel');
  return new Promise((resolve) => wheelWindow.webContents.once('did-finish-load', resolve));
}

function hideWheel() {
  stopWheelWatch();
  if (wheelWindow && !wheelWindow.isDestroyed() && wheelWindow.isVisible()) wheelWindow.hide();
}

// Focus can't be relied on (Windows may refuse it), so watch the mouse and
// Esc directly: a press outside the wheel, or Esc, closes it.
const VK_ESCAPE = 0x1b;
const WATCHED_BUTTONS = [0x01, 0x02, 0x04]; // left, right, middle
function startWheelWatch() {
  stopWheelWatch();
  let held = WATCHED_BUTTONS.map(isKeyDown);
  wheelWatch = setInterval(() => {
    if (!wheelWindow || wheelWindow.isDestroyed() || !wheelWindow.isVisible()) return stopWheelWatch();
    if (isKeyDown(VK_ESCAPE)) return hideWheel();
    const now = WATCHED_BUTTONS.map(isKeyDown);
    const pressed = now.some((down, i) => down && !held[i]);
    held = now;
    if (!pressed) return undefined;
    const { x, y } = screen.getCursorScreenPoint();
    const b = wheelWindow.getBounds();
    const r = WHEEL_SIZE / 2;
    // The ring is round: corners of the square window count as outside.
    if (Math.hypot(x - (b.x + r), y - (b.y + r)) > r) hideWheel();
    return undefined;
  }, 25);
}
function stopWheelWatch() {
  clearInterval(wheelWatch);
  wheelWatch = null;
}

async function openWheel(file, physical) {
  const menu = converter.menuFor(file);
  if (!menu) return;
  wheelMenu = { ...menu, downloadSizes: converter.downloadSizes() };
  if (!wheelWindow || wheelWindow.isDestroyed()) await createWheelWindow();
  // The Windows helper reports physical pixels, the mac one points already;
  // centre the wheel on the click.
  const point = MAC ? { x: physical.x, y: physical.y } : screen.screenToDipPoint({ x: physical.x, y: physical.y });
  const area = screen.getDisplayNearestPoint(point).workArea;
  const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - WHEEL_SIZE, point.x - WHEEL_SIZE / 2)));
  const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - WHEEL_SIZE, point.y - WHEEL_SIZE / 2)));
  wheelWindow.setBounds({ x, y, width: WHEEL_SIZE, height: WHEEL_SIZE });
  wheelWindow.webContents.send('wheel-menu', wheelMenu);
  wheelWindow.show();
  try { forceForeground(wheelWindow); } catch (error) { log('wheel focus: ' + error.message); }
  wheelWindow.focus();
  startWheelWatch();
}

const fromWheel = (event) => fromAppPage(event) && wheelWindow && !wheelWindow.isDestroyed() && event.sender === wheelWindow.webContents;
const fromEditor = (event) => fromAppPage(event) && editorWindow && !editorWindow.isDestroyed() && event.sender === editorWindow.webContents;

function startConvert(file, target) {
  converter.convert(file, target).catch(() => {}); // progress and errors arrive as jobs
}

function onConvertJob(job) {
  if (job.output) convertedFiles.add(job.output);
  send('convert-job', job);
}

// Chromium prints HTML to PDF; relative images resolve next to the source.
// The document comes from the user's file, so it renders offline: its own
// session that only loads local files and inline data, no scripts, no
// navigation (see web-contents-created), and a time limit.
let pdfSession = null;
function getPdfSession() {
  if (!pdfSession) {
    const { session } = require('electron');
    pdfSession = session.fromPartition('topnotch-pdf');
    pdfSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(file|data|blob):/i.test(details.url) });
    });
    pdfSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  }
  return pdfSession;
}

async function renderPdf(html, sourceFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topnotch-pdf-'));
  const page = path.join(dir, 'page.html');
  const base = `<base href="${pathToFileURL(path.dirname(sourceFile) + path.sep).href}">`;
  fs.writeFileSync(page, /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html);
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, session: getPdfSession() } });
  const timeout = (ms) => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('PDF rendering timed out')), ms));
  try {
    await Promise.race([win.loadFile(page), timeout(30000)]);
    return await Promise.race([win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } }), timeout(60000)]);
  } finally {
    win.destroy();
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function openEditor(file, mode) {
  editorState = { file, mode };
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.webContents.send('editor-open', editorState);
    editorWindow.show();
    editorWindow.focus();
    return;
  }
  editorWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'TopNotch Editor',
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
  editorWindow.once('ready-to-show', () => editorWindow.show());
  editorWindow.on('closed', () => { editorWindow = null; editorState = null; });
  loadPage(editorWindow, 'editor');
}

ipcMain.handle('wheel-pick', async (event, id) => {
  if (!fromWheel(event) || !wheelMenu || typeof id !== 'string') return null;
  const action = wheelMenu.actions.find((a) => a.id === id);
  if (!action) return null;
  if (action.id === 'edit' || action.id === 'crop') {
    hideWheel();
    openEditor(wheelMenu.file, action.id);
    return { ok: true };
  }
  const engines = converter.engines();
  if (action.needs && !engines[action.needs]) return { needs: action.needs };
  hideWheel();
  if (action.id === 'removebg') converter.removeBackground(wheelMenu.file).catch(() => {}); // reported as a job
  else startConvert(wheelMenu.file, action.target);
  return { ok: true };
});
ipcMain.handle('engine-download', async (event, name) => {
  if (!fromWheel(event) || !['ffmpeg', 'office', 'bgmodel'].includes(name)) return { ok: false };
  try {
    await converter.downloadEngine(name, (progress) => wheelWindow?.webContents.send('engine-progress', progress));
    if (wheelMenu) wheelMenu = { ...wheelMenu, ...converter.menuFor(wheelMenu.file) };
    return { ok: true };
  } catch (error) {
    log(name + ' download: ' + error.message);
    return { ok: false, error: error.message };
  }
});
ipcMain.on('wheel-close', (event) => { if (fromWheel(event)) hideWheel(); });
ipcMain.on('open-libreoffice', (event) => {
  if (!fromWheel(event)) return;
  hideWheel();
  shell.openExternal(converter.libreOfficeUrl);
});
ipcMain.on('show-converted', (event, file) => {
  if (fromNotch(event) && convertedFiles.has(file) && fs.existsSync(file)) shell.showItemInFolder(file);
});

ipcMain.handle('editor-get', async (event) => {
  if (!fromEditor(event) || !editorState) return null;
  try {
    const { file, mode } = editorState;
    return { file, name: path.basename(file), mode, ext: extOf(file), targets: TARGETS.image, image: await converter.previewImage(file) };
  } catch (error) {
    return { error: error.message };
  }
});
ipcMain.handle('editor-save', async (event, png, target) => {
  if (!fromEditor(event) || !editorState || !(png instanceof Uint8Array) || typeof target !== 'string') return { ok: false };
  try {
    const out = await converter.saveEdited(editorState.file, Buffer.from(png), target);
    return { ok: true, output: out };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.on('editor-reveal', (event, file) => {
  if (fromEditor(event) && convertedFiles.has(file)) shell.showItemInFolder(file);
});
ipcMain.on('editor-close', (event) => { if (fromEditor(event)) editorWindow.close(); });
ipcMain.handle('engines-get', (event) => (fromOurWindows(event) ? converter.engineStatus() : null));
ipcMain.handle('engine-install', async (event, id) => {
  if (!fromOurWindows(event) || typeof id !== 'string') return { ok: false };
  try { await converter.installEngine(id); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('engines-install-missing', async (event) => (fromOurWindows(event) ? { ok: await installMissingEngines() } : { ok: false }));
ipcMain.on('setup-close', (event) => {
  if (fromAppPage(event) && setupWindow && BrowserWindow.fromWebContents(event.sender) === setupWindow) setupWindow.close();
});
ipcMain.on('open-setup', (event) => { if (fromOurWindows(event)) openSetup(); });
ipcMain.handle('ai-models-get', (event) => (fromOurWindows(event) ? converter.models.status() : null));
ipcMain.handle('ai-model-download', async (event, id) => {
  if (!fromOurWindows(event) || typeof id !== 'string') return { ok: false };
  try {
    await converter.models.download(id);
    return { ok: true };
  } catch (error) {
    log(`model ${id} download: ${error.message}`);
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('ai-model-delete', async (event, id) => {
  if (!fromOurWindows(event) || typeof id !== 'string') return { ok: false };
  await converter.models.remove(id);
  return { ok: true };
});
ipcMain.handle('editor-remove-bg', async (event) => {
  if (!fromEditor(event) || !editorState) return null;
  if (!converter.engines().bgmodel) return { needs: 'bgmodel', size: converter.downloadSizes().bgmodel };
  try {
    return { image: await converter.removeBackgroundImage(editorState.file) };
  } catch (error) {
    log('editor remove background: ' + error.message);
    return { error: error.message };
  }
});
ipcMain.handle('editor-download-model', async (event) => {
  if (!fromEditor(event)) return { ok: false };
  try {
    await converter.downloadEngine('bgmodel', (progress) => editorWindow?.webContents.send('editor-progress', progress));
    return { ok: true };
  } catch (error) {
    log('bgmodel download: ' + error.message);
    return { ok: false, error: error.message };
  }
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // A menu-bar app on macOS: no Dock icon (Info.plist also sets LSUIElement).
  if (MAC) app.dock?.hide();
  const dir = app.getPath('userData');
  config = createConfig(dir);
  clipboardHistory = createClipboardHistory({ dir, onChange: (items) => send('clipboard', items) });
  shelf = createShelf({ dir, onChange: (items) => send('shelf', items) });
  sensors = createSensors({ dir, log });
  converter = createConverter({
    dir, log, renderPdf, onJob: onConvertJob,
    getSettings: () => config.get(),
    onModelStatus: (status) => broadcast('ai-models', status),
    onEngineStatus: sendEngines
  });
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
    if (current.displayId !== previous.displayId || current.dockEdge !== previous.dockEdge || current.dockOffset !== previous.dockOffset) positionNotch();
    if (current.features.fileWheel !== previous.features.fileWheel) applyFileWheel();
    if (current.features.lyrics && !previous.features.lyrics) { lyricsKey = null; updateLyrics(); }
    if (current.weatherCity !== previous.weatherCity || current.temperatureUnit !== previous.temperatureUnit) weather.reset();
    previous = current;
    broadcast('config', current);
  });

  createNotchWindow();
  applyGlass(config.get().material === 'glass');
  createTray();
  if (config.get().enginesSetup !== 'done') {
    if (converter.engineStatus().every((e) => e.ready)) config.set({ enginesSetup: 'done' });
    else { openSetup(); installMissingEngines(); }
  }
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
