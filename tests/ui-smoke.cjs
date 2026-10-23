// Run with Electron after `npm run build`. Isolated fixtures only: no login
// settings, real clipboard, downloads, sensors installation or volume changes.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topnotch-ui-smoke-'));
app.setPath('userData', dir);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const results = [];
const measurements = [];
const benchmark = process.env.TOPNOTCH_BENCHMARK === '1';
let win;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check, label) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(50); }
  throw new Error('Timed out: ' + label + '\n' + await js('document.body.innerText'));
}
const js = (code) => win.webContents.executeJavaScript(code, true);
async function click(text, selector = 'button') {
  const found = await js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)} || e.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
  assert.ok(found, 'Control exists: ' + text);
  await pause(100);
}
app.whenReady().then(async () => {
  const { createConfig } = require('../electron/config.cjs');
  const { createConverter } = require('../electron/convert.cjs');
  const config = createConfig(dir);
  const converter = createConverter({ dir, log() {}, getSettings: config.get, onJob() {} });
  const source = path.join(dir, 'source.png');
  await sharp({ create: { width: 120, height: 80, channels: 4, background: '#e05260' } }).png().toFile(source);
  const original = fs.readFileSync(source);
  const saved = [];
  const calls = [];
  const handlers = {
    'config-get': () => config.get(), 'dock-get': () => ({ edge: 'top', anchor: 450, dragging: false }),
    'weather-get': () => null, 'displays-get': () => [{ id: 1, label: 'Test display' }],
    'app-info': () => ({ name: 'TopNotch', version: 'smoke', electron: process.versions.electron }),
    'engines-get': () => converter.engineStatus(), 'ai-models-get': () => converter.models.status(),
    'sensors-status': () => ({ installed: false, running: false, atSignIn: false, version: 'test', size: 'test' }),
    'update-mode': () => ({ selfInstall: false }),
    'editor-get': async () => ({ file: source, name: 'source.png', mode: 'edit', ext: 'png', targets: ['png', 'jpg'], image: await converter.previewImage(source, true) }),
    'editor-save': async (_e, bytes, target) => { const output = await converter.saveEdited(source, Buffer.from(bytes), target); saved.push(await sharp(output).metadata()); return { ok: true, output }; },
    'wheel-pick': (_e, id) => { calls.push(id); return { ok: true }; }
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  for (const channel of ['media-control', 'media-seek', 'notify', 'set-volume', 'toggle-mute', 'set-brightness', 'quick-tool', 'clipboard-copy', 'shelf-drag', 'meter']) ipcMain.on(channel, (_e, ...args) => calls.push({ channel, args }));
  ipcMain.on('config-set', (_e, patch) => { config.set(patch); win.webContents.send('config', config.get()); });
  const consoleErrors = [];
  async function open(hash) {
    if (win) win.destroy();
    win = new BrowserWindow({ width: 1080, height: 780, show: false, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    win.webContents.on('console-message', (...args) => { const detail = args[0]; const level = detail.level ?? args[1]; const message = detail.message ?? args[2]; if (level === 'error' || level === 3) consoleErrors.push(message); });
    win.webContents.on('render-process-gone', (_e, detail) => { throw new Error('Renderer exited: ' + detail.reason); });
    const openedAt = performance.now();
    await win.loadFile(path.join(root, 'dist/index.html'), { hash });
    if (hash === 'wheel') {
      await pause(200);
      win.webContents.send('wheel-menu', { ...converter.menuFor(source), downloadSizes: converter.downloadSizes() });
    }
    await waitFor(() => js('document.getElementById("root").children.length > 0'), hash || 'notch');
    if (benchmark) {
      const readyMs = performance.now() - openedAt;
      const memory = await win.webContents.executeJavaScript('performance.memory.usedJSHeapSize');
      measurements.push({ page: hash || 'notch', readyMs: Math.round(readyMs), jsHeapBytes: memory });
    }
    await pause(200);
  }
  await open('');
  win.webContents.send('media-state', { appId: 'test', title: 'Smoke track', artist: 'Fixture', playing: true, duration: 180, position: 20, positionAt: Date.now() });
  win.webContents.send('system-levels', { levels: { volume: 50, muted: false, brightness: 50, brightnessSupported: true }, changed: null });
  win.webContents.send('stats', { cpu: 20, ram: 30, ramUsedGb: 3, ramTotalGb: 10, rx: 1024, tx: 512 });
  win.webContents.send('clipboard', [{ id: 'test', type: 'text', text: 'Clipboard fixture', pinned: false }]);
  win.webContents.send('shelf', [{ path: source, name: 'source.png', icon: null }]);
  win.webContents.send('open-panel', 'dashboard');
  await waitFor(() => js('!!document.querySelector(".dashboard")'), 'dashboard');
  for (const name of ['Music', ...(process.platform === 'darwin' ? [] : ['Volume mixer']), 'Bluetooth', 'Clipboard', 'Focus timer', 'System stats', 'File shelf', 'Dashboard']) { await click(name); }
  await click('Music'); await click('Pause');
  assert.ok(calls.some((c) => c.channel === 'media-control'));
  results.push('Notch: all platform tabs render; media controls reach preload IPC');
  win.webContents.send('lyrics', { key: 'Smoke track|Fixture', lines: [{ time: 0, text: 'A test lyric line' }] });
  await waitFor(() => js('!!document.querySelector(".lyrics-list")'), 'lyrics');
  await waitFor(() => calls.filter((c) => c.channel === 'meter').at(-1)?.args[0] === true, 'playing meter starts');
  win.webContents.send('media-state', { title: 'Smoke track', artist: 'Fixture', playing: false, duration: 180, position: 20, positionAt: Date.now() });
  await waitFor(() => calls.filter((c) => c.channel === 'meter').at(-1)?.args[0] === false, 'paused meter stops');
  win.webContents.send('media-state', { title: 'Smoke track', artist: 'Fixture', playing: true, duration: 180, position: 20, positionAt: Date.now() });
  await waitFor(() => calls.filter((c) => c.channel === 'meter').at(-1)?.args[0] === true, 'resumed meter');
  await click('Unpin');
  win.webContents.send('window-blur');
  win.webContents.send('covered', true);
  await waitFor(() => calls.filter((c) => c.channel === 'meter').at(-1)?.args[0] === false, 'covered meter stops');
  win.webContents.send('covered', false);
  await waitFor(() => calls.filter((c) => c.channel === 'meter').at(-1)?.args[0] === true, 'uncovered meter resumes');
  results.push('Playing lyrics acquire the meter; paused/covered lyrics release it and uncover resumes it');
  await open('settings');
  for (const name of ['Appearance', 'Widgets', 'Tips', 'About', 'General']) await click(name);
  results.push('Settings: all 5 sections render');
  await open('setup'); assert.ok(await js('!!document.querySelector(".setup")'));
  results.push('Setup: engine status renders');
  await open('wheel'); win.webContents.send('wheel-menu', { ...converter.menuFor(source), downloadSizes: converter.downloadSizes() });
  await waitFor(() => js('document.querySelectorAll(".wheel-seg").length > 0'), 'wheel');
  await js('document.querySelector(".wheel-seg").dispatchEvent(new MouseEvent("click", {bubbles: true}))'); await pause(100);
  assert.ok(calls.includes('edit')); results.push('File wheel: actions render and selection reaches IPC');
  await open('editor');
  await waitFor(() => js('document.querySelector("canvas")?.width > 0'), 'editor image');
  await click('1:1'); await click('Save copy');
  await waitFor(() => saved.length === 1, 'cropped save');
  assert.deepEqual([saved[0].width, saved[0].height], [80, 80]);
  await click('On', '.ed-toggle'); await click('Save copy');
  await waitFor(() => saved.length === 2, 'uncropped save');
  assert.deepEqual([saved[1].width, saved[1].height], [120, 80]);
  assert.deepEqual(fs.readFileSync(source), original);
  results.push('Editor: crop-on exports 80×80; crop-off exports 120×80; source unchanged');
  // Also exercise worker_threads from Electron, as packaged conversions do.
  const bmp = await converter.convert(source, 'bmp'); await converter.previewImage(bmp);
  results.push('Electron main process: BMP worker conversion and preview succeed');
  const packaged = path.join(dir, 'package');
  fs.mkdirSync(path.join(packaged, 'electron'), { recursive: true });
  for (const name of fs.readdirSync(path.join(root, 'electron')).filter((name) => name.endsWith('.cjs'))) fs.copyFileSync(path.join(root, 'electron', name), path.join(packaged, 'electron', name));
  const { createPackageWithOptions } = await import('@electron/asar');
  const archive = path.join(dir, 'app.asar');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await createPackageWithOptions(packaged, archive, { unpack: '**/{image-decode,image-codecs,image-tasks}.cjs' });
  const packedDecoder = require(path.join(archive, 'electron/image-decode.cjs'));
  const decoded = await packedDecoder.decodeImage(fs.readFileSync(bmp), 'bmp');
  assert.deepEqual([decoded.width, decoded.height], [120, 80]);
  const packedConverter = require(path.join(archive, 'electron/convert.cjs')).createConverter({ dir, log() {}, onJob() {}, getSettings: () => ({}) });
  const packedPreview = await packedConverter.previewImage(bmp, true);
  assert.equal((await sharp(packedPreview).metadata()).width, 120);
  await packedConverter.convert(source, 'psd');
  results.push('Packaged ASAR: decoder and image processing workers load, preview BMP, and encode PSD');
  await sharp({ create: { width: 4096, height: 2048, channels: 4, background: '#e05260' } }).png().toFile(source);
  await open('editor');
  await waitFor(() => js('document.querySelector(".ed-dim")?.textContent.includes("4096")'), 'large image');
  await click('Save copy'); await waitFor(() => saved.length === 3, 'full resolution save');
  assert.deepEqual([saved[2].width, saved[2].height], [4096, 2048]);
  await click('1:1'); await click('Save copy'); await waitFor(() => saved.length === 4, 'full resolution crop');
  assert.deepEqual([saved[3].width, saved[3].height], [2048, 2048]);
  results.push('Large editor preview preserves 4096x2048 export and 2048x2048 crop');
  assert.deepEqual(consoleErrors, []);
  results.push('No renderer console errors');
  console.log(JSON.stringify({ smoke: 'passed', results, ...(benchmark ? { measurements, processes: app.getAppMetrics().map(({type, cpu, memory}) => ({type, cpu, memory})) } : {}) }));
  win.destroy(); app.exit(0);
}).catch((error) => { console.error(error.stack); if (win) win.destroy(); app.exit(1); });
app.on('quit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
