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

test('clipboard restores complete text across persistence; private copies remain excluded', () => {
  let text = 'x'.repeat(6000), written = '', disk = null, privateCopy = false;
  const clipboard = { has: () => privateCopy, readBuffer: () => Buffer.alloc(0), availableFormats: () => [], readText: () => text, writeText: (s) => { written = s; } };
  const fakeFs = { readFileSync: () => { if (!disk) throw new Error('empty'); return disk; }, writeFileSync: (_p, s) => { disk = s; } };
  const storage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  const { createClipboardHistory } = load('electron/clipboard.cjs', { fs: fakeFs, electron: { clipboard, safeStorage: storage } }, { setInterval: () => 1, clearInterval() {} });
  let history = createClipboardHistory({ dir: 'unused', onChange() {} }); history.start(); history.stop();
  history = createClipboardHistory({ dir: 'unused', onChange() {} });
  history.copy(history.list()[0].id);
  assert.equal(written, text);
  privateCopy = true; text = 'secret'; history.start(); history.stop();
  assert.equal(history.list().length, 1);
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
  const { createBackgroundRemover } = load('electron/bgremove.cjs', { fs: { ...fs, existsSync: () => true, promises: { rm: async () => { removed++; } } }, sharp: () => pipeline, 'onnxruntime-node': ort }, { setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id) });
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
