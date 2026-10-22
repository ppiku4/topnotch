// File conversion behind the Alt+click wheel. Images use sharp (plus
// ag-psd and small BMP/ICO codecs), documents use marked/turndown/mammoth/
// unpdf and Chromium's PDF printer, and anything else falls back to the
// user's LibreOffice. Audio and video go through ffmpeg: the one on PATH, or
// a pinned build TopNotch downloads on request. Output always lands next to
// the original under a free name.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createBackgroundRemover } = require('./bgremove.cjs');
const { downloadVerified, createLibreOffice } = require('./engines.cjs');

const EXT_ALIASES = { jpeg: 'jpg', jpe: 'jpg', tif: 'tiff', htm: 'html', markdown: 'md', aif: 'aiff', text: 'txt' };
const KINDS = {
  image: ['png', 'jpg', 'webp', 'tiff', 'avif', 'gif', 'bmp', 'ico', 'psd', 'svg'],
  document: ['txt', 'md', 'html', 'docx', 'doc', 'odt', 'rtf', 'pdf', 'docm', 'dotx', 'dotm', 'dot', 'ott', 'wpd', 'wps', 'fodt'],
  spreadsheet: ['xlsx', 'xls', 'ods', 'csv', 'xlsm', 'xlsb', 'xltx', 'xlt', 'ots', 'fods', 'tsv'],
  presentation: ['pptx', 'ppt', 'odp', 'pptm', 'ppsx', 'pps', 'potx', 'pot', 'otp', 'fodp', 'key'],
  drawing: ['vsdx', 'vsd', 'odg', 'otg', 'pub'],
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'mts', 'm2ts'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff']
};
const TARGETS = {
  image: ['png', 'jpg', 'webp', 'tiff', 'avif', 'gif', 'bmp', 'ico', 'psd'],
  document: ['pdf', 'docx', 'txt', 'md', 'html', 'odt', 'rtf', 'doc'],
  spreadsheet: ['xlsx', 'pdf', 'csv', 'ods', 'xls', 'html'],
  presentation: ['pptx', 'pdf', 'odp', 'ppt'],
  drawing: ['pdf', 'png', 'svg', 'odg'],
  video: ['mp4', 'mkv', 'webm', 'mov', 'gif', 'mp3', 'wav', 'm4a'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'opus']
};

const MAC = process.platform === 'darwin';
// Windows: gyan.dev's essentials zip. macOS (Apple Silicon): the static
// build ffmpeg-static publishes, a gzipped single binary.
const FFMPEG = MAC ? {
  version: '6.1.1',
  url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz',
  sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
  size: '19 MB',
  exe: 'ffmpeg'
} : {
  version: '7.1.1',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip',
  sha256: '04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4',
  size: '88 MB',
  exe: 'ffmpeg.exe'
};
const FFMPEG_VERSION = FFMPEG.version;
const FFMPEG_SIZE = FFMPEG.size;
const LIBREOFFICE_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

const extOf = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return EXT_ALIASES[ext] || ext;
};

function kindOf(file) {
  const ext = extOf(file);
  return Object.keys(KINDS).find((kind) => KINDS[kind].includes(ext)) || null;
}

// "photo.png" → "photo (1).png" … until the name is free. The name is
// claimed by creating an empty file exclusively ('wx'), so two conversions
// running at once can never pick the same name and overwrite each other;
// the converter then writes over that placeholder.
function freePath(dir, base, ext) {
  for (let n = 0; ; n++) {
    const candidate = path.join(dir, n ? `${base} (${n}).${ext}` : `${base}.${ext}`);
    try {
      fs.closeSync(fs.openSync(candidate, 'wx'));
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

// A failed job leaves no empty placeholder behind.
function dropPlaceholder(file) {
  try { if (fs.statSync(file).size === 0) fs.rmSync(file, { force: true }); } catch (_) {}
}

function outputFor(file, ext) {
  return freePath(path.dirname(file), path.basename(file, path.extname(file)), ext);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'topnotch-convert-'));
}

// ── Images ────────────────────────────────────────────────────────────────

const { decodeImage } = require('./image-decode.cjs');

function encodeBmp({ width, height, data }) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + stride * height;
  const out = Buffer.alloc(size);
  out.write('BM', 0);
  out.writeUInt32LE(size, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[row + x * 3] = data[i + 2];
      out[row + x * 3 + 1] = data[i + 1];
      out[row + x * 3 + 2] = data[i];
    }
  }
  return out;
}

async function encodeIco(sharp, input) {
  const sizes = [16, 32, 48, 256];
  const pngs = await Promise.all(sizes.map((s) => input.clone()
    .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    header[e] = s === 256 ? 0 : s;
    header[e + 1] = s === 256 ? 0 : s;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

// Any supported image file → a sharp pipeline.
async function loadImage(file) {
  const sharp = require('sharp');
  const ext = extOf(file);
  if (['bmp', 'ico'].includes(ext) && (await fs.promises.stat(file)).size > 256 * 1024 * 1024) throw new Error('Image file exceeds the 256 MB limit');
  const buf = await fs.promises.readFile(file);
  const raw = (img) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } });
  if (ext === 'psd') {
    const { readPsd, initializeCanvas } = require('ag-psd');
    // Only raw pixel buffers are needed; no real canvas in the main process.
    initializeCanvas(() => { throw new Error('PSD layer previews are not supported'); },
      (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
    const psd = readPsd(buf, { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
    if (!psd.imageData) throw new Error('This PSD has no flattened image (save it with "Maximize compatibility")');
    return raw({ width: psd.width, height: psd.height, data: Buffer.from(psd.imageData.data.buffer) });
  }
  if (ext === 'bmp') return raw(await decodeImage(buf, 'bmp'));
  if (ext === 'ico') {
    const icon = await decodeImage(buf, 'ico');
    return icon.png ? sharp(icon.png) : raw(icon);
  }
  return sharp(buf, { animated: ext === 'gif' || ext === 'webp', density: ext === 'svg' ? 192 : undefined });
}

// Encodes a sharp pipeline as `ext` into `out`.
async function saveImage(input, ext, out) {
  const sharp = require('sharp');
  if (ext === 'png') return input.png().toFile(out);
  if (ext === 'jpg') return input.flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toFile(out);
  if (ext === 'webp') return input.webp({ quality: 90 }).toFile(out);
  if (ext === 'tiff') return input.tiff({ compression: 'lzw' }).toFile(out);
  if (ext === 'avif') return input.avif({ quality: 60 }).toFile(out);
  if (ext === 'gif') return input.gif().toFile(out);
  if (ext === 'ico') return fs.promises.writeFile(out, await encodeIco(sharp, input));
  const { data, info } = await input.flatten(ext === 'bmp' ? { background: '#ffffff' } : false).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = { width: info.width, height: info.height, data };
  if (ext === 'bmp') return fs.promises.writeFile(out, encodeBmp(image));
  if (ext === 'psd') {
    const { writePsdBuffer } = require('ag-psd');
    const imageData = { width: image.width, height: image.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
    const psd = { width: image.width, height: image.height, imageData, children: [{ name: 'Background', imageData }] };
    return fs.promises.writeFile(out, writePsdBuffer(psd));
  }
  throw new Error(`Can't write .${ext}`);
}

// Flattened PNG for the editor (Chromium can't show PSD, TIFF, ICO…).
async function previewImage(file) {
  const input = await loadImage(file);
  const png = await input.rotate().png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Documents ─────────────────────────────────────────────────────────────

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function htmlPage(body, title) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.55 "Segoe UI",system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;color:#111}
pre,code{font-family:Consolas,monospace;background:#f3f3f3;border-radius:4px}pre{padding:.8em;overflow:auto;white-space:pre-wrap}
code{padding:.1em .3em}pre code{padding:0}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.3em .6em}
img{max-width:100%}blockquote{margin-left:0;padding-left:1em;border-left:3px solid #ccc;color:#444}</style></head><body>${body}</body></html>`;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

function htmlToMarkdown(html) {
  const TurndownService = require('turndown');
  return new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
    .remove(['script', 'style', 'head', 'title'])
    .turndown(html) + '\n';
}

async function pdfText(file) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await fs.promises.readFile(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((page) => page.trim());
}

// Reads txt/md/html/docx/pdf as HTML (null if this needs LibreOffice).
async function documentHtml(file) {
  const ext = extOf(file);
  const title = path.basename(file, path.extname(file));
  if (ext === 'html') return fs.promises.readFile(file, 'utf8');
  if (ext === 'txt') return htmlPage(`<pre style="background:none;padding:0">${escapeHtml(await fs.promises.readFile(file, 'utf8'))}</pre>`, title);
  if (ext === 'md') {
    const { marked } = await import('marked');
    return htmlPage(marked.parse(await fs.promises.readFile(file, 'utf8')), title);
  }
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.convertToHtml({ path: file });
    return htmlPage(value, title);
  }
  if (ext === 'pdf') {
    const pages = await pdfText(file);
    const body = pages.map((p) => p.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`).join('')).join('<hr>');
    return htmlPage(body, title);
  }
  return null;
}

const BUILTIN_DOC = {
  txt: ['md', 'html', 'pdf'],
  md: ['txt', 'html', 'pdf'],
  html: ['txt', 'md', 'pdf'],
  docx: ['txt', 'md', 'html', 'pdf'],
  pdf: ['txt', 'md', 'html']
};

// LibreOffice export filters for --convert-to, per kind of source (Writer,
// Calc, Impress, Draw each have their own).
const OFFICE_FILTERS = {
  document: {
    docx: 'docx:MS Word 2007 XML',
    doc: 'doc:MS Word 97',
    odt: 'odt',
    rtf: 'rtf',
    pdf: 'pdf:writer_pdf_Export',
    html: 'html:XHTML Writer File:UTF8',
    txt: 'txt:Text (encoded):UTF8'
  },
  spreadsheet: {
    xlsx: 'xlsx:Calc MS Excel 2007 XML',
    xls: 'xls:MS Excel 97',
    ods: 'ods',
    // Comma-separated, double quotes, UTF-8; LibreOffice writes the first sheet.
    csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1',
    pdf: 'pdf:calc_pdf_Export',
    html: 'html:HTML (StarCalc)'
  },
  presentation: {
    pptx: 'pptx:Impress MS PowerPoint 2007 XML',
    ppt: 'ppt:MS PowerPoint 97',
    odp: 'odp',
    pdf: 'pdf:impress_pdf_Export'
  },
  drawing: {
    pdf: 'pdf:draw_pdf_Export',
    png: 'png:draw_png_Export',
    svg: 'svg:draw_svg_Export',
    odg: 'odg'
  }
};
// Import filters for sources LibreOffice would otherwise guess wrong.
const OFFICE_IMPORT = {
  pdf: 'writer_pdf_import',
  html: 'HTML (StarWriter)', // opens as a web page by default, which can't be saved as RTF/DOC
  csv: 'Text - txt - csv (StarCalc):44,34,76',
  tsv: 'Text - txt - csv (StarCalc):9,34,76'
};


function run(exe, args, { onStdout, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let stderr = '';
    let timer = timeout ? setTimeout(() => child.kill(), timeout) : null;
    child.stdout.on('data', (chunk) => onStdout?.(String(chunk)));
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || `exit ${code}`));
    });
  });
}

async function officeConvert(soffice, file, ext, out) {
  const work = tempDir();
  try {
    let source = file;
    // LibreOffice doesn't read Markdown; hand it the rendered HTML.
    if (extOf(file) === 'md') {
      source = path.join(work, path.basename(file, path.extname(file)) + '.html');
      await fs.promises.writeFile(source, await documentHtml(file));
    }
    // file:///C:/… on Windows, file:///private/var/… on macOS.
    const profile = require('url').pathToFileURL(path.join(work, 'profile')).href;
    const args = [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo'];
    const filter = OFFICE_FILTERS[kindOf(file)]?.[ext];
    if (!filter) throw new Error(`Can't convert to .${ext}`);
    const importFilter = OFFICE_IMPORT[extOf(source)];
    if (importFilter) args.push(`--infilter=${importFilter}`);
    args.push('--convert-to', filter, '--outdir', work, source);
    await run(soffice, args, { timeout: 180000 });
    const produced = fs.readdirSync(work).find((name) => extOf(name) === ext);
    if (!produced) throw new Error('LibreOffice produced no file');
    await fs.promises.copyFile(path.join(work, produced), out);
  } finally {
    fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Audio / video ─────────────────────────────────────────────────────────

const FFMPEG_ARGS = {
  mp4: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-sn'],
  mov: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-sn'],
  mkv: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-sn'],
  webm: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '128k', '-sn'],
  gif: ['-vf', "fps=12,scale='min(480,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer", '-an', '-sn'],
  mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-vn', '-c:a', 'pcm_s16le'],
  m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
  flac: ['-vn', '-c:a', 'flac'],
  ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
  opus: ['-vn', '-c:a', 'libopus', '-b:a', '160k']
};

async function ffmpegConvert(ffmpeg, file, ext, out, onProgress) {
  let duration = 0;
  const args = ['-hide_banner', '-nostdin', '-y', '-i', file, ...FFMPEG_ARGS[ext], '-progress', 'pipe:1', '-nostats', out];
  const child = spawn(ffmpeg, args, { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-16000);
    if (!duration) {
      const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3];
    }
  });
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      const m = /^out_time_us=(\d+)/.exec(line.trim());
      if (m && duration) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / duration));
    }
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      fs.promises.rm(out, { force: true }).catch(() => {});
      const lines = stderr.trim().split(/\r?\n/).filter((l) => !/^\s*(frame|size|Press)/.test(l));
      reject(new Error(lines.slice(-1)[0] || `ffmpeg exit ${code}`));
    });
  });
}

// ── Service ───────────────────────────────────────────────────────────────

function createConverter({ dir, log, renderPdf, onJob, getSettings, onModelStatus, onEngineStatus = () => {} }) {
  const vendor = path.join(dir, 'vendor', 'ffmpeg');
  const vendorExe = path.join(vendor, FFMPEG.exe);
  let ffmpegOnPath;
  let downloading = null;
  let nextId = 1;

  function pathFfmpeg() {
    if (ffmpegOnPath !== undefined) return ffmpegOnPath;
    ffmpegOnPath = null;
    // Apps started from Finder get a bare PATH; Homebrew lives outside it.
    const extra = MAC ? ['/opt/homebrew/bin', '/usr/local/bin'] : [];
    for (const folder of [...(process.env.PATH || '').split(path.delimiter), ...extra]) {
      const exe = path.join(folder.replace(/"/g, ''), FFMPEG.exe);
      if (folder && fs.existsSync(exe)) { ffmpegOnPath = exe; break; }
    }
    return ffmpegOnPath;
  }
  const ffmpeg = () => (fs.existsSync(vendorExe) ? vendorExe : pathFfmpeg());

  // Which engine a source/target pair needs.
  function engineFor(file, target) {
    const kind = kindOf(file);
    if (kind === 'image') return 'image';
    if (kind === 'video' || kind === 'audio') return 'ffmpeg';
    if (kind === 'document') return BUILTIN_DOC[extOf(file)]?.includes(target) ? 'document' : 'office';
    if (kind === 'spreadsheet' || kind === 'presentation' || kind === 'drawing') return 'office';
    return null;
  }

  const remover = createBackgroundRemover({ dir, log, getSettings, onStatus: (status) => { onModelStatus?.(status); onEngineStatus(engineStatus()); } });
  const office = createLibreOffice({ dir, log });
  const findLibreOffice = office.find;
  const installs = new Map(); // engine id → progress 0..1 while installing
  const failures = new Map(); // engine id → last error message

  function engines() {
    return { ffmpeg: !!ffmpeg(), office: !!findLibreOffice(), bgmodel: remover.installed() };
  }

  // What the first-run setup and Settings show: each engine, whether it's
  // ready (downloaded or already on the system) and any install progress.
  function engineStatus() {
    const entry = (id, label, about, size, ready, source) => ({
      id, label, about, size, ready, source,
      progress: installs.has(id) ? installs.get(id) : null,
      error: failures.get(id) || null
    });
    const ff = ffmpeg();
    const lo = findLibreOffice();
    return [
      entry('ffmpeg', 'ffmpeg', 'Video and audio', FFMPEG_SIZE, !!ff, ff ? (ff === vendorExe ? 'downloaded' : 'system') : null),
      entry('libreoffice', 'LibreOffice', 'Word, Excel, PowerPoint and other office files', office.info.size, !!lo, lo ? (office.bundled() && lo.includes('vendor') ? 'downloaded' : 'system') : null),
      entry('bgmodel', `${remover.label()} model`, 'Remove background', remover.size(), remover.installed(), remover.installed() ? 'downloaded' : null)
    ];
  }

  function installEngine(id, onProgress) {
    const step = { ffmpeg: downloadFfmpeg, libreoffice: office.install, bgmodel: (p) => remover.download(undefined, p) }[id];
    if (!step) return Promise.reject(new Error('Unknown engine'));
    failures.delete(id);
    installs.set(id, 0);
    onEngineStatus(engineStatus());
    let last = 0;
    return step((progress) => {
      installs.set(id, progress);
      onProgress?.(progress);
      if (Date.now() - last > 200) { last = Date.now(); onEngineStatus(engineStatus()); }
    }).catch((error) => {
      failures.set(id, String(error.message || error).split(/\r?\n/)[0].slice(0, 160));
      log(`engine ${id}: ${error.message}`);
      throw error;
    }).finally(() => {
      installs.delete(id);
      onEngineStatus(engineStatus());
    });
  }

  // First run: everything missing, one after another (smallest first).
  async function installMissing() {
    for (const engine of engineStatus()) {
      if (!engine.ready) await installEngine(engine.id).catch(() => {});
    }
    return engineStatus().every((e) => e.ready);
  }

  // What the wheel offers for a file.
  function menuFor(file) {
    const kind = kindOf(file);
    if (!kind) return null;
    const ext = extOf(file);
    const available = engines();
    const actions = [];
    if (kind === 'image' && ext !== 'svg') {
      actions.push({ id: 'edit', label: 'Edit', icon: 'edit' });
      actions.push({ id: 'crop', label: 'Crop', icon: 'crop' });
      actions.push({ id: 'removebg', label: 'Remove BG', icon: 'removebg', needs: 'bgmodel', ready: available.bgmodel });
    }
    for (const target of TARGETS[kind]) {
      if (target === ext) continue;
      // Office formats can't be read back as PDF text, so skip pdf→pdf-ish loops.
      const engine = engineFor(file, target);
      const needs = engine === 'ffmpeg' || engine === 'office' ? engine : null;
      actions.push({ id: `to:${target}`, label: target.toUpperCase(), target, needs, ready: needs ? available[needs] : true });
    }
    return { file, name: path.basename(file), kind, ext, actions };
  }

  async function downloadFfmpeg(onProgress) {
    if (downloading) return downloading;
    downloading = (async () => {
      const work = tempDir();
      try {
        const zip = path.join(work, MAC ? 'ffmpeg.gz' : 'ffmpeg.zip');
        await downloadVerified(FFMPEG.url, FFMPEG.sha256, zip, onProgress);
        if (MAC) {
          fs.mkdirSync(vendor, { recursive: true });
          await fs.promises.writeFile(vendorExe, require('zlib').gunzipSync(await fs.promises.readFile(zip)));
          await fs.promises.chmod(vendorExe, 0o755);
          // Apple Silicon kills unsigned binaries; an ad-hoc signature is enough.
          await run('/usr/bin/codesign', ['--force', '--sign', '-', vendorExe]);
          log(`ffmpeg ${FFMPEG_VERSION} installed`);
          return vendorExe;
        }
        // Windows' own bsdtar reads zip files.
        await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', work]);
        const folder = fs.readdirSync(work).find((name) => name.startsWith('ffmpeg-') && fs.statSync(path.join(work, name)).isDirectory());
        const exe = folder && path.join(work, folder, 'bin', 'ffmpeg.exe');
        if (!exe || !fs.existsSync(exe)) throw new Error('ffmpeg.exe missing from the download');
        fs.mkdirSync(vendor, { recursive: true });
        await fs.promises.copyFile(exe, vendorExe);
        const license = path.join(work, folder, 'LICENSE');
        if (fs.existsSync(license)) await fs.promises.copyFile(license, path.join(vendor, 'LICENSE.txt'));
        log(`ffmpeg ${FFMPEG_VERSION} installed`);
        return vendorExe;
      } finally {
        downloading = null;
        fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
      }
    })();
    return downloading;
  }

  // Background removal: a transparent PNG, "photo (no background).png".
  async function removeBackground(file) {
    const job = { id: nextId++, name: path.basename(file), target: 'no background', status: 'running', progress: 0 };
    const report = (patch) => { Object.assign(job, patch); onJob({ ...job }); };
    report({});
    let out;
    try {
      out = freePath(path.dirname(file), path.basename(file, path.extname(file)) + ' (no background)', 'png');
      await remover.removeBackground((await loadImage(file)).rotate(), out, (progress) => report({ progress }));
      report({ status: 'done', progress: 1, output: out });
      return out;
    } catch (error) {
      log('remove background ' + job.name + ': ' + error.message);
      dropPlaceholder(out);
      report({ status: 'error', error: error.message });
      throw error;
    }
  }

  // The editor's Remove background: the cut-out as a PNG data URL.
  async function removeBackgroundImage(file) {
    const png = await remover.removeBackground((await loadImage(file)).rotate(), null);
    return `data:image/png;base64,${png.toString('base64')}`;
  }

  function downloadEngine(name, onProgress) {
    if (name === 'ffmpeg') return installEngine('ffmpeg', onProgress);
    if (name === 'office') return installEngine('libreoffice', onProgress);
    if (name === 'bgmodel') return installEngine('bgmodel', onProgress);
    return Promise.reject(new Error('Unknown download'));
  }

  async function convert(file, target) {
    const id = nextId++;
    const kind = kindOf(file);
    const name = path.basename(file);
    const engine = engineFor(file, target);
    if (!kind || !TARGETS[kind].includes(target) || !engine) throw new Error(`Can't convert ${name} to ${target}`);
    const job = { id, name, target: target.toUpperCase(), status: 'running', progress: 0 };
    const report = (patch) => { Object.assign(job, patch); onJob({ ...job }); };
    report({});
    let out;
    try {
      out = outputFor(file, target);
      if (engine === 'image') {
        await saveImage((await loadImage(file)).rotate(), target, out);
      } else if (engine === 'ffmpeg') {
        const exe = ffmpeg();
        if (!exe) throw new Error('ffmpeg is not installed');
        await ffmpegConvert(exe, file, target, out, (progress) => report({ progress }));
      } else if (engine === 'document') {
        const html = await documentHtml(file);
        if (target === 'html') await fs.promises.writeFile(out, html);
        else if (target === 'md') await fs.promises.writeFile(out, extOf(file) === 'pdf' ? (await pdfText(file)).join('\n\n---\n\n') + '\n' : htmlToMarkdown(html));
        else if (target === 'txt') await fs.promises.writeFile(out, extOf(file) === 'pdf' ? (await pdfText(file)).join('\n\n\f') + '\n' : htmlToText(html));
        else if (target === 'pdf') await fs.promises.writeFile(out, await renderPdf(html, file));
      } else {
        const soffice = findLibreOffice();
        if (!soffice) throw new Error('LibreOffice is not installed');
        // Markdown out of an office file: let LibreOffice make HTML first.
        if (target === 'md') {
          const work = tempDir();
          try {
            const html = path.join(work, 'doc.html');
            await officeConvert(soffice, file, 'html', html);
            await fs.promises.writeFile(out, htmlToMarkdown(await fs.promises.readFile(html, 'utf8')));
          } finally { fs.promises.rm(work, { recursive: true, force: true }).catch(() => {}); }
        } else await officeConvert(soffice, file, target, out);
      }
      report({ status: 'done', progress: 1, output: out });
      return out;
    } catch (error) {
      log(`convert ${name} → ${target}: ${error.message}`);
      dropPlaceholder(out);
      report({ status: 'error', error: error.message });
      throw error;
    }
  }

  // Editor output: a PNG from the canvas, re-encoded as `target`.
  async function saveEdited(file, png, target) {
    const sharp = require('sharp');
    const kind = kindOf(file);
    if (kind !== 'image' || !TARGETS.image.includes(target)) throw new Error('Unsupported format');
    const out = outputFor(file, target);
    const job = { id: nextId++, name: path.basename(file), target: target.toUpperCase(), status: 'running', progress: 0 };
    onJob({ ...job });
    try {
      await saveImage(sharp(png), target, out);
      onJob({ ...job, status: 'done', progress: 1, output: out });
      return out;
    } catch (error) {
      dropPlaceholder(out);
      onJob({ ...job, status: 'error', error: error.message });
      throw error;
    }
  }

  return {
    kindOf,
    menuFor,
    convert,
    saveEdited,
    previewImage,
    engines,
    downloadEngine,
    removeBackground,
    removeBackgroundImage,
    downloadSizes: () => ({ ffmpeg: FFMPEG_SIZE, office: `LibreOffice · ${office.info.size}`, bgmodel: `${remover.label()} · ${remover.size()}` }),
    engineStatus,
    installEngine,
    installMissing,
    models: { status: remover.status, download: remover.download, remove: remover.remove },
    libreOfficeUrl: LIBREOFFICE_URL
  };
}

// Every extension the wheel opens on, aliases included (for the helper's filter).
const EXTENSIONS = [...Object.values(KINDS).flat(), ...Object.keys(EXT_ALIASES)];

module.exports = { createConverter, kindOf, extOf, outputFor, TARGETS, EXTENSIONS };
