const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Writable, PassThrough } = require('stream');
const { EventEmitter } = require('events');
const { load } = require('./helpers.cjs');
const { saveResponse, downloadVerified } = require('../electron/download.cjs');
const { decodeImage } = require('../electron/image-decode.cjs');
const { createConverter } = require('../electron/convert.cjs');
const sharp = require('sharp');
const tick = () => new Promise((r) => setImmediate(r));
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const temporary = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topnotch-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const response = (data) => ({ ok: true, headers: { get: () => String(data.length) }, body: (async function* () { yield data; })() });
const converter = (dir, jobs = []) => createConverter({ dir, log() {}, onJob: (j) => jobs.push(j), getSettings: () => ({}) });

test('verified downloads preserve bytes and reject/clean checksum failures', async (t) => {
  const dest = path.join(temporary(t), 'download');
  const bytes = Buffer.from('verified bytes');
  await saveResponse(response(bytes), dest, hash(bytes));
  assert.deepEqual(fs.readFileSync(dest), bytes);
  await assert.rejects(saveResponse(response(bytes), dest, '0'.repeat(64)), /checksum/);
  assert.equal(fs.existsSync(dest), false);
});

test('disk-full stream errors reject promptly and clean partial files', async () => {
  let removed = false;
  const failingFs = { ...fs, createWriteStream: () => new Writable({ highWaterMark: 1, write(_c, _e, cb) { cb(Object.assign(new Error('disk full'), { code: 'ENOSPC' })); } }), promises: { rm: async () => { removed = true; } } };
  const { saveResponse: save } = load('electron/download.cjs', { fs: failingFs });
  await assert.rejects(save(response(Buffer.from('x')), 'unused', hash('x')), { code: 'ENOSPC' });
  assert.equal(removed, true);
});

test('network interruption removes partial download and mirror retry succeeds', async (t) => {
  const dest = path.join(temporary(t), 'download');
  const broken = { ok: true, headers: { get: () => null }, body: (async function* () { yield Buffer.from('partial'); throw new Error('connection reset'); })() };
  await assert.rejects(saveResponse(broken, dest, '0'.repeat(64)), /connection reset/);
  assert.equal(fs.existsSync(dest), false);
  const bytes = Buffer.from('retry'); let calls = 0;
  const { downloadVerified: download } = load('electron/download.cjs', {}, { AbortSignal, fetch: async () => { if (++calls === 1) throw new Error('offline'); return response(bytes); } });
  await download(['first', 'second'], hash(bytes), dest);
  assert.equal(calls, 2);
  assert.deepEqual(fs.readFileSync(dest), bytes);
});

function bmp(width = 2, height = 1) {
  const bytes = Buffer.alloc(62);
  bytes.write('BM'); bytes.writeUInt32LE(62, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28);
  bytes.set([0, 0, 255, 0, 255, 0], 54);
  return bytes;
}
test('worker decodes valid BMP pixels and rejects huge/truncated headers', async () => {
  const image = await decodeImage(bmp(), 'bmp');
  assert.deepEqual([image.width, image.height], [2, 1]);
  assert.deepEqual([...image.data], [255, 0, 0, 255, 0, 255, 0, 255]);
  await assert.rejects(decodeImage(bmp(20000, 20000).subarray(0, 54), 'bmp'), /dimensions/);
  await assert.rejects(decodeImage(bmp().subarray(0, 54), 'bmp'), /Truncated/);
  const invalid = bmp(); invalid.writeUInt16LE(0, 28);
  await assert.rejects(decodeImage(invalid, 'bmp'), /bit depth/);
});

test('ICO directory bounds are checked and valid DIB icons decode', async () => {
  const dib = bmp().subarray(14); dib.writeInt32LE(2, 8);
  const icon = Buffer.alloc(22 + dib.length);
  icon.writeUInt16LE(1, 2); icon.writeUInt16LE(1, 4); icon[6] = 2; icon[7] = 1;
  icon.writeUInt32LE(dib.length, 14); icon.writeUInt32LE(22, 18); dib.copy(icon, 22);
  assert.equal((await decodeImage(icon, 'ico')).width, 2);
  icon.writeUInt32LE(0xffffffff, 18);
  await assert.rejects(decodeImage(icon, 'ico'), /bounds/);
});

test('all nine image output formats preserve source and generate readable previews', async (t) => {
  const dir = temporary(t), jobs = [], c = converter(dir, jobs);
  const source = path.join(dir, 'photo.png');
  const original = await sharp({ create: { width: 8, height: 6, channels: 4, background: '#ff0000' } }).png().toBuffer();
  fs.writeFileSync(source, original);
  for (const ext of ['jpg', 'webp', 'tiff', 'avif', 'gif', 'bmp', 'ico', 'psd']) {
    const out = await c.convert(source, ext);
    assert.ok(fs.statSync(out).size > 0);
    const preview = await c.previewImage(out);
    assert.match(preview, /^data:image\/png;base64,/);
  }
  const saved = await c.saveEdited(source, original, 'png');
  assert.notEqual(saved, source);
  assert.deepEqual(fs.readFileSync(source), original);
  assert.equal(jobs.filter((j) => j.status === 'done').length, 9);
});

test('unwritable output reports terminal errors for conversion and background removal', async () => {
  const jobs = [];
  const c = load('electron/convert.cjs', { fs: { ...fs, existsSync: () => false, openSync: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); } } }).createConverter({ dir: 'unused', log() {}, onJob: (j) => jobs.push(j), getSettings: () => ({}) });
  await assert.rejects(c.convert('photo.png', 'jpg'), { code: 'EACCES' });
  await assert.rejects(c.removeBackground('photo.png'), { code: 'EACCES' });
  assert.deepEqual(jobs.map((j) => j.status), ['running', 'error', 'running', 'error']);
});

test('clipboard restores complete text across persistence; private copies remain excluded', async (t) => {
  const dir = temporary(t);
  let text = 'x'.repeat(6000), written = '', privateCopy = false;
  const clipboard = { has: () => privateCopy, readBuffer: () => Buffer.alloc(0), availableFormats: () => [], readText: () => text, writeText: (s) => { written = s; } };
  const storage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  const { createClipboardHistory } = load('electron/clipboard.cjs', { electron: { clipboard, safeStorage: storage } }, { setInterval: () => 1, clearInterval() {} });
  let history = createClipboardHistory({ dir, onChange() {} }); history.start(); history.stop(); await history.flush();
  history = createClipboardHistory({ dir, onChange() {} });
  history.copy(history.list()[0].id);
  assert.equal(written, text);
  privateCopy = true; text = 'secret'; history.start(); history.stop();
  assert.equal(history.list().length, 1);
  await history.flush();
});

test('helper subscriptions are replayed on restart, including disabled states', async () => {
  const children = [], scheduled = new Map(); let id = 0;
  function spawn() { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.commands = []; child.stdin = { writable: true, write: (s) => child.commands.push(s.trim()) }; child.kill = () => child.emit('exit', 0); children.push(child); return child; }
  const { createSystemService } = load('electron/system-service.cjs', { child_process: { spawn } }, { setTimeout: (fn) => { scheduled.set(++id, fn); return id; }, clearTimeout: (n) => scheduled.delete(n) });
  const service = createSystemService({ onLevels() {}, log() {} });
  service.setStats(true); service.setMeter(true); service.setFileClick(true, ['png']);
  service.restart(); [...scheduled.values()][0]();
  children[1].stdout.write('{"type":"ready"}\n'); await tick();
  assert.deepEqual(children[1].commands, ['stats on', 'meter on', 'fileclick on png']);
  service.setStats(false); service.setMeter(false); service.setFileClick(false);
  service.restart(); [...scheduled.values()][0]();
  children[2].stdout.write('{"type":"ready"}\n'); await tick();
  assert.deepEqual(children[2].commands, ['stats off', 'meter off', 'fileclick off']);
  service.stop(); assert.equal(scheduled.size, 0);
});

test('background inference and deletion serialize; idle release starts after completion', async () => {
  let created = 0, running = 0, released = 0, removed = 0;
  let unblock; const gate = new Promise((r) => { unblock = r; });
  const timers = new Map(); let timerId = 0;
  const pipeline = { clone() { return this; }, ensureAlpha() { return this; }, raw() { return this; }, removeAlpha() { return this; }, resize() { return this; }, extractChannel() { return this; }, png() { return this; }, async toBuffer(options) { return options ? { data: Buffer.from([255, 0, 0, 255]), info: { width: 1, height: 1 } } : Buffer.alloc(1024 * 1024 * 3, 128); } };
  const ort = { Tensor: class {}, InferenceSession: { create: async () => { created++; const priorReleases = released; return { inputNames: ['input'], outputNames: ['output'], async run() { running++; await gate; assert.equal(released, priorReleases); running--; return { output: { data: new Float32Array(1024 * 1024) } }; }, async release() { assert.equal(running, 0); released++; } }; } } };
  const { createBackgroundRemover } = load('electron/bgremove.cjs', { fs: { ...fs, existsSync: () => true, promises: { rm: async () => { removed++; } } }, sharp: () => pipeline, 'onnxruntime-node': ort, './image-tasks.cjs': { runImageTask: async (task, ...args) => require('../electron/image-operations.cjs')[task](...args) } }, { setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  const remover = createBackgroundRemover({ dir: 'unused', log() {} });
  const one = remover.removeBackground(pipeline, null); const two = remover.removeBackground(pipeline, null);
  await tick(); assert.equal(created, 1); assert.equal(running, 1); assert.equal(timers.size, 0);
  const deletion = remover.remove('isnet'); await tick(); assert.equal(removed, 0);
  unblock(); await Promise.all([one, two, deletion]); await tick();
  assert.equal(created, 1); assert.equal(released, 1); assert.equal(removed, 2);
  await remover.removeBackground(pipeline, null); await tick();
  assert.equal(timers.size, 1); const idle = [...timers.values()][0]; idle(); await tick();
  assert.equal(released, 2);
});

test('sensor installer checks protected staged bytes before extraction', () => {
  // Capture the actual generated elevated script through the process boundary.
  let elevatedScript;
  const fakeExec = (_exe, args, _opts, cb) => {
    const encoded = /-EncodedCommand','([^']+)'/.exec(args.at(-1));
    if (encoded) elevatedScript = Buffer.from(encoded[1], 'base64').toString('utf16le');
    cb(null, '0', '');
  };
  const fakeCrypto = { createHash: () => ({ update() { return this; }, digest: () => '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001' }) };
  const sensors = load('electron/sensors.cjs', { fs: { ...fs, readFileSync: () => Buffer.alloc(0) }, crypto: fakeCrypto, child_process: { execFile: fakeExec } }).createSensors({ dir: 'unused', log() {} });
  return sensors.setAtSignIn(true).then(() => {
    assert.ok(elevatedScript.includes('$acl.SetAccessRuleProtection($true, $false)'));
    assert.ok(elevatedScript.indexOf('Copy-Item -LiteralPath $zip') < elevatedScript.indexOf('Get-FileHash'));
    assert.match(elevatedScript, /Get-FileHash -Algorithm SHA256 -LiteralPath \$verifiedZip/);
    assert.match(elevatedScript, /Expand-Archive -LiteralPath \$verifiedZip/);
    assert.ok(!/Expand-Archive -LiteralPath \$zip\b/.test(elevatedScript));
    if (process.platform === 'win32') {
      const { spawnSync } = require('child_process');
      const parse = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$source = [Console]::In.ReadToEnd(); $tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }"], { input: elevatedScript, encoding: 'utf8', windowsHide: true });
      assert.equal(parse.status, 0, parse.stderr);
    }
  });
});


test('clipboard change tokens skip encoding unchanged images and retry changed contents', async (t) => {
  const dir = temporary(t);
  let token = 1, reads = 0, encode = 0, poll;
  let privateCopy = false;
  const image = { isEmpty: () => false, getSize: () => ({ width: 20, height: 20 }),
    toPNG: () => { encode++; return Buffer.from('image-' + token); },
    resize() { return this; }, toDataURL: () => 'data:image/png;base64,AA==' };
  const clipboard = { has: () => privateCopy, readBuffer: () => Buffer.alloc(0), availableFormats: () => ['image/png'],
    readImage: () => { reads++; return image; } };
  const { createClipboardHistory } = load('electron/clipboard.cjs', { electron: { clipboard, safeStorage: { isEncryptionAvailable: () => false } } },
    { setInterval: (fn) => { poll = fn; return 1; }, clearInterval() {} });
  const history = createClipboardHistory({ dir, onChange() {}, getChangeToken: () => token });
  history.start();
  for (let i = 0; i < 10; i++) poll();
  assert.equal(reads, 1); assert.equal(encode, 1);
  token++; poll(); assert.equal(reads, 2);
  privateCopy = true; token++; poll(); assert.equal(reads, 2);
  privateCopy = false; token++; poll(); assert.equal(reads, 3);
  history.stop(); await history.flush();
});

test('atomic persistence coalesces snapshots and flushes the latest value', async (t) => {
  const file = path.join(temporary(t), 'state.json');
  const { createWriter } = require('../electron/persistence.cjs');
  const writer = createWriter(file);
  for (let i = 0; i < 100; i++) writer.write(JSON.stringify({ i }));
  await writer.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { i: 99 });
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('worker pixel math matches expected tensor, mask and alpha values', async () => {
  const { runImageTask } = require('../electron/image-tasks.cjs');
  const tensor = await runImageTask('tensor', Uint8Array.from([255, 0, 128]), [0.5, 0.5, 0.5], [1, 1, 1], 1);
  assert.equal(tensor[0], 0.5); assert.equal(tensor[1], -0.5);
  assert.ok(Math.abs(tensor[2] - (128 / 255 - 0.5)) < 1e-6);
  assert.deepEqual([...await runImageTask('mask', Float32Array.from([0, 0.5, 1]), false)], [0, 128, 255]);
  assert.deepEqual([...await runImageTask('alpha', Uint8Array.from([10, 20, 30, 128]), Uint8Array.from([128]))], [10, 20, 30, 64]);
  await assert.rejects(runImageTask('unknown'), /not a function/);
  assert.deepEqual([...await runImageTask('mask', Float32Array.from([1, 1]), false)], [0, 0]);
});

test('shelf mutations serialize and clear evicts cached icons', async (t) => {
  const dir = temporary(t), source = path.join(dir, 'source.txt');
  fs.writeFileSync(source, 'fixture');
  const { createShelf } = load('electron/shelf.cjs', { electron: { app: { getFileIcon: async () => ({ toDataURL: () => 'icon' }) } } });
  const shelf = createShelf({ dir, onChange() {} });
  const add = shelf.add([source, source]);
  const clear = shelf.clear();
  await Promise.all([add, clear]); await shelf.flush();
  assert.equal((await shelf.list()).length, 0);
  assert.equal(shelf.icon(source), undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'shelf.json'))), []);
});


test('battery subscribers detach listeners and ignore promises resolved after cleanup', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/hooks.js'), 'utf8');
  const body = source.slice(source.indexOf('const batterySubscribers'), source.indexOf('export function useBatteryEvents'));
  let resolve, attached = 0;
  const battery = { addEventListener() { attached++; }, removeEventListener() { attached--; } };
  const navigator = { getBattery: () => new Promise((r) => { resolve = r; }) };
  const subscribe = new Function('navigator', body + '\nreturn subscribeBattery;')(navigator);
  const first = subscribe(() => {});
  first(); resolve(battery); await tick(); assert.equal(attached, 0);
  const second = subscribe(() => {}), third = subscribe(() => {});
  resolve(battery); await tick(); assert.equal(attached, 2);
  second(); assert.equal(attached, 2);
  third(); assert.equal(attached, 0);
});


test('native CI audio exception is opt-in and restricted to missing endpoint/mixer HRESULT', () => {
  const { isMissingAudio } = require('./native-capabilities.cjs');
  const endpoint = 'audio endpoint: Element not found. (Exception from HRESULT: 0x80070490)';
  assert.equal(isMissingAudio(endpoint, false), false);
  assert.equal(isMissingAudio(endpoint, true), true);
  assert.equal(isMissingAudio('[system-helper] mixer: Element not found. (Exception from HRESULT: 0x80070490)', true), true);
  for (const error of ['audio endpoint: Access denied 0x80070005', 'net: Element not found 0x80070490', 'audio endpoint: Element not found', 'compiler failed']) {
    assert.equal(isMissingAudio(error, true), false);
  }
});

test('native smoke permits known hardware absence only in opt-in mode and preserves failures', () => {
  const { isMissingAudio } = require('./native-capabilities.cjs');
  function run({ allow = true, error = 'audio endpoint: Element not found 0x80070490', ready = true, code = 0, timeout = false } = {}) {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { write() {}, end() {} }; child.kill = () => {};
    const timers = new Map(), messages = [], state = { exitCode: 0 };
    load('tests/native-smoke.cjs', { child_process: { spawn: () => child }, './native-capabilities.cjs': { isMissingAudio: (m) => isMissingAudio(m, allow) } }, {
      process: state, console: { log: (m) => messages.push(JSON.parse(m)), error() {} },
      setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: (id) => timers.delete(id)
    });
    if (error) child.stdout.emit('data', JSON.stringify({ type: 'error', message: error }) + '\n');
    if (ready) child.stdout.emit('data', '{"type":"ready"}\n');
    if (timeout) timers.get(25000)();
    child.emit('exit', code);
    return { code: state.exitCode, report: messages.at(-1) };
  }
  assert.equal(run().report.nativeSmoke, 'passed-without-audio');
  assert.equal(run().code, 0);
  assert.equal(run({ error: null }).report.nativeSmoke, 'passed');
  for (const options of [{ allow: false }, { error: 'net: broken' }, { ready: false }, { code: 1 }, { code: null }, { timeout: true }]) {
    assert.equal(run(options).code, 1);
    assert.equal(run(options).report.nativeSmoke, 'failed');
  }
});

test('restart smoke requires second-generation stats and either peaks or fresh missing-endpoint evidence', () => {
  const { isMissingAudio } = require('./native-capabilities.cjs');
  function run({ allow = true, missing = true, peak = false, net = true, unexpected = false, firstOnly = false } = {}) {
    let callbacks, timeout, stopped = false;
    const reports = [], state = { exitCode: 0 };
    const service = { setStats() {}, setMeter() {}, restart() {}, stop() { stopped = true; } };
    load('tests/native-restart-smoke.cjs', {
      '../electron/system-service.cjs': { createSystemService: (options) => { callbacks = options; return service; } },
      './native-capabilities.cjs': { isMissingAudio: (m) => isMissingAudio(m, allow) }
    }, { process: state, console: { log: (m) => reports.push(JSON.parse(m)) }, setTimeout: (fn) => { timeout = fn; return 1; }, clearTimeout() {} });
    const unavailable = '[system-helper] audio endpoint: Element not found 0x80070490';
    if (firstOnly) callbacks.log(unavailable);
    callbacks.onEvent({ type: 'ready' }); callbacks.onEvent({ type: 'net' });
    callbacks.log('[system-helper] exited with null, restarting in 1000ms');
    if (unexpected) callbacks.log('[system-helper] exited with 1, restarting in 1000ms');
    if (missing) callbacks.log(unavailable);
    callbacks.onEvent({ type: 'ready' });
    if (net) callbacks.onEvent({ type: 'net' });
    if (peak) callbacks.onEvent({ type: 'peak' });
    if (!stopped) timeout();
    return { code: state.exitCode, report: reports.at(-1) };
  }
  assert.equal(run().report.restartSmoke, 'passed-without-audio');
  assert.equal(run().code, 0);
  assert.equal(run({ missing: false, peak: true }).report.restartSmoke, 'passed');
  for (const options of [{ allow: false }, { missing: false }, { net: false }, { unexpected: true }, { missing: false, firstOnly: true }]) {
    assert.equal(run(options).code, 1);
  }
});
